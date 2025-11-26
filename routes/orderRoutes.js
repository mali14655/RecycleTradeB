const express = require("express");
const Stripe = require("stripe");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const PDFDocument = require("pdfkit");
const Order = require("../models/Orders");
const Product = require("../models/Product");
const Cart = require("../models/Cart");
const User = require("../models/User");

// Helper function to get customer name properly - removes duplicates
const getCustomerName = (order) => {
  if (order.userId?.name) {
    // Clean up user name if it has duplicates
    const name = (order.userId.name || '').trim();
    if (name) {
      const parts = name.split(/\s+/);
      const uniqueParts = [];
      parts.forEach(part => {
        if (part && !uniqueParts.some(existing => existing.toLowerCase() === part.toLowerCase())) {
          uniqueParts.push(part);
        }
      });
      return uniqueParts.join(' ');
    }
    return name;
  }
  const firstName = (order.guestInfo?.firstName || '').trim();
  const lastName = (order.guestInfo?.lastName || '').trim();
  
  // Remove duplicates within firstName or lastName
  const cleanFirstName = firstName ? firstName.split(/\s+/).filter((v, i, a) => a.indexOf(v) === i).join(' ') : '';
  const cleanLastName = lastName ? lastName.split(/\s+/).filter((v, i, a) => a.indexOf(v) === i).join(' ') : '';
  
  if (cleanFirstName && cleanLastName) {
    // If firstName already contains lastName, just return firstName
    if (cleanFirstName.toLowerCase().includes(cleanLastName.toLowerCase())) {
      return cleanFirstName;
    }
    // If lastName already contains firstName, just return lastName
    if (cleanLastName.toLowerCase().includes(cleanFirstName.toLowerCase())) {
      return cleanLastName;
    }
    // Normal case: combine them with a space
    return `${cleanFirstName} ${cleanLastName}`;
  }
  return cleanFirstName || cleanLastName || 'Guest Customer';
};

