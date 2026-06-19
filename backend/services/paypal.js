const PAYPAL_BASE = process.env.PAYPAL_MODE === 'live'
  ? 'https://api.paypal.com'
  : 'https://api.sandbox.paypal.com';

let cachedToken = null;
let tokenExpiry = 0;

async function getPayPalAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString('base64');

  const response = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  const data = await response.json();
  if (!data.access_token) {
    throw new Error('Failed to obtain PayPal access token');
  }

  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

async function verifyPayPalTransaction(transactionId, expectedAmountUsd) {
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
    console.warn('PayPal credentials not configured — skipping auto-verify');
    return { verified: false, reason: 'not_configured' };
  }

  try {
    const token = await getPayPalAccessToken();

    const response = await fetch(
      `${PAYPAL_BASE}/v2/payments/captures/${transactionId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (response.status === 404) {
      const paymentResponse = await fetch(
        `${PAYPAL_BASE}/v2/checkout/orders/${transactionId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!paymentResponse.ok) {
        return { verified: false, reason: 'not_found' };
      }

      const order = await paymentResponse.json();
      return validatePayPalOrder(order, expectedAmountUsd);
    }

    if (!response.ok) {
      return { verified: false, reason: 'query_failed' };
    }

    const capture = await response.json();
    return validatePayPalCapture(capture, expectedAmountUsd);
  } catch (err) {
    console.error('PayPal verification error:', err.message);
    return { verified: false, reason: err.message };
  }
}

function validatePayPalCapture(capture, expectedAmountUsd) {
  if (capture.status !== 'COMPLETED') {
    return { verified: false, reason: `status_${capture.status}` };
  }

  const amount = parseFloat(capture.amount?.value || 0);
  const expected = parseFloat(expectedAmountUsd);

  if (Math.abs(amount - expected) > 0.01) {
    return { verified: false, reason: 'amount_mismatch', amount, expected };
  }

  return { verified: true };
}

function validatePayPalOrder(order, expectedAmountUsd) {
  if (order.status !== 'COMPLETED') {
    return { verified: false, reason: `status_${order.status}` };
  }

  const unit = order.purchase_units?.[0];
  const amount = parseFloat(unit?.amount?.value || 0);
  const expected = parseFloat(expectedAmountUsd);

  if (Math.abs(amount - expected) > 0.01) {
    return { verified: false, reason: 'amount_mismatch', amount, expected };
  }

  return { verified: true };
}

async function verifyPayPalWebhook(req) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return null;

  try {
    const token = await getPayPalAccessToken();
    const response = await fetch(`${PAYPAL_BASE}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        auth_algo: req.headers['paypal-auth-algo'],
        cert_url: req.headers['paypal-cert-url'],
        transmission_id: req.headers['paypal-transmission-id'],
        transmission_sig: req.headers['paypal-transmission-sig'],
        transmission_time: req.headers['paypal-transmission-time'],
        webhook_id: webhookId,
        webhook_event: req.body,
      }),
    });

    const result = await response.json();
    return result.verification_status === 'SUCCESS' ? req.body : null;
  } catch (err) {
    console.error('PayPal webhook verification error:', err.message);
    return null;
  }
}

module.exports = { verifyPayPalTransaction, verifyPayPalWebhook };
