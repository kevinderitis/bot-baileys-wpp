import mongoose from 'mongoose';

const botSettingsSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: String, default: '' },
}, { timestamps: true });

export default mongoose.model('BotSettings', botSettingsSchema);