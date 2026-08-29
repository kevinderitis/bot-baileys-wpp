import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getSocket, getIsConnected } from '../socket.js';
import { simulateTyping } from '../utils/typing.js';
import { getRandomDelay, sleep, randomBetween } from '../utils/delays.js';
import logger from '../utils/logger.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_STORE_PATH = path.resolve('data/schedules.json');

function normalizeText(value) {
  return String(value || '').trim();
}

function sortByDate(a, b) {
  return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
}

function getNextDateForWeekday(day, time) {
  const [hours, minutes] = time.split(':').map(Number);
  const now = new Date();
  const target = new Date(now);
  target.setHours(hours, minutes, 0, 0);

  const today = target.getDay();
  let offset = day - today;
  if (offset < 0 || (offset === 0 && target <= now)) {
    offset += 7;
  }
  target.setTime(target.getTime() + offset * DAY_MS);
  return target;
}

class Scheduler {
  constructor({ storePath = DEFAULT_STORE_PATH } = {}) {
    this.storePath = storePath;
    this.jobs = [];
    this.timer = null;
    this.isProcessing = false;
  }

  async start() {
    await this.load();
    this.scheduleNextRun();
    logger.info({ jobs: this.jobs.length }, 'Scheduler de mensajes iniciado');
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async load() {
    try {
      const raw = await fs.readFile(this.storePath, 'utf8');
      this.jobs = JSON.parse(raw).map(job => ({
        ...job,
        status: job.status === 'sending' ? 'pending' : job.status || 'pending',
      }));
    } catch (err) {
      if (err.code !== 'ENOENT') logger.error({ err }, 'No se pudieron cargar los mensajes programados');
      this.jobs = [];
    }
  }

  async save() {
    await fs.mkdir(path.dirname(this.storePath), { recursive: true });
    await fs.writeFile(this.storePath, JSON.stringify(this.jobs, null, 2));
  }

  listJobs() {
    return [...this.jobs].sort(sortByDate);
  }

  async createJobs({ groupJids, groups = [], message, scheduledAt, weekdays = [], weeklyTime = '' }) {
    const cleanMessage = normalizeText(message);
    const selectedJids = Array.isArray(groupJids) ? groupJids.filter(Boolean) : [];

    if (!cleanMessage) throw new Error('El mensaje es requerido');
    if (selectedJids.length === 0) throw new Error('Selecciona al menos un grupo');

    const groupByJid = new Map(groups.map(group => [group.jid, group.name]));
    const dates = [];

    if (scheduledAt) {
      const date = new Date(scheduledAt);
      if (Number.isNaN(date.getTime())) throw new Error('Fecha inválida');
      dates.push(date);
    }

    if (Array.isArray(weekdays) && weekdays.length > 0) {
      if (!/^\d{2}:\d{2}$/.test(weeklyTime)) throw new Error('Hora semanal inválida');
      for (const day of weekdays.map(Number)) {
        if (day >= 0 && day <= 6) dates.push(getNextDateForWeekday(day, weeklyTime));
      }
    }

    const futureDates = dates.filter(date => date.getTime() > Date.now());
    if (futureDates.length === 0) throw new Error('Programa al menos una fecha futura');

    const created = [];
    for (const groupJid of selectedJids) {
      for (const date of futureDates) {
        created.push({
          id: randomUUID(),
          groupJid,
          groupName: groupByJid.get(groupJid) || groupJid,
          message: cleanMessage,
          scheduledAt: date.toISOString(),
          status: 'pending',
          attempts: 0,
          createdAt: new Date().toISOString(),
          sentAt: null,
          lastError: null,
        });
      }
    }

    this.jobs.push(...created);
    await this.save();
    this.scheduleNextRun();
    logger.info({ count: created.length }, 'Mensajes programados creados');
    return created.sort(sortByDate);
  }

  async updateJob(id, { groupJid, groups = [], message, scheduledAt }) {
    const job = this.jobs.find(item => item.id === id);
    if (!job) throw new Error('Programación no encontrada');
    if (!['pending', 'failed', 'canceled'].includes(job.status)) {
      throw new Error('Solo se pueden editar mensajes pendientes, fallidos o cancelados');
    }

    const cleanMessage = normalizeText(message);
    if (!cleanMessage) throw new Error('El mensaje es requerido');

    const date = new Date(scheduledAt);
    if (Number.isNaN(date.getTime())) throw new Error('Fecha inválida');
    if (date.getTime() <= Date.now()) throw new Error('La fecha debe ser futura');

    const groupByJid = new Map(groups.map(group => [group.jid, group.name]));
    if (groupJid) {
      job.groupJid = groupJid;
      job.groupName = groupByJid.get(groupJid) || groupJid;
    }

    job.message = cleanMessage;
    job.scheduledAt = date.toISOString();
    job.status = 'pending';
    job.lastError = null;
    job.updatedAt = new Date().toISOString();
    await this.save();
    this.scheduleNextRun();
    return job;
  }

  async deleteJob(id) {
    const index = this.jobs.findIndex(item => item.id === id);
    if (index === -1) throw new Error('Programación no encontrada');
    const [job] = this.jobs.splice(index, 1);
    await this.save();
    this.scheduleNextRun();
    return job;
  }

  scheduleNextRun() {
    if (this.timer) clearTimeout(this.timer);

    const nextJob = this.jobs
      .filter(job => job.status === 'pending')
      .sort(sortByDate)[0];

    if (!nextJob) {
      this.timer = null;
      return;
    }

    const msUntilNext = Math.max(0, new Date(nextJob.scheduledAt).getTime() - Date.now());
    const waitMs = Math.min(msUntilNext, MAX_TIMEOUT_MS);
    this.timer = setTimeout(() => {
      this.processDueJobs().catch(err => logger.error({ err }, 'Error procesando jobs programados'));
    }, waitMs);
  }

  async processDueJobs() {
    if (this.isProcessing) {
      this.scheduleNextRun();
      return;
    }
    if (!getIsConnected()) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.processDueJobs().catch(err => logger.error({ err }, 'Error procesando jobs programados'));
      }, 15000);
      return;
    }

    this.isProcessing = true;

    try {
      const dueJobs = this.jobs
        .filter(job => job.status === 'pending' && new Date(job.scheduledAt).getTime() <= Date.now())
        .sort(sortByDate);

      for (const job of dueJobs) {
        await this.sendJob(job);
        await this.save();
        await sleep(randomBetween(2500, 8000));
      }
    } finally {
      this.isProcessing = false;
      this.scheduleNextRun();
    }
  }

  async sendJob(job) {
    const sock = getSocket();
    if (!sock) return;

    job.status = 'sending';
    job.attempts += 1;
    job.updatedAt = new Date().toISOString();

    try {
      const delay = getRandomDelay();
      logger.info(
        { groupName: job.groupName, groupJid: job.groupJid, delayMs: Math.round(delay) },
        'Esperando antes de enviar mensaje programado'
      );
      await sleep(delay);
      await simulateTyping(sock, job.groupJid, job.message);
      await sock.sendMessage(job.groupJid, { text: job.message });
      job.status = 'sent';
      job.sentAt = new Date().toISOString();
      job.lastError = null;
      logger.info({ groupName: job.groupName, groupJid: job.groupJid }, 'MENSAJE PROGRAMADO ENVIADO');
    } catch (err) {
      job.status = job.attempts >= 3 ? 'failed' : 'pending';
      job.lastError = err.message;
      job.updatedAt = new Date().toISOString();
      logger.error({ err, jobId: job.id, groupName: job.groupName }, 'Error enviando mensaje programado');
    }
  }
}

export default Scheduler;
