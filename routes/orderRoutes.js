const express = require("express");
const Stripe = require("stripe");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const Order = require("../models/Orders");
const Product = require("../models/Product");
const Cart = require("../models/Cart");
const User = require("../models/User");

// NEW: Helper function to get API URL (works on both local and server)
// Note: API_URL already includes /api, so we use it as-is
const getApiUrl = () => {
  // If API_URL is set, use it (it already includes /api)
  if (process.env.API_URL) {
    return process.env.API_URL.replace(/\/$/, ''); // Remove trailing slash
  }
  // For Railway - try internal service URL first, then public domain
  // Need to add /api since these don't include it
  if (process.env.RAILWAY_STATIC_URL) {
    return `${process.env.RAILWAY_STATIC_URL.replace(/\/$/, '')}/api`;
  }
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api`;
  }
  // For Vercel - add /api
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}/api`;
  }
  // For internal calls on same server, use localhost with /api
  if (process.env.PORT) {
    return `http://localhost:${process.env.PORT}/api`;
  }
  // Fallback - add /api
  return `${process.env.FRONTEND_URL?.replace(/\/$/, '') || 'http://localhost:5000'}/api`;
};

const router = express.Router();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const { authMiddleware, roleCheck } = require("../middlewares/auth");

function getUserIdFromToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || process.env.JWT);
    return decoded.id || decoded._id || null;
  } catch (err) {
    return null;
  }
}

// NEW: Stock management - Decrease stock for order items
async function decreaseOrderStock(order) {
  try {
    console.log("Decreasing stock for order:", order._id);
    
    for (const item of order.items) {
      const product = await Product.findById(item.productId);
      if (!product) {
        console.warn(`Product not found for item: ${item.productId}`);
        continue;
      }

      // If product has variants and item has variantId
      if (product.variants && product.variants.length > 0 && item.variantId) {
        const variant = product.variants.find(v => v._id.toString() === item.variantId.toString());
        if (variant) {
          // Decrease stock for the variant
          const currentStock = variant.stock !== undefined ? variant.stock : 0;
          const newStock = Math.max(0, currentStock - item.quantity);
          variant.stock = newStock;
          console.log(`Decreased stock for variant ${item.variantId}: ${currentStock} -> ${newStock}`);
        } else {
          console.warn(`Variant not found: ${item.variantId} for product: ${item.productId}`);
        }
      }
      // For products without variants, stock is not managed (backward compatibility)
      
      await product.save();
    }
    
    console.log("Stock decreased successfully for order:", order._id);
  } catch (error) {
    console.error("Error decreasing stock for order:", error);
    throw error;
  }
}

async function createOrderDocument({ userId, guestInfo, items, total, paymentMethod, deliveryMethod, outletId }) {
  console.log("Creating order document with items:", items);
  const products = await Product.find({ _id: { $in: items.map(i => i.productId) } });
  const order = new Order({
    userId: userId || undefined,
    guestInfo: userId ? undefined : guestInfo,
    items: items.map(item => ({
      productId: item.productId,
      sellerId: products.find(p => p._id.equals(item.productId))?.sellerId,
      variantId: item.variantId,
      quantity: item.quantity,
      price: item.price,
    })),
    total,
    paymentMethod: paymentMethod || "Stripe",
    deliveryMethod: deliveryMethod || "delivery",
    outletId: deliveryMethod === "pickup" ? outletId : null,
    paymentStatus: paymentMethod === "Stripe" ? "Pending" : "Pending",
    orderStatus: "Pending"
  });
  await order.save();
  console.log("Order created:", order._id);
  return order;
}

