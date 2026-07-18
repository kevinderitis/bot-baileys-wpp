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

  _extractName(text) {
    const patterns = [
      /(?:me\s+llamo|mi\s+nombre\s+es|soy)\s+(.+)/i,
      /(?:this\s+is|i'm|i\s+am|calls?\s+me)\s+(.+)/i,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m) return m[1].replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ\s]/g, '').trim().split(/\s+/)[0];
    }
    return null;
  }

  async getName(userId) {
    const conv = await Conversation.findOne({ userId }).lean();
    return conv?.name || '';
  }

  async setName(userId, name) {
    if (!name) return;
    await Conversation.findOneAndUpdate({ userId }, { $set: { name } });
    logger.info({ userId, name }, 'Nombre de cliente guardado');
  }

  async saveMessage(userId, role, content) {
    await Message.create({ userId, role, content });
    const conv = await Conversation.findOneAndUpdate(
      { userId },
      { $inc: { messageCount: 1 } },
      { upsert: true, new: true },
    );
    return conv;
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
      systemParts.push('Es la primera interacción con este cliente. Pregúntale su nombre de forma natural antes de continuar.');
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
    const conv = await this.saveMessage(userId, 'user', userMessage);

    const { messages, conversation } = await this.buildContext(userId, userMessage);

    const response = await createCompletion(messages);

    await this.saveMessage(userId, 'assistant', response);

    if (!conversation?.name && conv.messageCount >= 2) {
      const extracted = this._extractName(userMessage);
      if (extracted) {
        await this.setName(userId, extracted);
      }
    }

    if (await this.shouldSummarize(userId)) {
      logger.info({ userId }, 'Generando resumen automático...');
      await this.updateSummary(userId);
      await this.cleanupOldMessages(userId);
    }

    return response;
  }
}

export default ConversationManager;
