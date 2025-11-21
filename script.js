const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
require('dotenv').config();
const User = require('./models/User'); // CommonJS import

const MONGO_URI = process.env.MONGO_URI;

const createAdmin = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');

    const existingAdmin = await User.findOne({ email: 'muhammadali.dev5@gmail.com' });
    if (existingAdmin) {
      console.log('Admin already exists');
      process.exit();
    }

    const passwordHash = await bcrypt.hash('Admin123', 10);

    const admin = new User({
      name: 'Admin',
      email: 'muhammadali.dev5@gmail.com',
      passwordHash, // ✅ match your schema
      role: 'admin',
      verified: true
    });

    await admin.save();
    console.log('Admin created successfully!');
    process.exit();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

createAdmin();
