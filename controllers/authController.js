const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { validationResult } = require("express-validator");
const User = require("../models/User");
const axios = require("axios");

const createAccessToken = (user, rememberMe = false) =>
  jwt.sign({ id: user._id }, process.env.JWT_ACCESS_SECRET, {
    expiresIn: rememberMe ? "7d" : "1h", // NEW: Support remember me in token creation
  });
const createRefreshToken = (user, rememberMe = false) =>
  jwt.sign({ id: user._id }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: rememberMe ? "30d" : "7d",
  });

// NEW: Normalize email to enforce uniqueness and consistent lookups
const normalizeEmail = (email = "") => email.trim().toLowerCase();

// NEW: Helper function to send email via notifications service
const sendEmail = async (to, subject, html) => {
  try {
    // For internal server calls, always use localhost (most reliable)
    const port = process.env.PORT || 5000;
    const baseUrl = `http://localhost:${port}`;
    
    console.log(`[EMAIL] Attempting to send email to: ${to}`);
    console.log(`[EMAIL] Using API URL: ${baseUrl}/api/notifications/send-email`);
    
    const response = await axios.post(`${baseUrl}/api/notifications/send-email`, {
      to,
      subject,
      html
    }, {
      timeout: 10000 // 10 second timeout
    });
    
    console.log(`[EMAIL] ✅ Successfully sent email to ${to}`);
    console.log(`[EMAIL] Response:`, response.data);
    return { success: true, response: response.data };
  } catch (error) {
    console.error(`[EMAIL] ❌ Error sending email to ${to}:`);
    console.error(`[EMAIL] Error message:`, error.message);
    console.error(`[EMAIL] Error code:`, error.code);
    console.error(`[EMAIL] Error response:`, error.response?.data);
    console.error(`[EMAIL] Full error:`, error);
    
    // Return detailed error info
    return { 
      success: false, 
      error: error.message,
      errorCode: error.code,
      errorDetails: error.response?.data || error.message,
      suggestion: error.code === 'ECONNREFUSED' 
        ? 'Email service not running or not accessible. Check if notifications service is working.'
        : 'Check email service configuration (RESEND_API_KEY, EMAIL_USER, etc.)'
    };
  }
};

// NEW: Generate verification token
const generateVerificationToken = () => {
  return crypto.randomBytes(32).toString("hex");
};

