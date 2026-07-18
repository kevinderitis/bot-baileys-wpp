import express from 'express';
import mongoose from 'mongoose';
import QR from 'qrcode';
import createSocket, { setMessageHandler, getQR, getIsConnected } from './socket.js';
import { clearAllAuth } from './services/auth-state.js';
import makeHandler from './handlers/message.js';
import chatRoutes from './routes/chat.js';
import config from './config.js';
import logger from './utils/logger.js';

logger.info('Iniciando Bot de WhatsApp con Baileys...');

if (config.mongo.enabled) {
  try {
    await mongoose.connect(config.mongo.uri);
    logger.info('Conectado a MongoDB');
  } catch (err) {
    logger.error({ err }, 'Error conectando a MongoDB');
  }
} else {
  logger.warn('MongoDB no configurado. El historial NO se persistirá.');
}

if (config.groq.enabled && config.mongo.enabled) {
  logger.info({ model: config.groq.model }, 'Groq API configurado');
} else if (config.groq.enabled && !config.mongo.enabled) {
  logger.warn('GROQ_API_KEY presente pero MongoDB requerido para IA. Usando respuestas por reglas.');
} else {
  logger.warn('GROQ_API_KEY no configurada. Usando respuestas por reglas.');
}

const app = express();
app.use(express.json());
app.use('/api', chatRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', mongodb: mongoose.connection.readyState === 1, groq: config.groq.enabled });
});

app.get('/qr', async (req, res) => {
  if (getIsConnected()) {
    const connected = getIsConnected();
    return res.send(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>WhatsApp Bot - Sesión activa</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5;flex-direction:column;text-align:center;padding:20px}
.card{background:white;border-radius:12px;padding:30px;box-shadow:0 4px 20px rgba(0,0,0,0.1);max-width:400px;width:100%}
.status{display:inline-block;width:12px;height:12px;border-radius:50%;margin-right:8px}
.status.online{background:#4CAF50}
.status.offline{background:#ff9800}
h2{color:#333;margin:10px 0}
p{color:#666;margin:8px 0}
.btn{display:inline-block;padding:10px 20px;border-radius:6px;text-decoration:none;color:white;margin-top:16px;border:none;font-size:14px;cursor:pointer}
.btn-danger{background:#e53935}
.btn-danger:hover{background:#c62828}
a{color:#2196F3;text-decoration:none}</style>
</head>
<body>
<div class="card">
<div style="display:flex;align-items:center;justify-content:center;margin-bottom:10px">
<span class="status ${connected ? 'online' : 'offline'}"></span>
<span>${connected ? 'Conectado' : 'Reconectando...'}</span>
</div>
<h2>WhatsApp conectado</h2>
<p>El bot está vinculado a una cuenta de WhatsApp.</p>
<form action="/logout" method="POST" onsubmit="return confirm('¿Cerrar sesión de WhatsApp?')">
<button class="btn btn-danger">Cerrar sesión</button>
</form>
</div>
</body>
</html>`);
  }

  const qr = getQR();
  if (!qr) {
    return res.status(404).send('No hay QR disponible. Espera a que el bot genere uno.');
  }
  const qrImage = await QR.toDataURL(qr);
  res.send(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Escanear QR - WhatsApp Bot</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5;flex-direction:column;text-align:center;padding:20px}
img{max-width:100%;width:300px;height:auto;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.15)}
h2{color:#333;margin-bottom:10px}
p{color:#666;margin-top:10px}</style>
</head>
<body>
<div>
<h2>Escanéa este código QR con WhatsApp</h2>
<img src="${qrImage}" alt="QR Code">
<p>Abre WhatsApp → Menú → Dispositivos vinculados → Vincular un dispositivo</p>
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

const sock = await createSocket();
const handler = makeHandler();
setMessageHandler(handler);
