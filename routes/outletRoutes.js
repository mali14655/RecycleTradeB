const express = require("express");
const Outlet = require("../models/Outlet");
const { authMiddleware, roleCheck } = require("../middlewares/auth");

const router = express.Router();

// Get all active outlets
router.get("/", async (req, res) => {
  try {
    const outlets = await Outlet.find({ isActive: true }).sort({ name: 1 });
    res.json(outlets);
  } catch (err) {
    console.error("Error fetching outlets:", err);
    res.status(500).json({ message: "Failed to fetch outlets" });
  }
});

// Get all outlets (admin only)
router.get("/all", authMiddleware, roleCheck(["admin"]), async (req, res) => {
  try {
    const outlets = await Outlet.find().sort({ createdAt: -1 });
    res.json(outlets);
  } catch (err) {
    console.error("Error fetching all outlets:", err);
    res.status(500).json({ message: "Failed to fetch outlets" });
  }
});

// Create outlet (admin only)
router.post("/", authMiddleware, roleCheck(["admin"]), async (req, res) => {
  try {
    const { name, location, address, phone, email } = req.body;
    
    const outlet = new Outlet({
      name,
      location,
      address,
      phone,
      email
    });
    
    await outlet.save();
    res.status(201).json({ message: "Outlet created successfully", outlet });
  } catch (err) {
    console.error("Error creating outlet:", err);
    res.status(500).json({ message: "Failed to create outlet" });
  }
});

// Update outlet (admin only)
router.put("/:id", authMiddleware, roleCheck(["admin"]), async (req, res) => {
  try {
    const outlet = await Outlet.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedAt: Date.now() },
      { new: true }
    );
    
    if (!outlet) return res.status(404).json({ message: "Outlet not found" });
    res.json({ message: "Outlet updated successfully", outlet });
  } catch (err) {
    console.error("Error updating outlet:", err);
    res.status(500).json({ message: "Failed to update outlet" });
  }
});

// Delete outlet (admin only)
router.delete("/:id", authMiddleware, roleCheck(["admin"]), async (req, res) => {
  try {
    const outlet = await Outlet.findByIdAndDelete(req.params.id);
    if (!outlet) return res.status(404).json({ message: "Outlet not found" });
    res.json({ message: "Outlet deleted successfully" });
  } catch (err) {
    console.error("Error deleting outlet:", err);
    res.status(500).json({ message: "Failed to delete outlet" });
  }
});

module.exports = router;