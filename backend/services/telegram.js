const TelegramBot = require('node-telegram-bot-api');
const supabase = require('../db/client');
const { verifyOrder } = require('./fulfillment');

let bot = null;
const pendingInvoices = new Map();

const STARS_PER_USD = 100;

function usdToStars(usd) {
  return Math.max(1, Math.round(parseFloat(usd) * STARS_PER_USD));
}

function getDownloadUrl(token) {
  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5500').replace(/\/$/, '');
  return `${frontendUrl}/download/${token}`;
}

function normalizeHandle(handle) {
  if (!handle) return null;
  const cleaned = handle.replace(/^@/, '').trim();
  return cleaned || null;
}

function initTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn('TELEGRAM_BOT_TOKEN not set — bot disabled');
    return null;
  }

  bot = new TelegramBot(token, { polling: true });
  console.log('Telegram bot started');

  bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const payload = match?.[1];

    if (payload && payload.startsWith('buy_')) {
      const contentId = payload.replace('buy_', '');
      await sendContentInvoice(chatId, contentId, msg.from.username);
      return;
    }

    bot.sendMessage(
      chatId,
      'Welcome to VELA.\n\nUse /buy to browse premium content, or open a purchase link from the website.'
    );
  });

  bot.onText(/\/buy(?: (.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const contentId = match?.[1];

    if (contentId) {
      await sendContentInvoice(chatId, contentId, msg.from.username);
      return;
    }

    const { data: items } = await supabase
      .from('content_items')
      .select('id, title, price_usd')
      .eq('is_active', true)
      .eq('is_free', false)
      .order('created_at', { ascending: false });

    if (!items?.length) {
      bot.sendMessage(chatId, 'No premium content available right now.');
      return;
    }

    const lines = items.map(
      (item, i) => `${i + 1}. ${item.title} — $${item.price_usd}\n   /buy_${item.id}`
    );

    bot.sendMessage(
      chatId,
      `Premium content:\n\n${lines.join('\n\n')}\n\nTap a /buy_<id> command to pay with Stars.`
    );
  });

  bot.onText(/\/buy_(.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const contentId = match[1];
    await sendContentInvoice(chatId, contentId, msg.from.username);
  });

  bot.on('pre_checkout_query', (query) => {
    bot.answerPreCheckoutQuery(query.id, true);
  });

  bot.on('successful_payment', async (msg) => {
    const chatId = msg.chat.id;
    const payment = msg.successful_payment;
    const payload = payment.invoice_payload;
    const username = msg.from.username;

    try {
      const pending = pendingInvoices.get(payload);
      if (!pending) {
        bot.sendMessage(chatId, 'Payment received but order could not be matched. Contact support.');
        return;
      }

      const { data: order, error } = await supabase
        .from('orders')
        .insert({
          content_item_id: pending.contentId,
          payment_method: 'telegram_stars',
          transaction_id: payment.telegram_payment_charge_id,
          telegram_handle: username ? `@${username}` : pending.handle,
          amount_usd: pending.amountUsd,
          status: 'pending',
        })
        .select()
        .single();

      if (error) throw error;

      const result = await verifyOrder(order.id);
      pendingInvoices.delete(payload);

      bot.sendMessage(
        chatId,
        `Payment confirmed!\n\nYour download link:\n${getDownloadUrl(result.link_token)}\n\nExpires in 48 hours. One-time use only.`
      );
    } catch (err) {
      console.error('Stars payment fulfillment error:', err.message);
      bot.sendMessage(chatId, 'Payment received. Your link will be sent shortly.');
    }
  });

  return bot;
}

async function sendContentInvoice(chatId, contentId, username) {
  if (!process.env.TELEGRAM_PAYMENT_PROVIDER_TOKEN) {
    bot.sendMessage(chatId, 'Telegram Stars payments are not configured yet.');
    return;
  }

  const { data: item, error } = await supabase
    .from('content_items')
    .select('*')
    .eq('id', contentId)
    .eq('is_active', true)
    .eq('is_free', false)
    .single();

  if (error || !item) {
    bot.sendMessage(chatId, 'Content not found or unavailable.');
    return;
  }

  const stars = usdToStars(item.price_usd);
  const payload = `vela_${contentId}_${Date.now()}`;

  pendingInvoices.set(payload, {
    contentId: item.id,
    amountUsd: item.price_usd,
    handle: username ? `@${username}` : null,
  });

  await bot.sendInvoice(
    chatId,
    item.title,
    item.description || `Unlock: ${item.title}`,
    payload,
    process.env.TELEGRAM_PAYMENT_PROVIDER_TOKEN,
    'XTR',
    [{ label: item.title, amount: stars }],
    { start_parameter: `buy_${contentId}` }
  );
}

async function sendDownloadLink(telegramHandle, token) {
  if (!bot) return false;

  const handle = normalizeHandle(telegramHandle);
  if (!handle) return false;

  const url = getDownloadUrl(token);
  const message =
    `✅ Payment verified!\n\nHere is your exclusive download link:\n${url}\n\n⏳ This link expires in 48 hours and can only be used once.`;

  try {
    await bot.sendMessage(`@${handle}`, message);
    return true;
  } catch {
    try {
      await bot.sendMessage(handle, message);
      return true;
    } catch (err) {
      console.error(`Failed to send Telegram message to ${handle}:`, err.message);
      return false;
    }
  }
}

async function sendRejectionMessage(telegramHandle) {
  if (!bot) return false;

  const handle = normalizeHandle(telegramHandle);
  if (!handle) return false;

  const message =
    '❌ Your payment could not be verified. Please double-check your transaction ID and try again, or contact support.';

  try {
    await bot.sendMessage(`@${handle}`, message);
    return true;
  } catch {
    try {
      await bot.sendMessage(handle, message);
      return true;
    } catch (err) {
      console.error(`Failed to send rejection to ${handle}:`, err.message);
      return false;
    }
  }
}

function getBotDeepLink(contentId) {
  const username = process.env.TELEGRAM_BOT_USERNAME || 'YOUR_BOT_USERNAME';
  return `https://t.me/${username}?start=buy_${contentId}`;
}

module.exports = {
  initTelegramBot,
  sendDownloadLink,
  sendRejectionMessage,
  getBotDeepLink,
  usdToStars,
};
