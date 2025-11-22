const SellRequest = require('../models/SellerRequest');
const { validationResult } = require('express-validator');
const axios = require('axios');

// Helper function to delete images from Cloudinary
const deleteImagesFromCloudinary = async (imageUrls, authHeader) => {
  if (!imageUrls || imageUrls.length === 0) return;
  
  for (const imageUrl of imageUrls) {
    if (!imageUrl) continue;
    try {
      await axios.delete(`${process.env.API_URL || 'http://localhost:5000'}/upload/delete`, {
        headers: authHeader ? { Authorization: authHeader } : {},
        data: { imageUrl },
      });
      console.log("Deleted SellRequest image from Cloudinary:", imageUrl);
    } catch (err) {
      console.error("Failed to delete SellRequest image:", imageUrl, err.message);
    }
  }
};

// user creates sell request (C2B)
exports.createSellRequest = async (req,res,next)=>{
  try{
    const { productTitle, description, expectedPrice, images } = req.body;
    const request = new SellRequest({
      productTitle,
      description,
      expectedPrice,
      images: images || [],
      seller: req.user._id
    });
    await request.save();
    res.json(request);
  }catch(err){ next(err); }
};

// get all sell requests (admin view)
exports.getSellRequests = async (req,res,next)=>{
  try{
    const requests = await SellRequest.find().populate('seller','name email');
    res.json(requests);
  }catch(err){ next(err); }
};

// admin approves/rejects
exports.updateSellRequestStatus = async (req,res,next)=>{
  try{
    const { status, companyResponse, images } = req.body; // NEW: Allow image updates
    const request = await SellRequest.findById(req.params.id);
    if(!request) return res.status(404).json({ message: 'Request not found' });
    if(!['approved','rejected','completed'].includes(status)) return res.status(400).json({ message: 'Invalid status' });

    // NEW: If images are being updated, delete old images that are not in new images
    if (images && Array.isArray(images)) {
      const oldImages = request.images || [];
      const imagesToDelete = oldImages.filter(oldImg => !images.includes(oldImg));
      
      if (imagesToDelete.length > 0) {
        deleteImagesFromCloudinary(imagesToDelete, req.headers.authorization).catch(err => {
          console.error("Error deleting old SellRequest images:", err);
        });
      }
      
      request.images = images;
    }

    request.status = status;
    if(companyResponse) request.companyResponse = companyResponse;
    request.updatedAt = Date.now();
    await request.save();
    res.json(request);
  }catch(err){ next(err); }
};

// seller checks own requests
exports.getMySellRequests = async (req,res,next)=>{
  try{
    const requests = await SellRequest.find({ seller: req.user._id });
    res.json(requests);
  }catch(err){ next(err); }
};
