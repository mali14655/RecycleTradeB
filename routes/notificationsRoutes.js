const express = require("express");
const nodemailer = require("nodemailer");

const router = express.Router();

// ==================== UNIVERSAL EMAIL CONFIGURATION ====================
class UniversalEmailService {
  constructor() {
    this.transporter = null;
    this.isConfigured = false;
    this.init();
  }

  init() {
    console.log('\n📧 ========== INITIALIZING EMAIL SERVICE ==========');
    console.log('📧 Checking available email configurations...');
    
    // Check what's available
    const hasResend = !!process.env.RESEND_API_KEY;
    const hasSMTP = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
    const hasGmail = !!(process.env.EMAIL_USER && process.env.EMAIL_PASS);
    
    console.log(`📧 Resend API Key: ${hasResend ? '✅ Found' : '❌ Not set'}`);
    console.log(`📧 SMTP Config: ${hasSMTP ? '✅ Found' : '❌ Not set'}`);
    console.log(`📧 Gmail Config: ${hasGmail ? '✅ Found' : '❌ Not set'}`);
    
    // IMPORTANT: On cloud servers (Railway, Vercel, etc.), SMTP ports 587/465 are often blocked
    // Resend uses HTTPS API and works everywhere - prioritize it for production
    const transporters = [];
    
    // 1. Try Resend first (works on all servers, API-based, not SMTP)
    const resendTransporter = this.createResendTransporter();
    if (resendTransporter) {
      transporters.push(resendTransporter);
      console.log('📧 Resend transporter added (recommended for cloud servers)');
    }
    
    // 2. Try SMTP (generic, might work on some servers)
    const smtpTransporter = this.createSMTPTransporter();
    if (smtpTransporter) {
      transporters.push(smtpTransporter);
      console.log('📧 SMTP transporter added');
    }
    
    // 3. Try Gmail last (often blocked on cloud servers due to SMTP port restrictions)
    // NOTE: Gmail SMTP (ports 587/465) is often blocked on cloud platforms
    // If you're on Railway/Vercel/etc., Gmail SMTP will likely timeout
    // Solution: Use Resend.com (free tier available) or enable "Less secure app access" + use OAuth2
    if (hasGmail) {
      console.log('📧 Attempting Gmail transporter (may fail on cloud servers due to SMTP port blocking)...');
      const gmailTransporter = this.createGmailTransporter();
      if (gmailTransporter) {
        transporters.push(gmailTransporter);
        console.log('📧 Gmail transporter added (will be tested during verification)');
      } else {
        console.warn('⚠️ Gmail transporter creation failed - this is normal on cloud servers that block SMTP');
      }
    }
    
    // 4. Development fallback
    const etherealTransporter = this.createEtherealTransporter();
    if (etherealTransporter) {
      transporters.push(etherealTransporter);
      console.log('📧 Ethereal transporter added (development only)');
    }

    if (transporters.length > 0) {
      this.transporter = transporters[0];
      this.isConfigured = true;
      console.log(`✅ Email service initialized with: ${transporters[0].name}`);
      console.log(`📧 Total available transporters: ${transporters.length}`);
      
      // Verify connection in background
      this.verifyConnection();
    } else {
      console.error('❌ No email transport configured - emails will be logged only');
      console.error('❌ Please set EMAIL_USER and EMAIL_PASS for Gmail, or configure another email service');
    }
    
    console.log('📧 ================================================\n');
  }

  // 1. RESEND.COM (Most reliable - works on any server)
  createResendTransporter() {
    if (process.env.RESEND_API_KEY) {
      const transporter = nodemailer.createTransport({
        host: 'smtp.resend.com',
        port: 587,
        secure: false,
        auth: {
          user: 'resend',
          pass: process.env.RESEND_API_KEY
        },
        connectionTimeout: 10000, // 10 seconds
        greetingTimeout: 5000,    // 5 seconds
        socketTimeout: 10000,      // 10 seconds
        tls: {
          rejectUnauthorized: false
        }
      });
      transporter.name = 'Resend';
      return transporter;
    }
    return null;
  }

