const mongoose = require("mongoose");

const variantSchema = new mongoose.Schema({
  specs: { type: Map, of: String },
  price: { type: Number, required: true },
  images: [{ type: String }],
  sku: { type: String },
  enabled: { type: Boolean, default: true },
  stock: { type: Number, default: 0, min: 0 },
  // NEW: Appearance condition (Premium, Excellent, Very good, Good)
  appearance: { type: String, enum: ['Premium', 'Excellent', 'Very good', 'Good'], required: false },
  // NEW: Battery type (Optimal, New)
  battery: { type: String, enum: ['Optimal', 'New'], required: false }
}, { _id: true });

const reviewSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  name: { type: String },
  email: { type: String },
  rating: { type: Number, required: true },
  comment: { type: String },
  images: [{ type: String }], // NEW: Review images
  createdAt: { type: Date, default: Date.now },
});

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String },
  // NEW: Make price optional to support variant-priced products during creation.
  // NEW: Default to 0 to preserve existing flows that assume a numeric price.
  price: { type: Number, required: false, default: 0 },
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