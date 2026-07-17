import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
}, { timestamps: true });

messageSchema.index({ userId: 1, timestamp: -1 });

const Message = mongoose.model('Message', messageSchema);

export default Message;
