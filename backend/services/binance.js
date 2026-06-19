const crypto = require('crypto');

const BINANCE_API_URL = 'https://bpay.binanceapi.com/binancepay/openapi/v2/order/query';

function getBinanceHeaders(body) {
  const timestamp = Date.now().toString();
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = timestamp + '\n' + nonce + '\n' + body + '\n';
  const signature = crypto
    .createHmac('sha512', process.env.BINANCE_SECRET_KEY)
    .update(payload)
    .digest('hex')
    .toUpperCase();

  return {
    'Content-Type': 'application/json',
    'BinancePay-Timestamp': timestamp,
    'BinancePay-Nonce': nonce,
    'BinancePay-Certificate-SN': process.env.BINANCE_API_KEY,
    'BinancePay-Signature': signature,
  };
}

async function verifyBinanceTransaction(transactionId, expectedAmountUsd) {
  if (!process.env.BINANCE_API_KEY || !process.env.BINANCE_SECRET_KEY) {
    console.warn('Binance Pay credentials not configured — skipping auto-verify');
    return { verified: false, reason: 'not_configured' };
  }

  const body = JSON.stringify({
    merchantTradeNo: transactionId,
    prepayId: transactionId,
  });

  try {
    const response = await fetch(BINANCE_API_URL, {
      method: 'POST',
      headers: getBinanceHeaders(body),
      body,
    });

    const result = await response.json();

    if (result.status !== 'SUCCESS' && result.code !== '000000') {
      const altBody = JSON.stringify({ transactionId });
      const altResponse = await fetch(BINANCE_API_URL, {
        method: 'POST',
        headers: getBinanceHeaders(altBody),
        body: altBody,
      });
      const altResult = await altResponse.json();

      if (altResult.status !== 'SUCCESS' && altResult.code !== '000000') {
        return { verified: false, reason: altResult.errorMessage || 'query_failed' };
      }

      return validateBinanceOrder(altResult.data, expectedAmountUsd);
    }

    return validateBinanceOrder(result.data, expectedAmountUsd);
  } catch (err) {
    console.error('Binance verification error:', err.message);
    return { verified: false, reason: err.message };
  }
}

function validateBinanceOrder(data, expectedAmountUsd) {
  if (!data) return { verified: false, reason: 'no_data' };

  const status = data.status || data.orderStatus;
  if (status !== 'PAID' && status !== 'SUCCESS') {
    return { verified: false, reason: `status_${status}` };
  }

  const currency = (data.currency || data.transactCurrency || 'USDT').toUpperCase();
  if (currency !== 'USDT') {
    return { verified: false, reason: 'wrong_currency' };
  }

  const amount = parseFloat(data.orderAmount || data.totalFee || data.transactAmount || 0);
  const expected = parseFloat(expectedAmountUsd);

  if (Math.abs(amount - expected) > 0.01) {
    return { verified: false, reason: 'amount_mismatch', amount, expected };
  }

  return { verified: true };
}

module.exports = { verifyBinanceTransaction };
