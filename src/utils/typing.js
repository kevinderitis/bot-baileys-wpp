import logger from './logger.js';
import { sleep, getTypingTime, randomBetween } from './delays.js';

async function simulateTyping(sock, remoteJid, message) {
  const typingDuration = getTypingTime(message.length);

  logger.info({ typingMs: Math.round(typingDuration) }, 'Simulando escritura...');

  await sock.sendPresenceUpdate('composing', remoteJid);
  await sleep(typingDuration + randomBetween(200, 800));
  await sock.sendPresenceUpdate('paused', remoteJid);
}

export { simulateTyping };
