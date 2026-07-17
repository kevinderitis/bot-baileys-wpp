import 'dotenv/config';

export default {
  session: {
    path: process.env.SESSION_PATH || './sessions',
  },

  mongo: {
    uri: process.env.MONGODB_URI || '',
    enabled: !!process.env.MONGODB_URI,
  },

  server: {
    port: parseInt(process.env.PORT, 10) || 3000,
  },

  groq: {
    apiKey: process.env.GROQ_API_KEY || '',
    enabled: !!process.env.GROQ_API_KEY,
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    summaryModel: process.env.GROQ_SUMMARY_MODEL || 'llama-3.1-8b-instant',
    maxTokens: parseInt(process.env.GROQ_MAX_TOKENS, 10) || 1024,
    temperature: parseFloat(process.env.GROQ_TEMPERATURE) || 0.7,
  },

  ai: {
    maxContextMessages: parseInt(process.env.AI_MAX_CONTEXT_MESSAGES, 10) || 20,
    summarizeAfter: parseInt(process.env.AI_SUMMARIZE_AFTER, 10) || 40,
    keepAfterSummary: parseInt(process.env.AI_KEEP_AFTER_SUMMARY, 10) || 20,
  },

  bot: {
    minDelaySeconds: parseInt(process.env.MIN_DELAY_SECONDS, 10) || 3,
    maxDelaySeconds: parseInt(process.env.MAX_DELAY_SECONDS, 10) || 25,
    typingSpeedCPS: parseInt(process.env.TYPING_SPEED_CPS, 10) || 15,
  },
};
