import config from '../config.js';

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getRandomDelay() {
  const { minDelaySeconds, maxDelaySeconds } = config.bot;
  return randomBetween(minDelaySeconds, maxDelaySeconds) * 1000;
}

function getTypingTime(messageLength) {
  const cps = config.bot.typingSpeedCPS;
  return (messageLength / cps) * 1000;
}

export { randomBetween, sleep, getRandomDelay, getTypingTime };
