const mongoose = require("mongoose");

const variantSchema = new mongoose.Schema({
  specs: { type: Map, of: String },
  price: { type: Number, required: true },
  images: [{ type: String }],
  sku: { type: String },
  enabled: { type: Boolean, default: true },
  stock: { type: Number, default: 0, min: 0 }
}, { _id: true });

const reviewSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  name: { type: String },
  email: { type: String },
  rating: { type: Number, required: true },
  comment: { type: String },
  createdAt: { type: Date, default: Date.now },
});

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String },
  price: { type: Number, required: true },
  sellerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  category: { type: String, required: true },
  images: { type: [String], default: [] },
  featured: { type: Boolean, default: false },
  reviews: [reviewSchema],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  categoryRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
  basePrice: { type: Number },
  specs: { type: Map, of: String },
  variants: [variantSchema],
});

module.exports = mongoose.model("Product", productSchema);