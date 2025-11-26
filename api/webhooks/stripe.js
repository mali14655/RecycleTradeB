const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const axios = require('axios');
const connectDB = require('../../config/db');
const Order = require('../../models/Orders');
const Cart = require('../../models/Cart');
const Product = require('../../models/Product');

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
// For internal server calls, always use localhost (most reliable)
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

// Stripe webhook route
router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    console.log('✅ Webhook verified:', event.type);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    await connectDB();

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const orderId = session.metadata?.orderId || session.client_reference_id;

      if (!orderId) return res.status(400).json({ error: 'No orderId found in session' });

      const order = await Order.findById(orderId);
      if (!order) return res.status(404).json({ error: 'Order not found' });

      order.paymentStatus = 'Paid';
      await order.save();

      // NEW: Stock management - Decrease stock when payment is confirmed
      try {
        console.log('Decreasing stock for paid order:', orderId);
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
        console.log('✅ Stock decreased successfully for order:', orderId);
      } catch (stockError) {
        console.error('❌ Error decreasing stock:', stockError);
        // Don't fail the webhook if stock update fails, but log it
      }

      if (order.userId) await Cart.deleteOne({ userId: order.userId });

      // NEW: Send order confirmation email when payment is successful
      try {
        // Populate order with product details before sending
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
          // NEW: Lazy load the function to avoid circular dependency issues on server
          // This ensures the module is fully loaded before we try to use it
          try {
            const notificationsModule = require('../../routes/notificationsRoutes');
            const sendOrderConfirmationEmail = notificationsModule.sendOrderConfirmationEmail;
            
            if (!sendOrderConfirmationEmail) {
              throw new Error('sendOrderConfirmationEmail function not found in notificationsRoutes');
            }

            const result = await sendOrderConfirmationEmail(populatedOrder, customer);
            
            if (result.success) {
              console.log('✅ Order confirmation email sent for paid order:', orderId, result);
            } else if (result.skipped) {
              console.log('⚠️ Order confirmation skipped:', result.message);
            }
          } catch (emailError) {
            console.error('❌ Failed to send order confirmation email:', emailError.message);
            // Don't fail the webhook if email fails
          }
        }
      } catch (emailError) {
        console.error('❌ Failed to send order confirmation email:', emailError.message);
        // Don't fail the webhook if email fails
      }

      console.log('✅ Order updated and cart cleared:', orderId);
    }

    res.json({ received: true });
  } catch (err) {
    console.error('❌ Webhook processing error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

module.exports = router;
