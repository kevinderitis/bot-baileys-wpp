import mongoose from 'mongoose';

const conversationSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true, index: true },
  summary: { type: String, default: '' },
  summaryModel: { type: String, default: '' },
  lastSummaryAt: { type: Date },
  messageCount: { type: Number, default: 0 },
  name: { type: String, default: '' },
}, { timestamps: true });

const Conversation = mongoose.model('Conversation', conversationSchema);

export default Conversation;
