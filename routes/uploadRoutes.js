const express = require("express");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { authMiddleware } = require("../middlewares/auth");

const router = express.Router();

// Configure Cloudinary with better timeout settings
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  timeout: 120000, // 2 minutes timeout
});

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  }
});

// Upload image endpoint with improved error handling and retry logic
router.post("/upload", authMiddleware, upload.array("images", 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: "No files uploaded" });
    }

    console.log("Starting upload for", req.files.length, "files");

    // Upload files with retry logic
    const uploadWithRetry = async (file, retries = 3) => {
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          console.log(`Upload attempt ${attempt} for file: ${file.originalname}`);
          
          const result = await new Promise((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
              {
                folder: "recycletrade/products",
                resource_type: "image",
              },
              (error, result) => {
                if (error) {
                  reject(error);
                } else {
                  resolve(result);
                }
              }
            );
            
            // Set timeout for the upload stream
            const timeout = setTimeout(() => {
              uploadStream.destroy();
              reject(new Error('Upload timeout'));
            }, 60000); // 1 minute timeout per file
            
            uploadStream.on('finish', () => clearTimeout(timeout));
            uploadStream.on('error', () => clearTimeout(timeout));
            
            uploadStream.end(file.buffer);
          });
          
          console.log(`Successfully uploaded: ${file.originalname}`);
          return result;
          
        } catch (error) {
          console.error(`Attempt ${attempt} failed for ${file.originalname}:`, error.message);
          
          if (attempt === retries) {
            throw error; // All retries failed
          }
          
          // Wait before retrying (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    };

    // Upload files sequentially to avoid overwhelming connections
    const results = [];
    for (const file of req.files) {
      try {
        const result = await uploadWithRetry(file);
        results.push(result);
      } catch (error) {
        console.error(`Failed to upload ${file.originalname} after all retries:`, error);
        // Continue with other files even if one fails
      }
    }

    if (results.length === 0) {
      return res.status(500).json({ message: "All uploads failed. Please try again." });
    }

    const imageUrls = results.map(result => result.secure_url);

    console.log("Images uploaded successfully:", imageUrls.length);
    
    res.json({
      message: "Images uploaded successfully",
      images: imageUrls,
      uploaded: imageUrls.length,
      failed: req.files.length - imageUrls.length
    });
    
  } catch (error) {
    console.error("Upload endpoint error:", error);
    
    if (error.message.includes('File too large')) {
      return res.status(413).json({ message: "File too large. Maximum size is 5MB." });
    }
    
    if (error.message.includes('timeout') || error.code === 'ECONNRESET') {
      return res.status(408).json({ message: "Upload timeout. Please try again with smaller files or check your internet connection." });
    }
    
    res.status(500).json({ message: "Failed to upload images. Please try again." });
  }
});

// Delete image from Cloudinary
router.delete("/delete", authMiddleware, async (req, res) => {
  try {
    const { imageUrl } = req.body;
    
    if (!imageUrl) {
      return res.status(400).json({ message: "Image URL is required" });
    }

    // Extract public_id from Cloudinary URL
    const publicId = imageUrl.split('/').pop().split('.')[0];
    const fullPublicId = `recycletrade/products/${publicId}`;

    const result = await cloudinary.uploader.destroy(fullPublicId);
    
    if (result.result === "ok") {
      res.json({ message: "Image deleted successfully" });
    } else {
      res.status(404).json({ message: "Image not found" });
    }
  } catch (error) {
    console.error("Delete error:", error);
    res.status(500).json({ message: "Failed to delete image" });
  }
});

module.exports = router;