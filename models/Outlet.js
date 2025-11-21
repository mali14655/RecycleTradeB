// models/Outlet.js
const mongoose = require('mongoose');

const outletSchema = new mongoose.Schema({
  name: { type: String, required: true },
  location: { type: String, required: true },
  address: { type: String, required: true },
  phone: { type: String },
  email: { type: String },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Outlet', outletSchema);