// In orderRoutes.js - find the sendOrderNotifications function and update it:
async function sendOrderNotifications(order, isPickup = false, trackingNumber = null) {
  try {
    const customerEmail = order.userId?.email || order.guestInfo?.email;
    const customerPhone = order.userId?.phone || order.guestInfo?.phone;
    const customerName = order.userId?.name || `${order.guestInfo?.firstName} ${order.guestInfo?.lastName}`;

    const orderIdStr = order._id.toString();
    const shortOrderId = orderIdStr.slice(-8);

    // Create simplified order object
    const simplifiedOrder = {
      _id: order._id,
      outletId: order.outletId,
      deliveryMethod: order.deliveryMethod,
      total: order.total
    };

    const apiUrl = getApiUrl();
    
    if (isPickup) {
      // PICKUP READY NOTIFICATION
      if (customerEmail) {
        await axios.post(`${apiUrl}/notifications/send-status-email`, {
          to: customerEmail,
          order: simplifiedOrder,
          customerName: customerName,
          status: 'Ready for Pickup'
        });
      }

      if (customerPhone) {
        const pickupMessage = `Hello ${customerName}! Your order #${shortOrderId} is ready for pickup at ${order.outletId?.name || 'the selected outlet'}. Address: ${order.outletId?.address || 'Outlet address'}. Phone: ${order.outletId?.phone || 'N/A'}`;
        
        await axios.post(`${apiUrl}/notifications/send-whatsapp`, {
          to: customerPhone,
          message: pickupMessage,
          order: simplifiedOrder,
          notificationType: 'pickup_ready'
        });
      }
    } else if (trackingNumber) {
      // TRACKING NOTIFICATION  
      if (customerEmail) {
        await axios.post(`${apiUrl}/notifications/send-status-email`, {
          to: customerEmail,
          order: simplifiedOrder,
          customerName: customerName,
          status: 'Shipped',
          trackingNumber: trackingNumber
        });
      }

      if (customerPhone) {
        const trackingMessage = `Hello ${customerName}! Your order #${shortOrderId} has been shipped. Tracking Number: ${trackingNumber}. Track your order here: ${process.env.FRONTEND_URL}/track-order`;

        await axios.post(`${apiUrl}/notifications/send-whatsapp`, {
          to: customerPhone,
          message: trackingMessage,
          order: simplifiedOrder,
          notificationType: 'tracking'
        });
      }
    }

    console.log("✅ Notifications sent successfully for order:", order._id);
  } catch (notificationError) {
    console.error("❌ Failed to send notifications:", notificationError.message);
    // Don't fail the order processing if notifications fail
  }
}
// Stripe checkout for home delivery
router.post("/stripe", async (req, res) => {
  try {
    const { items = [], guestInfo = null, deliveryMethod = "delivery", outletId = null } = req.body;
    const userId = getUserIdFromToken(req);
    if (!items || !items.length) return res.status(400).json({ message: "No items provided" });

    console.log("Stripe checkout request:", { items, guestInfo, userId, deliveryMethod, outletId });

    const total = items.reduce((s, it) => s + (it.price || 0) * (it.quantity || 1), 0);

    const order = await createOrderDocument({ 
      userId, 
      guestInfo, 
      items, 
      total, 
      paymentMethod: "Stripe",
      deliveryMethod,
      outletId
    });

    const lineItems = items.map((item) => ({
      price_data: {
        currency: "usd",
        product_data: {
          name: item.name,
          images: item.image ? [item.image] : [],
        },
        unit_amount: Math.round((item.price || 0) * 100),
      },
      quantity: item.quantity || 1,
    }));

    if (!process.env.FRONTEND_URL || !/^https?:\/\//i.test(process.env.FRONTEND_URL)) {
      console.warn("FRONTEND_URL is missing or invalid in .env. Should include http:// or https://");
      return res.status(500).json({ message: "Server misconfiguration: FRONTEND_URL must include http:// or https:// in .env" });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: lineItems,
      success_url: `${process.env.FRONTEND_URL.replace(/\/$/, "")}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL.replace(/\/$/, "")}/cancel`,
      metadata: {
        orderId: order._id.toString()
      },
      client_reference_id: order._id.toString()
    });

    order.stripeSessionId = session.id;
    await order.save();

    await sendOrderConfirmation(order);

    console.log("Stripe session created:", session.id);
    return res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe Checkout Error:", err);
    return res.status(500).json({ message: "Failed to create checkout session" });
  }
});

