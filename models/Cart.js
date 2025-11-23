const mongoose = require("mongoose");

const cartItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
  quantity: { type: Number, default: 1 },
  variantId: { type: mongoose.Schema.Types.ObjectId }, // NEW: Stock management - variant identifier
  price: { type: Number } // NEW: Store the actual price (variant price if variant exists, product price otherwise)
});

const cartSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  items: [cartItemSchema],
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Cart", cartSchema);
