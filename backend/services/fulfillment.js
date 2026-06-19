const crypto = require('crypto');
const supabase = require('../db/client');
const { sendDownloadLink, sendRejectionMessage } = require('./telegram');
const { getSignedUrl } = require('./storage');

function sanitizeText(text, maxLength = 500) {
  if (text == null) return '';
  return String(text)
    .trim()
    .slice(0, maxLength)
    .replace(/[<>'"`\\]/g, '');
}

async function generateDownloadLink(orderId, contentItemId) {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('download_links')
    .insert({
      order_id: orderId,
      token,
      content_item_id: contentItemId,
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create download link: ${error.message}`);
  return data;
}

async function verifyOrder(orderId) {
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('*, content_items(*)')
    .eq('id', orderId)
    .single();

  if (orderError || !order) {
    throw new Error('Order not found');
  }

  if (order.status === 'verified') {
    const { data: existingLink } = await supabase
      .from('download_links')
      .select('token')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    return { order, link_token: existingLink?.token || null };
  }

  if (order.status === 'rejected') {
    throw new Error('Order was rejected');
  }

  const { error: updateError } = await supabase
    .from('orders')
    .update({ status: 'verified', verified_at: new Date().toISOString() })
    .eq('id', orderId);

  if (updateError) throw new Error(`Failed to verify order: ${updateError.message}`);

  const link = await generateDownloadLink(orderId, order.content_item_id);

  if (order.telegram_handle) {
    await sendDownloadLink(order.telegram_handle, link.token);
  }

  return { order, link_token: link.token };
}

async function rejectOrder(orderId) {
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single();

  if (orderError || !order) {
    throw new Error('Order not found');
  }

  const { error: updateError } = await supabase
    .from('orders')
    .update({ status: 'rejected' })
    .eq('id', orderId);

  if (updateError) throw new Error(`Failed to reject order: ${updateError.message}`);

  if (order.telegram_handle) {
    await sendRejectionMessage(order.telegram_handle);
  }

  return order;
}

async function redeemDownloadToken(token) {
  const { data: link, error } = await supabase
    .from('download_links')
    .select('*, content_items(file_path)')
    .eq('token', token)
    .single();

  if (error || !link) {
    return { valid: false, reason: 'invalid' };
  }

  if (link.used) {
    return { valid: false, reason: 'used' };
  }

  if (new Date(link.expires_at) < new Date()) {
    return { valid: false, reason: 'expired' };
  }

  const { error: markError } = await supabase
    .from('download_links')
    .update({ used: true })
    .eq('id', link.id);

  if (markError) {
    throw new Error(`Failed to mark link as used: ${markError.message}`);
  }

  const filePath = link.content_items?.file_path;
  if (!filePath) {
    return { valid: false, reason: 'no_file' };
  }

  const signedUrl = await getSignedUrl(filePath, 3600);
  return { valid: true, url: signedUrl };
}

module.exports = {
  sanitizeText,
  generateDownloadLink,
  verifyOrder,
  rejectOrder,
  redeemDownloadToken,
};
