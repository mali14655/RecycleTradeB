const mongoose = require('mongoose');

const specSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, enum: ['single', 'multiple'], required: true },
  required: { type: Boolean, default: false }
});

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  description: { type: String },
  image: { type: String }, // Add image field
  specs: [specSchema],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Category', categorySchema);