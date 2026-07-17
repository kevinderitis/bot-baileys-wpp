import Auth from '../models/Auth.js';
import logger from '../utils/logger.js';

const KEY_PREFIX = 'baileys:';

async function useMongoDBAuthState() {
  const read = async (id) => {
    try {
      const doc = await Auth.findById(id);
      return doc ? doc.value : null;
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

  const creds = await read(`${KEY_PREFIX}creds`);

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
