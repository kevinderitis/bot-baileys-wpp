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
      logger.info({ count: messages.length }, 'Jobs loaded from MongoDB');
    } catch (err) {
      logger.error({ err }, 'Error loading jobs from MongoDB, using cache');
    }
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
      const fresh = await ScheduledMessage.findById(doc._id).lean().maxTimeMS(5000);
      if (!fresh) {
        logger.warn({ id: doc._id }, 'Message not found in DB, skipping');
        return;
      }
      if (!fresh.isActive) {
        logger.info({ id: doc._id }, 'Message is inactive, skipping');
        return;
      }
      if (fresh.sending) {
        logger.warn({ id: doc._id }, 'Message is already being sent, skipping duplicate');
        return;
      }
      const now = new Date();
      if (fresh.lastSent) {
        const lastSent = new Date(fresh.lastSent);
        const diffMinutes = (now - lastSent) / 60000;
        if (diffMinutes < 60) {
          logger.warn({ id: doc._id, lastSent: fresh.lastSent, diffMinutes }, 'Message was sent less than 60 minutes ago, skipping');
          return;
        }
      }
      if (!fresh.nextRun || new Date(fresh.nextRun) > now) {
        logger.info({ id: doc._id, nextRun: fresh.nextRun, now: now.toISOString() }, 'Message no longer due (DB check), skipping');
        return;
      }
      const locked = await ScheduledMessage.findOneAndUpdate(
        { _id: doc._id, sending: { $ne: true } },
        { $set: { sending: true } },
        { new: true }
      ).maxTimeMS(5000);
      if (!locked) {
        logger.warn({ id: doc._id }, 'Failed to lock message for sending, skipping');
        return;
      }
      const nextRun = this.calculateNextRun(fresh.schedule);
      let imageData = null;
      let imageMime = 'image/jpeg';
      if (fresh.imageId) {
        try {
          const img = await ScheduledImage.findById(fresh.imageId).lean();
          if (img) {
            imageData = img.data;
            imageMime = img.mimeType;
          }
        } catch (err) {
          logger.error({ err, id: doc._id }, 'Error loading image');
        }
      }
      try {
        if (imageData) {
          const buffer = Buffer.from(imageData, 'base64');
          await sock.sendMessage(doc.targetId, { image: buffer, caption: doc.message || '', mimetype: imageMime });
        } else {
          await sock.sendMessage(doc.targetId, { text: doc.message });
        }
        await ScheduledMessage.findByIdAndUpdate(doc._id, { $set: { lastSent: new Date(), nextRun }, $unset: { sending: '' } }).maxTimeMS(5000);
        logger.info({ id: doc._id, name: doc.name, target: doc.targetName, nextRun }, 'Scheduled message sent successfully');
      } catch (sendErr) {
        logger.error({ err: sendErr, id: doc._id }, 'Error sending message, will retry next minute');
        await ScheduledMessage.findByIdAndUpdate(doc._id, { $unset: { sending: '' } }).maxTimeMS(5000);
      }
    } catch (err) {
      logger.error({ err, id: doc._id, name: doc.name, target: doc.targetName }, 'Error in scheduled message execution');
    }
  }

  calculateNextRun(schedule) {
    const now = new Date();
    const tz = schedule.timezone || 'Asia/Bangkok';
    const [hh, mm] = schedule.time.split(':').map(Number);

    const nowUtc = now.getTime();
    const tzOffsetMs = this.getTzOffsetMs(now, tz);

    const nowInTzMs = nowUtc + tzOffsetMs;
    const runDateUtc = new Date(nowInTzMs);
    runDateUtc.setUTCHours(hh, mm, 0, 0);

    if (schedule.type === 'daily') {
      if (runDateUtc.getTime() <= nowInTzMs) runDateUtc.setUTCDate(runDateUtc.getUTCDate() + 1);
    } else if (schedule.type === 'weekly') {
      const days = schedule.daysOfWeek || [runDateUtc.getUTCDay()];
      let nextDay = days.find(d => {
        const candidate = new Date(runDateUtc);
        const diff = (d - candidate.getUTCDay() + 7) % 7;
        candidate.setUTCDate(candidate.getUTCDate() + diff);
        return candidate.getTime() > nowInTzMs;
      });
      if (nextDay === undefined) nextDay = days[0];
      const diff = (nextDay - runDateUtc.getUTCDay() + 7) % 7;
      runDateUtc.setUTCDate(runDateUtc.getUTCDate() + diff);
      if (runDateUtc.getTime() <= nowInTzMs) runDateUtc.setUTCDate(runDateUtc.getUTCDate() + 7);
    } else {
      if (runDateUtc.getTime() <= nowInTzMs) runDateUtc.setUTCDate(runDateUtc.getUTCDate() + 1);
    }

    return new Date(runDateUtc.getTime() - tzOffsetMs);
  }

  getTzOffsetMs(date, tz) {
    const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' });
    const tzStr = date.toLocaleString('en-US', { timeZone: tz });
    return new Date(tzStr).getTime() - new Date(utcStr).getTime();
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