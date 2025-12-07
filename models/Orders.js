const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  guestInfo: {
    // Personal Information
    firstName: String,
    lastName: String,
    gender: { type: String, enum: ["male", "female", "other"] },
    
    // Address Information
    address: String,
    country: String,
    postalCode: String,
    
    // Contact Information
    email: String,
    phone: String,
  },
  items: [
    {
      productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
      sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      variantId: { type: mongoose.Schema.Types.ObjectId },
      quantity: { type: Number, required: true },
      price: { type: Number, required: true },
    },
  ],
  total: { type: Number, required: true },
  paymentMethod: { type: String, enum: ["COD", "Stripe", "Pickup"], default: "COD" },
  deliveryMethod: { type: String, enum: ["delivery", "pickup"], default: "delivery" },
  outletId: { type: mongoose.Schema.Types.ObjectId, ref: "Outlet" },
  paymentStatus: { type: String, enum: ["Pending", "Paid", "Failed", "Cancelled"], default: "Pending" },
  orderStatus: { type: String, enum: ["Pending", "Processing", "Cancelled"], default: "Pending" },
  cancelledAt: { type: Date },
  cancellationReason: { type: String }, // "abandoned", "user_cancelled", "payment_failed", "stripe_cancelled"
  trackingNumber: { type: String },
  stripeSessionId: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Order", orderSchema);