// Pickup order endpoint
router.post("/pickup", async (req, res) => {
  try {
    const { items = [], total = 0, guestInfo = null, outletId = null } = req.body;
    const userId = getUserIdFromToken(req);

    console.log("Pickup order request:", { items, total, guestInfo, userId, outletId });

    if (!items || !items.length) return res.status(400).json({ message: "No items provided" });

    if (!outletId) {
      return res.status(400).json({ message: "Outlet selection is required for pickup orders" });
    }

    const order = await createOrderDocument({ 
      userId, 
      guestInfo, 
      items, 
      total, 
      paymentMethod: "Pickup",
      deliveryMethod: "pickup",
      outletId
    });

    // NEW: Stock management - Decrease stock for pickup orders immediately
    await decreaseOrderStock(order);

    if (userId) {
      try {
        await Cart.findOneAndDelete({ userId });
        console.log("Cart cleared for user:", userId);
      } catch (e) {
        console.warn("Failed to clear DB cart after pickup order:", e.message);
      }
    }

    await sendOrderConfirmation(order);

    console.log("Pickup order placed successfully:", order._id);
    return res.status(201).json({ 
      message: `Pickup order placed successfully! Ready for pickup at selected outlet.`, 
      order 
    });
  } catch (err) {
    console.error("Pickup Order Error:", err);
    return res.status(500).json({ message: "Failed to place pickup order" });
  }
});

// Get user orders
router.get("/", async (req, res) => {
  try {
    const userId = getUserIdFromToken(req);
    if (!userId) return res.status(401).json({ message: "Login required" });

    console.log("Fetching orders for user:", userId);

    const orders = await Order.find({ userId })
      .populate("items.productId", "name price images")
      .populate("items.sellerId", "name email")
      .populate("outletId", "name location address phone")
      .sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    console.error("Error fetching orders:", err);
    res.status(500).json({ message: "Failed to fetch orders" });
  }
});

// Get seller orders
router.get("/seller", async (req, res) => {
  try {
    const userId = getUserIdFromToken(req);
    if (!userId) return res.status(401).json({ message: "Login required" });

    console.log("Fetching seller orders for user:", userId);

    const orders = await Order.find({ "items.sellerId": userId })
      .populate("items.productId", "name price images")
      .populate("userId", "name email phone")
      .populate("outletId", "name location address phone")
      .sort({ createdAt: -1 });

    const transformed = orders.map(o => {
      const myItems = o.items.filter(it => it.sellerId && it.sellerId.toString() === userId.toString());
      return {
        _id: o._id,
        userId: o.userId,
        guestInfo: o.guestInfo,
        total: o.total,
        paymentMethod: o.paymentMethod,
        paymentStatus: o.paymentStatus,
        orderStatus: o.orderStatus,
        deliveryMethod: o.deliveryMethod,
        outletId: o.outletId,
        createdAt: o.createdAt,
        items: myItems
      };
    });

    res.json(transformed);
  } catch (err) {
    console.error("Error fetching seller orders:", err);
    res.status(500).json({ message: "Failed to fetch seller orders" });
  }
});

// Get all orders for admin with full details
router.get("/all", authMiddleware, roleCheck(["admin","company"]), async (req, res) => {
  try {
    console.log("Fetching all orders for admin");
    const orders = await Order.find()
      .populate("items.productId", "name price images")
      .populate("items.sellerId", "name email")
      .populate("userId", "name email phone")
      .populate("outletId", "name location address phone")
      .sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch all orders" });
  }
});

// Get seller candidate orders for admin
router.get("/admin/seller-candidates", authMiddleware, roleCheck(["admin","company"]), async (req, res) => {
  try {
    console.log("Fetching seller candidate orders");
    const sellerCandidates = await User.find({ role: "seller_candidate" });
    const sellerCandidateIds = sellerCandidates.map(s => s._id);
    
    const orders = await Order.find({ "items.sellerId": { $in: sellerCandidateIds } })
      .populate("items.productId", "name price images")
      .populate("items.sellerId", "name email")
      .populate("userId", "name email phone")
      .populate("outletId", "name location address phone")
      .sort({ createdAt: -1 });

    res.json(orders);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch seller candidate orders" });
  }
});

