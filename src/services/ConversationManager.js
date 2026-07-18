import Message from '../models/Message.js';
import Conversation from '../models/Conversation.js';
import { createCompletion } from './groq.js';
import { SYSTEM_PROMPT, SUMMARY_PROMPT } from '../utils/prompts.js';
import config from '../config.js';
import logger from '../utils/logger.js';

const SAVE_NAME_TOOL = {
  type: 'function',
  function: {
    name: 'saveCustomerName',
    description: 'Save the customer name after they introduce themselves. Call this when the customer tells you their name.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The customer first name' },
      },
      required: ['name'],
    },
  },
};

class ConversationManager {
  constructor() {
    this.maxContextMessages = config.ai.maxContextMessages;
    this.summarizeAfter = config.ai.summarizeAfter;
    this.keepAfterSummary = config.ai.keepAfterSummary;
  }

  async getName(userId) {
    const conv = await Conversation.findOne({ userId }).lean();
    return conv?.name || '';
  }

  async setCustomerInfo(userId, name, phone) {
    const update = {};
    if (name) update.name = name;
    if (phone) update.phone = phone;
    if (Object.keys(update).length === 0) return;
    await Conversation.findOneAndUpdate({ userId }, { $set: update });
    logger.info({ userId, name, phone }, 'Info de cliente guardada');
  }

  async saveMessage(userId, role, content) {
    await Message.create({ userId, role, content });
    await Conversation.findOneAndUpdate(
      { userId },
      { $inc: { messageCount: 1 } },
      { upsert: true },
    );
  }

  async getRecentMessages(userId, limit = null) {
    const count = limit || this.maxContextMessages;
    return Message.find({ userId })
      .sort({ timestamp: -1 })
      .limit(count)
      .lean();
  }

  async getTotalMessageCount(userId) {
    return Message.countDocuments({ userId });
  }

  async getConversation(userId) {
    return Conversation.findOne({ userId });
  }

  async buildContext(userId, currentMessage) {
    const conversation = await this.getConversation(userId);
    const recentMessages = await this.getRecentMessages(userId);

    const systemParts = [SYSTEM_PROMPT];

    if (conversation?.name) {
      systemParts.push(`Estás hablando con ${conversation.name}. Dirígete a él/ella por su nombre.`);
    }

    if (conversation?.summary) {
      systemParts.push(`Resumen de la conversación hasta ahora:\n${conversation.summary}`);
    }

    if (conversation?.messageCount === 1 && !conversation.name) {
      systemParts.push('Es la primera interacción con este cliente. Pregúntale su nombre de forma natural. Cuando te lo diga, usa la función saveCustomerName para guardarlo.');
    }

    const messages = systemParts.map(content => ({ role: 'system', content }));

    const reversed = recentMessages.reverse();
    for (const msg of reversed) {
      if (msg.role !== 'system') {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    messages.push({ role: 'user', content: currentMessage });

    return { messages, conversation };
  }

  async generateSummary(userId) {
    const messages = await Message.find({ userId })
      .sort({ timestamp: -1 })
      .limit(60)
      .lean();

    if (messages.length === 0) return '';

    const reversed = messages.reverse();
    const transcript = reversed
      .map(m => `${m.role}: ${m.content}`)
      .join('\n');

    const summaryMessages = [
      { role: 'system', content: SUMMARY_PROMPT },
      { role: 'user', content: `Conversación:\n\n${transcript}` },
    ];

    try {
      const result = await createCompletion(summaryMessages, {
        model: config.groq.summaryModel,
        maxTokens: 500,
        temperature: 0.3,
      });

      return result.content || '';
    } catch (err) {
      logger.error({ err }, 'Error generando resumen');
      return '';
    }
  }

  async updateSummary(userId) {
    const summary = await this.generateSummary(userId);
    if (!summary) return;

    await Conversation.findOneAndUpdate(
      { userId },
      {
        $set: {
          summary,
          lastSummaryAt: new Date(),
          summaryModel: config.groq.summaryModel,
        },
      },
      { upsert: true },
    );

    logger.info({ userId, summaryLength: summary.length }, 'Resumen actualizado');
  }

  async cleanupOldMessages(userId) {
    const messages = await Message.find({ userId })
      .sort({ timestamp: -1 })
      .skip(this.keepAfterSummary)
      .lean();

    if (messages.length === 0) return;

    const idsToDelete = messages.map(m => m._id);
    const deleted = await Message.deleteMany({ _id: { $in: idsToDelete } });

    await Conversation.findOneAndUpdate(
      { userId },
      { $set: { messageCount: await Message.countDocuments({ userId }) } },
    );

    logger.info({ userId, deleted: deleted.deletedCount }, 'Mensajes antiguos limpiados');
  }

  async shouldSummarize(userId) {
    const count = await this.getTotalMessageCount(userId);
    const conversation = await this.getConversation(userId);
    const alreadySummarized = conversation?.lastSummaryAt != null;

    if (!alreadySummarized) {
      return count >= this.summarizeAfter;
    }

    const messagesSinceSummary = await Message.countDocuments({
      userId,
      timestamp: { $gt: conversation.lastSummaryAt },
    });

    return messagesSinceSummary >= this.summarizeAfter;
  }

  async chat(userId, userMessage) {
    await this.saveMessage(userId, 'user', userMessage);

    const { messages, conversation } = await this.buildContext(userId, userMessage);

    const tools = conversation?.name ? undefined : [SAVE_NAME_TOOL];
    const result = await createCompletion(messages, { tools, tool_choice: 'auto' });

    if (result.tool_calls) {
      for (const call of result.tool_calls) {
        if (call.function.name === 'saveCustomerName') {
          const args = JSON.parse(call.function.arguments);
          await this.setCustomerInfo(userId, args.name, userId);
        }
      }
      messages.push(result);
      for (const call of result.tool_calls) {
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: 'ok',
        });
      }
      const finalResult = await createCompletion(messages, { tools: [SAVE_NAME_TOOL], tool_choice: 'none' });
      await this.saveMessage(userId, 'assistant', finalResult.content);
      return finalResult.content;
    }

    const response = result.content || '';
    await this.saveMessage(userId, 'assistant', response);

    if (await this.shouldSummarize(userId)) {
      logger.info({ userId }, 'Generando resumen automático...');
      await this.updateSummary(userId);
      await this.cleanupOldMessages(userId);
    }

    return response;
  }
}

export default ConversationManager;
