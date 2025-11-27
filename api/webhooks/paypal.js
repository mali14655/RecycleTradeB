const express = require('express');
const router = express.Router();
const paypal = require('@paypal/paypal-server-sdk');
const axios = require('axios');
const connectDB = require('../../config/db');
const Order = require('../../models/Orders');
const Cart = require('../../models/Cart');
const Product = require('../../models/Product');

// Helper function to get customer name properly - removes duplicates
const getCustomerName = (order) => {
  if (order.userId?.name) {
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
  
  const cleanFirstName = firstName ? firstName.split(/\s+/).filter((v, i, a) => a.indexOf(v) === i).join(' ') : '';
  const cleanLastName = lastName ? lastName.split(/\s+/).filter((v, i, a) => a.indexOf(v) === i).join(' ') : '';
  
  if (cleanFirstName && cleanLastName) {
    if (cleanFirstName.toLowerCase().includes(cleanLastName.toLowerCase())) {
      return cleanFirstName;
    }
    if (cleanLastName.toLowerCase().includes(cleanFirstName.toLowerCase())) {
      return cleanLastName;
    }
    return `${cleanFirstName} ${cleanLastName}`;
  }
  return cleanFirstName || cleanLastName || 'Guest Customer';
};

// NEW: Helper function to get API URL (works on both local and server)
const getApiUrl = () => {
  const port = process.env.PORT || 5000;
  const baseUrl = `http://localhost:${port}`;
  
  if (process.env.NODE_ENV === 'production' && process.env.API_URL) {
    const apiUrl = process.env.API_URL.replace(/\/$/, '');
    if (apiUrl.includes('localhost') || apiUrl.includes('127.0.0.1')) {
      return `${baseUrl}/api`;
    }
    return apiUrl;
  }
  
  return `${baseUrl}/api`;
};

// Initialize PayPal SDK
const paypalClientId = process.env.PAYPAL_CLIENT_ID;
const paypalClientSecret = process.env.PAYPAL_CLIENT_SECRET;
const paypalEnvironment = process.env.PAYPAL_ENVIRONMENT || "sandbox";

let paypalClient = null;
if (paypalClientId && paypalClientSecret) {
  const environment = paypalEnvironment === "live" 
    ? paypal.Environment.Production
    : paypal.Environment.Sandbox;
  paypalClient = new paypal.Client({
    environment: environment,
    clientId: paypalClientId,
    clientSecret: paypalClientSecret
  });
} else {
  console.warn('⚠️ PayPal credentials not configured. PayPal webhooks will not work.');
}

// PayPal webhook route - handles payment completion
router.post('/', express.json(), async (req, res) => {
  try {
    await connectDB();

    // PayPal sends webhook events for order completion
    // We'll handle the order capture event
    const eventType = req.body.event_type;
    const resource = req.body.resource;

    console.log('✅ PayPal webhook received:', eventType);

    // Handle payment capture completion
    if (eventType === 'PAYMENT.CAPTURE.COMPLETED' || eventType === 'CHECKOUT.ORDER.COMPLETED') {
      let orderId = null;
      
      // Extract order ID from different event types
      if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
        // For payment capture, get the order ID from the custom_id
        orderId = resource?.custom_id || resource?.supplementary_data?.related_ids?.order_id;
      } else if (eventType === 'CHECKOUT.ORDER.COMPLETED') {
        // For order completion, get from purchase_units
        orderId = resource?.purchase_units?.[0]?.custom_id || resource?.id;
      }

      // Also try to find by PayPal order ID
      if (!orderId && resource?.id) {
        const orderByPaypalId = await Order.findOne({ paypalOrderId: resource.id });
        if (orderByPaypalId) {
          orderId = orderByPaypalId._id.toString();
        }
      }

      if (!orderId) {
        console.error('❌ No order ID found in PayPal webhook');
        return res.status(400).json({ error: 'No orderId found in webhook' });
      }

      const order = await Order.findById(orderId);
      if (!order) {
        console.error('❌ Order not found:', orderId);
        return res.status(404).json({ error: 'Order not found' });
      }

      // Update order payment status
      order.paymentStatus = 'Paid';
      await order.save();

      // NEW: Stock management - Decrease stock when payment is confirmed
      try {
        console.log('Decreasing stock for paid PayPal order:', orderId);
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
              const currentStock = variant.stock !== undefined ? variant.stock : 0;
              const newStock = Math.max(0, currentStock - item.quantity);
              variant.stock = newStock;
              console.log(`Decreased stock for variant ${item.variantId}: ${currentStock} -> ${newStock}`);
            } else {
              console.warn(`Variant not found: ${item.variantId} for product: ${item.productId}`);
            }
          }
          
          await product.save();
        }
        console.log('✅ Stock decreased successfully for PayPal order:', orderId);
      } catch (stockError) {
        console.error('❌ Error decreasing stock:', stockError);
        // Don't fail the webhook if stock update fails, but log it
      }

      // Clear cart
      if (order.userId) {
        await Cart.deleteOne({ userId: order.userId });
      }

      // NEW: Send order confirmation email when payment is successful
      try {
        const populatedOrder = await Order.findById(orderId)
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

        if (customer.email) {
          try {
            const notificationsModule = require('../../routes/notificationsRoutes');
            const sendOrderConfirmationEmail = notificationsModule.sendOrderConfirmationEmail;
            
            if (!sendOrderConfirmationEmail) {
              throw new Error('sendOrderConfirmationEmail function not found in notificationsRoutes');
            }

            const result = await sendOrderConfirmationEmail(populatedOrder, customer);
            
            if (result.success) {
              console.log('✅ Order confirmation email sent for paid PayPal order:', orderId);
              console.log('✅ Email details:', {
                messageId: result.messageId,
                service: result.service,
                to: customer.email
              });
            } else if (result.skipped) {
              console.log('⚠️ Order confirmation skipped:', result.message);
            }
          } catch (emailError) {
            console.error('\n❌ ========== PAYPAL WEBHOOK ORDER CONFIRMATION EMAIL FAILED ==========');
            console.error('❌ Order ID:', orderId);
            console.error('❌ Customer Email:', customer.email);
            console.error('❌ Error Message:', emailError.message);
            console.error('❌ Error Code:', emailError.code || 'NO_CODE');
            console.error('❌ Full Error:', emailError);
            console.error('❌ =====================================================================\n');
          }
        }
      } catch (emailError) {
        console.error('❌ Failed to send order confirmation email:', emailError.message);
        // Don't fail the webhook if email fails
      }

      console.log('✅ PayPal order updated and cart cleared:', orderId);
    }

    res.json({ received: true });
  } catch (err) {
    console.error('❌ PayPal webhook processing error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// NEW: Route to capture PayPal order after approval (called from frontend)
router.post('/capture', express.json(), async (req, res) => {
  try {
    await connectDB();

    const { orderId: paypalOrderId } = req.body;

    if (!paypalOrderId) {
      return res.status(400).json({ error: 'PayPal order ID is required' });
    }

    if (!paypalClient) {
      return res.status(500).json({ error: 'PayPal is not configured' });
    }

    // Find order by PayPal order ID
    const order = await Order.findOne({ paypalOrderId });
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Capture the PayPal order
    const ordersController = new paypal.OrdersController(paypalClient);
    const captureRequest = { body: {} }; // Empty body for capture

    const { result, statusCode } = await ordersController.captureOrder(paypalOrderId, captureRequest);

    if (statusCode !== 201) {
      console.error('PayPal capture failed:', result);
      return res.status(500).json({ error: 'Failed to capture PayPal order' });
    }

    // Update order payment status
    order.paymentStatus = 'Paid';
    await order.save();

    // NEW: Stock management - Decrease stock when payment is confirmed
    try {
      console.log('Decreasing stock for captured PayPal order:', order._id);
      for (const item of order.items) {
        const product = await Product.findById(item.productId);
        if (!product) {
          console.warn(`Product not found for item: ${item.productId}`);
          continue;
        }

        if (product.variants && product.variants.length > 0 && item.variantId) {
          const variant = product.variants.find(v => v._id.toString() === item.variantId.toString());
          if (variant) {
            const currentStock = variant.stock !== undefined ? variant.stock : 0;
            const newStock = Math.max(0, currentStock - item.quantity);
            variant.stock = newStock;
            console.log(`Decreased stock for variant ${item.variantId}: ${currentStock} -> ${newStock}`);
          }
        }
        
        await product.save();
      }
      console.log('✅ Stock decreased successfully for captured PayPal order:', order._id);
    } catch (stockError) {
      console.error('❌ Error decreasing stock:', stockError);
    }

    // Clear cart
    if (order.userId) {
      await Cart.deleteOne({ userId: order.userId });
    }

    // Send order confirmation email
    try {
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

      if (customer.email) {
        try {
          const notificationsModule = require('../../routes/notificationsRoutes');
          const sendOrderConfirmationEmail = notificationsModule.sendOrderConfirmationEmail;
          
          if (sendOrderConfirmationEmail) {
            const result = await sendOrderConfirmationEmail(populatedOrder, customer);
            if (result.success) {
              console.log('✅ Order confirmation email sent for captured PayPal order:', order._id);
            }
          }
        } catch (emailError) {
          console.error('❌ Failed to send order confirmation email:', emailError.message);
        }
      }
    } catch (emailError) {
      console.error('❌ Failed to send order confirmation email:', emailError.message);
    }

    console.log('✅ PayPal order captured successfully:', order._id);
    res.json({ 
      success: true, 
      orderId: order._id,
      paymentStatus: 'Paid'
    });
  } catch (err) {
    console.error('❌ PayPal capture error:', err);
    res.status(500).json({ error: 'Failed to capture PayPal order', message: err.message });
  }
});

module.exports = router;

