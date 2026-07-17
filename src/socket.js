import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import NodeCache from 'node-cache';
import qrcode from 'qrcode-terminal';
import config from './config.js';
import logger from './utils/logger.js';

const msgRetryCache = new NodeCache({ stdTTL: 300 });

let sock = null;
let messageHandler = null;

async function createSocket() {
  const { state, saveCreds } = await useMultiFileAuthState(config.session.path);
  const { version, isLatest } = await fetchLatestBaileysVersion();

  logger.info({ version, isLatest }, 'Versión de Baileys');

  sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    msgRetryCounterCache: msgRetryCache,
    printQRInTerminal: false,
    browser: ['Mac OS', 'Chrome', '14.4.1'],
    syncFullHistory: false,
    markOnlineOnConnect: true,
    defaultQueryTimeoutMs: 60000,
    emitOwnEvents: true,
    retryRequestOnTimeout: true,
    maxHistoryRetries: 2,
    generateHighQualityLinkPreview: false,
    linkPreviewImageThumbnailWidth: 480,
  });

  sock.ev.on('creds.update', saveCreds);

  if (messageHandler) {
    sock.ev.on('messages.upsert', messageHandler);
  }

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      qrcode.generate(qr, { small: true });
      logger.info('Escanea el código QR con WhatsApp');
      return;
    }

    if (connection === 'connecting') {
      logger.info('Conectando...');
      return;
    }

    if (connection === 'open') {
      logger.info('=== Bot de WhatsApp conectado y listo ===');
      return;
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      logger.warn({ statusCode }, 'Conexión cerrada');

      if (shouldReconnect) {
        logger.info('Reconectando en 5 segundos...');
        setTimeout(() => createSocket(), 5000);
      } else {
        logger.error('Sesión cerrada. Elimina la carpeta sessions y reinicia.');
      }
    }
  });

  return sock;
}

function setMessageHandler(handler) {
  messageHandler = handler;
  if (sock) {
    sock.ev.on('messages.upsert', handler);
  }
}

function getSocket() {
  return sock;
}

export { createSocket as default, setMessageHandler, getSocket };
