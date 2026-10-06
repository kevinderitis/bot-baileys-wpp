import cron from 'node-cron';
import ScheduledMessage from '../models/ScheduledMessage.js';
import ScheduledImage from '../models/ScheduledImage.js';
import { getSocket } from '../socket.js';
import logger from '../utils/logger.js';

class Scheduler {
  constructor() {
    this.jobs = new Map();
    this.cachedMessages = [];
    this.lastCacheUpdate = null;
  }

  async start() {
    await this.loadJobs();
    cron.schedule('* * * * *', () => this.checkDue());
    logger.info('Scheduler started');
  }

  async loadJobs() {
    try {
      const messages = await ScheduledMessage.find({ isActive: true }).lean();
      this.cachedMessages = messages;
      this.lastCacheUpdate = new Date();
      for (const msg of messages) {
        this.scheduleJob(msg);
      }
      logger.info({ count: messages.length }, 'Jobs loaded from MongoDB');
    } catch (err) {
      logger.error({ err }, 'Error loading jobs from MongoDB, using cache');
    }
  }

  scheduleJob(doc) {
    if (this.jobs.has(doc._id.toString())) {
      this.jobs.get(doc._id.toString()).stop();
    }
    const cronExpr = this.toCron(doc.schedule);
    const job = cron.schedule(cronExpr, () => this.execute(doc));
    this.jobs.set(doc._id.toString(), job);
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
    try {
      const fresh = await ScheduledMessage.find({ isActive: true }).lean().maxTimeMS(5000);
      this.cachedMessages = fresh;
      this.lastCacheUpdate = new Date();
    } catch (err) {
      logger.error({ err }, 'Error refreshing cache, using stale data');
    }
    const now = new Date();
    const due = this.cachedMessages.filter(m => m.isActive && m.nextRun && new Date(m.nextRun) <= now);
    const activeCount = this.cachedMessages.filter(m => m.isActive).length;
    const nowBangkok = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
    logger.info({
      time: now.toISOString(),
      timeBangkok: nowBangkok.toISOString(),
      dueCount: due.length,
      activeCount,
      totalCached: this.cachedMessages.length,
      nextRuns: this.cachedMessages.map(m => ({ id: m._id, name: m.name, nextRun: m.nextRun, isActive: m.isActive })),
    }, 'Scheduler check');
    if (due.length > 0) {
      logger.info({ messages: due.map(m => ({ id: m._id, name: m.name, target: m.targetName })) }, 'Due messages found');
    }
    for (const doc of due) {
      await this.execute(doc);
    }
  }

  async execute(doc) {
    const sock = getSocket();
    if (!sock) {
      logger.warn({ id: doc._id, name: doc.name }, 'Socket not available, skipping');
      return;
    }
    logger.info({ id: doc._id, name: doc.name, target: doc.targetName, targetId: doc.targetId, hasImage: !!doc.imageId }, 'Attempting to send scheduled message');
    try {
      let imageData = null;
      let imageMime = 'image/jpeg';
      if (doc.imageId) {
        try {
          const img = await ScheduledImage.findById(doc.imageId).lean();
          if (img) {
            imageData = img.data;
            imageMime = img.mimeType;
          }
        } catch (err) {
          logger.error({ err, id: doc._id }, 'Error loading image');
        }
      }
      if (imageData) {
        const buffer = Buffer.from(imageData, 'base64');
        await sock.sendMessage(doc.targetId, { image: buffer, caption: doc.message || '', mimetype: imageMime });
      } else {
        await sock.sendMessage(doc.targetId, { text: doc.message });
      }
      doc.lastSent = new Date();
      doc.nextRun = this.calculateNextRun(doc.schedule);
      this.scheduleJob(doc);
      try {
        await ScheduledMessage.findByIdAndUpdate(doc._id, { lastSent: doc.lastSent, nextRun: doc.nextRun });
      } catch (err) {
        logger.error({ err }, 'Error updating message in DB');
      }
      logger.info({ id: doc._id, name: doc.name, target: doc.targetName, nextRun: doc.nextRun }, 'Scheduled message sent successfully');
    } catch (err) {
      logger.error({ err, id: doc._id, name: doc.name, target: doc.targetName }, 'Error sending scheduled message');
    }
  }

  calculateNextRun(schedule) {
    const now = new Date();
    const tz = schedule.timezone || 'Asia/Bangkok';
    const [hh, mm] = schedule.time.split(':').map(Number);

    const nowInTz = new Date(now.toLocaleString('en-US', { timeZone: tz }));
    const runDate = new Date(nowInTz);
    runDate.setHours(hh, mm, 0, 0);

    if (schedule.type === 'daily') {
      if (runDate <= nowInTz) runDate.setDate(runDate.getDate() + 1);
    } else if (schedule.type === 'weekly') {
      const days = schedule.daysOfWeek || [nowInTz.getDay()];
      let nextDay = days.find(d => {
        const candidate = new Date(runDate);
        const diff = (d - candidate.getDay() + 7) % 7;
        candidate.setDate(candidate.getDate() + diff);
        return candidate > nowInTz;
      });
      if (nextDay === undefined) nextDay = days[0];
      const diff = (nextDay - runDate.getDay() + 7) % 7;
      runDate.setDate(runDate.getDate() + diff);
      if (runDate <= nowInTz) runDate.setDate(runDate.getDate() + 7);
    } else {
      if (runDate <= nowInTz) runDate.setDate(runDate.getDate() + 1);
    }

    const tzOffsetMs = (() => {
      const utcStr = now.toLocaleString('en-US', { timeZone: 'UTC' });
      const tzStr = now.toLocaleString('en-US', { timeZone: tz });
      return (new Date(utcStr) - new Date(tzStr));
    })();

    return new Date(runDate.getTime() + tzOffsetMs);
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