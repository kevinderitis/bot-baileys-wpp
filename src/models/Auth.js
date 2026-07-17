import mongoose from 'mongoose';

const authSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
}, { timestamps: true });

const Auth = mongoose.model('Auth', authSchema);

export default Auth;
