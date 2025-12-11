const express = require("express");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { authMiddleware } = require("../middlewares/auth");

const router = express.Router();

// Validate Cloudinary configuration
const validateCloudinaryConfig = () => {
  const required = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error('❌ Missing Cloudinary environment variables:', missing.join(', '));
    return false;
  }
  return true;
};

// Configure Cloudinary with better timeout settings
if (validateCloudinaryConfig()) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    timeout: 180000, // 3 minutes timeout for large files
    secure: true,
    api_proxy: process.env.CLOUDINARY_API_PROXY || undefined,
  });
  console.log('✅ Cloudinary configured with cloud_name:', process.env.CLOUDINARY_CLOUD_NAME);
} else {
  console.error('❌ Cloudinary configuration incomplete. Uploads will fail.');
}

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

    // Validate Cloudinary config before upload
    if (!validateCloudinaryConfig()) {
      return res.status(500).json({ 
        message: "Cloudinary configuration error. Please check server environment variables.",
        error: "Missing Cloudinary credentials"
      });
    }

    // Upload files with retry logic using direct upload (not stream)
    const uploadWithRetry = async (file, retries = 3) => {
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          console.log(`Upload attempt ${attempt} for file: ${file.originalname} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
          
          // Use data URI method - most reliable for Cloudinary uploads
          // Convert buffer to base64 data URI
          const base64String = file.buffer.toString('base64');
          const dataUri = `data:${file.mimetype || 'image/png'};base64,${base64String}`;
          
          // Upload with direct method - simpler and more reliable than streams
          const result = await cloudinary.uploader.upload(dataUri, {
            folder: "fssmartphones/products",
            resource_type: "image",
            use_filename: true,
            unique_filename: true,
            overwrite: false,
            timeout: 180000, // 3 minutes
            // Add additional options for better reliability
            chunk_size: 6000000, // 6MB chunks
          });
          
          console.log(`✅ Successfully uploaded: ${file.originalname} -> ${result.secure_url}`);
          return result;
          
        } catch (error) {
          const errorCode = error.code || error.message || (error.error?.message || '');
          const errorMessage = error.message || error.error?.message || errorCode;
          const isConnectionError = errorCode === 'ECONNRESET' || 
                                   errorCode === 'ETIMEDOUT' || 
                                   errorCode === 'ECONNREFUSED' ||
                                   errorMessage?.includes('timeout') ||
                                   errorMessage?.includes('Connection') ||
                                   errorMessage?.includes('ECONNRESET');
          
          console.error(`❌ Attempt ${attempt} failed for ${file.originalname}:`, errorMessage);
          
          // Log detailed error for debugging
          if (attempt === 1) {
            console.error('Error details:', {
              code: error.code,
              message: error.message,
              error: error.error,
              http_code: error.http_code,
              name: error.name
            });
          }
          
          if (attempt === retries) {
            // On final attempt, provide more context
            if (error.http_code === 401) {
              throw new Error('Cloudinary authentication failed. Please check API credentials.');
            } else if (error.http_code === 400) {
              throw new Error(`Invalid request: ${errorMessage}`);
            } else if (isConnectionError) {
              throw new Error(`Network connection error: ${errorMessage}. Please check your internet connection.`);
            }
            throw error;
          }
          
          // Exponential backoff - shorter delays since we're using direct upload
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000); // 1s, 2s, 4s, max 8s
          console.log(`⏳ Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    };

    // Upload files sequentially to avoid overwhelming connections
    const results = [];
    const failedUploads = [];
    
    for (const file of req.files) {
      try {
        const result = await uploadWithRetry(file);
        results.push(result);
      } catch (error) {
        const errorCode = error.code || error.message;
        const isConnectionError = errorCode === 'ECONNRESET' || 
                                 errorCode === 'ETIMEDOUT' || 
                                 error.message?.includes('timeout') ||
                                 error.message?.includes('Connection error');
        
        console.error(`Failed to upload ${file.originalname} after all retries:`, error);
        
        let errorMsg = 'Upload failed. Please try again.';
        if (isConnectionError) {
          errorMsg = 'Network connection error. This may be caused by:\n' +
                     '1. Firewall blocking Cloudinary (api.cloudinary.com)\n' +
                     '2. Network connectivity issues\n' +
                     '3. Proxy/VPN interference\n' +
                     'Please check your network settings or contact your administrator.';
        } else if (error.message?.includes('authentication')) {
          errorMsg = 'Cloudinary authentication failed. Please check server configuration.';
        }
        
        failedUploads.push({
          filename: file.originalname,
          error: errorMsg,
          size: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
          errorCode: error.code || error.http_code
        });
        // Continue with other files even if one fails
      }
    }

    if (results.length === 0) {
      const errorMessage = failedUploads.length > 0 && failedUploads[0].error.includes('Network')
        ? "All uploads failed due to network issues. Please check your internet connection and try again."
        : "All uploads failed. Please try again with smaller files or check your internet connection.";
      
      // Return consistent format even when all fail - frontend expects 'images' array
      return res.status(500).json({ 
        message: errorMessage,
        images: [], // Always include images array for consistency
        uploaded: 0,
        failed: failedUploads.length,
        failedUploads: failedUploads
      });
    }

    const imageUrls = results.map(result => result.secure_url);

    console.log("Images uploaded successfully:", imageUrls.length, "Failed:", failedUploads.length);
    
    // If some files failed, return partial success with warnings
    if (failedUploads.length > 0) {
      return res.status(207).json({ // 207 Multi-Status for partial success
        message: `${imageUrls.length} image(s) uploaded successfully, ${failedUploads.length} failed.`,
        images: imageUrls,
        uploaded: imageUrls.length,
        failed: failedUploads.length,
        failedUploads: failedUploads
      });
    }
    
    res.json({
      message: "Images uploaded successfully",
      images: imageUrls,
      uploaded: imageUrls.length,
      failed: 0
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

// Test Cloudinary connection endpoint
router.get("/test-connection", authMiddleware, async (req, res) => {
  try {
    if (!validateCloudinaryConfig()) {
      return res.status(500).json({ 
        success: false,
        message: "Cloudinary configuration incomplete",
        missing: ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'].filter(key => !process.env[key])
      });
    }

    // Test with a small 1x1 pixel PNG
    const testImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    
    const result = await cloudinary.uploader.upload(testImage, {
      folder: "fssmartphones/test",
      resource_type: "image",
      timeout: 30000,
    });

    // Clean up test image
    if (result.public_id) {
      await cloudinary.uploader.destroy(result.public_id).catch(() => {});
    }

    res.json({
      success: true,
      message: "Cloudinary connection successful",
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      test_upload: "Success"
    });
  } catch (error) {
    console.error("Cloudinary connection test failed:", error);
    res.status(500).json({
      success: false,
      message: "Cloudinary connection test failed",
      error: error.message || error.error?.message || 'Unknown error',
      http_code: error.http_code,
      code: error.code,
      suggestion: error.http_code === 401 
        ? "Check your CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET"
        : error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT'
        ? "Network issue: Check firewall/proxy settings or internet connection"
        : "Check Cloudinary configuration and network connectivity"
    });
  }
});

// Delete image from Cloudinary
router.delete("/delete", authMiddleware, async (req, res) => {
  try {
    const { imageUrl } = req.body;
    
    if (!imageUrl) {
      return res.status(400).json({ message: "Image URL is required" });
    }

    // Extract public_id from Cloudinary URL (handles different URL formats)
    let publicId;
    try {
      // Cloudinary URL format: https://res.cloudinary.com/cloud_name/image/upload/v1234567890/folder/image_id.jpg
      // Or: https://res.cloudinary.com/cloud_name/image/upload/folder/image_id.jpg
      const urlParts = imageUrl.split('/');
      const uploadIndex = urlParts.findIndex(part => part === 'upload');
      
      if (uploadIndex !== -1 && uploadIndex < urlParts.length - 1) {
        // Get everything after 'upload' (skip version if present)
        const afterUpload = urlParts.slice(uploadIndex + 1);
        // Version starts with 'v' followed by digits - skip it
        const pathParts = afterUpload[0].startsWith('v') && /^v\d+$/.test(afterUpload[0])
          ? afterUpload.slice(1)
          : afterUpload;
        
        // Join remaining parts and remove file extension
        const pathWithId = pathParts.join('/');
        publicId = pathWithId.replace(/\.[^/.]+$/, ''); // Remove extension
      } else {
        // Fallback: extract from end of URL
        const fileName = urlParts[urlParts.length - 1];
        publicId = fileName.split('.')[0];
      }
    } catch (err) {
      console.error("Error parsing Cloudinary URL:", err);
      // Fallback: simple extraction
      const fileName = imageUrl.split('/').pop();
      publicId = fileName.split('.')[0];
    }

    console.log(`Deleting image with public_id: ${publicId}`);
    const result = await cloudinary.uploader.destroy(publicId);
    
    if (result.result === "ok" || result.result === "not found") {
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