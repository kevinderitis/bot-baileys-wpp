import { initAuthCreds } from '@whiskeysockets/baileys';
import mongoose from 'mongoose';
import Auth from '../models/Auth.js';
import logger from '../utils/logger.js';

const KEY_PREFIX = 'baileys:';
const { Binary } = mongoose.mongo;

let cachedState = null;
let saveCredsPromise = Promise.resolve();

function binaryToBuffer(obj) {
  if (obj instanceof Binary) return Buffer.from(obj.buffer);
  if (Array.isArray(obj)) return obj.map(binaryToBuffer);
  if (obj && typeof obj === 'object' && obj.constructor === Object) {
    const result = {};
    for (const key of Object.keys(obj)) result[key] = binaryToBuffer(obj[key]);
    return result;
  }
  return obj;
}

async function useMongoDBAuthState() {
  if (cachedState) return cachedState;

  const read = async (id) => {
    try {
      const doc = await Auth.findById(id);
      return doc ? binaryToBuffer(doc.value) : null;
    } catch {
      return null;
    }
  };

  const write = async (id, value) => {
    try {
      await Auth.findByIdAndUpdate(id, { $set: { value } }, { upsert: true });
    } catch (err) {
      logger.error({ err, id }, 'Error escribiendo auth key');
    }
  };

  const del = async (id) => {
    try {
      await Auth.findByIdAndDelete(id);
    } catch (err) {
      logger.error({ err, id }, 'Error eliminando auth key');
    }
  };

  let creds = await read(`${KEY_PREFIX}creds`);
  if (creds) {
    logger.info({ registered: creds.registered, hasMe: !!creds.me, valid: !!creds.me }, 'Credenciales cargadas desde MongoDB');
  }
  if (!creds || !creds.me) {
    logger.warn('No hay credenciales válidas, generando nuevas...');
    await Auth.deleteMany({ _id: new RegExp(`^${KEY_PREFIX}`) });
    creds = initAuthCreds();
  }

  const keys = {
    get: async (type, ids) => {
      const result = {};
      for (const id of ids) {
        const value = await read(`${KEY_PREFIX}${type}-${id}`);
        if (value) result[id] = value;
      }
      return result;
    },
    set: async (data) => {
      for (const [key, value] of Object.entries(data)) {
        await write(`${KEY_PREFIX}${key}`, value);
      }
    },
    has: async (type, ids) => {
      const result = {};
      for (const id of ids) {
        const doc = await Auth.findById(`${KEY_PREFIX}${type}-${id}`, { _id: 1 });
        result[id] = !!doc;
      }
      return result;
    },
    clear: async () => {
      await Auth.deleteMany({ _id: new RegExp(`^${KEY_PREFIX}`) });
    },
  };

  const saveCreds = async () => {
    const p = (async () => {
      await saveCredsPromise;
      logger.info('Guardando credenciales...');
      await write(`${KEY_PREFIX}creds`, creds);
    })();
    saveCredsPromise = p;
    await p;
  };

  cachedState = { state: { creds, keys }, saveCreds };

  logger.info('Usando autenticación persistente en MongoDB');

  return cachedState;
}

async function clearAllAuth() {
  cachedState = null;
  await Auth.deleteMany({ _id: new RegExp(`^${KEY_PREFIX}`) });
}

function isSessionRegistered() {
  return cachedState?.state?.creds?.me != null;
}

export { useMongoDBAuthState, saveCredsPromise, clearAllAuth, isSessionRegistered };
