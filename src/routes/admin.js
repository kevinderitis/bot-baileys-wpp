import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getSocket, getRealPhone } from '../socket.js';
import ScheduledMessage from '../models/ScheduledMessage.js';
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
  for (const [jid, chat] of sock.chats.all()) {
    if (jid.endsWith('@g.us')) {
      groups.push({
        id: jid,
        name: chat.name || 'Sin nombre',
        participants: chat.participants?.length || 0,
      });
    }
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
  } else if (schedule.type === 'custom') {
    if (runDate <= now) runDate.setDate(runDate.getDate() + 1);
  }
  return runDate;
}

export default router;