exports.register = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    const { name, email, password, phone, role } = req.body;
    const normalizedEmail = normalizeEmail(email);
    
    // NEW: Only allow buyer registration for now
    if (role && role !== "buyer") {
      return res.status(400).json({ message: "Only buyer registration is currently available" });
    }

    // NEW: Check if email already exists and prevent buyers from using admin/company emails
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      // If the existing user is an admin or company, prevent buyer registration with this email
      if (existing.role === "admin" || existing.role === "company") {
        return res.status(400).json({ 
          message: "This email is already registered as an administrator. Please use a different email address." 
        });
      }
      // For other roles, show generic message
      return res.status(400).json({ message: "Email already registered" });
    }

    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    // NEW: Generate email verification token
    const emailVerificationToken = generateVerificationToken();
    const emailVerificationExpiry = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    const user = new User({
      name,
      email: normalizedEmail,
      phone,
      passwordHash,
      role: "buyer", // NEW: Force buyer role
      verified: false, // NEW: Require email verification - EXPLICITLY SET TO FALSE
      emailVerificationToken,
      emailVerificationExpiry,
    });
    await user.save();
    
    // NEW: Verify that verified was saved correctly
    const savedUser = await User.findById(user._id);
    console.log(`[REGISTER] User ${email} created - verified status:`, savedUser.verified, typeof savedUser.verified);
    
    if (savedUser.verified !== false) {
      console.error(`[REGISTER] WARNING: User ${email} was created with verified=${savedUser.verified} instead of false!`);
      // Force set to false if somehow it's not false
      savedUser.verified = false;
      await savedUser.save();
    }

    // NEW: Send verification email
    const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, '');
    const verificationUrl = `${frontendUrl}/verify-email?token=${emailVerificationToken}`;
    
    // NEW: Log the URL for debugging
    console.log(`[REGISTER] Verification URL: ${verificationUrl}`);
    console.log(`[REGISTER] Token: ${emailVerificationToken.substring(0, 20)}...`);
    
    // NEW: Ultra-simple email template with multiple clickable links
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #333; font-size: 24px; margin-bottom: 20px;">Welcome to Mobitrade!</h1>
        
        <p style="color: #666; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">Hi ${name},</p>
        
        <p style="color: #666; font-size: 16px; line-height: 1.6; margin-bottom: 30px;">Thank you for registering! Please verify your email address by clicking one of the links below:</p>
        
        <div style="text-align: center; margin: 40px 0;">
          <a href="${verificationUrl}" style="background-color: #000000; color: #ffffff; padding: 16px 40px; text-decoration: none; border-radius: 8px; display: inline-block; font-size: 16px; font-weight: 600;">CLICK HERE TO VERIFY EMAIL</a>
        </div>
        
        <p style="color: #666; font-size: 14px; margin: 30px 0 10px 0;">Or click this link:</p>
        <p style="margin: 0; padding: 12px; background-color: #f0f9ff; border-radius: 4px;">
          <a href="${verificationUrl}" style="color: #0066cc; font-size: 16px; text-decoration: underline; word-break: break-all;">${verificationUrl}</a>
        </p>
        
        <p style="color: #666; font-size: 14px; margin: 20px 0 10px 0;">Or copy and paste this URL into your browser:</p>
        <p style="color: #333; font-size: 13px; word-break: break-all; margin: 0; padding: 10px; background-color: #f9f9f9; border: 1px solid #ddd; font-family: monospace;">
          ${verificationUrl}
        </p>
        
        <p style="color: #999; font-size: 12px; margin-top: 30px;">This link will expire in 24 hours.</p>
      </div>
    `;

    // NEW: Send verification email and check result
    console.log(`[REGISTER] Sending verification email to: ${email}`);
    const emailResult = await sendEmail(email, "Verify Your Email - Mobitrade", emailHtml);
    
    // NEW: Don't return tokens - user needs to verify email first
    // Include email sending status in response
    if (emailResult.success) {
      console.log(`[REGISTER] ✅ Email sent successfully to ${email}`);
      res.json({
        message: "Registration successful! Please check your email to verify your account.",
        emailSent: true,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          verified: user.verified,
        },
      });
    } else {
      // Email failed but account created - still return success but warn user
      console.error(`[REGISTER] ❌ Email sending failed for ${email}`);
      console.error(`[REGISTER] Error details:`, emailResult);
      
      // Log verification token for manual verification if needed
      console.log(`[REGISTER] Verification token for ${email}: ${emailVerificationToken}`);
      console.log(`[REGISTER] Manual verification URL: ${verificationUrl}`);
      
      res.json({
        message: "Account created, but verification email could not be sent. Please use 'Resend Verification' on the login page.",
        emailSent: false,
        emailError: emailResult.error || 'Unknown error',
        emailSuggestion: emailResult.suggestion || 'Check email service configuration',
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          verified: user.verified,
        },
      });
    }
  } catch (err) {
    next(err);
  }
};

exports.login = async (req, res, next) => {
  try {
    const { email, password, rememberMe } = req.body;
    const normalizedEmail = normalizeEmail(email);
    
    // Fetch user from database
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) return res.status(400).json({ message: "Invalid credentials" });
    
    // NEW: Prevent admin credentials from being used on the public login route
    if (user.role === "admin") {
      console.log(`[LOGIN] ❌ BLOCKED: Admin attempted client login for ${normalizedEmail}`);
      return res.status(400).json({ message: "User not registered" });
    }
    
    // NEW: Check verification FIRST (before password check) - better UX
    // Log for debugging
    console.log(`[LOGIN] Attempting login for: ${email}`);
    console.log(`[LOGIN] Verified status:`, user.verified, `Type:`, typeof user.verified);
    
    // STRICT CHECK: verified must be explicitly boolean true
    if (user.verified !== true) {
      console.log(`[LOGIN] ❌ BLOCKED: User ${email} is not verified (verified=${user.verified})`);
      return res.status(403).json({ 
        message: "Please verify your email before logging in. Check your inbox for the verification link.",
        requiresVerification: true,
        verified: user.verified
      });
    }
    
    // Check password AFTER verification check
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }
    
    console.log(`[LOGIN] ✅ ALLOWED: User ${email} is verified`);

    // NEW: Adjust token expiry based on remember me
    const accessTokenExpiry = rememberMe ? "7d" : "1h"; // Fixed: "1hr" -> "1h" (JWT standard)
    const refreshTokenExpiry = rememberMe ? "30d" : "7d";

    console.log(`[LOGIN] Remember me: ${rememberMe}, Access token expiry: ${accessTokenExpiry}, Refresh token expiry: ${refreshTokenExpiry}`);

    // Use helper functions with rememberMe parameter
    const accessToken = createAccessToken(user, rememberMe);
    const refreshToken = createRefreshToken(user, rememberMe);

    // NEW: Set cookie with longer expiry if remember me
    const cookieOptions = {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
    };
    if (rememberMe) {
      cookieOptions.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds
      console.log(`[LOGIN] Setting refresh token cookie with 30-day expiry`);
    } else {
      cookieOptions.maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
      console.log(`[LOGIN] Setting refresh token cookie with 7-day expiry`);
    }

    res.cookie("refreshToken", refreshToken, cookieOptions);
    res.json({
      accessToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        verified: user.verified,
      },
    });
  } catch (err) {
    next(err);
  }
};

// NEW: Dedicated admin login endpoint to isolate admin authentication
exports.adminLogin = async (req, res, next) => {
  try {
    const { email, password, rememberMe } = req.body;
    const normalizedEmail = normalizeEmail(email);

    const adminUser = await User.findOne({ email: normalizedEmail, role: "admin" });
    if (!adminUser) {
      console.log(`[ADMIN-LOGIN] ❌ Unknown admin email attempt: ${normalizedEmail}`);
      return res.status(401).json({ message: "Unauthorized" });
    }

    const isMatch = await bcrypt.compare(password, adminUser.passwordHash);
    if (!isMatch) {
      console.log(`[ADMIN-LOGIN] ❌ Invalid password for admin email: ${normalizedEmail}`);
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (adminUser.verified !== true) {
      console.log(`[ADMIN-LOGIN] ❌ Admin account not verified: ${normalizedEmail}`);
      return res.status(403).json({ message: "Admin account not verified" });
    }

    const accessToken = createAccessToken(adminUser, rememberMe);
    const refreshToken = createRefreshToken(adminUser, rememberMe);

    const cookieOptions = {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: rememberMe
        ? 30 * 24 * 60 * 60 * 1000
        : 7 * 24 * 60 * 60 * 1000,
    };

    res.cookie("refreshToken", refreshToken, cookieOptions);
    res.json({
      accessToken,
      user: {
        id: adminUser._id,
        name: adminUser.name,
        email: adminUser.email,
        role: adminUser.role,
        verified: adminUser.verified,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.refreshToken = async (req, res, next) => {
  try {
    const token = req.cookies.refreshToken;
    if (!token) return res.status(401).json({ message: "No refresh token" });
    const payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(payload.id);
    if (!user) return res.status(401).json({ message: "User not found" });

    // NEW: Check if email is verified - don't allow refresh for unverified users
    if (!user.verified) {
      res.clearCookie("refreshToken");
      return res.status(403).json({ 
        message: "Please verify your email before accessing your account.",
        requiresVerification: true
      });
    }

    // NEW: Check if user has rememberMe preference (stored in token or cookie)
    // For refresh, we'll use default expiry unless we can determine rememberMe
    const accessToken = createAccessToken(user, false); // Refresh uses default expiry
    res.json({
      accessToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        verified: user.verified,
      },
    });
  } catch (err) {
    return res.status(401).json({ message: "Invalid refresh token" });
  }
};

exports.logout = async (req, res) => {
  res.clearCookie("refreshToken");
  res.json({ message: "Logged out" });
};

exports.me = async (req, res) => {
  const user = req.user;
  // NEW: Double-check verification (authMiddleware already checks, but extra safety)
  if (!user.verified) {
    return res.status(403).json({ 
      message: 'Please verify your email before accessing your account.',
      requiresVerification: true
    });
  }
  res.json({ user });
};

// NEW: Verify email endpoint
exports.verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.body;
    
    console.log('[VERIFY-EMAIL] Request received');
    console.log('[VERIFY-EMAIL] Token received:', token ? `${token.substring(0, 20)}...` : 'none');
    console.log('[VERIFY-EMAIL] Token length:', token?.length);
    console.log('[VERIFY-EMAIL] Request body:', JSON.stringify(req.body));
    
    if (!token) {
      console.error('[VERIFY-EMAIL] ❌ No token provided');
      return res.status(400).json({ message: "Verification token is required" });
    }

    // Try to find user with exact token match
    let user = await User.findOne({
      emailVerificationToken: token,
      emailVerificationExpiry: { $gt: Date.now() }
    });

    // If not found, try URL-decoded token (in case email client encoded it)
    if (!user && token) {
      try {
        const decodedToken = decodeURIComponent(token);
        if (decodedToken !== token) {
          console.log('[VERIFY-EMAIL] Trying URL-decoded token');
          user = await User.findOne({
            emailVerificationToken: decodedToken,
            emailVerificationExpiry: { $gt: Date.now() }
          });
        }
      } catch (e) {
        console.log('[VERIFY-EMAIL] Could not decode token:', e.message);
      }
    }

    // If still not found, check if token exists but expired
    if (!user) {
      const expiredUser = await User.findOne({ emailVerificationToken: token });
      if (expiredUser) {
        const isExpired = expiredUser.emailVerificationExpiry <= Date.now();
        console.error('[VERIFY-EMAIL] Token found but expired:', isExpired);
        console.error('[VERIFY-EMAIL] Expiry time:', new Date(expiredUser.emailVerificationExpiry).toISOString());
        console.error('[VERIFY-EMAIL] Current time:', new Date().toISOString());
        return res.status(400).json({ 
          message: "Verification token has expired. Please request a new verification email.",
          expired: true
        });
      }
      
      console.error('[VERIFY-EMAIL] ❌ Invalid token - not found in database');
      console.error('[VERIFY-EMAIL] Token searched:', token.substring(0, 20) + '...');
      return res.status(400).json({ 
        message: "Invalid verification token. Please check your email link or request a new verification email.",
        invalid: true
      });
    }

    console.log('[VERIFY-EMAIL] ✅ Valid token found for user:', user.email);

    user.verified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpiry = undefined;
    await user.save();

    console.log('[VERIFY-EMAIL] ✅ Email verified successfully for:', user.email);
    res.json({ message: "Email verified successfully! You can now log in." });
  } catch (err) {
    console.error('[VERIFY-EMAIL] ❌ Error:', err);
    next(err);
  }
};

// NEW: Resend verification email
exports.resendVerification = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const user = await User.findOne({ email });
    if (!user) {
      // Don't reveal if email exists
      return res.json({ message: "If an account exists with this email, a verification link has been sent." });
    }

    if (user.verified) {
      return res.status(400).json({ message: "Email is already verified" });
    }

    // Generate new token
    const emailVerificationToken = generateVerificationToken();
    const emailVerificationExpiry = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    user.emailVerificationToken = emailVerificationToken;
    user.emailVerificationExpiry = emailVerificationExpiry;
    await user.save();

    // Send verification email
    const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, '');
    const verificationUrl = `${frontendUrl}/verify-email?token=${emailVerificationToken}`;
    
    // NEW: Log the URL for debugging
    console.log(`[RESEND-VERIFICATION] Verification URL: ${verificationUrl}`);
    
    // NEW: Ultra-simple email template with multiple clickable links
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #333; font-size: 24px; margin-bottom: 20px;">Verify Your Email - Mobitrade</h1>
        
        <p style="color: #666; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">Hi ${user.name},</p>
        
        <p style="color: #666; font-size: 16px; line-height: 1.6; margin-bottom: 30px;">Please verify your email address by clicking one of the links below:</p>
        
        <div style="text-align: center; margin: 40px 0;">
          <a href="${verificationUrl}" style="background-color: #000000; color: #ffffff; padding: 16px 40px; text-decoration: none; border-radius: 8px; display: inline-block; font-size: 16px; font-weight: 600;">CLICK HERE TO VERIFY EMAIL</a>
        </div>
        
        <p style="color: #666; font-size: 14px; margin: 30px 0 10px 0;">Or click this link:</p>
        <p style="margin: 0; padding: 12px; background-color: #f0f9ff; border-radius: 4px;">
          <a href="${verificationUrl}" style="color: #0066cc; font-size: 16px; text-decoration: underline; word-break: break-all;">${verificationUrl}</a>
        </p>
        
        <p style="color: #666; font-size: 14px; margin: 20px 0 10px 0;">Or copy and paste this URL into your browser:</p>
        <p style="color: #333; font-size: 13px; word-break: break-all; margin: 0; padding: 10px; background-color: #f9f9f9; border: 1px solid #ddd; font-family: monospace;">
          ${verificationUrl}
        </p>
        
        <p style="color: #999; font-size: 12px; margin-top: 30px;">This link will expire in 24 hours.</p>
      </div>
    `;

    await sendEmail(email, "Verify Your Email - Mobitrade", emailHtml);

    res.json({ message: "Verification email sent! Please check your inbox." });
  } catch (err) {
    next(err);
  }
};

