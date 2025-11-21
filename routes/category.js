const express = require("express");
const router = express.Router();
const Category = require("../models/Category");
const { authMiddleware, roleCheck } = require("../middlewares/auth");

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

// Update category (Admin only) - ✅ Better validation
router.put("/:id", authMiddleware, roleCheck(["admin"]), async (req, res) => {
  try {
    const { name, description, image, specs } = req.body;
    
    const updateData = {
      ...(name && { name }),
      ...(description && { description }),
      ...(image && { image }),
      ...(specs && { specs })
    };

    const category = await Category.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );
    
    if (!category) return res.status(404).json({ message: "Category not found" });
    res.json({ message: "Category updated successfully", category });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Delete category (Admin only)
router.delete("/:id", authMiddleware, roleCheck(["admin"]), async (req, res) => {
  try {
    const category = await Category.findByIdAndDelete(req.params.id);
    if (!category) return res.status(404).json({ message: "Category not found" });
    res.json({ message: "Category deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;