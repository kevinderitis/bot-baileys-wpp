import { Router } from 'express';
import { sendMessage, getMessages, getConversation } from '../controllers/chat.js';

const router = Router();

router.post('/chat', sendMessage);
router.get('/chat/:userId/messages', getMessages);
router.get('/chat/:userId', getConversation);

export default router;
