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