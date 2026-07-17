import logger from '../utils/logger.js';
import { getRandomDelay } from '../utils/delays.js';
import { simulateTyping } from '../utils/typing.js';
import { pickResponse } from '../responses/example.js';
import ConversationManager from '../services/ConversationManager.js';
import config from '../config.js';

const cm = (config.groq.enabled && config.mongo.enabled) ? new ConversationManager() : null;

const pendingQueries = new Map();
const messageBuffer = new Map();

function getText(msg) {
  if (!msg.message) return '';
  const m = msg.message;
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    ''
  );
}

function extractNumber(remoteJid) {
  return remoteJid.replace(/@.*$/, '');
}

function classifyIntent(text) {
  const lower = text.toLowerCase().trim();

  if (/^(hola|buenas|buen[ads]|hey|hi|hello|que tal|qué tal|alo|aló|ola)\b/.test(lower)) {
    return 'saludo';
  }
  if (/^(como estas|como estás|cómo estás|cómo estas|bien y tu|como andas|qué tal todo)\b/.test(lower)) {
    return 'como_estas';
  }
  if (/^(gracias|muchas gracias|te agradezco|thanks|thank you|gracias por)\b/.test(lower)) {
    return 'agradecimiento';
  }
  if (/^(adios|adiós|chao|bye|nos vemos|hasta luego|hasta pronto|nos hablamos)\b/.test(lower)) {
    return 'despedida';
  }
  if (/^(que es|qué es|que puedes|qué puedes|como funciona|cómo funciona|que haces|qué haces)\b/.test(lower)) {
    return 'info';
  }
  return 'random';
}

function buildRuleResponse(intent) {
  if (intent === 'saludo') {
    return `${pickResponse('saludos')}\n\n${pickResponse('bienvenida')}`;
  }
  if (intent === 'info') {
    return 'Soy un asistente de Koderix. Por ahora estoy en fase de pruebas, pero muy pronto podré ayudarte con todo lo que necesites. ¿En qué más puedo ayudarte?';
  }
  return pickResponse(intent);
}

async function processWithGroq(sock, userId, combinedBody, quotedMsg, remoteJid) {
  const delay = getRandomDelay();
  const groqPromise = cm.chat(userId, combinedBody);

  logger.info({ delayMs: Math.round(delay) }, 'Esperando antes de responder...');
  await new Promise(r => setTimeout(r, delay));

  let response;
  try {
    response = await groqPromise;
  } catch (err) {
    logger.error({ err }, 'Error con Groq, usando respuesta local');
    const intent = classifyIntent(combinedBody);
    response = buildRuleResponse(intent);
  }

  try {
    await simulateTyping(sock, remoteJid, response);
    await sock.sendMessage(remoteJid, { text: response }, { quoted: quotedMsg });
    logger.info({ userId, response: response.slice(0, 80) }, 'MENSAJE SALIENTE (Groq)');
  } catch (err) {
    logger.error({ err }, 'Error enviando mensaje (socket cerrado)');
  }
}

async function drainBuffer(sock, userId, remoteJid) {
  const buffered = messageBuffer.get(userId);
  if (!buffered || buffered.length === 0) return;

  messageBuffer.delete(userId);

  const bodies = buffered.map(b => b.body);
  const combinedBody = bodies.join('\n');
  const lastMsg = buffered[buffered.length - 1].msg;

  try {
    await sock.readMessages(buffered.map(b => b.msg.key));
  } catch (err) {
    logger.error({ err }, 'Error marcando como leídos');
  }

  const promise = processWithGroq(sock, userId, combinedBody, lastMsg, remoteJid);
  pendingQueries.set(userId, promise);
  try {
    await promise;
  } finally {
    pendingQueries.delete(userId);
    await drainBuffer(sock, userId, remoteJid);
  }
}

function makeHandler(sock) {
  return async function handleMessage({ messages }) {
    for (const msg of messages) {
      if (msg.key.fromMe) continue;

      const remoteJid = msg.key.remoteJid;
      const body = getText(msg);
      const name = msg.pushName || 'Desconocido';
      const number = extractNumber(remoteJid);

      if (!body) continue;

      logger.info({ number, name, body }, 'MENSAJE ENTRANTE');

      if (pendingQueries.has(number)) {
        if (!messageBuffer.has(number)) messageBuffer.set(number, []);
        messageBuffer.get(number).push({ body, msg, remoteJid });
        logger.info({ number }, 'Mensaje encolado (query en curso)');
        continue;
      }

      try {
        await sock.readMessages([msg.key]);
      } catch (err) {
        logger.error({ err }, 'Error marcando como leído');
      }

      if (cm) {
        const promise = processWithGroq(sock, number, body, msg, remoteJid);
        pendingQueries.set(number, promise);
        try {
          await promise;
        } finally {
          pendingQueries.delete(number);
          await drainBuffer(sock, number, remoteJid);
        }
      } else {
        const delay = getRandomDelay();
        logger.info({ delayMs: Math.round(delay) }, 'Esperando antes de responder...');
        await new Promise(r => setTimeout(r, delay));

        const intent = classifyIntent(body);
        const response = buildRuleResponse(intent);

        try {
          await simulateTyping(sock, remoteJid, response);
          await sock.sendMessage(remoteJid, { text: response }, { quoted: msg });
          logger.info({ number, intent, response: response.slice(0, 80) }, 'MENSAJE SALIENTE');
        } catch (err) {
          logger.error({ err }, 'Error enviando mensaje (socket cerrado)');
        }
      }
    }
  };
}

export default makeHandler;
