import Groq from 'groq-sdk';
import config from '../config.js';
import logger from '../utils/logger.js';

const groq = new Groq({ apiKey: config.groq.apiKey });

async function createCompletion(messages, options = {}) {
  const model = options.model || config.groq.model;
  const maxTokens = options.maxTokens || config.groq.maxTokens;
  const temperature = options.temperature ?? config.groq.temperature;

  try {
    const body = {
      messages,
      model,
      max_tokens: maxTokens,
      temperature,
    };
    if (options.tools) body.tools = options.tools;
    if (options.tool_choice) body.tool_choice = options.tool_choice;

    const completion = await groq.chat.completions.create(body);

    return completion.choices[0]?.message || { content: '' };
  } catch (err) {
    logger.error({ err, model }, 'Error en Groq API');
    throw err;
  }
}

export { createCompletion };
