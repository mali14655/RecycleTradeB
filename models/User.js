const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  phone: { type: String },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['buyer','seller','seller_candidate','admin'], default: 'buyer' },
  verified: { type: Boolean, default: false }, // NEW: Changed to false - requires email verification
  emailVerificationToken: { type: String }, // NEW: Token for email verification
  emailVerificationExpiry: { type: Date }, // NEW: Expiry for verification token
  resetPasswordToken: { type: String }, // NEW: Token for password reset
  resetPasswordExpiry: { type: Date }, // NEW: Expiry for reset token
  kyc: {
    status: { type: String, enum: ['pending','approved','rejected'], default: 'pending' },
    docs: { type: Array, default: [] }
  },
  payoutDetails: { type: Object, default: {} },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
