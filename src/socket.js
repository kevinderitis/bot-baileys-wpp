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
import { useMongoDBAuthState, saveCredsPromise, clearAllAuth, isSessionRegistered } from './services/auth-state.js';

const msgRetryCache = new NodeCache({ stdTTL: 300 });

let sock = null;
let messageHandler = null;
let currentQR = null;
let _isConnected = false;

async function createSocket() {
  const authStore = config.session.store === 'mongo' && config.mongo.enabled
    ? await useMongoDBAuthState()
    : await useMultiFileAuthState(config.session.path);
  const { state, saveCreds } = authStore;
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

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      currentQR = qr;
      if (!isSessionRegistered()) {
        qrcode.generate(qr, { small: true });
        logger.info('Escanea el código QR con WhatsApp');
        logger.info('O visita /qr en el navegador para escanear');
      }
      return;
    }

    if (connection === 'connecting') {
      logger.info('Conectando...');
      return;
    }

    if (connection === 'open') {
      _isConnected = true;
      if (isSessionRegistered()) {
        await saveCredsPromise;
        saveCreds();
      }
      logger.info('=== Bot de WhatsApp conectado y listo ===');
      return;
    }

    if (connection === 'close') {
      _isConnected = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      logger.warn({ statusCode }, 'Conexión cerrada');

      if (shouldReconnect) {
        logger.info('Esperando a que se guarden las credenciales...');
        await saveCredsPromise;
        logger.info('Reconectando en 5 segundos...');
        setTimeout(() => createSocket(), 5000);
      } else {
        logger.error('Sesión cerrada. Limpiando credenciales stale y reiniciando...');
        await clearAllAuth();
        setTimeout(() => createSocket(), 5000);
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

function getQR() {
  return currentQR;
}

function getIsConnected() { return _isConnected; }

export { createSocket as default, setMessageHandler, getSocket, getQR, getIsConnected };
