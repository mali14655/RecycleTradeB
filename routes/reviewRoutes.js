const express = require("express");
const router = express.Router();
const Product = require("../models/Product");
const { authMiddleware, roleCheck } = require("../middlewares/auth");

// Add review
router.post("/:productId/reviews", async (req, res) => {
  try {
    const { rating, comment, name, email, userId } = req.body;

    if (!rating) {
      return res.status(400).json({ message: "Rating is required" });
    }

    const product = await Product.findById(req.params.productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const review = { rating, comment };

    // Check if user is registered or not
    if (userId) {
      review.userId = userId;
    } else {
      review.name = name || "Anonymous";
      review.email = email || "N/A";
    }

    product.reviews.push(review);
    await product.save();

    res.status(201).json({ message: "Review added successfully", review });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get all reviews for a product
router.get("/:productId/reviews", async (req, res) => {
  try {
    const product = await Product.findById(req.params.productId).populate("reviews.userId", "name email");
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }
    res.status(200).json(product.reviews);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// NEW: Update a review (Admin only)
router.put("/:productId/reviews/:reviewId", authMiddleware, roleCheck(["admin"]), async (req, res) => {
  try {
    const { rating, comment } = req.body;
    const { productId, reviewId } = req.params;

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const review = product.reviews.id(reviewId);
    if (!review) {
      return res.status(404).json({ message: "Review not found" });
    }

    if (rating !== undefined) review.rating = rating;
    if (comment !== undefined) review.comment = comment;

    await product.save();

    // Populate userId if it exists
    await product.populate("reviews.userId", "name email");

    res.status(200).json({ message: "Review updated successfully", review: product.reviews.id(reviewId) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// NEW: Delete a review (Admin only)
router.delete("/:productId/reviews/:reviewId", authMiddleware, roleCheck(["admin"]), async (req, res) => {
  try {
    const { productId, reviewId } = req.params;

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const review = product.reviews.id(reviewId);
    if (!review) {
      return res.status(404).json({ message: "Review not found" });
    }

    product.reviews.pull(reviewId);
    await product.save();

    res.status(200).json({ message: "Review deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
