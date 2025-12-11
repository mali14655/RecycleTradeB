# Email Debugging Guide

## Quick Check - Is Email Service Configured?

### Step 1: Check Server Logs
When you register, check your server console. You should see:
```
[REGISTER] Sending verification email to: your@email.com
[EMAIL] Attempting to send email to: your@email.com
[EMAIL] Using API URL: http://localhost:5000/api/notifications/send-email
```

### Step 2: Check Email Configuration
Visit this URL in your browser or use Postman:
```
GET http://localhost:5000/api/notifications/test-config
```

This will show:
- Which email services are available
- Which service is currently being used
- If email service is configured

### Step 3: Test Email Sending
Test if emails can be sent:
```
GET http://localhost:5000/api/notifications/debug-email
```

Or send a test email:
```
POST http://localhost:5000/api/notifications/test-email
Body: { "to": "your-email@example.com" }
```

## Common Issues

### Issue 1: "Email service not configured"
**Solution:** Set up email service:
- **For Cloud Servers (Railway, Vercel, etc.):** Use Resend.com
  ```env
  RESEND_API_KEY=re_your_api_key_here
  EMAIL_FROM=F&S Smartphones <onboarding@resend.dev>
  ```

- **For Local Development:** Use Gmail (if SMTP ports not blocked)
  ```env
  EMAIL_USER=your-email@gmail.com
  EMAIL_PASS=your-app-password
  ```

### Issue 2: "ECONNREFUSED" error
**Cause:** Email service endpoint not accessible
**Solution:** 
- Check if backend server is running
- Check if notifications route is working
- Restart backend server

### Issue 3: "Authentication failed"
**Cause:** Wrong API key or password
**Solution:**
- For Resend: Get new API key from resend.com/api-keys
- For Gmail: Use App Password (not regular password)

### Issue 4: Email sent but not received
**Possible causes:**
1. **Check spam folder** - Emails might be in spam
2. **Email service blocking** - Some providers block emails
3. **Domain not verified** - If using custom domain, verify it
4. **Email address invalid** - Make sure email exists

## Quick Setup - Resend.com (Recommended)

1. Go to https://resend.com
2. Sign up (free: 3,000 emails/month)
3. Get API key from https://resend.com/api-keys
4. Add to your `.env` file:
   ```env
   RESEND_API_KEY=re_your_key_here
   EMAIL_FROM=F&S Smartphones <onboarding@resend.dev>
   ```
5. Restart your backend server
6. Test with: `GET /api/notifications/test-config`

## Check Server Logs

When registering, check your backend console for:
- `[REGISTER] Sending verification email to: ...`
- `[EMAIL] Attempting to send email to: ...`
- `[EMAIL] ✅ Successfully sent email to ...` OR
- `[EMAIL] ❌ Error sending email to ...`

The logs will show exactly what's happening!


