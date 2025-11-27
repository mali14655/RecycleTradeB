# PayPal Integration Setup Guide - RecycleTrade

## Overview
PayPal integration has been successfully added to your e-commerce platform alongside Stripe. This guide will help you configure PayPal for both testing and live production.

## Prerequisites
- PayPal Business Account (or create one at [paypal.com/business](https://www.paypal.com/business))

## Setup Steps

### Step 1: Create PayPal App
1. Log in to your PayPal Business Account
2. Go to [PayPal Developer Dashboard](https://developer.paypal.com/)
3. Navigate to **Dashboard** > **My Apps & Credentials**
4. Click **Create App** or select **Sandbox** for testing / **Live** for production

### Step 2: Get API Credentials

#### For Testing (Sandbox):
1. In the Developer Dashboard, make sure you're in **Sandbox** mode
2. Go to **My Apps & Credentials**
3. Find your app or create a new one
4. Click on your app to view credentials
5. Copy the **Client ID** and **Secret**

#### For Production (Live):
1. Switch to **Live** mode in the PayPal Developer Dashboard
2. Go to **My Apps & Credentials**
3. Find your app or create a new one
4. Click on your app to view credentials
5. Copy the **Client ID** and **Secret**

### Step 3: Configure Environment Variables

Add these environment variables to your `.env` file:

```env
# PayPal Configuration
PAYPAL_CLIENT_ID=your_paypal_client_id_here
PAYPAL_CLIENT_SECRET=your_paypal_client_secret_here
PAYPAL_ENVIRONMENT=sandbox  # Use "sandbox" for testing, "live" for production
```

**Important Notes:**
- Use `sandbox` for testing with PayPal test accounts
- Use `live` for production with real payments
- Never commit your PayPal credentials to version control
- Keep your PayPal credentials secure

### Step 4: Configure PayPal Webhook (Optional but Recommended)

For automatic payment verification via webhooks:

1. In PayPal Developer Dashboard, go to **My Apps & Credentials**
2. Select your app
3. Click **Add Webhook** or **Edit Webhook**
4. Set webhook URL:
   - **Development**: `http://localhost:5000/api/webhooks/paypal`
   - **Production**: `https://your-domain.com/api/webhooks/paypal`
5. Select these events:
   - `PAYMENT.CAPTURE.COMPLETED`
   - `CHECKOUT.ORDER.COMPLETED`
6. Save the webhook

### Step 5: Test PayPal Integration

#### Test Mode (Sandbox):
1. Set `PAYPAL_ENVIRONMENT=sandbox`
2. Use PayPal sandbox test accounts:
   - Create test accounts at [PayPal Sandbox](https://developer.paypal.com/dashboard/accounts)
   - Use these test accounts to complete test payments

#### Production Mode (Live):
1. Set `PAYPAL_ENVIRONMENT=live`
2. Use real PayPal accounts to test
3. **Note**: Real money will be processed in live mode!

## How It Works

### Payment Flow:
1. Customer clicks **"Pay with PayPal"** button on checkout page
2. Customer is redirected to PayPal login/checkout page
3. Customer approves payment on PayPal
4. Customer is redirected back to your success page
5. PayPal order is automatically captured
6. Order status is updated to "Paid"
7. Stock is decreased
8. Order confirmation email is sent
9. Cart is cleared

### Webhook Flow (Backup):
- PayPal sends webhook events when payments are completed
- Webhook handler verifies and processes payments
- Ensures payments are processed even if customer closes browser

## Testing Checklist

- [ ] PayPal credentials are set in environment variables
- [ ] PayPal environment is set correctly (sandbox/live)
- [ ] Test PayPal checkout flow end-to-end
- [ ] Verify order status updates to "Paid"
- [ ] Verify stock decreases after payment
- [ ] Verify order confirmation email is sent
- [ ] Verify cart is cleared after payment
- [ ] Test webhook (optional but recommended)

## Troubleshooting

### "PayPal is not configured" Error
- **Solution**: Check that `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` are set in your `.env` file

### Payments Not Processing
- **Check**: Verify `PAYPAL_ENVIRONMENT` matches your credentials (sandbox credentials need `sandbox`, live credentials need `live`)
- **Check**: Verify PayPal app is active in PayPal Developer Dashboard

### Webhook Not Receiving Events
- **Check**: Webhook URL is correctly configured in PayPal Developer Dashboard
- **Check**: Webhook events are selected (PAYMENT.CAPTURE.COMPLETED, CHECKOUT.ORDER.COMPLETED)
- **Check**: Server logs for webhook errors

### Orders Not Updating to "Paid"
- **Check**: PayPal capture endpoint is working (`/api/webhooks/paypal/capture`)
- **Check**: Webhook is configured and receiving events
- **Check**: Database connection is working

## Environment Variables Summary

```env
# Required for PayPal
PAYPAL_CLIENT_ID=your_client_id
PAYPAL_CLIENT_SECRET=your_client_secret
PAYPAL_ENVIRONMENT=sandbox  # or "live"

# Required for frontend redirects
FRONTEND_URL=https://your-frontend-domain.com

# Required for email notifications
EMAIL_FROM=your-email@domain.com
# ... other email configuration
```

## Security Best Practices

1. **Never expose credentials** in client-side code
2. **Use environment variables** for all sensitive data
3. **Enable PayPal webhooks** for automatic verification
4. **Monitor PayPal dashboard** for suspicious activity
5. **Use HTTPS** in production
6. **Verify webhook signatures** (implemented in webhook handler)

## Support

- [PayPal Developer Documentation](https://developer.paypal.com/docs/)
- [PayPal API Reference](https://developer.paypal.com/api/rest/)
- [PayPal Support](https://www.paypal.com/support)

## Notes

- PayPal integration works alongside Stripe - customers can choose either payment method
- Both payment methods follow the same order flow and stock management
- PayPal webhooks ensure payments are verified even if customer closes browser
- The system automatically handles both test and live environments based on `PAYPAL_ENVIRONMENT`

