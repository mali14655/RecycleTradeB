const express = require("express");
const router = express.Router();

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
const User = require("../models/User");
const Order = require("../models/Orders");
const Product = require("../models/Product");
const SellerForm = require("../models/SellerForm");
const { authMiddleware, roleCheck } = require("../middlewares/auth");

// Enhanced admin overview - shows only orders and revenue for last month
router.get("/overview", authMiddleware, roleCheck(["admin"]), async (req, res) => {
  try {
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    // Get orders and revenue for the last month
    const monthlyOrders = await Order.find({
      createdAt: { $gte: oneMonthAgo },
      paymentStatus: { $in: ["Paid", "Pending"] } // Include both paid and pending
    }).sort({ createdAt: -1 });

    const totalRevenue = monthlyOrders
      .filter(order => order.paymentStatus === "Paid")
      .reduce((sum, order) => sum + order.total, 0);
    
    const pendingOrders = await Order.countDocuments({ 
      orderStatus: "Pending",
      paymentStatus: "Paid"
    });
    
    const processedOrders = await Order.countDocuments({ 
      orderStatus: "Processing",
      paymentStatus: "Paid"
    });

    // Get recent orders for display (last 5)
    const recentOrders = await Order.find({
      createdAt: { $gte: oneMonthAgo }
    })
    .populate("userId", "name email")
    .populate("items.productId", "name")
    .sort({ createdAt: -1 })
    .limit(5);

    res.json({
      monthlyRevenue: parseFloat(totalRevenue.toFixed(2)),
      orders: {
        pending: pendingOrders,
        processed: processedOrders,
        total: monthlyOrders.length
      },
      recentOrders: recentOrders.map(order => ({
        _id: order._id,
        orderNumber: `ORD-${order._id.toString().slice(-8).toUpperCase()}`,
        customer: getCustomerName(order),
        total: order.total,
        status: order.orderStatus,
        createdAt: order.createdAt
      })),
      period: {
        start: oneMonthAgo,
        end: new Date()
      }
    });
  } catch (err) {
    console.error("Error fetching admin overview:", err);
    res.status(500).json({ message: err.message });
  }
});

// Enhanced seller overview
router.get("/seller-overview", authMiddleware, roleCheck(["seller", "seller_candidate"]), async (req, res) => {
  try {
    const userId = req.user._id;
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    // Get seller's orders
    const sellerOrders = await Order.find({
      "items.sellerId": userId,
      createdAt: { $gte: oneMonthAgo }
    }).sort({ createdAt: -1 });

    const totalRevenue = sellerOrders.reduce((sum, order) => {
      const sellerItems = order.items.filter(item => 
        item.sellerId?.toString() === userId.toString()
      );
      return sum + sellerItems.reduce((itemSum, item) => 
        itemSum + (item.price * item.quantity), 0
      );
    }, 0);

    const pendingOrders = sellerOrders.filter(order => 
      order.orderStatus === "Pending"
    ).length;

    const processedOrders = sellerOrders.filter(order => 
      order.orderStatus === "Processing"
    ).length;

    // Get seller's products
    const sellerProducts = await Product.countDocuments({ sellerId: userId });

    // Recent orders for seller
    const recentSellerOrders = await Order.find({
      "items.sellerId": userId,
      createdAt: { $gte: oneMonthAgo }
    })
    .populate("userId", "name email")
    .populate("items.productId", "name")
    .sort({ createdAt: -1 })
    .limit(5);

    res.json({
      monthlyRevenue: parseFloat(totalRevenue.toFixed(2)),
      orders: {
        pending: pendingOrders,
        processed: processedOrders,
        total: sellerOrders.length
      },
      products: sellerProducts,
      recentOrders: recentSellerOrders.map(order => {
        const sellerItems = order.items.filter(item => 
          item.sellerId?.toString() === userId.toString()
        );
        return {
          _id: order._id,
          orderNumber: `ORD-${order._id.toString().slice(-8).toUpperCase()}`,
          customer: getCustomerName(order),
          items: sellerItems.length,
          total: sellerItems.reduce((sum, item) => sum + (item.price * item.quantity), 0),
          status: order.orderStatus,
          createdAt: order.createdAt
        };
      }),
      period: {
        start: oneMonthAgo,
        end: new Date()
      }
    });
  } catch (err) {
    console.error("Error fetching seller overview:", err);
    res.status(500).json({ message: err.message });
  }
});

// Enhanced notification counts - no hardcoded values
router.get("/notification-counts", authMiddleware, async (req, res) => {
  try {
    const user = req.user;
    let counts = {};

    if (user.role === "admin") {
      const [
        pendingSellers,
        pendingSellerForms,
        pendingOrders,
        sellerCandidateOrders
      ] = await Promise.all([
        User.countDocuments({ role: "seller_candidate", verified: false }),
        SellerForm.countDocuments({ status: "pending" }),
        Order.countDocuments({ orderStatus: "Pending", paymentStatus: "Paid" }),
        Order.countDocuments({ 
          "items.sellerId": { $exists: true },
          orderStatus: "Pending" 
        }).populate('items.sellerId').then(orders => 
          orders.filter(order => 
            order.items.some(item => 
              item.sellerId && item.sellerId.role === "seller_candidate"
            )
          ).length
        )
      ]);

      counts = {
        pendingSellers,
        sellerForms: pendingSellerForms,
        pendingOrders,
        sellerCandidateOrders
      };
    } else if (user.role === "seller" || user.role === "seller_candidate") {
      const sellerOrders = await Order.countDocuments({
        "items.sellerId": user._id,
        orderStatus: "Pending"
      });

      counts = {
        pendingOrders: sellerOrders
      };
    }

    res.json(counts);
  } catch (err) {
    console.error("Error fetching notification counts:", err);
    res.status(500).json({ message: err.message });
  }
});

// Get all seller candidates (unverified)
router.get("/seller-requests", authMiddleware, roleCheck(["admin"]), async (req, res) => {
  try {
    const sellers = await User.find({ role: "seller_candidate", verified: false }).select(
      "name email phone createdAt"
    ).sort({ createdAt: -1 });
    res.json(sellers);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Approve seller candidate
router.post("/verify-seller/:id", authMiddleware, roleCheck(["admin"]), async (req, res) => {
  try {
    console.log("Approve request for ID:", req.params.id);
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    console.log("Before verify:", user.verified);
    user.verified = true;
    await user.save();
    console.log("After verify:", user.verified);

    res.json({ message: "Seller verified successfully" });
  } catch (err) {
    console.error("Error in approve route:", err);
    res.status(500).json({ message: err.message });
  }
});

// Reject seller candidate
router.post("/reject-seller/:id", authMiddleware, roleCheck(["admin"]), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    await user.deleteOne();
    res.json({ message: "Seller rejected and removed" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;