import mongoose from 'mongoose';

const scheduledMessageSchema = new mongoose.Schema({
  name: { type: String, required: true },
  message: { type: String, required: true },
  image: { type: String, default: '' },
  imageMimeType: { type: String, default: '' },
  targetType: { type: String, enum: ['group', 'contact', 'broadcast'], required: true },
  targetId: { type: String, required: true },
  targetName: { type: String, required: true },
  schedule: {
    type: { type: String, enum: ['daily', 'weekly', 'custom'], required: true },
    daysOfWeek: [{ type: Number, min: 0, max: 6 }],
    time: { type: String, required: true },
    timezone: { type: String, default: 'Asia/Bangkok' },
  },
  isActive: { type: Boolean, default: true },
  lastSent: { type: Date },
  nextRun: { type: Date },
  createdBy: { type: String, default: 'admin' },
}, { timestamps: true });

scheduledMessageSchema.index({ isActive: 1, nextRun: 1 });

export default mongoose.model('ScheduledMessage', scheduledMessageSchema);