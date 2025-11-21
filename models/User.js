const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  phone: { type: String },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['buyer','seller','seller_candidate','admin'], default: 'buyer' },
  verified: { type: Boolean, default: true }, // true by default
  kyc: {
    status: { type: String, enum: ['pending','approved','rejected'], default: 'pending' },
    docs: { type: Array, default: [] }
  },
  payoutDetails: { type: Object, default: {} },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
