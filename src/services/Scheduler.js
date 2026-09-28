import cron from 'node-cron';
import ScheduledMessage from '../models/ScheduledMessage.js';
import { getSocket } from '../socket.js';
import logger from '../utils/logger.js';

class Scheduler {
  constructor() {
    this.jobs = new Map();
  }

  async start() {
    await this.loadJobs();
    cron.schedule('* * * * *', () => this.checkDue());
    logger.info('Scheduler iniciado');
  }

  async loadJobs() {
    const messages = await ScheduledMessage.find({ isActive: true });
    for (const msg of messages) {
      this.scheduleJob(msg);
    }
  }

  scheduleJob(doc) {
    if (this.jobs.has(doc._id.toString())) {
      this.jobs.get(doc._id.toString()).stop();
    }
    const cronExpr = this.toCron(doc.schedule);
    const job = cron.schedule(cronExpr, () => this.execute(doc));
    this.jobs.set(doc._id.toString(), job);
    logger.info({ id: doc._id, cron: cronExpr }, 'Job programado');
  }

  toCron(schedule) {
    const [hh, mm] = schedule.time.split(':').map(Number);
    if (schedule.type === 'daily') {
      return `${mm} ${hh} * * *`;
    }
    if (schedule.type === 'weekly') {
      const days = (schedule.daysOfWeek || []).join(',');
      return `${mm} ${hh} * * ${days}`;
    }
    return `${mm} ${hh} * * *`;
  }

  async checkDue() {
    const now = new Date();
    const due = await ScheduledMessage.find({
      isActive: true,
      nextRun: { $lte: now },
    });
    for (const doc of due) {
      await this.execute(doc);
    }
  }

  async execute(doc) {
    const sock = getSocket();
    if (!sock) {
      logger.warn({ id: doc._id }, 'Socket no disponible, reintentando en 1 min');
      return;
    }
    try {
      if (doc.image) {
        const buffer = Buffer.from(doc.image, 'base64');
        await sock.sendMessage(doc.targetId, { image: buffer, caption: doc.message || '', mimetype: doc.imageMimeType || 'image/jpeg' });
      } else {
        await sock.sendMessage(doc.targetId, { text: doc.message });
      }
      doc.lastSent = new Date();
      doc.nextRun = this.calculateNextRun(doc.schedule);
      await doc.save();
      this.scheduleJob(doc);
      logger.info({ id: doc._id, target: doc.targetId, hasImage: !!doc.image }, 'Mensaje programado enviado');
    } catch (err) {
      logger.error({ err, id: doc._id }, 'Error enviando mensaje programado');
    }
  }

  calculateNextRun(schedule) {
    const now = new Date();
    const [hh, mm] = schedule.time.split(':').map(Number);
    const runDate = new Date(now);
    runDate.setHours(hh, mm, 0, 0);

    if (schedule.type === 'daily') {
      if (runDate <= now) runDate.setDate(runDate.getDate() + 1);
    } else if (schedule.type === 'weekly') {
      const days = schedule.daysOfWeek || [now.getDay()];
      let nextDay = days.find(d => {
        const candidate = new Date(runDate);
        const diff = (d - candidate.getDay() + 7) % 7;
        candidate.setDate(candidate.getDate() + diff);
        return candidate > now;
      });
      if (nextDay === undefined) nextDay = days[0];
      const diff = (nextDay - runDate.getDay() + 7) % 7;
      runDate.setDate(runDate.getDate() + diff);
      if (runDate <= now) runDate.setDate(runDate.getDate() + 7);
    } else {
      if (runDate <= now) runDate.setDate(runDate.getDate() + 1);
    }
    return runDate;
  }

  refreshJob(doc) {
    this.scheduleJob(doc);
  }

  removeJob(id) {
    const job = this.jobs.get(id);
    if (job) {
      job.stop();
      this.jobs.delete(id);
    }
  }
}

export default Scheduler;