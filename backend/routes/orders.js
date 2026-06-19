const express = require('express');
const supabase = require('../db/client');
const { sanitizeText, verifyOrder } = require('../services/fulfillment');
const { verifyBinanceTransaction } = require('../services/binance');
const { verifyPayPalTransaction } = require('../services/paypal');
const { getBotDeepLink } = require('../services/telegram');

const router = express.Router();

const VALID_METHODS = ['binance', 'paypal', 'telegram_stars'];

router.post('/', async (req, res) => {
  try {
    const { content_item_id, payment_method, transaction_id, telegram_handle } = req.body;

    if (!content_item_id || !payment_method || !telegram_handle) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!VALID_METHODS.includes(payment_method)) {
      return res.status(400).json({ error: 'Invalid payment method' });
    }

    const { data: content, error: contentError } = await supabase
      .from('content_items')
      .select('*')
      .eq('id', content_item_id)
      .eq('is_active', true)
      .eq('is_free', false)
      .single();

    if (contentError || !content) {
      return res.status(404).json({ error: 'Content not found or not purchasable' });
    }

    if (payment_method === 'telegram_stars') {
      return res.json({
        order_id: null,
        status: 'telegram_flow',
        bot_link: getBotDeepLink(content_item_id),
      });
    }

    if (!transaction_id) {
      return res.status(400).json({ error: 'Transaction ID required' });
    }

    const sanitizedTx = sanitizeText(transaction_id, 200);
    const sanitizedHandle = sanitizeText(telegram_handle, 100);

    if (!sanitizedHandle) {
      return res.status(400).json({ error: 'Valid Telegram handle required' });
    }

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        content_item_id,
        payment_method,
        transaction_id: sanitizedTx,
        telegram_handle: sanitizedHandle.startsWith('@')
          ? sanitizedHandle
          : `@${sanitizedHandle}`,
        amount_usd: content.price_usd,
        status: 'pending',
      })
      .select()
      .single();

    if (orderError) throw orderError;

    let autoVerified = false;

    if (payment_method === 'binance') {
      const result = await verifyBinanceTransaction(sanitizedTx, content.price_usd);
      if (result.verified) {
        await verifyOrder(order.id);
        autoVerified = true;
      }
    } else if (payment_method === 'paypal') {
      const result = await verifyPayPalTransaction(sanitizedTx, content.price_usd);
      if (result.verified) {
        await verifyOrder(order.id);
        autoVerified = true;
      }
    }

    res.status(201).json({
      order_id: order.id,
      status: autoVerified ? 'verified' : 'pending',
    });
  } catch (err) {
    console.error('POST /api/orders error:', err.message);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

module.exports = router;
