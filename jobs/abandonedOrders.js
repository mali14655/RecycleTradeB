const Order = require('../models/Orders');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Product = require('../models/Product');

// Helper function to get customer name
// Always prioritizes guestInfo (form data) over userId
const getCustomerName = (order) => {
  // First, try to get name from guestInfo (form data)
  const firstName = (order.guestInfo?.firstName || '').trim();
  const lastName = (order.guestInfo?.lastName || '').trim();
  
  if (firstName || lastName) {
    if (firstName && lastName) return `${firstName} ${lastName}`;
    return firstName || lastName || 'Guest Customer';
  }
  
  // Fallback to userId name only if no guestInfo exists
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
  
  return 'Guest Customer';
};

// Import cancel order function from orderRoutes
let cancelOrder;
try {
  // Use a dynamic require to avoid circular dependency issues
  const orderRoutesModule = require('../routes/orderRoutes');
  cancelOrder = orderRoutesModule.cancelOrder;
  
  if (!cancelOrder || typeof cancelOrder !== 'function') {
    throw new Error('cancelOrder function not found in exports');
  }
  console.log('✅ Successfully imported cancelOrder from orderRoutes');
} catch (error) {
  console.error('❌ Failed to import cancelOrder from orderRoutes:', error.message);
  console.log('⚠️ Using fallback cancelOrder implementation');
  
  // Fallback implementation with full functionality
  cancelOrder = async (order, reason = 'abandoned') => {
    try {
      console.log(`Cancelling order ${order._id} - Reason: ${reason}`);
      
      // Check if already cancelled
      if (order.orderStatus === 'Cancelled') {
        console.log(`Order ${order._id} is already cancelled`);
        return order;
      }
      
      const ensureDefaultVariant = (product) => {
        if (product.variants && product.variants.length > 0) {
          return product.variants[0];
        }
        const defaultVariant = {
          specs: {},
          price: product.price,
          images: product.images || [],
          sku: `${product.name.replace(/\s+/g, '').toUpperCase().slice(0, 10)}-DEFAULT`,
          enabled: true,
          stock: 0
        };
        if (!product.variants) {
          product.variants = [];
        }
        product.variants.push(defaultVariant);
        return product.variants[product.variants.length - 1];
      };

      // Recover stock
      for (const item of order.items) {
        const product = await Product.findById(item.productId);
        if (!product) continue;

        let variant = null;
        if (product.variants && product.variants.length > 0 && item.variantId) {
          variant = product.variants.find(v => v._id.toString() === item.variantId.toString());
        }
        if (!variant) {
          variant = ensureDefaultVariant(product);
        }
        if (variant) {
          variant.stock = (variant.stock || 0) + item.quantity;
          await product.save();
        }
      }

      // Update order status
      order.orderStatus = 'Cancelled';
      if (order.paymentStatus === 'Pending') {
        order.paymentStatus = 'Cancelled';
      } else if (order.paymentStatus !== 'Paid') {
        order.paymentStatus = 'Failed';
      }
      order.cancelledAt = new Date();
      order.cancellationReason = reason;
      await order.save();
      
      // Send cancellation email
      try {
        const populatedOrder = await Order.findById(order._id)
          .populate("items.productId", "name price images variants")
          .populate("items.sellerId", "name email")
          .populate("outletId", "name location address phone email")
          .populate("userId", "name email phone")
          .lean();

        // Always prioritize guestInfo (form data) for customer contact details
        // userId is only for order tracking/profile, not for shipping/contact info
        const customer = populatedOrder.guestInfo ? {
          email: populatedOrder.guestInfo.email,
          phone: populatedOrder.guestInfo.phone,
          name: getCustomerName(populatedOrder)
        } : (populatedOrder.userId ? {
          // Fallback to userId only if no guestInfo exists
          email: populatedOrder.userId.email,
          phone: populatedOrder.userId.phone,
          name: populatedOrder.userId.name
        } : {
          email: null,
          phone: null,
          name: 'Guest Customer'
        });

        if (customer.email) {
          try {
            const notificationsModule = require('../routes/notificationsRoutes');
            const sendOrderCancellationEmail = notificationsModule.sendOrderCancellationEmail;
            
            if (sendOrderCancellationEmail) {
              await sendOrderCancellationEmail(customer.email, populatedOrder, customer.name, reason);
              console.log(`✅ Cancellation email sent for order: ${order._id}`);
            }
          } catch (emailError) {
            console.error('❌ Failed to send cancellation email:', emailError.message);
          }
        }
      } catch (emailError) {
        console.error('❌ Failed to send cancellation email:', emailError.message);
      }
      
      console.log(`✅ Order ${order._id} cancelled successfully`);
      return order;
    } catch (error) {
      console.error(`❌ Error cancelling order ${order._id}:`, error);
      throw error;
    }
  };
}

// Check and cancel abandoned orders
async function checkAbandonedOrders() {
  try {
    console.log('🕐 Checking for abandoned orders...');
    
    // Find orders that are:
    // 1. Stripe payment method
    // 2. Payment status is Pending
    // 3. Order status is Pending (not cancelled)
    // 4. Created more than 5 minutes ago
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    const abandonedOrders = await Order.find({
      paymentMethod: 'Stripe',
      paymentStatus: 'Pending',
      orderStatus: 'Pending',
      createdAt: { $lt: fiveMinutesAgo }
    });

    console.log(`Found ${abandonedOrders.length} potentially abandoned orders`);

    let cancelledCount = 0;
    for (const order of abandonedOrders) {
      try {
        // Verify with Stripe if session exists
        if (order.stripeSessionId) {
          try {
            const session = await stripe.checkout.sessions.retrieve(order.stripeSessionId);
            
            // If session is completed/paid, skip (webhook might be delayed)
            if (session.payment_status === 'paid') {
              console.log(`Order ${order._id} is actually paid, skipping cancellation`);
              // Update order status in case webhook was missed
              order.paymentStatus = 'Paid';
              await order.save();
              continue;
            }
            
            // If session is still open, check if it expired
            if (session.status === 'open') {
              // Session is still open but order is old - cancel it
              console.log(`Order ${order._id} has open session but is old, cancelling`);
            }
          } catch (stripeError) {
            // Session might not exist or be invalid - proceed with cancellation
            console.log(`Stripe session check failed for order ${order._id}, proceeding with cancellation`);
          }
        }
        
        // Cancel the order
        await cancelOrder(order, 'abandoned');
        cancelledCount++;
        console.log(`✅ Cancelled abandoned order: ${order._id}`);
      } catch (error) {
        console.error(`❌ Failed to cancel abandoned order ${order._id}:`, error.message);
      }
    }

    console.log(`✅ Abandoned orders check completed. Cancelled: ${cancelledCount} out of ${abandonedOrders.length}`);
  } catch (error) {
    console.error('❌ Error checking abandoned orders:', error);
  }
}

// Run every minute
if (require.main === module) {
  // If run directly, check once
  checkAbandonedOrders().then(() => {
    console.log('Abandoned orders check completed');
    process.exit(0);
  }).catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
}

module.exports = { checkAbandonedOrders, cancelOrder };

