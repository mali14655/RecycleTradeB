const express = require("express");
const router = express.Router();
const Category = require("../models/Category");
const { authMiddleware, roleCheck } = require("../middlewares/auth");
const axios = require("axios");

// Helper function to delete images from Cloudinary
const deleteImagesFromCloudinary = async (imageUrls, authHeader) => {
  if (!imageUrls || imageUrls.length === 0) return;
  
  for (const imageUrl of imageUrls) {
    if (!imageUrl) continue; // Skip empty strings
    
    try {
      await axios.delete(`${process.env.API_URL || 'http://localhost:5000'}/upload/delete`, {
        headers: authHeader ? { Authorization: authHeader } : {},
        data: { imageUrl },
      });
      console.log("Deleted image from Cloudinary:", imageUrl);
    } catch (err) {
      console.error("Failed to delete image:", imageUrl, err.message);
      // Continue even if image deletion fails
    }
  }
};

// Get all categories
router.get("/", async (req, res) => {
  try {
    const categories = await Category.find().sort({ name: 1 });
    res.json(categories);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get single category
router.get("/:id", async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) return res.status(404).json({ message: "Category not found" });
    res.json(category);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Create category (Admin only) - ✅ Image field add kiya
router.post("/", authMiddleware, roleCheck(["admin"]), async (req, res) => {
  try {
    const { name, description, image, specs } = req.body; // ✅ image add kiya
    
    // Check if category already exists
    const existingCategory = await Category.findOne({ name });
    if (existingCategory) {
      return res.status(400).json({ message: "Category with this name already exists" });
    }
    
    const category = new Category({
      name,
      description,
      image, // ✅ image save kiya
      specs: specs || []
    });
    
    await category.save();
    res.status(201).json({ message: "Category created successfully", category });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update category (Admin only) - ✅ Better validation + Image cleanup
router.put("/:id", authMiddleware, roleCheck(["admin"]), async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) return res.status(404).json({ message: "Category not found" });
    
    const { name, description, image, specs } = req.body;
    const oldImage = category.image;
    
    // NEW: If image is being updated, delete old image from Cloudinary
    if (image && image !== oldImage && oldImage) {
      // Delete old image (non-blocking)
      deleteImagesFromCloudinary([oldImage], req.headers.authorization).catch(err => {
        console.error("Error deleting old category image:", err);
        // Don't fail the update if image deletion fails
      });
    }
    
    const updateData = {
      ...(name && { name }),
      ...(description !== undefined && { description }),
      ...(image && { image }),
      ...(specs && { specs })
    };

    Object.assign(category, updateData);
    await category.save();
    
    res.json({ message: "Category updated successfully", category });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Delete category (Admin only) + Image cleanup
router.delete("/:id", authMiddleware, roleCheck(["admin"]), async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) return res.status(404).json({ message: "Category not found" });
    
    // NEW: Delete category image from Cloudinary
    if (category.image) {
      await deleteImagesFromCloudinary([category.image], req.headers.authorization);
    }
    
    await category.deleteOne();
    res.json({ message: "Category deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;