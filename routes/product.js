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

        // NEW: Set product price from first variant if variants exist
        // NEW: Use provided images (common images) or fallback to first variant images
        // NEW: Treat empty-string price as "not provided"
        let productPrice = (price === "" ? undefined : price);
        let productImages = images || [];
        
        if (variants && variants.length > 0) {
          const firstVariant = variants.find(v => v.enabled !== false) || variants[0];
          if (firstVariant.price !== undefined) {
            productPrice = firstVariant.price;
          }
          // NEW: Only use first variant's images if no common images provided
          if (productImages.length === 0) {
            productImages = firstVariant.images || [];
          }
        }
        
        // NEW: If price is still not provided (and no variant price), keep legacy-safe numeric default
        if (productPrice === undefined || productPrice === null || Number.isNaN(Number(productPrice))) {
          productPrice = 0;
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

  // NEW: Get search suggestions for autocomplete
  router.get("/search-suggestions", async (req, res) => {
    try {
      const { q } = req.query;
      
      if (!q || q.trim().length < 2) {
        return res.json([]);
      }
      
      // Use FULL search query, not truncated
      const fullSearchTerm = q.trim().toLowerCase();
      console.log("Search suggestions: Full query received:", fullSearchTerm, "Length:", fullSearchTerm.length);
      
      // Get all product names for suggestions
      const products = await Product.find({}, 'name').limit(20);
      
      // Filter and format suggestions - use FULL search term
      const suggestions = products
        .map(product => product.name)
        .filter(name => name && name.toLowerCase().includes(fullSearchTerm)) // Use full term, not just first 2 chars
        .slice(0, 5) // Limit to 5 suggestions
        .map(name => ({ name, value: name }));
      
      console.log("Search suggestions: Returning", suggestions.length, "suggestions");
      res.json(suggestions);
    } catch (err) {
      console.error("Error fetching search suggestions:", err);
      res.status(500).json({ message: err.message });
    }
  });

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

      // NEW: Price filtering is now done after fetching to check variant prices
      // Removed MongoDB price filter - we'll filter by minimum variant price in JavaScript

      // Condition filter
      if (condition) {
        filter.condition = condition;
      }

      // Normalize search query: remove spaces and convert to lowercase for robust matching
      // This allows "iphone12 pro" to match "iPhone 12 Pro"
      const normalizeSearch = (text) => {
        if (!text) return '';
        // Convert to string, trim, lowercase, and remove all spaces
        return String(text).trim().toLowerCase().replace(/\s+/g, '');
      };

      // Helper function to get minimum price from product variants
      // NEW: Returns the least price among all enabled variants, or product.price if no variants
      const getMinimumVariantPrice = (product) => {
        if (product.variants && product.variants.length > 0) {
          // Filter enabled variants and get their prices
          const enabledVariants = product.variants.filter(v => v.enabled !== false);
          if (enabledVariants.length > 0) {
            const prices = enabledVariants.map(v => v.price).filter(price => price !== undefined && price !== null);
            if (prices.length > 0) {
              return Math.min(...prices);
            }
          }
        }
        // Fallback to product.price if no variants or no valid variant prices
        return product.price || 0;
      };

      // For search, we'll do comprehensive filtering after fetching
      // Don't use regex filter as it doesn't handle space variations well
      // Instead, fetch products based on other filters and do robust search in JavaScript

      console.log("Filtering with:", filter);
      if (search) {
        console.log("Backend received search term:", search, "Length:", search.length, "Normalized:", normalizeSearch(search));
      }

      let products = await Product.find(filter).populate(
        "sellerId",
        "name role"
      ).populate("categoryRef", "name specs");
      
      console.log(`Fetched ${products.length} products before filtering`);
      
      // NEW: Filter by search FIRST, then by price
      // This ensures search results are properly filtered by price range
      if (search && search.trim()) {
        const normalizedSearch = normalizeSearch(search);
        
        products = products.filter(product => {
          // NEW: Only check product name with exact matching (normalized)
          // "iphone 13" matches "iPhone 13", "iphone13", "IPHONE 13" but NOT "iPhone 12", "iPhone 14", or "iPhone 13 Pro"
          const normalizedProductName = normalizeSearch(product.name);
          
          // Exact match only - ensures "iphone 13" only matches products named exactly "iPhone 13"
          // This prevents matching "iPhone 12" or "iPhone 14" which would have normalized names "iphone12" and "iphone14"
          return normalizedProductName === normalizedSearch;
        });
        
        console.log(`After search filtering: ${products.length} products match`);
      }
      
      // NEW: Filter by price range AFTER search (so price filter works with search results)
      if (minPrice || maxPrice) {
        const minPriceNum = minPrice ? Number(minPrice) : 0;
        const maxPriceNum = maxPrice ? Number(maxPrice) : Number.MAX_SAFE_INTEGER;
        
        products = products.filter(product => {
          const minVariantPrice = getMinimumVariantPrice(product);
          return minVariantPrice >= minPriceNum && minVariantPrice <= maxPriceNum;
        });
        
        console.log(`After price filtering (by variant min price): ${products.length} products match`);
      }
      
      // NEW: Update product price from first variant if variants exist
      // NEW: Keep product.images as common images (don't overwrite with variant images)
      const productsWithVariantData = products.map(product => {
        if (product.variants && product.variants.length > 0) {
          const firstEnabledVariant = product.variants.find(v => v.enabled !== false) || product.variants[0];
          if (firstEnabledVariant) {
            if (firstEnabledVariant.price !== undefined) {
              product.price = firstEnabledVariant.price;
            }
            // NEW: Only use first variant's images if product has no common images
            if ((!product.images || product.images.length === 0) && 
                firstEnabledVariant.images && firstEnabledVariant.images.length > 0) {
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

        // NEW: Update product price from first variant if variants exist
        // NEW: Preserve existing common images - only overwrite if explicitly provided in request
        if (req.body.variants && req.body.variants.length > 0) {
          const firstVariant = req.body.variants.find(v => v.enabled !== false) || req.body.variants[0];
          if (firstVariant && firstVariant.price !== undefined) {
            req.body.price = firstVariant.price;
          }
          // NEW: Preserve existing product.images if images field not provided in request
          // Only set req.body.images if it wasn't provided (undefined), to preserve existing images
          if (!('images' in req.body)) {
            // images field not in request - preserve existing ones
            // Don't set req.body.images, so Object.assign won't overwrite product.images
            // This ensures existing common images are preserved when only variants are updated
            // Set a flag to skip image deletion logic
            req.body._preserveImages = true;
          } else if (!req.body.images || req.body.images.length === 0) {
            // images field was provided but is empty - only use variant fallback if no existing images
            if (!product.images || product.images.length === 0) {
              req.body.images = firstVariant.images || [];
            } else {
              // Keep existing images if provided images array is empty but product has images
              // Set flag to preserve and skip deletion
              delete req.body.images; // Remove from update to preserve existing
              req.body._preserveImages = true;
            }
          }
        }

        // NEW: Delete old product.images that are no longer used
        // Skip deletion if we're preserving existing images
        if (!req.body._preserveImages) {
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
        }
        // Remove the flag before saving
        delete req.body._preserveImages;

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
      
      // NEW: Update product price from first variant if variants exist
      // NEW: Keep product.images as common images (don't overwrite with variant images)
      if (product.variants && product.variants.length > 0) {
        const firstEnabledVariant = product.variants.find(v => v.enabled !== false) || product.variants[0];
        if (firstEnabledVariant) {
          if (firstEnabledVariant.price !== undefined) {
            product.price = firstEnabledVariant.price;
          }
          // NEW: Only use first variant's images if product has no common images
          if ((!product.images || product.images.length === 0) && 
              firstEnabledVariant.images && firstEnabledVariant.images.length > 0) {
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
      
      // NEW: Update product price from first variant if variants exist
      // NEW: Keep product.images as common images (don't overwrite with variant images)
      const productsWithVariantData = products.map(product => {
        if (product.variants && product.variants.length > 0) {
          const firstEnabledVariant = product.variants.find(v => v.enabled !== false) || product.variants[0];
          if (firstEnabledVariant) {
            if (firstEnabledVariant.price !== undefined) {
              product.price = firstEnabledVariant.price;
            }
            // NEW: Only use first variant's images if product has no common images
            if ((!product.images || product.images.length === 0) && 
                firstEnabledVariant.images && firstEnabledVariant.images.length > 0) {
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