// NEW: Forgot password - send reset link
exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const user = await User.findOne({ email });
    if (!user) {
      // Don't reveal if email exists
      return res.json({ message: "If an account exists with this email, a password reset link has been sent." });
    }

    // Generate reset token
    const resetToken = generateVerificationToken();
    const resetExpiry = Date.now() + 60 * 60 * 1000; // 1 hour

    user.resetPasswordToken = resetToken;
    user.resetPasswordExpiry = resetExpiry;
    await user.save();
    
    // NEW: Verify token was saved correctly
    const savedUser = await User.findById(user._id);
    console.log(`[FORGOT-PASSWORD] Token saved - Length: ${savedUser.resetPasswordToken?.length}, Token: ${savedUser.resetPasswordToken?.substring(0, 20)}...`);
    console.log(`[FORGOT-PASSWORD] Expiry: ${new Date(savedUser.resetPasswordExpiry).toISOString()}`);

    // Send reset email
    // NEW: Ensure URL is properly formatted - don't encode token (hex is safe)
    const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, '');
    const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;
    
    // NEW: Log the URL for debugging
    console.log(`[FORGOT-PASSWORD] Reset URL: ${resetUrl}`);
    console.log(`[FORGOT-PASSWORD] Token: ${resetToken.substring(0, 20)}...`);
    
    // NEW: Ultra-simple email template with multiple clickable links
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #333; font-size: 24px; margin-bottom: 20px;">Reset Your Password - Mobitrade</h1>
        
        <p style="color: #666; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">Hi ${user.name},</p>
        
        <p style="color: #666; font-size: 16px; line-height: 1.6; margin-bottom: 30px;">You requested to reset your password. Click one of the links below to reset it:</p>
        
        <div style="text-align: center; margin: 40px 0;">
          <a href="${resetUrl}" style="background-color: #000000; color: #ffffff; padding: 16px 40px; text-decoration: none; border-radius: 8px; display: inline-block; font-size: 16px; font-weight: 600;">CLICK HERE TO RESET PASSWORD</a>
        </div>
        
        <p style="color: #666; font-size: 14px; margin: 30px 0 10px 0;">Or click this link:</p>
        <p style="margin: 0; padding: 12px; background-color: #f0f9ff; border-radius: 4px;">
          <a href="${resetUrl}" style="color: #0066cc; font-size: 16px; text-decoration: underline; word-break: break-all;">${resetUrl}</a>
        </p>
        
        <p style="color: #666; font-size: 14px; margin: 20px 0 10px 0;">Or copy and paste this URL into your browser:</p>
        <p style="color: #333; font-size: 13px; word-break: break-all; margin: 0; padding: 10px; background-color: #f9f9f9; border: 1px solid #ddd; font-family: monospace;">
          ${resetUrl}
        </p>
        
        <p style="color: #999; font-size: 12px; margin-top: 30px;">This link will expire in 1 hour.</p>
      </div>
    `;

    console.log(`[FORGOT-PASSWORD] Sending reset email to: ${email}`);
    const emailResult = await sendEmail(email, "Reset Your Password - Mobitrade", emailHtml);
    
    if (emailResult.success) {
      console.log(`[FORGOT-PASSWORD] ✅ Reset email sent successfully to ${email}`);
      console.log(`[FORGOT-PASSWORD] Message ID:`, emailResult.response?.messageId);
      res.json({ 
        message: "If an account exists with this email, a password reset link has been sent.",
        emailSent: true,
        messageId: emailResult.response?.messageId
      });
    } else {
      console.error(`[FORGOT-PASSWORD] ❌ Failed to send reset email to ${email}`);
      console.error(`[FORGOT-PASSWORD] Error:`, emailResult.error);
      console.error(`[FORGOT-PASSWORD] Error details:`, emailResult.errorDetails);
      console.error(`[FORGOT-PASSWORD] Suggestion:`, emailResult.suggestion);
      
      // Log reset token for manual use if needed (for debugging)
      console.log(`[FORGOT-PASSWORD] 🔧 DEBUG INFO:`);
      console.log(`[FORGOT-PASSWORD] Reset token for ${email}: ${resetToken}`);
      console.log(`[FORGOT-PASSWORD] Manual reset URL: ${resetUrl}`);
      console.log(`[FORGOT-PASSWORD] Token expires at: ${new Date(resetExpiry).toISOString()}`);
      
      res.json({ 
        message: "Password reset requested, but email could not be sent. Please check your email service configuration or contact support.",
        emailSent: false,
        error: emailResult.error,
        errorDetails: emailResult.errorDetails,
        suggestion: emailResult.suggestion || "Check server logs for details. Make sure RESEND_API_KEY or EMAIL_USER/EMAIL_PASS is set in environment variables."
      });
    }
  } catch (err) {
    next(err);
  }
};

// NEW: Reset password
exports.resetPassword = async (req, res, next) => {
  try {
    const { token, password } = req.body;
    
    console.log('[RESET-PASSWORD] Reset password request received');
    console.log('[RESET-PASSWORD] Token received:', token ? `${token.substring(0, 10)}...` : 'none');
    console.log('[RESET-PASSWORD] Token length:', token?.length);
    
    if (!token || !password) {
      console.error('[RESET-PASSWORD] Missing token or password');
      return res.status(400).json({ message: "Token and password are required" });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    // NEW: Debug - check what tokens exist in database
    const allUsersWithTokens = await User.find({ 
      resetPasswordToken: { $exists: true, $ne: null },
      resetPasswordExpiry: { $gt: Date.now() }
    }).select('email resetPasswordToken resetPasswordExpiry');
    
    console.log('[RESET-PASSWORD] Found', allUsersWithTokens.length, 'users with valid reset tokens');
    if (allUsersWithTokens.length > 0) {
      console.log('[RESET-PASSWORD] Sample token from DB:', allUsersWithTokens[0].resetPasswordToken?.substring(0, 20) + '...');
      console.log('[RESET-PASSWORD] Token from request:', token.substring(0, 20) + '...');
      console.log('[RESET-PASSWORD] Tokens match?', allUsersWithTokens[0].resetPasswordToken === token);
    }
    
    // NEW: Try to find user with token (exact match first)
    let user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpiry: { $gt: Date.now() }
    });
    
    // NEW: If not found, try URL-decoded token (in case email client encoded it)
    if (!user && token) {
      try {
        const decodedToken = decodeURIComponent(token);
        if (decodedToken !== token) {
          console.log('[RESET-PASSWORD] Trying URL-decoded token');
          user = await User.findOne({
            resetPasswordToken: decodedToken,
            resetPasswordExpiry: { $gt: Date.now() }
          });
        }
      } catch (e) {
        console.log('[RESET-PASSWORD] Could not decode token:', e.message);
      }
    }
    
    // NEW: If still not found, try searching without expiry check (to see if expired)
    if (!user) {
      const expiredUser = await User.findOne({ resetPasswordToken: token });
      if (expiredUser) {
        const isExpired = expiredUser.resetPasswordExpiry <= Date.now();
        console.error('[RESET-PASSWORD] Token found but expired:', isExpired);
        console.error('[RESET-PASSWORD] Expiry time:', new Date(expiredUser.resetPasswordExpiry).toISOString());
        console.error('[RESET-PASSWORD] Current time:', new Date().toISOString());
      }
    }

    if (!user) {
      console.error('[RESET-PASSWORD] Invalid or expired token');
      console.error('[RESET-PASSWORD] Token searched:', token.substring(0, 20) + '...');
      console.error('[RESET-PASSWORD] Full token length:', token.length);
      return res.status(400).json({ 
        message: "Invalid or expired reset token. Please request a new password reset link." 
      });
    }
    
    console.log('[RESET-PASSWORD] ✅ Valid token found for user:', user.email);

    // Hash new password
    const salt = await bcrypt.genSalt(12);
    user.passwordHash = await bcrypt.hash(password, salt);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpiry = undefined;
    await user.save();

    // NEW: Return user role so frontend can redirect to correct login page
    res.json({ 
      message: "Password reset successfully! You can now log in with your new password.",
      userRole: user.role // NEW: Include role for proper redirect
    });
  } catch (err) {
    next(err);
  }
};