// Process order - No stock management
router.post("/:orderId/process", authMiddleware, async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = getUserIdFromToken(req);
    const { trackingNumber, isPickup = false } = req.body;
    console.log(trackingNumber)
    console.log("Processing order:", orderId, "by user:", userId, "isPickup:", isPickup);

    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const order = await Order.findById(orderId)
      .populate("items.productId")
      .populate("userId", "name email phone")
      .populate("outletId", "name location address phone");

    if (!order) return res.status(404).json({ message: "Order not found" });

    let canProcess = false;

    if (req.user.role === "company" || req.user.role === "admin") {
      canProcess = true;
    } else if (req.user.role === "seller_candidate" || req.user.role === "seller") {
      canProcess = order.items.some(item => item.sellerId?.toString() === userId.toString());
    }

    if (!canProcess)
      return res.status(403).json({ message: "You cannot process this order" });

    // Update order status only - No stock management
    order.orderStatus = "Processing";
    
    if (trackingNumber && order.deliveryMethod === "delivery") {
      order.trackingNumber = trackingNumber;
    }

    order.updatedAt = Date.now();
    await order.save();

    await sendOrderNotifications(order, isPickup, trackingNumber);

    console.log("Order processed successfully:", orderId);
    
    res.json({ 
      message: "Order processed successfully", 
      order,
      notification: isPickup ? "Pickup notification sent" : "Tracking information added"
    });
  } catch (err) {
    console.error("Error processing order:", err);
    res.status(500).json({ message: err.message || "Failed to process order" });
  }
});

