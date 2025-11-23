const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const axios = require('axios');
const connectDB = require('../../config/db');
const Order = require('../../models/Orders');
const Cart = require('../../models/Cart');
const Product = require('../../models/Product');

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
          name: `${populatedOrder.guestInfo?.firstName || ''} ${populatedOrder.guestInfo?.lastName || ''}`.trim()
        };

        if (customer.email) {
          const apiUrl = getApiUrl();
          await axios.post(`${apiUrl}/notifications/send-order-confirmation`, {
            order: populatedOrder,
            customer: customer
          }, {
            timeout: 10000,
            headers: {
              'Content-Type': 'application/json'
            }
          });
          console.log('✅ Order confirmation email sent for paid order:', orderId);
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