  // 2. GENERIC SMTP (Works with any SMTP provider)
  createSMTPTransporter() {
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        },
        connectionTimeout: 10000,  // Reduced to 10 seconds
        greetingTimeout: 5000,     // Reduced to 5 seconds
        socketTimeout: 10000,       // Reduced to 10 seconds
        tls: {
          rejectUnauthorized: false
        }
      });
      transporter.name = 'SMTP';
      return transporter;
    }
    return null;
  }

  // 3. GMAIL (Common but less reliable in cloud)
  createGmailTransporter() {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.log('📧 Gmail: EMAIL_USER or EMAIL_PASS not set, skipping Gmail transporter');
      return null;
    }

    console.log('📧 Gmail: Attempting to create Gmail transporter...');
    console.log('📧 Gmail: Using email:', process.env.EMAIL_USER);
    console.log('📧 Gmail: Password provided:', process.env.EMAIL_PASS ? 'Yes (hidden)' : 'No');

    const portsToTry = [
      { port: 587, secure: false, name: 'STARTTLS' },
      { port: 465, secure: true, name: 'SSL/TLS' }
    ];

    for (const config of portsToTry) {
      try {
        console.log(`📧 Gmail: Trying port ${config.port} (${config.name})...`);
        
        const transporter = nodemailer.createTransport({
          host: 'smtp.gmail.com',
          port: config.port,
          secure: config.secure,
          auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
          },
          connectionTimeout: 15000, // 15 seconds
          greetingTimeout: 10000,   // 10 seconds
          socketTimeout: 15000,     // 15 seconds
          tls: {
            rejectUnauthorized: false,
            ciphers: 'SSLv3'
          },
          debug: true, // Enable debug logging
          logger: true  // Enable logger
        });
        
        transporter.name = `Gmail (port ${config.port})`;
        console.log(`✅ Gmail: Transporter created for port ${config.port}`);
        return transporter;
      } catch (error) {
        console.error(`❌ Gmail: Failed to create transporter on port ${config.port}:`, error.message);
        continue;
      }
    }
    
    console.error('❌ Gmail: All port attempts failed');
    return null;
  }

  // 4. ETHEREAL (Development/Testing fallback)
  createEtherealTransporter() {
    if (process.env.NODE_ENV === 'development') {
      const transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: 'test@ethereal.email',
          pass: 'test'
        }
      });
      transporter.name = 'Ethereal (Test)';
      return transporter;
    }
    return null;
  }

  async verifyConnection() {
    if (!this.transporter) {
      console.log('📧 Verify: No transporter available to verify');
      return;
    }
    
    console.log(`📧 Verify: Starting connection verification for ${this.transporter.name}...`);
    
    // Don't block - verify in background with timeout
    setTimeout(async () => {
      try {
        console.log(`📧 Verify: Attempting to verify ${this.transporter.name} connection...`);
        
        // Use Promise.race to add timeout to verification
        const verifyPromise = this.transporter.verify();
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Verification timeout after 10 seconds')), 10000)
        );
        
        await Promise.race([verifyPromise, timeoutPromise]);
        console.log(`✅ Verify: Email connection verified successfully for ${this.transporter.name}`);
      } catch (error) {
        const errorMsg = error.message || 'Unknown error';
        console.error(`❌ Verify: Email connection verification FAILED for ${this.transporter.name}`);
        console.error(`❌ Verify: Error details:`, {
          message: errorMsg,
          code: error.code,
          command: error.command,
          response: error.response,
          responseCode: error.responseCode
        });
        
        // Log specific error types
        if (errorMsg.includes('timeout') || errorMsg.includes('ETIMEDOUT')) {
          console.error(`❌ Verify: Connection timeout - Gmail server not responding`);
          console.error(`❌ Verify: This usually means:`);
          console.error(`   - Your cloud server (Railway/Vercel/etc.) is BLOCKING SMTP ports 587/465`);
          console.error(`   - Gmail SMTP will NOT work on most cloud platforms`);
          console.error(`   - Network connectivity issues`);
          console.error(`\n💡 SOLUTION: Use Resend.com (API-based, works everywhere)`);
          console.error(`   - Sign up at https://resend.com (free tier: 3,000 emails/month)`);
          console.error(`   - Get API key and set: RESEND_API_KEY=re_your_key`);
          console.error(`   - See EMAIL_SETUP_GUIDE.md for details`);
        } else if (errorMsg.includes('EAUTH') || errorMsg.includes('authentication')) {
          console.error(`❌ Verify: Authentication failed - check EMAIL_USER and EMAIL_PASS`);
          console.error(`❌ Verify: Make sure you're using an App Password, not your regular password`);
        } else if (errorMsg.includes('ECONNREFUSED')) {
          console.error(`❌ Verify: Connection refused - Gmail server not reachable`);
        } else {
          console.error(`❌ Verify: Unknown error: ${errorMsg}`);
        }
      }
    }, 2000); // Wait 2 seconds before verifying to not block startup
  }

  async sendEmail(mailOptions) {
    const defaultFrom = {
      name: 'RecycleTrade',
      address: process.env.EMAIL_FROM || process.env.EMAIL_USER || process.env.SMTP_USER || 'noreply@recycletrade.com'
    };

    const options = {
      from: mailOptions.from || defaultFrom,
      to: mailOptions.to,
      subject: mailOptions.subject,
      html: mailOptions.html,
      text: mailOptions.text
    };

    // If no transporter, log the email (never fail)
    if (!this.isConfigured || !this.transporter) {
      console.log('📧 EMAIL LOGGED (No transporter):', {
        to: options.to,
        subject: options.subject,
        html: options.html.substring(0, 100) + '...'
      });
      return { messageId: 'logged-only', accepted: [options.to] };
    }

    try {
      console.log(`📧 Send: Attempting to send email via ${this.transporter.name}...`);
      console.log(`📧 Send: To: ${options.to}`);
      console.log(`📧 Send: Subject: ${options.subject}`);
      console.log(`📧 Send: From: ${typeof options.from === 'object' ? options.from.address : options.from}`);
      
      // Add timeout wrapper to prevent hanging
      const sendPromise = this.transporter.sendMail(options);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Email send timeout after 20 seconds')), 20000)
      );
      
      const result = await Promise.race([sendPromise, timeoutPromise]);
      console.log(`✅ Send: Email sent successfully via ${this.transporter.name}`);
      console.log(`✅ Send: Message ID: ${result.messageId}`);
      console.log(`✅ Send: Accepted recipients: ${result.accepted?.join(', ') || 'N/A'}`);
      if (result.rejected && result.rejected.length > 0) {
        console.warn(`⚠️ Send: Rejected recipients: ${result.rejected.join(', ')}`);
      }
      return result;
    } catch (error) {
      // Comprehensive error logging
      const errorMsg = error.message || 'Unknown error';
      const errorCode = error.code || 'NO_CODE';
      const isTimeout = errorMsg.includes('timeout') || errorMsg.includes('ETIMEDOUT') || errorCode === 'ETIMEDOUT';
      const isAuthError = errorMsg.includes('EAUTH') || errorMsg.includes('authentication') || errorCode === 'EAUTH';
      const isConnectionError = errorMsg.includes('ECONNREFUSED') || errorMsg.includes('ENOTFOUND') || errorCode === 'ECONNREFUSED';
      
      console.error(`\n❌ ========== EMAIL SEND FAILED ==========`);
      console.error(`❌ Transporter: ${this.transporter.name}`);
      console.error(`❌ To: ${options.to}`);
      console.error(`❌ Subject: ${options.subject}`);
      console.error(`❌ Error Message: ${errorMsg}`);
      console.error(`❌ Error Code: ${errorCode}`);
      
      if (isTimeout) {
        console.error(`❌ Error Type: CONNECTION TIMEOUT`);
        console.error(`❌ Details: Email server did not respond within 20 seconds`);
        console.error(`❌ Possible causes:`);
        console.error(`   - Gmail SMTP servers are blocking your connection`);
        console.error(`   - Firewall or network blocking port 587/465`);
        console.error(`   - Server network connectivity issues`);
        console.error(`   - Gmail rate limiting or blocking`);
      } else if (isAuthError) {
        console.error(`❌ Error Type: AUTHENTICATION FAILED`);
        console.error(`❌ Details: Invalid email credentials`);
        console.error(`❌ Possible causes:`);
        console.error(`   - Wrong EMAIL_USER or EMAIL_PASS`);
        console.error(`   - Using regular password instead of App Password`);
        console.error(`   - 2FA not enabled or App Password not generated`);
        console.error(`   - Account security settings blocking access`);
      } else if (isConnectionError) {
        console.error(`❌ Error Type: CONNECTION REFUSED`);
        console.error(`❌ Details: Cannot reach Gmail SMTP server`);
        console.error(`❌ Possible causes:`);
        console.error(`   - Network connectivity issues`);
        console.error(`   - DNS resolution problems`);
        console.error(`   - Firewall blocking outbound connections`);
      } else {
        console.error(`❌ Error Type: UNKNOWN ERROR`);
        console.error(`❌ Full Error:`, error);
      }
      
      console.error(`❌ ========================================\n`);
      
      // Log email content that failed
      console.log('📧 FAILED EMAIL DETAILS:', {
        to: options.to,
        subject: options.subject,
        from: typeof options.from === 'object' ? options.from.address : options.from,
        error: errorMsg,
        errorCode: errorCode
      });
      
      // Re-throw the error so caller knows it failed
      throw error;
    }
  }
}

