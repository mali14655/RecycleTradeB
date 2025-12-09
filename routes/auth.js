const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const authController = require('../controllers/authController');
const { authMiddleware } = require('../middlewares/auth');

router.post('/register', [
  body('name').notEmpty(),
  body('email').isEmail(),
  body('password').isLength({ min: 6 })
], authController.register);

// NEW: Dedicated admin login route to isolate admin authentication flow
router.post('/admin/login', authController.adminLogin);

router.post('/login', authController.login);
router.post('/refresh', authController.refreshToken);
router.post('/logout', authController.logout);
router.get('/me', authMiddleware, authController.me);

// NEW: Email verification endpoints
router.post('/verify-email', authController.verifyEmail);
router.post('/resend-verification', authController.resendVerification);

// NEW: Password reset endpoints
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);

// NEW: Test endpoint to verify routes are working
router.get('/test-routes', (req, res) => {
  res.json({ 
    message: 'Auth routes are working!',
    availableRoutes: [
      'POST /api/auth/register',
      'POST /api/auth/login',
      'POST /api/auth/refresh',
      'POST /api/auth/logout',
      'GET /api/auth/me',
      'POST /api/auth/verify-email',
      'POST /api/auth/resend-verification',
      'POST /api/auth/forgot-password',
      'POST /api/auth/reset-password'
    ]
  });
});

module.exports = router;
