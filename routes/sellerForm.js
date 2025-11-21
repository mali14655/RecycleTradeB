const express = require('express');
const router = express.Router();
const SellerForm = require('../models/SellerForm');
const { authMiddleware, roleCheck } = require('../middlewares/auth');

// Submit a new seller form (B2C)
router.post('/form', authMiddleware, roleCheck(['seller']), async (req, res) => {
  try {
    const { productName, quantity, price } = req.body;

    const newForm = new SellerForm({
      sellerId: req.user._id,
      productName,
      quantity,
      price
    });

    await newForm.save();
    res.json({ message: 'Form submitted successfully', form: newForm });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Admin: Get all seller forms
router.get('/admin/forms', authMiddleware, roleCheck(['admin']), async (req, res) => {
  try {
    const forms = await SellerForm.find().populate('sellerId', 'name email');
    res.json(forms);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
// routes/sellerForm.js (or existing seller form router)
router.post('/admin/forms/:id/process', authMiddleware, roleCheck(['admin']), async (req, res) => {
  try {
    const form = await SellerForm.findById(req.params.id);
    if (!form) return res.status(404).json({ message: 'Form not found' });

    form.status = 'processed';
    await form.save();

    res.json({ message: 'Form marked as processed', form });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// routes/sellerForm.js - Add this route
router.get('/my-forms', authMiddleware, roleCheck(['seller']), async (req, res) => {
  try {
    const forms = await SellerForm.find({ sellerId: req.user._id })
      .sort({ createdAt: -1 });
    res.json(forms);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
