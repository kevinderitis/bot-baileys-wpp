import express from 'express';
import mongoose from 'mongoose';
import QR from 'qrcode';
import createSocket, { setMessageHandler, getQR } from './socket.js';
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

app.listen(config.server.port, () => {
  logger.info({ port: config.server.port }, 'Servidor Express iniciado');
});

const sock = await createSocket();
const handler = makeHandler();
setMessageHandler(handler);