// Initialize email service
const emailService = new UniversalEmailService();

// ==================== HELPER FUNCTIONS ====================
const getOrderShortId = (order) => {
  try {
    const orderId = order._id?.toString ? order._id.toString() : String(order._id);
    return orderId.slice(-8);
  } catch (error) {
    return 'N/A';
  }
};

// ==================== EMAIL ROUTES ====================

// Test endpoint to check email configuration
router.get("/test-config", async (req, res) => {
  const config = {
    availableServices: {
      resend: !!process.env.RESEND_API_KEY,
      smtp: !!(process.env.SMTP_HOST && process.env.SMTP_USER),
      gmail: !!(process.env.EMAIL_USER && process.env.EMAIL_PASS),
      ethereal: process.env.NODE_ENV === 'development'
    },
    currentService: emailService.transporter?.name || 'none',
    isConfigured: emailService.isConfigured,
    fromEmail: process.env.EMAIL_FROM || process.env.EMAIL_USER || process.env.SMTP_USER,
    emailUser: process.env.EMAIL_USER ? `${process.env.EMAIL_USER.substring(0, 3)}***` : 'Not set',
    hasEmailPass: !!process.env.EMAIL_PASS
  };

  res.json(config);
});

// NEW: Debug endpoint to test Gmail connection and sending
router.get("/debug-email", async (req, res) => {
  try {
    console.log('\n🔍 ========== EMAIL DEBUG TEST ==========');
    
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      return res.json({ 
        success: false, 
        error: 'EMAIL_USER or EMAIL_PASS not set in environment variables',
        config: {
          hasEmailUser: !!process.env.EMAIL_USER,
          hasEmailPass: !!process.env.EMAIL_PASS,
          emailUser: process.env.EMAIL_USER || 'Not set'
        }
      });
    }

    console.log('🔍 Testing Gmail connection...');
    console.log('🔍 Email User:', process.env.EMAIL_USER);
    console.log('🔍 Password provided:', process.env.EMAIL_PASS ? 'Yes' : 'No');

    // Create test transporter
    const testTransporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      },
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      tls: {
        rejectUnauthorized: false,
        ciphers: 'SSLv3'
      },
      debug: true,
      logger: true
    });

    console.log('🔍 Step 1: Testing connection verification...');
    
    // Test connection with timeout
    const verifyPromise = testTransporter.verify();
    const verifyTimeout = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Verification timeout after 15 seconds')), 15000)
    );
    
    try {
      await Promise.race([verifyPromise, verifyTimeout]);
      console.log('✅ Step 1: Connection verification successful');
    } catch (verifyError) {
      console.error('❌ Step 1: Connection verification failed:', verifyError.message);
      return res.json({ 
        success: false, 
        step: 'connection_verification',
        error: verifyError.message,
        errorCode: verifyError.code,
        details: {
          message: 'Cannot connect to Gmail SMTP server',
          possibleCauses: [
            'Wrong EMAIL_USER or EMAIL_PASS',
            'Using regular password instead of App Password',
            '2FA not enabled or App Password not generated',
            'Firewall blocking port 587',
            'Network connectivity issues',
            'Gmail blocking the connection'
          ]
        }
      });
    }

    console.log('🔍 Step 2: Testing email send...');
    const testEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USER;
    
    // Test send with timeout
    const sendPromise = testTransporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: testEmail,
      subject: 'Gmail Connection Test - RecycleTrade',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>✅ Gmail Connection Test Successful!</h2>
          <p>If you received this email, your Gmail configuration is working correctly.</p>
          <p><strong>Test Time:</strong> ${new Date().toLocaleString()}</p>
          <p><strong>Server:</strong> ${process.env.NODE_ENV || 'development'}</p>
        </div>
      `
    });
    
    const sendTimeout = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Send timeout after 20 seconds')), 20000)
    );
    
    try {
      const result = await Promise.race([sendPromise, sendTimeout]);
      console.log('✅ Step 2: Email send successful');
      console.log('✅ Message ID:', result.messageId);
      console.log('🔍 ============================================\n');
      
      return res.json({ 
        success: true, 
        message: 'Gmail connection and email sending working correctly!',
        messageId: result.messageId,
        sentTo: testEmail,
        transporter: 'Gmail (port 587)'
      });
    } catch (sendError) {
      console.error('❌ Step 2: Email send failed:', sendError.message);
      console.error('🔍 ============================================\n');
      
      return res.json({ 
        success: false, 
        step: 'email_send',
        error: sendError.message,
        errorCode: sendError.code,
        details: {
          message: 'Connection verified but email sending failed',
          possibleCauses: [
            'Gmail rate limiting',
            'Email address not verified',
            'Account security restrictions',
            'Network issues during send'
          ]
        }
      });
    }
  } catch (error) {
    console.error('❌ Debug test failed:', error.message);
    return res.status(500).json({ 
      success: false, 
      error: error.message,
      errorCode: error.code
    });
  }
});

// Send test email
router.post("/test-email", async (req, res) => {
  try {
    const { to = process.env.ADMIN_EMAIL } = req.body;

    if (!to) {
      return res.status(400).json({ 
        message: "No recipient email provided" 
      });
    }

    const result = await emailService.sendEmail({
      to,
      subject: 'Test Email from RecycleTrade',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #10B981;">✅ Test Email Successful!</h2>
          <p>This is a test email from your RecycleTrade application.</p>
          <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <h3>Configuration Details:</h3>
            <p><strong>Service:</strong> ${emailService.transporter?.name || 'Logged Only'}</p>
            <p><strong>Time:</strong> ${new Date().toString()}</p>
            <p><strong>Environment:</strong> ${process.env.NODE_ENV}</p>
          </div>
          <p>If you received this, your email service is working correctly! 🎉</p>
        </div>
      `
    });

    res.json({
      message: "Test email processed successfully",
      service: emailService.transporter?.name || 'logged',
      messageId: result.messageId,
      accepted: result.accepted
    });
  } catch (error) {
    res.status(500).json({
      message: "Test email failed",
      error: error.message
    });
  }
});

