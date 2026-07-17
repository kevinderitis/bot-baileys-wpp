import { initAuthCreds } from '@whiskeysockets/baileys';
import mongoose from 'mongoose';
import Auth from '../models/Auth.js';
import logger from '../utils/logger.js';

const KEY_PREFIX = 'baileys:';
const { Binary } = mongoose.mongo;

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
  if (!creds || !creds.registered) {
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
    await write(`${KEY_PREFIX}creds`, creds);
  };

  logger.info('Usando autenticación persistente en MongoDB');

  return { state: { creds, keys }, saveCreds };
}

export { useMongoDBAuthState };
