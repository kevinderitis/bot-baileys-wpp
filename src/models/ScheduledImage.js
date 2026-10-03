import mongoose from 'mongoose';

const scheduledImageSchema = new mongoose.Schema({
  data: { type: String, required: true },
  mimeType: { type: String, default: 'image/jpeg' },
}, { timestamps: true });

export default mongoose.model('ScheduledImage', scheduledImageSchema);