// NEW: Reusable function to send order confirmation email (can be called directly)
const sendOrderConfirmationEmail = async (order, customer) => {
  if (!customer.email) {
    console.log('⚠️ No customer email provided, skipping order confirmation');
    return { skipped: true, message: "No customer email provided" };
  }

  try {
    console.log('📧 Sending order confirmation email...', {
      customerEmail: customer.email,
      orderId: order._id
    });

    const shortOrderId = getOrderShortId(order);
    
    // Format order date
    const orderDate = order.createdAt 
      ? new Date(order.createdAt).toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      : new Date().toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });

    // Build items HTML
    let itemsHtml = '';
    if (order.items && Array.isArray(order.items)) {
      itemsHtml = order.items.map((item, index) => {
        const productName = item.productId?.name || item.name || 'Product';
        const quantity = item.quantity || 1;
        const price = item.price || 0;
        const subtotal = price * quantity;
        
        // Get variant specs if available
        let variantInfo = '';
        if (item.variantId && item.productId?.variants) {
          const variant = item.productId.variants.find(v => 
            v._id?.toString() === item.variantId?.toString()
          );
          if (variant && variant.specs) {
            const specs = variant.specs instanceof Map 
              ? Object.fromEntries(variant.specs) 
              : variant.specs;
            const specsText = Object.entries(specs)
              .map(([key, value]) => `${key}: ${value}`)
              .join(', ');
            if (specsText) {
              variantInfo = `<p style="font-size: 12px; color: #6b7280; margin: 4px 0 0 0;">${specsText}</p>`;
            }
          }
        }
        
        return `
          <tr style="border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 12px; text-align: left;">
              <strong>${productName}</strong>
              ${variantInfo}
            </td>
            <td style="padding: 12px; text-align: center;">${quantity}</td>
            <td style="padding: 12px; text-align: right;">$${price.toFixed(2)}</td>
            <td style="padding: 12px; text-align: right; font-weight: bold;">$${subtotal.toFixed(2)}</td>
          </tr>
        `;
      }).join('');
    }

    // Payment status
    const paymentStatus = order.paymentStatus === 'Paid' 
      ? '<span style="color: #059669; font-weight: bold;">Paid</span>' 
      : '<span style="color: #d97706; font-weight: bold;">Pending</span>';

    // Delivery/Shipping info
    let deliveryInfo = '';
    if (order.deliveryMethod === 'pickup' && order.outletId) {
      deliveryInfo = `
        <div style="background: #fef3c7; padding: 15px; border-radius: 8px; margin: 15px 0;">
          <h4 style="color: #d97706; margin-top: 0;">Pickup Information</h4>
          <p><strong>Outlet:</strong> ${order.outletId.name || 'Selected Outlet'}</p>
          <p><strong>Address:</strong> ${order.outletId.address || 'N/A'}</p>
          <p><strong>Phone:</strong> ${order.outletId.phone || 'N/A'}</p>
          ${order.outletId.email ? `<p><strong>Email:</strong> ${order.outletId.email}</p>` : ''}
        </div>
      `;
    } else if (order.guestInfo?.address) {
      deliveryInfo = `
        <div style="background: #f0f9ff; padding: 15px; border-radius: 8px; margin: 15px 0;">
          <h4 style="color: #0284c7; margin-top: 0;">Delivery Address</h4>
          <p>${order.guestInfo.address}</p>
          <p>${order.guestInfo.postalCode || ''} ${order.guestInfo.country || ''}</p>
        </div>
      `;
    }

    const result = await emailService.sendEmail({
      to: customer.email,
      subject: `Order Confirmation - #${shortOrderId}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Thank You for Your Order!</h1>
            <p style="color: #d1fae5; margin: 10px 0 0 0; font-size: 16px;">Order #${shortOrderId}</p>
          </div>

          <!-- Content -->
          <div style="padding: 30px; background: #ffffff;">
            <p style="font-size: 16px; color: #374151; margin: 0 0 20px 0;">Dear ${customer.name},</p>
            <p style="font-size: 16px; color: #374151; margin: 0 0 30px 0;">Your order has been received and is being processed. We'll send you another email when your order ships.</p>
            
            <!-- Order Details -->
            <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #10b981;">
              <h3 style="margin-top: 0; color: #111827; font-size: 18px;">Order Details</h3>
              <table style="width: 100%; margin: 10px 0;">
                <tr>
                  <td style="padding: 6px 0; color: #6b7280;"><strong>Order ID:</strong></td>
                  <td style="padding: 6px 0; color: #111827; text-align: right;"><strong>#${shortOrderId}</strong></td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #6b7280;"><strong>Order Date:</strong></td>
                  <td style="padding: 6px 0; color: #111827; text-align: right;">${orderDate}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #6b7280;"><strong>Payment Method:</strong></td>
                  <td style="padding: 6px 0; color: #111827; text-align: right;">${order.paymentMethod || 'N/A'}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #6b7280;"><strong>Payment Status:</strong></td>
                  <td style="padding: 6px 0; text-align: right;">${paymentStatus}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #6b7280;"><strong>Delivery Method:</strong></td>
                  <td style="padding: 6px 0; color: #111827; text-align: right;">${order.deliveryMethod === 'delivery' ? 'Home Delivery' : 'Outlet Pickup'}</td>
                </tr>
              </table>
            </div>

            <!-- Order Items -->
            <div style="margin: 30px 0;">
              <h3 style="color: #111827; font-size: 18px; margin-bottom: 15px;">Order Items</h3>
              <table style="width: 100%; border-collapse: collapse; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
                <thead>
                  <tr style="background: #f9fafb;">
                    <th style="padding: 12px; text-align: left; font-weight: 600; color: #374151; border-bottom: 2px solid #e5e7eb;">Product</th>
                    <th style="padding: 12px; text-align: center; font-weight: 600; color: #374151; border-bottom: 2px solid #e5e7eb;">Qty</th>
                    <th style="padding: 12px; text-align: right; font-weight: 600; color: #374151; border-bottom: 2px solid #e5e7eb;">Price</th>
                    <th style="padding: 12px; text-align: right; font-weight: 600; color: #374151; border-bottom: 2px solid #e5e7eb;">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsHtml}
                </tbody>
                <tfoot>
                  <tr style="background: #f9fafb; border-top: 2px solid #e5e7eb;">
                    <td colspan="3" style="padding: 15px; text-align: right; font-weight: 600; color: #374151;">Total:</td>
                    <td style="padding: 15px; text-align: right; font-weight: bold; font-size: 18px; color: #111827;">$${order.total?.toFixed(2) || '0.00'}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            ${deliveryInfo}

            <!-- Footer -->
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; font-size: 14px; margin: 10px 0;">We'll notify you when your order status changes.</p>
              <p style="color: #6b7280; font-size: 14px; margin: 10px 0;">If you have any questions, please contact our support team.</p>
              <p style="margin-top: 20px; color: #111827; font-weight: 600;">Best regards,<br><strong>RecycleTrade Team</strong></p>
            </div>
          </div>

          <!-- Footer Bar -->
          <div style="background: #f9fafb; padding: 20px; text-align: center; border-radius: 0 0 8px 8px; border-top: 1px solid #e5e7eb;">
            <p style="color: #6b7280; font-size: 12px; margin: 0;">© ${new Date().getFullYear()} RecycleTrade. All rights reserved.</p>
          </div>
        </div>
      `
    });
    
    return {
      success: true,
      message: "Order confirmation processed successfully",
      messageId: result.messageId,
      service: emailService.transporter?.name || 'logged'
    };
  } catch (error) {
    console.error("❌ Error sending order confirmation:", error);
    throw error; // Re-throw to let caller handle
  }
};

