import express from 'express';
import mongoose from 'mongoose';
import createSocket, { setMessageHandler } from './socket.js';
import makeHandler from './handlers/message.js';
import chatRoutes from './routes/chat.js';
import config from './config.js';
import logger from './utils/logger.js';

logger.info('Iniciando Bot de WhatsApp con Baileys...');

if (config.mongo.enabled) {
  mongoose.connect(config.mongo.uri)
    .then(() => logger.info('Conectado a MongoDB'))
    .catch(err => logger.error({ err }, 'Error conectando a MongoDB'));
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

app.listen(config.server.port, () => {
  logger.info({ port: config.server.port }, 'Servidor Express iniciado');
});

const sock = await createSocket();
const handler = makeHandler(sock);
setMessageHandler(handler);
