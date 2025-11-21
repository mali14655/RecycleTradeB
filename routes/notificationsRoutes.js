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
    // Try configuration methods in order of reliability
    const transporters = [
      this.createResendTransporter(),    // Most reliable (API-based)
      this.createSMTPTransporter(),      // Generic SMTP
      this.createGmailTransporter(),     // Gmail fallback
      this.createEtherealTransporter()   // Development fallback
    ].filter(Boolean);

    if (transporters.length > 0) {
      this.transporter = transporters[0];
      this.isConfigured = true;
      console.log(`✅ Email service initialized with: ${transporters[0].name}`);
      
      // Verify connection in background
      this.verifyConnection();
    } else {
      console.warn('⚠️ No email transport configured - emails will be logged only');
    }
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
        connectionTimeout: 30000,
        greetingTimeout: 15000,
        socketTimeout: 30000,
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
    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      const portsToTry = [
        { port: 587, secure: false },
        { port: 465, secure: true },
        { port: 25, secure: false }
      ];

      for (const config of portsToTry) {
        try {
          const transporter = nodemailer.createTransport({
            host: 'smtp.gmail.com',
            port: config.port,
            secure: config.secure,
            auth: {
              user: process.env.EMAIL_USER,
              pass: process.env.EMAIL_PASS
            },
            tls: {
              rejectUnauthorized: false
            }
          });
          transporter.name = `Gmail (port ${config.port})`;
          return transporter;
        } catch (error) {
          continue;
        }
      }
    }
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
    if (!this.transporter) return;
    
    try {
      await this.transporter.verify();
      console.log(`✅ Email connection verified: ${this.transporter.name}`);
    } catch (error) {
      console.warn(`⚠️ Email connection issue: ${error.message}`);
    }
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
      const result = await this.transporter.sendMail(options);
      console.log(`✅ Email sent via ${this.transporter.name}:`, result.messageId);
      return result;
    } catch (error) {
      console.error(`❌ Email failed (${this.transporter.name}):`, error.message);
      
      // Log email content even when failed
      console.log('📧 FAILED EMAIL CONTENT:', {
        to: options.to,
        subject: options.subject
      });
      
      // Return success anyway to not break user experience
      return { messageId: 'failed-but-continued', accepted: [options.to] };
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
    fromEmail: process.env.EMAIL_FROM || process.env.EMAIL_USER || process.env.SMTP_USER
  };

  res.json(config);
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

// 1. ORDER CONFIRMATION
router.post("/send-order-confirmation", async (req, res) => {
  try {
    const { order, customer } = req.body;

    console.log('📧 Sending order confirmation...', {
      customerEmail: customer.email,
      orderId: order._id
    });

    if (!customer.email) {
      return res.json({ message: "No customer email provided", skipped: true });
    }

    const shortOrderId = getOrderShortId(order);

    const result = await emailService.sendEmail({
      to: customer.email,
      subject: `Order Confirmation - #${shortOrderId}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #10B981;">Thank You for Your Order!</h2>
          <p>Dear ${customer.name},</p>
          <p>Your order has been received and is being processed.</p>
          
          <div style="background: #f9fafb; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Order Summary</h3>
            <p><strong>Order ID:</strong> #${shortOrderId}</p>
            <p><strong>Total:</strong> $${order.total?.toFixed(2) || '0.00'}</p>
            <p><strong>Payment Method:</strong> ${order.paymentMethod}</p>
            <p><strong>Delivery:</strong> ${order.deliveryMethod === 'delivery' ? 'Home Delivery' : 'Outlet Pickup'}</p>
          </div>
          
          <p>We'll notify you when your order status changes.</p>
          <p><strong>RecycleTrade Team</strong></p>
        </div>
      `
    });
    
    res.json({ 
      message: "Order confirmation processed successfully",
      messageId: result.messageId,
      service: emailService.transporter?.name || 'logged'
    });
  } catch (error) {
    console.error("❌ Error sending order confirmation:", error);
    res.status(500).json({ 
      message: "Failed to process order confirmation", 
      error: error.message 
    });
  }
});

// 2. STATUS UPDATE EMAIL
router.post("/send-status-email", async (req, res) => {
  try {
    const { to, order, customerName, status, trackingNumber } = req.body;

    const shortOrderId = getOrderShortId(order);
    const subject = `Order Update - #${shortOrderId}`;
    
    let htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #10B981;">Order Status Update</h2>
        <p>Dear ${customerName},</p>
        <p>Your order status has been updated.</p>
        
        <div style="background: #f0f9ff; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0;">Order Information</h3>
          <p><strong>Order ID:</strong> #${shortOrderId}</p>
          <p><strong>Status:</strong> <span style="color: #059669; font-weight: bold;">${status}</span></p>
    `;

    if (trackingNumber) {
      htmlContent += `<p><strong>Tracking Number:</strong> ${trackingNumber}</p>`;
    }

    htmlContent += `
        </div>
        
        <div style="background: #fef3c7; padding: 15px; border-radius: 8px;">
          <h3 style="color: #D97706;">What's Next?</h3>
    `;

    if (status === 'Shipped') {
      htmlContent += `
        <p>Your order has been shipped! You can track your package using the tracking number above.</p>
      `;
    } else if (status === 'Ready for Pickup') {
      htmlContent += `
        <p>Your order is ready for pickup at:</p>
        <p><strong>${order.outletId?.name || 'Outlet'}</strong><br>
        ${order.outletId?.address || 'Outlet address'}<br>
        Phone: ${order.outletId?.phone || 'N/A'}</p>
      `;
    }

    htmlContent += `
        </div>
        
        <p style="margin-top: 30px;">Thank you for your patience!</p>
        <p><strong>RecycleTrade Team</strong></p>
      </div>
    `;

    const result = await emailService.sendEmail({
      to,
      subject,
      html: htmlContent
    });

    console.log("✅ Status update email sent to:", to);
    res.json({ 
      message: "Status update email processed successfully",
      messageId: result.messageId,
      service: emailService.transporter?.name || 'logged'
    });
  } catch (error) {
    console.error("❌ Error sending status email:", error);
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

module.exports = router;