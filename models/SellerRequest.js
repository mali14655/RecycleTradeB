const mongoose = require('mongoose');

const sellRequestSchema = new mongoose.Schema({
  productTitle: { type: String, required: true },
  description: { type: String },
  images: { type: [String], default: [] },
  expectedPrice: { type: Number },
  status: { type: String, enum: ['pending','approved','rejected','completed'], default: 'pending' },
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  companyResponse: { type: String }, // admin can send note / offer
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('SellRequest', sellRequestSchema);
