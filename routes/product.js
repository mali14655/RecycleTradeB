  const express = require("express");
  const router = express.Router();
  const Product = require("../models/Product");
  const { authMiddleware, roleCheck } = require("../middlewares/auth");
  const axios = require("axios");

  // Add product
  router.post(
    "/",
    authMiddleware,
    roleCheck(["seller_candidate", "admin"]),
    async (req, res) => {
      try {
        const { name, description, price, quantity, category, images, categoryRef, specs, variants } = req.body;

        if (req.user.role === "seller_candidate" && !req.user.verified) {
          return res
            .status(403)
            .json({ message: "You are not verified to add products" });
        }

        // NEW: Set product price to first variant price if variants exist, otherwise use provided price
        let productPrice = price;
        if (variants && variants.length > 0 && variants[0].price !== undefined) {
          productPrice = variants[0].price;
        }

        const product = new Product({
          name,
          description,
          price: productPrice,
          quantity,
          category,
          images: images || [],
          sellerId: req.user._id,
          categoryRef: categoryRef || null,
          specs: specs || {},
          variants: variants || []
        });

        await product.save();
        res.json({ message: "Product added successfully", product });
      } catch (err) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  // Get all products with filtering
  router.get("/", async (req, res) => {
    try {
      const { category, minPrice, maxPrice, condition, search, featured } =
        req.query;

      // Build filter object
      let filter = {};

      // Featured filter
      if (featured === "true") {
        filter.featured = true;
      }

      // Category filter
      if (category) {
        filter.category = { $regex: category, $options: "i" };
      }

      // Price range filter
      if (minPrice || maxPrice) {
        filter.price = {};
        if (minPrice) filter.price.$gte = Number(minPrice);
        if (maxPrice) filter.price.$lte = Number(maxPrice);
      }

      // Condition filter
      if (condition) {
        filter.condition = condition;
      }

      // Search filter
      if (search) {
        filter.$or = [
          { name: { $regex: search, $options: "i" } },
          { description: { $regex: search, $options: "i" } },
        ];
      }

      console.log("Filtering with:", filter);

      const products = await Product.find(filter).populate(
        "sellerId",
        "name role"
      ).populate("categoryRef", "name specs");
      
      // NEW: Update product price to first variant price if variants exist
      const productsWithVariantPrice = products.map(product => {
        if (product.variants && product.variants.length > 0) {
          const firstEnabledVariant = product.variants.find(v => v.enabled !== false) || product.variants[0];
          if (firstEnabledVariant && firstEnabledVariant.price !== undefined) {
            product.price = firstEnabledVariant.price;
          }
        }
        return product;
      });
      
      res.json(productsWithVariantPrice);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // Update product
  router.put(
    "/:id",
    authMiddleware,
    roleCheck(["seller_candidate", "admin"]),
    async (req, res) => {
      try {
        const product = await Product.findById(req.params.id);
        if (!product)
          return res.status(404).json({ message: "Product not found" });

        if (product.sellerId.toString() !== req.user._id.toString()) {
          return res
            .status(403)
            .json({ message: "You cannot edit this product" });
        }

        // NEW: Update product price from first variant if variants exist
        if (req.body.variants && req.body.variants.length > 0) {
          const firstVariant = req.body.variants.find(v => v.enabled !== false) || req.body.variants[0];
          if (firstVariant && firstVariant.price !== undefined) {
            req.body.price = firstVariant.price;
          }
        }

        // Remove basePrice from update (no longer used)
        delete req.body.basePrice;

        Object.assign(product, req.body, { updatedAt: Date.now() });
        await product.save();
        res.json({ message: "Product updated successfully", product });
      } catch (err) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  // Delete product with image cleanup
  router.delete(
    "/:id",
    authMiddleware,
    roleCheck(["seller_candidate", "admin"]),
    async (req, res) => {
      try {
        const product = await Product.findById(req.params.id);
        if (!product)
          return res.status(404).json({ message: "Product not found" });

        if (product.sellerId.toString() !== req.user._id.toString()) {
          return res
            .status(403)
            .json({ message: "You cannot delete this product" });
        }

        // Delete images from Cloudinary
        if (product.images && product.images.length > 0) {
          for (const imageUrl of product.images) {
            try {
              await axios.delete(`${process.env.API_URL}/upload/delete`, {
                headers: { Authorization: req.headers.authorization },
                data: { imageUrl },
              });
            } catch (err) {
              console.error("Failed to delete image:", imageUrl, err.message);
              // Continue even if image deletion fails
            }
          }
        }

        await product.deleteOne();
        res.json({ message: "Product deleted successfully" });
      } catch (err) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  // Get single product
  router.get("/:id", async (req, res) => {
    try {
      const product = await Product.findById(req.params.id)
        .populate("sellerId", "name email")
        .populate("categoryRef", "name specs");
      if (!product) return res.status(404).json({ message: "Product not found" });
      
      // NEW: Update product price to first variant price if variants exist
      if (product.variants && product.variants.length > 0) {
        const firstEnabledVariant = product.variants.find(v => v.enabled !== false) || product.variants[0];
        if (firstEnabledVariant && firstEnabledVariant.price !== undefined) {
          product.price = firstEnabledVariant.price;
        }
      }
      
      res.json(product);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // Toggle featured status (admin only)
  router.patch(
    "/:id/featured",
    authMiddleware,
    roleCheck(["admin"]),
    async (req, res) => {
      try {
        const product = await Product.findById(req.params.id);
        if (!product)
          return res.status(404).json({ message: "Product not found" });

        product.featured = !product.featured;
        await product.save();

        res.json({
          message: `Product ${
            product.featured ? "added to" : "removed from"
          } featured`,
          product,
        });
      } catch (err) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  // Get products by category reference
  router.get("/category/:categoryId", async (req, res) => {
    try {
      const products = await Product.find({ categoryRef: req.params.categoryId })
        .populate("sellerId", "name role")
        .populate("categoryRef", "name specs");
      
      // NEW: Update product price to first variant price if variants exist
      const productsWithVariantPrice = products.map(product => {
        if (product.variants && product.variants.length > 0) {
          const firstEnabledVariant = product.variants.find(v => v.enabled !== false) || product.variants[0];
          if (firstEnabledVariant && firstEnabledVariant.price !== undefined) {
            product.price = firstEnabledVariant.price;
          }
        }
        return product;
      });
      
      res.json(productsWithVariantPrice);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // Generate variants for a product
  router.post("/:id/generate-variants", authMiddleware, roleCheck(["seller_candidate", "admin"]), async (req, res) => {
    try {
      const { multipleSpecs } = req.body;
      
      const product = await Product.findById(req.params.id);
      if (!product) return res.status(404).json({ message: "Product not found" });

      if (product.sellerId.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: "You cannot edit this product" });
      }

      // Generate all possible combinations
      const generateCombinations = (specs) => {
        const keys = Object.keys(specs);
        if (keys.length === 0) return [{}];
        
        const firstKey = keys[0];
        const restKeys = keys.slice(1);
        const restCombinations = generateCombinations(
          restKeys.reduce((obj, key) => {
            obj[key] = specs[key];
            return obj;
          }, {})
        );
        
        const result = [];
        for (const value of specs[firstKey]) {
          for (const combination of restCombinations) {
            result.push({ [firstKey]: value, ...combination });
          }
        }
        return result;
      };

      const combinations = generateCombinations(multipleSpecs);
      
      // Create variants from combinations
      const variants = combinations.map((combo, index) => ({
        specs: combo,
        price: product.price, // Use product price instead of basePrice
        quantity: 1,
        sku: `${product.name.replace(/\s+/g, '').toUpperCase()}-${index + 1}`,
        enabled: true,
        images: [],
        stock: 0 // Initialize stock to 0
      }));

      product.variants = variants;
      await product.save();

      res.json({ 
        message: "Variants generated successfully", 
        variants: product.variants 
      });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // Update variant details
  router.put("/:productId/variants/:variantIndex", authMiddleware, roleCheck(["seller_candidate", "admin"]), async (req, res) => {
    try {
      const { price, quantity, images, enabled } = req.body;
      
      const product = await Product.findById(req.params.productId);
      if (!product) return res.status(404).json({ message: "Product not found" });

      if (product.sellerId.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: "You cannot edit this product" });
      }

      const variantIndex = parseInt(req.params.variantIndex);
      if (variantIndex >= product.variants.length) {
        return res.status(404).json({ message: "Variant not found" });
      }

      // Update variant
      if (price !== undefined) product.variants[variantIndex].price = price;
      if (quantity !== undefined) product.variants[variantIndex].quantity = quantity;
      if (images !== undefined) product.variants[variantIndex].images = images;
      if (enabled !== undefined) product.variants[variantIndex].enabled = enabled;

      await product.save();

      res.json({ 
        message: "Variant updated successfully", 
        variant: product.variants[variantIndex] 
      });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  module.exports = router;