// NEW: Helper function to get API URL (works on both local and server)
// Note: API_URL already includes /api, so we use it as-is
const getApiUrl = () => {
  // For internal server calls, always use localhost (most reliable)
  // This works on both local and server environments
  const port = process.env.PORT || 5000;
  const baseUrl = `http://localhost:${port}`;
  
  // If we're in production and have a specific API URL, use it
  // But prefer localhost for internal calls to avoid network issues
  if (process.env.NODE_ENV === 'production' && process.env.API_URL) {
    // Only use external URL if explicitly needed
    const apiUrl = process.env.API_URL.replace(/\/$/, '');
    // If API_URL points to same server, use localhost instead
    if (apiUrl.includes('localhost') || apiUrl.includes('127.0.0.1')) {
      return `${baseUrl}/api`;
    }
    return apiUrl;
  }
  
  // Default to localhost for internal calls
  return `${baseUrl}/api`;
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
    const customerName = getCustomerName(order);

    const orderIdStr = order._id.toString();
    const shortOrderId = orderIdStr.slice(-8);

    // Create simplified order object with items for email
    const simplifiedOrder = {
      _id: order._id,
      outletId: order.outletId,
      deliveryMethod: order.deliveryMethod,
      total: order.total,
      items: order.items || [] // Include items for email template
    };

    // NEW: Lazy load notification functions to avoid circular dependency
    const notificationsModule = require('./notificationsRoutes');
    const sendStatusUpdateEmail = notificationsModule.sendStatusUpdateEmail;
    
    if (!sendStatusUpdateEmail) {
      throw new Error('sendStatusUpdateEmail function not found in notificationsRoutes');
    }
    
    if (isPickup) {
      // PICKUP READY NOTIFICATION
      if (customerEmail) {
        try {
          const result = await sendStatusUpdateEmail(customerEmail, simplifiedOrder, customerName, 'Ready for Pickup');
          if (result.success) {
            console.log("✅ Pickup ready email sent to:", customerEmail);
            console.log("✅ Email details:", {
              messageId: result.messageId,
              service: result.service
            });
          }
        } catch (emailError) {
          console.error("\n❌ ========== PICKUP EMAIL FAILED ==========");
          console.error("❌ Order ID:", order._id);
          console.error("❌ Customer Email:", customerEmail);
          console.error("❌ Error Message:", emailError.message);
          console.error("❌ Error Code:", emailError.code || 'NO_CODE');
          console.error("❌ Full Error:", emailError);
          console.error("❌ ========================================\n");
        }
      }

      // WhatsApp notification (if route exists, otherwise skip)
      if (customerPhone) {
        try {
          const apiUrl = getApiUrl();
          const pickupMessage = `Hello ${customerName}! Your order #${shortOrderId} is ready for pickup at ${order.outletId?.name || 'the selected outlet'}. Address: ${order.outletId?.address || 'Outlet address'}. Phone: ${order.outletId?.phone || 'N/A'}`;
          
          await axios.post(`${apiUrl}/notifications/send-whatsapp`, {
            to: customerPhone,
            message: pickupMessage,
            order: simplifiedOrder,
            notificationType: 'pickup_ready'
          }).catch(() => {
            // WhatsApp route might not exist, that's okay
            console.log("⚠️ WhatsApp notification skipped (route not available)");
          });
        } catch (whatsappError) {
          // Don't fail if WhatsApp fails
          console.log("⚠️ WhatsApp notification skipped:", whatsappError.message);
        }
      }
    } else if (trackingNumber) {
      // TRACKING NOTIFICATION  
      if (customerEmail) {
        try {
          const result = await sendStatusUpdateEmail(customerEmail, simplifiedOrder, customerName, 'Shipped', trackingNumber);
          if (result.success) {
            console.log("✅ Tracking email sent to:", customerEmail);
            console.log("✅ Email details:", {
              messageId: result.messageId,
              service: result.service,
              trackingNumber: trackingNumber
            });
          }
        } catch (emailError) {
          console.error("\n❌ ========== TRACKING EMAIL FAILED ==========");
          console.error("❌ Order ID:", order._id);
          console.error("❌ Customer Email:", customerEmail);
          console.error("❌ Tracking Number:", trackingNumber);
          console.error("❌ Error Message:", emailError.message);
          console.error("❌ Error Code:", emailError.code || 'NO_CODE');
          console.error("❌ Full Error:", emailError);
          console.error("❌ ===========================================\n");
        }
      }

      // WhatsApp notification (if route exists, otherwise skip)
      if (customerPhone) {
        try {
          const apiUrl = getApiUrl();
          const trackingMessage = `Hello ${customerName}! Your order #${shortOrderId} has been shipped. Tracking Number: ${trackingNumber}. Track your order here: ${process.env.FRONTEND_URL}/track-order`;

          await axios.post(`${apiUrl}/notifications/send-whatsapp`, {
            to: customerPhone,
            message: trackingMessage,
            order: simplifiedOrder,
            notificationType: 'tracking'
          }).catch(() => {
            // WhatsApp route might not exist, that's okay
            console.log("⚠️ WhatsApp notification skipped (route not available)");
          });
        } catch (whatsappError) {
          // Don't fail if WhatsApp fails
          console.log("⚠️ WhatsApp notification skipped:", whatsappError.message);
        }
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

    // REMOVED: Order confirmation will be sent via Stripe webhook after payment is successful
    // This ensures confirmation is only sent when payment is actually completed

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
      .populate("items.productId", "name price images variants")
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

// NEW: Lazy load the email function to avoid circular dependency and timing issues
// This ensures it works reliably on servers (Vercel, Railway, etc.)
async function sendOrderConfirmation(order) {
  try {
    // Populate order with product details before sending
    const populatedOrder = await Order.findById(order._id)
      .populate("items.productId", "name price images variants")
      .populate("items.sellerId", "name email")
      .populate("outletId", "name location address phone email")
      .populate("userId", "name email phone")
      .lean();

    const customer = populatedOrder.userId ? {
      email: populatedOrder.userId.email,
      phone: populatedOrder.userId.phone,
      name: populatedOrder.userId.name
    } : {
      email: populatedOrder.guestInfo?.email,
      phone: populatedOrder.guestInfo?.phone,
      name: getCustomerName(populatedOrder)
    };

    console.log('📧 Attempting to send order confirmation...', {
      customerEmail: customer.email,
      orderId: populatedOrder._id
    });

    // NEW: Lazy load the function to avoid circular dependency issues on server
    // This ensures the module is fully loaded before we try to use it
    const notificationsModule = require('./notificationsRoutes');
    const sendOrderConfirmationEmail = notificationsModule.sendOrderConfirmationEmail;
    
    if (!sendOrderConfirmationEmail) {
      throw new Error('sendOrderConfirmationEmail function not found in notificationsRoutes');
    }

    // Call the email function directly instead of HTTP request
    const result = await sendOrderConfirmationEmail(populatedOrder, customer);
    
    if (result.success) {
      console.log("✅ Order confirmation notification sent for order:", populatedOrder._id);
      console.log("✅ Email details:", {
        messageId: result.messageId,
        service: result.service,
        to: customer.email
      });
    } else if (result.skipped) {
      console.log("⚠️ Order confirmation skipped:", result.message);
    }
  } catch (error) {
    // Detailed error logging
    console.error("\n❌ ========== ORDER CONFIRMATION EMAIL FAILED ==========");
    console.error("❌ Order ID:", populatedOrder._id);
    console.error("❌ Customer Email:", customer.email);
    console.error("❌ Error Message:", error.message);
    console.error("❌ Error Code:", error.code || 'NO_CODE');
    console.error("❌ Full Error:", error);
    console.error("❌ =====================================================\n");
    // Don't fail the order creation if notification fails, but log it clearly
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
      const customerName = getCustomerName(order);

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

// NEW: Export processed orders to PDF
router.get("/processed/export-pdf", authMiddleware, roleCheck(["admin", "company"]), async (req, res) => {
  try {
    const { orderIds } = req.query;
    let orderIdArray = [];
    
    if (orderIds) {
      if (Array.isArray(orderIds)) {
        orderIdArray = orderIds;
      } else if (typeof orderIds === 'string') {
        // Handle comma-separated string
        orderIdArray = orderIds.split(',').filter(id => id.trim());
      } else {
        orderIdArray = [orderIds];
      }
    }

    // Fetch processed orders
    let query = { orderStatus: "Processing" };
    if (orderIdArray.length > 0) {
      query._id = { $in: orderIdArray };
    }

    const orders = await Order.find(query)
      .populate("items.productId", "name price")
      .populate("items.sellerId", "name email")
      .populate("userId", "name email phone")
      .populate("outletId", "name location address phone")
      .sort({ updatedAt: -1 });

    if (orders.length === 0) {
      return res.status(404).json({ message: "No processed orders found" });
    }

    // Create PDF
    const doc = new PDFDocument({ margin: 50 });
    const filename = `processed-orders-${Date.now()}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    doc.pipe(res);

    // Header
    doc.fontSize(20).text("Processed Orders Report", { align: "center" });
    doc.moveDown();
    doc.fontSize(12).text(`Generated on: ${new Date().toLocaleString()}`, { align: "center" });
    doc.fontSize(10).text(`Total Orders: ${orders.length}`, { align: "center" });
    doc.moveDown(2);

    let yPosition = doc.y;
    let pageNumber = 1;

    orders.forEach((order, index) => {
      // Check if we need a new page
      if (yPosition > 700) {
        doc.addPage();
        yPosition = 50;
        pageNumber++;
      }

      // Order Header
      doc.fontSize(14).fillColor("black").text(`Order #${order._id.toString().slice(-8)}`, { continued: false });
      doc.fontSize(10).fillColor("gray").text(`Date: ${new Date(order.createdAt).toLocaleDateString()}`, { continued: true });
      doc.text(` | Processed: ${new Date(order.updatedAt).toLocaleDateString()}`, { continued: true });
      doc.moveDown(0.5);

      // Customer Information
      doc.fontSize(11).fillColor("black").text("Customer Information:", { underline: true });
      const customerName = getCustomerName(order);
      doc.fontSize(10).fillColor("black").text(`Name: ${customerName}`);
      
      if (order.userId) {
        doc.text(`Email: ${order.userId.email || "N/A"}`);
        doc.text(`Phone: ${order.userId.phone || "N/A"}`);
      } else if (order.guestInfo) {
        doc.text(`Email: ${order.guestInfo.email || "N/A"}`);
        doc.text(`Phone: ${order.guestInfo.phone || "N/A"}`);
        if (order.guestInfo.address) {
          doc.text(`Address: ${order.guestInfo.address}`);
        }
      }
      doc.moveDown(0.5);

      // Order Items
      doc.fontSize(11).fillColor("black").text("Order Items:", { underline: true });
      order.items.forEach((item, itemIndex) => {
        const productName = item.productId?.name || "Product not found";
        const sellerName = item.sellerId?.name || "Unknown Seller";
        const quantity = item.quantity;
        const price = item.price;
        const itemTotal = quantity * price;

        doc.fontSize(10).fillColor("black")
          .text(`${itemIndex + 1}. ${productName}`, { continued: false })
          .text(`   Seller: ${sellerName}`, { indent: 20 })
          .text(`   Quantity: ${quantity} x $${price.toFixed(2)} = $${itemTotal.toFixed(2)}`, { indent: 20 });
      });
      doc.moveDown(0.5);

      // Order Summary
      doc.fontSize(11).fillColor("black").text("Order Summary:", { underline: true });
      doc.fontSize(10).fillColor("black")
        .text(`Payment Method: ${order.paymentMethod}`)
        .text(`Delivery Method: ${order.deliveryMethod}`);
      if (order.trackingNumber) {
        doc.text(`Tracking Number: ${order.trackingNumber}`);
      }
      if (order.outletId) {
        doc.text(`Pickup Outlet: ${order.outletId.name} - ${order.outletId.location || ""}`);
      }
      doc.fontSize(12).fillColor("green").text(`Total: $${order.total.toFixed(2)}`, { align: "right" });

      // Separator
      doc.moveDown(1);
      doc.strokeColor("gray").lineWidth(0.5).moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown(1);

      yPosition = doc.y;
    });

    // Footer
    doc.fontSize(8).fillColor("gray").text(`Page ${pageNumber}`, 50, doc.page.height - 50, { align: "center" });

    doc.end();
  } catch (err) {
    console.error("Error generating PDF:", err);
    res.status(500).json({ message: "Failed to generate PDF" });
  }
});

// NEW: Bulk delete processed orders
router.delete("/processed/bulk-delete", authMiddleware, roleCheck(["admin", "company"]), async (req, res) => {
  try {
    const { orderIds } = req.body;

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ message: "Order IDs array is required" });
    }

    // Verify all orders are processed before deleting
    const orders = await Order.find({
      _id: { $in: orderIds },
      orderStatus: "Processing"
    });

    if (orders.length === 0) {
      return res.status(404).json({ message: "No processed orders found with the provided IDs" });
    }

    // Delete the orders
    const deleteResult = await Order.deleteMany({
      _id: { $in: orderIds },
      orderStatus: "Processing"
    });

    res.json({
      message: `Successfully deleted ${deleteResult.deletedCount} processed order(s)`,
      deletedCount: deleteResult.deletedCount
    });
  } catch (err) {
    console.error("Error deleting processed orders:", err);
    res.status(500).json({ message: "Failed to delete processed orders" });
  }
});

module.exports = router;