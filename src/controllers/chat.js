import Message from '../models/Message.js';
import ConversationManager from '../services/ConversationManager.js';
import logger from '../utils/logger.js';

const cm = new ConversationManager();

async function sendMessage(req, res) {
  try {
    const { userId, message } = req.body;

    if (!userId || !message) {
      return res.status(400).json({ error: 'userId y message son requeridos' });
    }

    const response = await cm.chat(userId, message);

    res.json({ userId, response });
  } catch (err) {
    logger.error({ err }, 'Error en chat controller');
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}

async function getMessages(req, res) {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit, 10) || 50;

    const messages = await Message.find({ userId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    res.json({ userId, messages });
  } catch (err) {
    logger.error({ err }, 'Error obteniendo mensajes');
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}

async function getConversation(req, res) {
  try {
    const { userId } = req.params;
    const conversation = await cm.getConversation(userId);

    if (!conversation) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }

    res.json(conversation);
  } catch (err) {
    logger.error({ err }, 'Error obteniendo conversación');
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}

export { sendMessage, getMessages, getConversation };
