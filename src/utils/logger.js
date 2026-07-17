import pino from 'pino';

const logger = pino({
  transport: {
    targets: [
      {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      },
      {
        target: 'pino/file',
        options: {
          destination: './logs/bot.log',
          mkdir: true,
        },
      },
    ],
  },
  level: 'info',
});

export default logger;
