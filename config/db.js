const mongoose = require('mongoose');

// Cache the connection to prevent multiple connections
let cachedConnection = null;

const connectDB = async () => {
  // If we already have a connection, return it
  if (cachedConnection) {
    console.log('✅ Using cached MongoDB connection');
    return cachedConnection;
  }

  try {
    const uri = process.env.MONGO_URI;
    
    if (!uri) {
      throw new Error('MONGO_URI is not defined in environment variables');
    }

    console.log('🔄 Connecting to MongoDB...');
    
    const connection = await mongoose.connect(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });

    cachedConnection = connection;
    console.log('✅ MongoDB connected successfully');
    
    return connection;
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    
    // Reset cached connection on failure
    cachedConnection = null;
    
    // Only exit process if it's the main application (not webhook)
    if (process.env.IS_WEBHOOK !== 'true') {
      process.exit(1);
    }
    throw err;
  }
};

module.exports = connectDB;