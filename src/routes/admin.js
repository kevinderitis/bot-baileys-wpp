import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getSocket, getRealPhone, getIsConnected, startBot, stopBot, isBotEnabled, getQR } from '../socket.js';
import ScheduledMessage from '../models/ScheduledMessage.js';
import BotSettings from '../models/BotSettings.js';
import config from '../config.js';
import logger from '../utils/logger.js';

const router = express.Router();
const JWT_SECRET = config.admin?.jwtSecret || 'super-secret-change-me';
const ADMIN_USER = config.admin?.username || 'admin';
const ADMIN_PASS_HASH = config.admin?.passwordHash || '$2b$10$zCaoUg/FafR5i/y4OqFvVu8XVMQy5LgtgZ/N56PWYc0KCkbeaeYLu';

function authMiddleware(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (username !== ADMIN_USER) return res.status(401).json({ error: 'Credenciales inválidas' });
  const valid = await bcrypt.compare(password, ADMIN_PASS_HASH);
  if (!valid) return res.status(401).json({ error: 'Credenciales inválidas' });
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'lax' });
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

router.get('/me', authMiddleware, (req, res) => {
  res.json({ username: req.user.username });
});

function getGroups() {
  const sock = getSocket();
  if (!sock) return [];
  const groups = [];
  try {
    const chats = sock.chats;
    if (chats && typeof chats.values === 'function') {
      for (const [jid, chat] of chats) {
        if (jid.endsWith('@g.us')) {
          groups.push({
            id: jid,
            name: chat.name || chat.subject || 'Sin nombre',
            participants: chat.participants?.length || 0,
          });
        }
      }
    }
  } catch (e) {
    logger.error({ err: e }, 'Error obteniendo grupos');
  }
  return groups;
}

function getContacts() {
  const sock = getSocket();
  if (!sock) return [];
  const contacts = [];
  for (const [jid, contact] of Object.entries(sock.contacts || {})) {
    if (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid.g.whatsapp.net')) {
      contacts.push({
        id: jid,
        name: contact.name || contact.notify || 'Sin nombre',
        phone: contact.phone || jid.replace(/@.*$/, ''),
      });
    }
  }
  return contacts;
}

router.get('/groups', authMiddleware, (req, res) => {
  res.json({ groups: getGroups() });
});

router.get('/contacts', authMiddleware, (req, res) => {
  res.json({ contacts: getContacts() });
});

router.get('/scheduled', authMiddleware, async (req, res) => {
  const messages = await ScheduledMessage.find().sort({ createdAt: -1 }).lean();
  res.json({ messages });
});

router.post('/scheduled', authMiddleware, async (req, res) => {
  const { name, message, image, imageMimeType, targetType, targetId, targetName, schedule } = req.body;
  if (!name || !message || !targetType || !targetId || !targetName || !schedule) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }
  const nextRun = calculateNextRun(schedule);
  const doc = await ScheduledMessage.create({ name, message, image: image || '', imageMimeType: imageMimeType || '', targetType, targetId, targetName, schedule, nextRun });
  res.json({ message: doc });
});

router.put('/scheduled/:id', authMiddleware, async (req, res) => {
  const { name, message, image, imageMimeType, targetType, targetId, targetName, schedule, isActive } = req.body;
  const update = { name, message, image: image || '', imageMimeType: imageMimeType || '', targetType, targetId, targetName, schedule, isActive };
  if (schedule) update.nextRun = calculateNextRun(schedule);
  const doc = await ScheduledMessage.findByIdAndUpdate(req.params.id, update, { new: true });
  if (!doc) return res.status(404).json({ error: 'No encontrado' });
  res.json({ message: doc });
});

