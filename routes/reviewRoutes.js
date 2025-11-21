const express = require("express");
const router = express.Router();
const Product = require("../models/Product");

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

module.exports = router;