// Route handler that uses the function above
router.post("/send-order-confirmation", async (req, res) => {
  try {
    const { order, customer } = req.body;
    const result = await sendOrderConfirmationEmail(order, customer);
    
    if (result.skipped) {
      return res.json(result);
    }
    
    res.json(result);
  } catch (error) {
    console.error("❌ Error in order confirmation route:", error);
    res.status(500).json({ 
      message: "Failed to process order confirmation", 
      error: error.message 
    });
  }
});

// NEW: Reusable function to send status update email (can be called directly)
const sendStatusUpdateEmail = async (to, order, customerName, status, trackingNumber = null) => {
  if (!to) {
    console.log('⚠️ No recipient email provided, skipping status update email');
    return { skipped: true, message: "No recipient email provided" };
  }

  try {

    const shortOrderId = getOrderShortId(order);
    const subject = `Order Status Update - #${shortOrderId}`;
    
    // Status color and icon
    let statusColor = '#059669';
    let statusIcon = '✅';
    let statusMessage = '';
    
    if (status === 'Shipped' || status === 'Processing') {
      statusColor = '#0284c7';
      statusIcon = '🚚';
      statusMessage = 'Your order is on the way!';
    } else if (status === 'Ready for Pickup') {
      statusColor = '#d97706';
      statusIcon = '📦';
      statusMessage = 'Your order is ready for pickup!';
    } else if (status === 'Delivered' || status === 'Completed') {
      statusColor = '#059669';
      statusIcon = '🎉';
      statusMessage = 'Your order has been delivered!';
    } else {
      statusMessage = 'Your order status has been updated.';
    }

    // Build items summary
    let itemsSummary = '';
    if (order.items && Array.isArray(order.items)) {
      itemsSummary = order.items.map((item, index) => {
        const productName = item.productId?.name || item.name || 'Product';
        const quantity = item.quantity || 1;
        return `<li style="margin: 5px 0;">${productName} × ${quantity}</li>`;
      }).join('');
    }

    let htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, ${statusColor} 0%, ${statusColor}dd 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
          <div style="font-size: 48px; margin-bottom: 10px;">${statusIcon}</div>
          <h1 style="color: #ffffff; margin: 0; font-size: 28px;">${statusMessage}</h1>
          <p style="color: #ffffffdd; margin: 10px 0 0 0; font-size: 16px;">Order #${shortOrderId}</p>
        </div>

        <!-- Content -->
        <div style="padding: 30px; background: #ffffff;">
          <p style="font-size: 16px; color: #374151; margin: 0 0 20px 0;">Dear ${customerName},</p>
          <p style="font-size: 16px; color: #374151; margin: 0 0 30px 0;">We wanted to let you know that your order status has been updated.</p>
          
          <!-- Status Card -->
          <div style="background: #f0f9ff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid ${statusColor};">
            <h3 style="margin-top: 0; color: #111827; font-size: 18px;">Order Status</h3>
            <table style="width: 100%; margin: 10px 0;">
              <tr>
                <td style="padding: 6px 0; color: #6b7280;"><strong>Order ID:</strong></td>
                <td style="padding: 6px 0; color: #111827; text-align: right;"><strong>#${shortOrderId}</strong></td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #6b7280;"><strong>Status:</strong></td>
                <td style="padding: 6px 0; text-align: right;"><span style="color: ${statusColor}; font-weight: bold; font-size: 16px;">${status}</span></td>
              </tr>
    `;

    if (trackingNumber) {
      htmlContent += `
              <tr>
                <td style="padding: 6px 0; color: #6b7280;"><strong>Tracking Number:</strong></td>
                <td style="padding: 6px 0; color: #111827; text-align: right;"><strong>${trackingNumber}</strong></td>
              </tr>
              <tr>
                <td colspan="2" style="padding: 10px 0; text-align: center;">
                  <a href="https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}" 
                     style="display: inline-block; background: ${statusColor}; color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: 600; margin-top: 10px;">
                    Track Your Package
                  </a>
                </td>
              </tr>
      `;
    }

    htmlContent += `
            </table>
          </div>

          <!-- Order Items Summary -->
          ${itemsSummary ? `
          <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #111827; font-size: 18px;">Order Items</h3>
            <ul style="margin: 10px 0; padding-left: 20px; color: #374151;">
              ${itemsSummary}
            </ul>
            <p style="margin: 15px 0 0 0; font-weight: 600; color: #111827;">Total: $${order.total?.toFixed(2) || '0.00'}</p>
          </div>
          ` : ''}
    `;

    // Add specific information based on status
    if (status === 'Shipped' && trackingNumber) {
      htmlContent += `
          <div style="background: #fef3c7; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #d97706;">
            <h3 style="color: #d97706; margin-top: 0;">📦 Shipping Information</h3>
            <p style="color: #374151; margin: 10px 0;">Your order has been shipped and is on its way to you!</p>
            <p style="color: #374151; margin: 10px 0;">You can track your package using the tracking number above.</p>
            <p style="color: #374151; margin: 10px 0;"><strong>Expected Delivery:</strong> Please allow 3-5 business days for delivery.</p>
          </div>
      `;
    } else if (status === 'Ready for Pickup') {
      htmlContent += `
          <div style="background: #fef3c7; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #d97706;">
            <h3 style="color: #d97706; margin-top: 0;">📍 Pickup Information</h3>
            <p style="color: #374151; margin: 10px 0;">Your order is ready for pickup at the following location:</p>
            <div style="background: #ffffff; padding: 15px; border-radius: 6px; margin: 15px 0;">
              <p style="margin: 8px 0; font-weight: 600; color: #111827; font-size: 16px;">${order.outletId?.name || 'Selected Outlet'}</p>
              <p style="margin: 8px 0; color: #374151;">${order.outletId?.address || 'Outlet address'}</p>
              ${order.outletId?.phone ? `<p style="margin: 8px 0; color: #374151;">📞 Phone: ${order.outletId.phone}</p>` : ''}
              ${order.outletId?.email ? `<p style="margin: 8px 0; color: #374151;">✉️ Email: ${order.outletId.email}</p>` : ''}
            </div>
            <p style="color: #374151; margin: 15px 0 0 0;"><strong>Please bring a valid ID when picking up your order.</strong></p>
          </div>
      `;
    } else if (status === 'Delivered' || status === 'Completed') {
      htmlContent += `
          <div style="background: #d1fae5; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #059669;">
            <h3 style="color: #059669; margin-top: 0;">🎉 Delivery Complete!</h3>
            <p style="color: #374151; margin: 10px 0;">Your order has been successfully delivered. We hope you enjoy your purchase!</p>
            <p style="color: #374151; margin: 15px 0 0 0;">If you have any questions or concerns, please don't hesitate to contact our support team.</p>
          </div>
      `;
    }

    htmlContent += `
          <!-- Footer -->
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            <p style="color: #6b7280; font-size: 14px; margin: 10px 0;">If you have any questions about your order, please contact our support team.</p>
            <p style="margin-top: 20px; color: #111827; font-weight: 600;">Best regards,<br><strong>RecycleTrade Team</strong></p>
          </div>
        </div>

        <!-- Footer Bar -->
        <div style="background: #f9fafb; padding: 20px; text-align: center; border-radius: 0 0 8px 8px; border-top: 1px solid #e5e7eb;">
          <p style="color: #6b7280; font-size: 12px; margin: 0;">© ${new Date().getFullYear()} RecycleTrade. All rights reserved.</p>
        </div>
      </div>
    `;

    const result = await emailService.sendEmail({
      to,
      subject,
      html: htmlContent
    });

    console.log("✅ Status update email sent to:", to);
    return {
      success: true,
      message: "Status update email processed successfully",
      messageId: result.messageId,
      service: emailService.transporter?.name || 'logged'
    };
  } catch (error) {
    console.error("❌ Error sending status email:", error);
    throw error; // Re-throw to let caller handle
  }
};

// Route handler that uses the function above
router.post("/send-status-email", async (req, res) => {
  try {
    const { to, order, customerName, status, trackingNumber } = req.body;
    const result = await sendStatusUpdateEmail(to, order, customerName, status, trackingNumber);
    
    if (result.skipped) {
      return res.json(result);
    }
    
    res.json(result);
  } catch (error) {
    console.error("❌ Error in status email route:", error);
    res.status(500).json({ 
      message: "Failed to process status update email",
      error: error.message 
    });
  }
});

// 3. GENERIC EMAIL SENDER
router.post("/send-email", async (req, res) => {
  try {
    const { to, subject, html } = req.body;

    if (!to || !subject || !html) {
      return res.status(400).json({
        message: "Missing required fields: to, subject, html"
      });
    }

    const result = await emailService.sendEmail({
      to,
      subject,
      html
    });

    console.log("✅ Generic email sent to:", to);
    res.json({ 
      message: "Email processed successfully",
      messageId: result.messageId,
      service: emailService.transporter?.name || 'logged'
    });
  } catch (error) {
    console.error("❌ Error sending email:", error);
    res.status(500).json({ 
      message: "Failed to process email",
      error: error.message 
    });
  }
});

// Export router as default
module.exports = router;
// Also export functions for direct use
module.exports.sendOrderConfirmationEmail = sendOrderConfirmationEmail;
module.exports.sendStatusUpdateEmail = sendStatusUpdateEmail;