router.delete('/scheduled/:id', authMiddleware, async (req, res) => {
  await ScheduledMessage.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

router.post('/scheduled/:id/test', authMiddleware, async (req, res) => {
  const doc = await ScheduledMessage.findById(req.params.id);
  if (!doc) return res.status(404).json({ error: 'No encontrado' });
  await sendToTarget(doc.targetType, doc.targetId, doc.message, doc.image, doc.imageMimeType);
  res.json({ ok: true });
});

async function sendToTarget(targetType, targetId, text, image = '', imageMimeType = '') {
  const sock = getSocket();
  if (!sock) throw new Error('Socket no disponible');
  const jid = targetType === 'group' ? targetId : targetId;
  if (image) {
    const buffer = Buffer.from(image, 'base64');
    await sock.sendMessage(jid, { image: buffer, caption: text || '', mimetype: imageMimeType || 'image/jpeg' });
  } else {
    await sock.sendMessage(jid, { text });
  }
  logger.info({ targetType, targetId, hasImage: !!image }, 'Mensaje programado enviado');
}

function calculateNextRun(schedule) {
  const now = new Date();
  const tz = schedule.timezone || 'Asia/Bangkok';
  const [hh, mm] = schedule.time.split(':').map(Number);

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(now);
  const get = t => parseInt(parts.find(p => p.type === t)?.value || '0');
  const runDate = new Date(get('year'), get('month') - 1, get('day'), hh, mm, 0, 0);

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

router.get('/bot/status', authMiddleware, (req, res) => {
  res.json({
    connected: getIsConnected(),
    enabled: isBotEnabled(),
    aiEnabled: config.groq.enabled,
    config: {
      model: config.groq.model,
      maxTokens: config.groq.maxTokens,
      temperature: config.groq.temperature,
      minDelay: config.bot.minDelaySeconds,
      maxDelay: config.bot.maxDelaySeconds,
      typingSpeed: config.bot.typingSpeedCPS,
      maxContext: config.ai.maxContextMessages,
      summarizeAfter: config.ai.summarizeAfter,
    },
  });
});

router.post('/bot/toggle', authMiddleware, (req, res) => {
  config.groq.enabled = !config.groq.enabled;
  res.json({ ok: true, aiEnabled: config.groq.enabled });
});

router.get('/bot/qr', authMiddleware, async (req, res) => {
  const qr = getQR();
  if (!qr) return res.json({ qr: null });
  const QRCode = (await import('qrcode')).default;
  const dataUrl = await QRCode.toDataURL(qr);
  res.json({ qr: dataUrl });
});

router.post('/bot/start', authMiddleware, (req, res) => {
  startBot();
  res.json({ ok: true });
});

router.post('/bot/stop', authMiddleware, (req, res) => {
  stopBot();
  res.json({ ok: true });
});

router.put('/bot/config', authMiddleware, (req, res) => {
  const { model, maxTokens, temperature, minDelay, maxDelay, typingSpeed, maxContext, summarizeAfter } = req.body;
  if (model) config.groq.model = model;
  if (maxTokens) config.groq.maxTokens = maxTokens;
  if (temperature !== undefined) config.groq.temperature = temperature;
  if (minDelay) config.bot.minDelaySeconds = minDelay;
  if (maxDelay) config.bot.maxDelaySeconds = maxDelay;
  if (typingSpeed) config.bot.typingSpeedCPS = typingSpeed;
  if (maxContext) config.ai.maxContextMessages = maxContext;
  if (summarizeAfter) config.ai.summarizeAfter = summarizeAfter;
  res.json({ ok: true, config: {
    model: config.groq.model,
    maxTokens: config.groq.maxTokens,
    temperature: config.groq.temperature,
    minDelay: config.bot.minDelaySeconds,
    maxDelay: config.bot.maxDelaySeconds,
    typingSpeed: config.bot.typingSpeedCPS,
    maxContext: config.ai.maxContextMessages,
    summarizeAfter: config.ai.summarizeAfter,
  }});
});

router.get('/bot/purpose', authMiddleware, async (req, res) => {
  const setting = await BotSettings.findOne({ key: 'botPurpose' });
  res.json({ purpose: setting?.value || '' });
});

router.put('/bot/purpose', authMiddleware, async (req, res) => {
  const { purpose } = req.body;
  await BotSettings.findOneAndUpdate(
    { key: 'botPurpose' },
    { $set: { value: purpose } },
    { upsert: true }
  );
  res.json({ ok: true });
});

export default router;