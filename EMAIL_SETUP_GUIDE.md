# Email Setup Guide - RecycleTrade

## 🚨 IMPORTANT: Cloud Server SMTP Blocking

**Your server is blocking SMTP connections (ports 587/465).** This is common on:
- Railway
- Vercel
- Heroku
- Most cloud platforms

**Gmail SMTP will NOT work on these platforms** because they block outbound SMTP ports.

## ✅ Solution: Use Resend.com (Recommended)

Resend uses HTTPS API (not SMTP), so it works on all servers.

### Step 1: Sign up for Resend
1. Go to [resend.com](https://resend.com)
2. Sign up (free tier: 3,000 emails/month)
3. Verify your email

### Step 2: Get API Key
1. Go to [API Keys](https://resend.com/api-keys)
2. Click "Create API Key"
3. Name it "RecycleTrade Production"
4. Copy the key (starts with `re_`)

### Step 3: Add Domain (Optional but Recommended)
1. Go to [Domains](https://resend.com/domains)
2. Add your domain (e.g., `recycletrade.com`)
3. Add DNS records as shown
4. Wait for verification (usually 5-10 minutes)

### Step 4: Update Environment Variables

**On your server (Railway/Vercel/etc.), add:**

```env
# Remove or comment out Gmail settings:
# EMAIL_USER=muhammadali.dev5@gmail.com
# EMAIL_PASS=your-app-password

# Add Resend:
RESEND_API_KEY=re_your_api_key_here
EMAIL_FROM=RecycleTrade <onboarding@resend.dev>
# OR if you verified a domain:
EMAIL_FROM=RecycleTrade <noreply@yourdomain.com>
```

### Step 5: Restart Server

The email service will automatically use Resend.

## 🔍 Testing

### Test Email Configuration
```bash
GET /api/notifications/test-config
```

### Test Email Sending
```bash
GET /api/notifications/debug-email
```

### Send Test Email
```bash
POST /api/notifications/test-email
Body: { "to": "your-email@example.com" }
```

## 📧 Alternative Solutions

### Option 2: Use SendGrid
1. Sign up at [sendgrid.com](https://sendgrid.com)
2. Get API key
3. Set environment variables:
```env
SMTP_HOST=smtp.sendgrid.net
SMTP_USER=apikey
SMTP_PASS=your_sendgrid_api_key
SMTP_PORT=587
```

### Option 3: Use Mailgun
1. Sign up at [mailgun.com](https://mailgun.com)
2. Get API credentials
3. Set environment variables:
```env
SMTP_HOST=smtp.mailgun.org
SMTP_USER=your_mailgun_username
SMTP_PASS=your_mailgun_password
SMTP_PORT=587
```

### Option 4: Use Gmail OAuth2 (Complex)
If you really want to use Gmail on cloud servers, you need OAuth2:
- More complex setup
- Requires OAuth2 credentials
- Still may be blocked on some platforms

## 🎯 Recommended Setup for Production

**Best Practice:**
1. Use **Resend.com** for production (free tier, reliable, works everywhere)
2. Keep Gmail for local development (if you want)

**Environment Variables:**
```env
# Production (Resend)
RESEND_API_KEY=re_your_key_here
EMAIL_FROM=RecycleTrade <noreply@yourdomain.com>

# Local Development (Gmail - optional)
# EMAIL_USER=your-email@gmail.com
# EMAIL_PASS=your-app-password
```

## 📊 Email Service Priority

The system tries email services in this order:
1. **Resend** (API-based, works everywhere) ✅
2. **SMTP** (generic, may work)
3. **Gmail** (SMTP, often blocked on cloud) ⚠️
4. **Ethereal** (development only)

## 🐛 Troubleshooting

### "Connection timeout" errors
- **Cause:** Server blocking SMTP ports
- **Solution:** Use Resend.com (API-based)

### "Authentication failed" errors
- **Cause:** Wrong credentials
- **Solution:** Check API key or password

### "Email not received"
- Check spam folder
- Verify sender domain
- Check Resend dashboard for delivery status

## 📝 Notes

- Resend free tier: 3,000 emails/month
- Resend paid: $20/month for 50,000 emails
- All emails are logged even if sending fails
- The system continues working even if email fails (won't break orders)

