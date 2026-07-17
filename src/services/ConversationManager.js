import Message from '../models/Message.js';
import Conversation from '../models/Conversation.js';
import { createCompletion } from './groq.js';
import { SYSTEM_PROMPT, SUMMARY_PROMPT } from '../utils/prompts.js';
import config from '../config.js';
import logger from '../utils/logger.js';

class ConversationManager {
  constructor() {
    this.maxContextMessages = config.ai.maxContextMessages;
    this.summarizeAfter = config.ai.summarizeAfter;
    this.keepAfterSummary = config.ai.keepAfterSummary;
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

    const messages = [{ role: 'system', content: SYSTEM_PROMPT }];

    if (conversation?.summary) {
      messages.push({
        role: 'system',
        content: `Resumen de la conversación hasta ahora:\n${conversation.summary}`,
      });
    }

    const reversed = recentMessages.reverse();
    for (const msg of reversed) {
      if (msg.role !== 'system') {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    messages.push({ role: 'user', content: currentMessage });

    return messages;
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
      const summary = await createCompletion(summaryMessages, {
        model: config.groq.summaryModel,
        maxTokens: 500,
        temperature: 0.3,
      });

      return summary;
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

    const context = await this.buildContext(userId, userMessage);

    const response = await createCompletion(context);

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
