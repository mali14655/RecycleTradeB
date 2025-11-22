  const express = require("express");
  const router = express.Router();
  const Product = require("../models/Product");
  const { authMiddleware, roleCheck } = require("../middlewares/auth");
  const axios = require("axios");

  // Helper function to delete images from Cloudinary
  const deleteImagesFromCloudinary = async (imageUrls, authHeader) => {
    if (!imageUrls || imageUrls.length === 0) return;
    
    for (const imageUrl of imageUrls) {
      try {
        await axios.delete(`${process.env.API_URL || 'http://localhost:5000'}/upload/delete`, {
          headers: authHeader ? { Authorization: authHeader } : {},
          data: { imageUrl },
        });
      } catch (err) {
        console.error("Failed to delete image:", imageUrl, err.message);
        // Continue even if image deletion fails
      }
    }
  };

  // Helper function to get first variant images
  const getFirstVariantImages = (variants) => {
    if (!variants || variants.length === 0) return [];
    const firstVariant = variants.find(v => v.enabled !== false) || variants[0];
    return firstVariant.images || [];
  };

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

        // NEW: Set product price and images from first variant if variants exist
        let productPrice = price;
        let productImages = images || [];
        
        if (variants && variants.length > 0) {
          const firstVariant = variants.find(v => v.enabled !== false) || variants[0];
          if (firstVariant.price !== undefined) {
            productPrice = firstVariant.price;
          }
          // NEW: Use first variant's images for product.images
          productImages = firstVariant.images || [];
        }

        const product = new Product({
          name,
          description,
          price: productPrice,
          quantity,
          category,
          images: productImages, // NEW: Use first variant's images
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
      
      // NEW: Update product price and images to first variant if variants exist
      const productsWithVariantData = products.map(product => {
        if (product.variants && product.variants.length > 0) {
          const firstEnabledVariant = product.variants.find(v => v.enabled !== false) || product.variants[0];
          if (firstEnabledVariant) {
            if (firstEnabledVariant.price !== undefined) {
              product.price = firstEnabledVariant.price;
            }
            // NEW: Sync product.images with first variant's images
            if (firstEnabledVariant.images && firstEnabledVariant.images.length > 0) {
              product.images = firstEnabledVariant.images;
            }
          }
        }
        return product;
      });
      
      res.json(productsWithVariantData);
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

        // Store old data before update
        const oldProductImages = [...(product.images || [])];
        const oldVariants = JSON.parse(JSON.stringify(product.variants || []));
        
        // Create map of old variants by specs (for matching, not by index)
        const oldVariantsBySpecs = new Map();
        oldVariants.forEach(variant => {
          // Handle Map format for specs
          const specsObj = variant.specs instanceof Map 
            ? Object.fromEntries(variant.specs)
            : (variant.specs || {});
          const specsKey = JSON.stringify(specsObj);
          oldVariantsBySpecs.set(specsKey, variant);
        });

        // NEW: Update product price and images from first variant if variants exist
        if (req.body.variants && req.body.variants.length > 0) {
          const firstVariant = req.body.variants.find(v => v.enabled !== false) || req.body.variants[0];
          if (firstVariant && firstVariant.price !== undefined) {
            req.body.price = firstVariant.price;
          }
          // NEW: Sync product.images with first variant's images
          req.body.images = firstVariant.images || [];
        }

        // NEW: Delete old product.images that are no longer used
        if (req.body.images && req.body.images.length > 0) {
          const oldProductImagesToDelete = oldProductImages.filter(oldImg => 
            !req.body.images.includes(oldImg)
          );
          
          if (oldProductImagesToDelete.length > 0) {
            deleteImagesFromCloudinary(oldProductImagesToDelete, req.headers.authorization).catch(err => {
              console.error("Error deleting old product images:", err);
            });
          }
        } else if (oldProductImages.length > 0) {
          // If new product.images is empty but old had images, delete all old ones
          deleteImagesFromCloudinary(oldProductImages, req.headers.authorization).catch(err => {
            console.error("Error deleting old product images:", err);
          });
        }

        // NEW: Delete old variant images that were replaced or removed
        if (req.body.variants && req.body.variants.length > 0) {
          const imagesToDelete = [];
          
          // Track all new variant images
          const newVariantImagesSet = new Set();
          req.body.variants.forEach(newVariant => {
            if (newVariant.images && newVariant.images.length > 0) {
              newVariant.images.forEach(img => newVariantImagesSet.add(img));
            }
          });
          
          // Find old variant images that are not in new variants
          oldVariants.forEach(oldVariant => {
            // Match old variant with new variant by specs
            const oldSpecsObj = oldVariant.specs instanceof Map 
              ? Object.fromEntries(oldVariant.specs)
              : (oldVariant.specs || {});
            const oldSpecsKey = JSON.stringify(oldSpecsObj);
            
            // Find matching new variant
            const matchingNewVariant = req.body.variants.find(newV => {
              const newSpecsObj = newV.specs instanceof Map 
                ? Object.fromEntries(newV.specs)
                : (newV.specs || {});
              return JSON.stringify(newSpecsObj) === oldSpecsKey;
            });
            
            if (oldVariant.images && oldVariant.images.length > 0) {
              oldVariant.images.forEach(oldImg => {
                // Delete if: variant was removed OR image was removed from variant
                if (!matchingNewVariant) {
                  // Variant was completely removed
                  imagesToDelete.push(oldImg);
                } else if (!matchingNewVariant.images || !matchingNewVariant.images.includes(oldImg)) {
                  // Variant exists but this image was removed from it
                  imagesToDelete.push(oldImg);
                }
              });
            }
          });
          
          // Remove duplicates
          const uniqueImagesToDelete = [...new Set(imagesToDelete)];
          
          // Delete old images from Cloudinary (non-blocking)
          if (uniqueImagesToDelete.length > 0) {
            console.log(`Deleting ${uniqueImagesToDelete.length} old variant images from Cloudinary`);
            deleteImagesFromCloudinary(uniqueImagesToDelete, req.headers.authorization).catch(err => {
              console.error("Error deleting old variant images:", err);
              // Don't fail the update if image deletion fails
            });
          }
        } else {
          // If all variants were removed, delete all old variant images
          const allOldVariantImages = [];
          oldVariants.forEach(variant => {
            if (variant.images && variant.images.length > 0) {
              variant.images.forEach(img => {
                if (!allOldVariantImages.includes(img)) {
                  allOldVariantImages.push(img);
                }
              });
            }
          });
          
          if (allOldVariantImages.length > 0) {
            deleteImagesFromCloudinary(allOldVariantImages, req.headers.authorization).catch(err => {
              console.error("Error deleting all variant images:", err);
            });
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

        // Delete images from Cloudinary (both product.images and variant images)
        const imagesToDelete = [...(product.images || [])];
        
        // Also delete variant images
        if (product.variants && product.variants.length > 0) {
          product.variants.forEach(variant => {
            if (variant.images && variant.images.length > 0) {
              variant.images.forEach(img => {
                if (!imagesToDelete.includes(img)) {
                  imagesToDelete.push(img);
                }
              });
            }
          });
        }
        
        // Delete all images
        if (imagesToDelete.length > 0) {
          await deleteImagesFromCloudinary(imagesToDelete, req.headers.authorization);
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
      
      // NEW: Update product price and images to first variant if variants exist
      if (product.variants && product.variants.length > 0) {
        const firstEnabledVariant = product.variants.find(v => v.enabled !== false) || product.variants[0];
        if (firstEnabledVariant) {
          if (firstEnabledVariant.price !== undefined) {
            product.price = firstEnabledVariant.price;
          }
          // NEW: Sync product.images with first variant's images
          if (firstEnabledVariant.images && firstEnabledVariant.images.length > 0) {
            product.images = firstEnabledVariant.images;
          }
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
      
      // NEW: Update product price and images to first variant if variants exist
      const productsWithVariantData = products.map(product => {
        if (product.variants && product.variants.length > 0) {
          const firstEnabledVariant = product.variants.find(v => v.enabled !== false) || product.variants[0];
          if (firstEnabledVariant) {
            if (firstEnabledVariant.price !== undefined) {
              product.price = firstEnabledVariant.price;
            }
            // NEW: Sync product.images with first variant's images
            if (firstEnabledVariant.images && firstEnabledVariant.images.length > 0) {
              product.images = firstEnabledVariant.images;
            }
          }
        }
        return product;
      });
      
      res.json(productsWithVariantData);
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

  // Update variant details + Image cleanup
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

      // NEW: Store old variant images before update
      const oldVariant = product.variants[variantIndex];
      const oldVariantImages = oldVariant.images || [];

      // Update variant
      if (price !== undefined) product.variants[variantIndex].price = price;
      if (quantity !== undefined) product.variants[variantIndex].quantity = quantity;
      if (images !== undefined) product.variants[variantIndex].images = images;
      if (enabled !== undefined) product.variants[variantIndex].enabled = enabled;

      // NEW: Delete old variant images that were replaced/removed
      if (images !== undefined && Array.isArray(images)) {
        const imagesToDelete = oldVariantImages.filter(oldImg => !images.includes(oldImg));
        
        if (imagesToDelete.length > 0) {
          deleteImagesFromCloudinary(imagesToDelete, req.headers.authorization).catch(err => {
            console.error("Error deleting old variant images:", err);
            // Don't fail the update if image deletion fails
          });
        }
      }

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