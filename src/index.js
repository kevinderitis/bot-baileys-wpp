import express from 'express';
import mongoose from 'mongoose';
import cookieParser from 'cookie-parser';
import QR from 'qrcode';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import createSocket, { setMessageHandler, getQR, getIsConnected, startBot } from './socket.js';
import { clearAllAuth } from './services/auth-state.js';
import makeHandler from './handlers/message.js';
import chatRoutes from './routes/chat.js';
import adminRoutes from './routes/admin.js';
import Scheduler from './services/Scheduler.js';
import config from './config.js';
import logger from './utils/logger.js';

logger.info('Iniciando Bot de WhatsApp con Baileys...');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (config.mongo.enabled) {
  try {
    await mongoose.connect(config.mongo.uri, {
      serverSelectionTimeoutMS: 60000,
      socketTimeoutMS: 60000,
      connectTimeoutMS: 30000,
      heartbeatFrequencyMS: 15000,
      maxPoolSize: 5,
      retryWrites: true,
      retryReads: true,
    });
    logger.info('Conectado a MongoDB');
  } catch (err) {
    logger.error({ err }, 'Error conectando a MongoDB');
  }
} else {
  logger.warn('MongoDB no configurado. El historial NO se persistirá.');
}

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB desconectado, intentando reconectar...');
  setTimeout(() => {
    mongoose.connect(config.mongo.uri, {
      serverSelectionTimeoutMS: 60000,
      socketTimeoutMS: 60000,
      connectTimeoutMS: 30000,
      heartbeatFrequencyMS: 15000,
    }).catch(err => logger.error({ err }, 'Error reconectando MongoDB'));
  }, 5000);
});

if (config.groq.enabled && config.mongo.enabled) {
  logger.info({ model: config.groq.model }, 'Groq API configurado');
} else if (config.groq.enabled && !config.mongo.enabled) {
  logger.warn('GROQ_API_KEY presente pero MongoDB requerido para IA. Usando respuestas por reglas.');
} else {
  logger.warn('GROQ_API_KEY no configurada. Usando respuestas por reglas.');
}

const app = express();
const scheduler = new Scheduler();

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use('/api', chatRoutes);
app.use('/api/admin', adminRoutes);
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', mongodb: mongoose.connection.readyState === 1, groq: config.groq.enabled });
});

app.get('/qr', async (req, res) => {
  if (getIsConnected()) {
    return res.send(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Arena Bot - Connected</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5;flex-direction:column;text-align:center;padding:20px}
.card{background:white;border-radius:12px;padding:30px;box-shadow:0 4px 20px rgba(0,0,0,0.1);max-width:400px;width:100%}
.status{display:inline-block;width:12px;height:12px;border-radius:50%;margin-right:8px}
.status.online{background:#4CAF50}
h2{color:#333;margin:10px 0}
p{color:#666;margin:8px 0}
.btn{display:inline-block;padding:10px 20px;border-radius:6px;text-decoration:none;color:white;margin-top:16px;border:none;font-size:14px;cursor:pointer}
.btn-danger{background:#e53935}
.btn-danger:hover{background:#c62828}</style>
</head>
<body>
<div class="card">
<div style="display:flex;align-items:center;justify-content:center;margin-bottom:10px">
<span class="status online"></span>
<span>Connected</span>
</div>
<h2>WhatsApp Connected</h2>
<p>The bot is linked and ready.</p>
<form action="/logout" method="POST" onsubmit="return confirm('Log out of WhatsApp?')">
<button class="btn btn-danger">Logout</button>
</form>
</div>
</body>
</html>`);
  }

  const qr = getQR();
  if (!qr) {
    return res.status(404).send('No QR available yet. Please wait for the bot to generate one.');
  }

  const qrImage = await QR.toDataURL(qr);
  res.send(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Arena Bot - Scan QR</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5;flex-direction:column;text-align:center;padding:20px}
img{max-width:100%;width:300px;height:auto;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.15)}
h2{color:#333;margin-bottom:10px}
p{color:#666;margin-top:10px}</style>
</head>
<body>
<div>
<h2>Scan this QR code with WhatsApp</h2>
<img src="${qrImage}" alt="QR Code">
<p>WhatsApp → Settings → Linked Devices → Link a Device</p>
<script>setTimeout(()=>location.reload(),60000)</script>
</div>
</body>
</html>`);
});

app.post('/logout', async (req, res) => {
  logger.info('Cerrando sesión por solicitud del usuario...');
  await clearAllAuth();
  createSocket();
  res.redirect('/qr');
});

app.listen(config.server.port, () => {
  logger.info({ port: config.server.port }, 'Servidor Express iniciado');
});

const handler = makeHandler();
setMessageHandler(handler);

startBot();

scheduler.start().catch(err => {
  logger.error({ err }, 'Error starting scheduler');
});