async function sendOrderConfirmation(order) {
  try {
    const customer = order.userId ? {
      email: order.userId.email,
      phone: order.userId.phone,
      name: order.userId.name
    } : {
      email: order.guestInfo?.email,
      phone: order.guestInfo?.phone,
      name: `${order.guestInfo?.firstName} ${order.guestInfo?.lastName}`
    };

    // Convert ObjectId to string
    const orderIdStr = order._id.toString();
    const shortOrderId = orderIdStr.slice(-8);

    console.log('📧 Attempting to send order confirmation...', {
      customerEmail: customer.email,
      orderId: order._id
    });

    // NEW: Fix email sending - Use helper function to get correct API URL
    const apiUrl = getApiUrl();
    const response = await axios.post(`${apiUrl}/notifications/send-order-confirmation`, {
      order: {
        ...order.toObject ? order.toObject() : order,
        _id: order._id,
        shortId: shortOrderId
      },
      customer: customer
    }, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log("✅ Order confirmation notification sent for order:", order._id, response.data);
  } catch (notificationError) {
    console.error("❌ Failed to send order confirmation:", notificationError.message);
    // Don't fail the order creation if notification fails
  }
}

// Add tracking number
router.put("/:orderId/tracking", authMiddleware, roleCheck(["admin", "company"]), async (req, res) => {
  try {
    const { trackingNumber } = req.body;
    const order = await Order.findByIdAndUpdate(
      req.params.orderId,
      { 
        trackingNumber,
        orderStatus: "Processing",
        updatedAt: Date.now()
      },
      { new: true }
    ).populate("userId", "name email phone")
     .populate("guestInfo")
     .populate("outletId", "name location address phone")
     .populate("items.productId", "name");

    if (!order) return res.status(404).json({ message: "Order not found" });

    try {
      const customerEmail = order.userId?.email || order.guestInfo?.email;
      const customerPhone = order.userId?.phone || order.guestInfo?.phone;
      const customerName = order.userId?.name || `${order.guestInfo?.firstName} ${order.guestInfo?.lastName}`;

      if (order.deliveryMethod === 'delivery' && trackingNumber) {
        const apiUrl = getApiUrl();
        await axios.post(`${apiUrl}/notifications/send-email`, {
          to: customerEmail,
          subject: `Your Order is Shipped - #${order._id.slice(-8)}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #10B981;">Your Order is on the Way! 🚚</h2>
              <p>Dear ${customerName},</p>
              <p>Your order <strong>#${order._id.slice(-8)}</strong> has been shipped and is on its way to you.</p>
              
              <div style="background: #f0f9ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3 style="margin-top: 0;">Tracking Information</h3>
                <p><strong>Tracking Number:</strong> ${trackingNumber}</p>
                <p><strong>Track Your Package:</strong> 
                  <a href="https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}" style="color: #2563eb;">
                    Click here to track on FedEx
                  </a>
                </p>
              </div>

              <div style="background: #fef3c7; padding: 15px; border-radius: 8px;">
                <h4 style="color: #D97706;">Order Details</h4>
                <p><strong>Items:</strong></p>
                <ul>
                  ${order.items.map(item => `<li>${item.productId?.name} × ${item.quantity}</li>`).join('')}
                </ul>
                <p><strong>Total:</strong> $${order.total.toFixed(2)}</p>
              </div>

              <p style="margin-top: 30px;">Thank you for shopping with us!</p>
              <p><strong>RecycleTrade Team</strong></p>
            </div>
          `
        });

        if (customerPhone) {
          const whatsappMessage = `Your order #${order._id.slice(-8)} has been shipped! 🚚\n\nTracking Number: ${trackingNumber}\nTrack your package: https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}\n\nYour order will arrive soon!`;
          
          const apiUrl = getApiUrl();
        await axios.post(`${apiUrl}/notifications/send-whatsapp`, {
            to: customerPhone,
            message: whatsappMessage
          });
        }

      } else if (order.deliveryMethod === 'pickup') {
        const apiUrl = getApiUrl();
        await axios.post(`${apiUrl}/notifications/send-email`, {
          to: customerEmail,
          subject: `Your Order is Ready for Pickup - #${order._id.slice(-8)}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #10B981;">Your Order is Ready for Pickup! 🎉</h2>
              <p>Dear ${customerName},</p>
              <p>Your order <strong>#${order._id.slice(-8)}</strong> is ready for pickup.</p>
              
              <div style="background: #f0f9ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3 style="margin-top: 0;">Pickup Location</h3>
                <p><strong>Outlet:</strong> ${order.outletId?.name}</p>
                <p><strong>Address:</strong> ${order.outletId?.address}</p>
                <p><strong>Location:</strong> ${order.outletId?.location}</p>
                ${order.outletId?.phone ? `<p><strong>Phone:</strong> ${order.outletId.phone}</p>` : ''}
                <p><strong>Business Hours:</strong> 9:00 AM - 8:00 PM (Mon-Sun)</p>
              </div>

              <div style="background: #fef3c7; padding: 15px; border-radius: 8px;">
                <h4 style="color: #D97706;">What to Bring</h4>
                <ul>
                  <li>Order confirmation (this email or order ID)</li>
                  <li>Valid government-issued ID</li>
                  <li>Payment method used for the order</li>
                </ul>
              </div>

              <div style="margin-top: 20px; padding: 15px; background: #dcfce7; border-radius: 8px;">
                <h4 style="color: #16a34a; margin-top: 0;">Order Items</h4>
                <ul>
                  ${order.items.map(item => `<li><strong>${item.productId?.name}</strong> × ${item.quantity} - $${(item.price * item.quantity).toFixed(2)}</li>`).join('')}
                </ul>
                <p style="margin-top: 10px;"><strong>Total Amount: $${order.total.toFixed(2)}</strong></p>
              </div>

              <p style="margin-top: 30px;">We look forward to seeing you!</p>
              <p><strong>RecycleTrade Team</strong></p>
            </div>
          `
        });

        if (customerPhone) {
          const whatsappMessage = `Your order #${order._id.slice(-8)} is ready for pickup! 🎉\n\n📍 Pickup Location:\n${order.outletId?.name}\n${order.outletId?.address}\n${order.outletId?.location}\n\n🕒 Hours: 9AM-8PM (Mon-Sun)\n\nPlease bring your order confirmation and ID.\n\nWe can't wait to see you!`;
          
          const apiUrl = getApiUrl();
        await axios.post(`${apiUrl}/notifications/send-whatsapp`, {
            to: customerPhone,
            message: whatsappMessage
          });
        }
      }

      console.log("Notifications sent for order processing");
    } catch (notificationError) {
      console.error("Failed to send notifications:", notificationError);
    }

    res.json({ message: "Tracking number added and notifications sent successfully", order });
  } catch (err) {
    console.error("Error adding tracking number:", err);
    res.status(500).json({ message: "Failed to add tracking number" });
  }
});

// Track order by ID or tracking number
router.get("/track/:orderId", async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId)
      .populate("items.productId", "name images")
      .populate("items.sellerId", "name")
      .populate("outletId", "name location address phone")
      .select("-stripeSessionId");

    if (!order) {
      const orderByTracking = await Order.findOne({ trackingNumber: req.params.orderId })
        .populate("items.productId", "name images")
        .populate("items.sellerId", "name")
        .populate("outletId", "name location address phone")
        .select("-stripeSessionId");
      
      if (!orderByTracking) {
        return res.status(404).json({ message: "Order not found" });
      }
      return res.json(orderByTracking);
    }

    res.json(order);
  } catch (err) {
    console.error("Error tracking order:", err);
    res.status(500).json({ message: "Failed to track order" });
  }
});

module.exports = router;