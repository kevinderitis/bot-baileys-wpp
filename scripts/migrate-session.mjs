/**
 * Migra la sesión de WhatsApp de archivos locales a MongoDB.
 * Ejecutar localmente antes de deployar a Render:
 *   node scripts/migrate-session.mjs
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

const SESSION_PATH = resolve(process.env.SESSION_PATH || './sessions');

if (!process.env.MONGODB_URI) {
  console.error('ERROR: MONGODB_URI no configurada en .env');
  process.exit(1);
}

await mongoose.connect(process.env.MONGODB_URI);
console.log('Conectado a MongoDB');

const db = mongoose.connection.db;
const collection = db.collection('auths');
const KEY_PREFIX = 'baileys:';

let total = 0;

try {
  const files = readdirSync(SESSION_PATH);

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    if (file === 'creds.json') {
      const data = JSON.parse(readFileSync(join(SESSION_PATH, file), 'utf-8'));
      await collection.updateOne(
        { _id: `${KEY_PREFIX}creds` },
        { $set: { value: data } },
        { upsert: true },
      );
      console.log(`  ✓ ${file} → baileys:creds`);
      total++;
    } else {
      const data = JSON.parse(readFileSync(join(SESSION_PATH, file), 'utf-8'));
      await collection.updateOne(
        { _id: `${KEY_PREFIX}${file.replace('.json', '')}` },
        { $set: { value: data } },
        { upsert: true },
      );
      console.log(`  ✓ ${file} → baileys:${file.replace('.json', '')}`);
      total++;
    }
  }

  console.log(`\nMigración completa: ${total} documentos insertados en MongoDB.`);
  console.log('Ahora puedes deployar a Render con AUTH_STORE=mongo');
} catch (err) {
  if (err.code === 'ENOENT') {
    console.error(`No se encontró la carpeta de sesión: ${SESSION_PATH}`);
    console.error('Escanea el QR primero ejecutando: npm start');
  } else {
    console.error('Error:', err.message);
  }
}

await mongoose.disconnect();
