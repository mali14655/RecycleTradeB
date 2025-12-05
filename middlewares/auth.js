  const jwt = require('jsonwebtoken');
  const User = require('../models/User');

  const authMiddleware = async (req, res, next) => {
    try {
      const token = req.headers.authorization?.split(' ')[1] || req.cookies?.accessToken;
      if (!token) return res.status(401).json({ message: 'No token' });
      const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
      const user = await User.findById(payload.id).select('-passwordHash');
      if (!user) return res.status(401).json({ message: 'Invalid token' });
      
      // NEW: Check if email is verified - block unverified users from accessing protected routes
      if (!user.verified) {
        return res.status(403).json({ 
          message: 'Please verify your email before accessing your account.',
          requiresVerification: true
        });
      }
      
      req.user = user;
      next();
    } catch (err) {
      return res.status(401).json({ message: 'Unauthorized', error: err.message });
    }
  };

  const roleCheck = (roles = []) => (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Unauthorized' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ message: 'Forbidden' });
    next();
  };

  module.exports = { authMiddleware, roleCheck };
