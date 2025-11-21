const express = require("express");
const router = express.Router();
const Cart = require("../models/Cart");
const Product = require("../models/Product");
const { authMiddleware, roleCheck } = require("../middlewares/auth");

// Get user's cart
router.get("/", authMiddleware, async (req, res) => {
  const cart = await Cart.findOne({ userId: req.user._id }).populate("items.productId");
  res.json(cart || { items: [] });
});

// Helper function to check stock availability
const checkStockAvailability = async (product, variantId, requestedQuantity, existingCartQuantity = 0) => {
  // If product has variants
  if (product.variants && product.variants.length > 0) {
    if (!variantId) {
      return { available: false, message: "Variant selection required" };
    }
    
    const variant = product.variants.find(v => v._id.toString() === variantId.toString());
    if (!variant) {
      return { available: false, message: "Variant not found" };
    }
    
    const totalQuantity = existingCartQuantity + requestedQuantity;
    const availableStock = variant.stock !== undefined ? variant.stock : Infinity;
    
    if (totalQuantity > availableStock) {
      return { 
        available: false, 
        message: `Insufficient stock. Only ${availableStock} available.`,
        availableStock 
      };
    }
    
    return { available: true, availableStock };
  }
  
  // For products without variants, assume unlimited stock (backward compatibility)
  return { available: true };
};

// Add item to cart
router.post("/add", authMiddleware, async (req, res) => {
  try {
    const { productId, quantity, variantId } = req.body;
    const addQuantity = quantity || 1;

    // Fetch product to check stock
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    let cart = await Cart.findOne({ userId: req.user._id });
    if (!cart) cart = new Cart({ userId: req.user._id, items: [] });

    // Find existing item (matching both productId and variantId if variant exists)
    const existingItem = cart.items.find(item => {
      const productMatch = item.productId.toString() === productId;
      if (variantId) {
        return productMatch && item.variantId && item.variantId.toString() === variantId.toString();
      }
      return productMatch && !item.variantId;
    });

    const existingQuantity = existingItem ? existingItem.quantity : 0;
    const requestedQuantity = addQuantity;

    // Check stock availability
    const stockCheck = await checkStockAvailability(product, variantId, requestedQuantity, existingQuantity);
    if (!stockCheck.available) {
      return res.status(400).json({ 
        message: stockCheck.message,
        availableStock: stockCheck.availableStock 
      });
    }

    if (existingItem) {
      existingItem.quantity += addQuantity;
    } else {
      cart.items.push({ productId, quantity: addQuantity, variantId: variantId || undefined });
    }

    cart.updatedAt = Date.now();
    await cart.save();

    const updatedCart = await cart.populate("items.productId");
    res.json({ message: "Item added to cart", cart: updatedCart });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Remove item
router.delete("/remove/:productId", authMiddleware, async (req, res) => {
  try {
    const { variantId } = req.query; // Get variantId from query params
    const cart = await Cart.findOne({ userId: req.user._id });
    if (!cart) return res.status(404).json({ message: "Cart not found" });

    // Filter out the item matching both productId and variantId (if provided)
    cart.items = cart.items.filter(item => {
      const productMatch = item.productId.toString() === req.params.productId;
      if (variantId) {
        return !(productMatch && item.variantId && item.variantId.toString() === variantId.toString());
      }
      return !(productMatch && !item.variantId);
    });

    await cart.save();

    const updatedCart = await cart.populate("items.productId");
    res.json({ message: "Item removed", cart: updatedCart });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Clear cart
router.delete("/clear", authMiddleware, async (req, res) => {
  await Cart.findOneAndDelete({ userId: req.user._id });
  res.json({ message: "Cart cleared" });
});


// Update quantity
router.put("/update", authMiddleware, async (req, res) => {
  try {
    const { productId, quantity, variantId } = req.body;
    if (!productId || quantity < 1)
      return res.status(400).json({ message: "Invalid input" });

    const cart = await Cart.findOne({ userId: req.user._id });
    if (!cart) return res.status(404).json({ message: "Cart not found" });

    // Find item matching both productId and variantId (if variant exists)
    const item = cart.items.find(i => {
      const productMatch = i.productId.toString() === productId;
      if (variantId) {
        return productMatch && i.variantId && i.variantId.toString() === variantId.toString();
      }
      return productMatch && !i.variantId;
    });

    if (!item)
      return res.status(404).json({ message: "Product not in cart" });

    // Fetch product to check stock
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    // NEW: Stock management - Check stock availability for the new quantity
    // We need to check if the new quantity is available, considering what's already in cart
    // The checkStockAvailability function already accounts for existingCartQuantity
    // But here we need to pass the current item quantity as existing, and new quantity as requested
    const currentQuantity = item.quantity;
    const quantityDifference = quantity - currentQuantity; // How much we're adding/removing
    
    // Only check stock if we're increasing quantity
    if (quantityDifference > 0) {
      const stockCheck = await checkStockAvailability(product, variantId || item.variantId, quantityDifference, currentQuantity);
      if (!stockCheck.available) {
        return res.status(400).json({ 
          message: stockCheck.message,
          availableStock: stockCheck.availableStock 
        });
      }
    }

    item.quantity = quantity;
    cart.updatedAt = Date.now();
    await cart.save();

    const updatedCart = await cart.populate("items.productId");
    res.json({ message: "Quantity updated", cart: updatedCart });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});



module.exports = router;
