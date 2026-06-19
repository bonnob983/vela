const express = require('express');
const multer = require('multer');
const supabase = require('../db/client');
const adminAuth = require('../middleware/adminAuth');
const { uploadFile, getThumbnailUrl } = require('../services/storage');
const { sanitizeText, verifyOrder, rejectOrder } = require('../services/fulfillment');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

router.post('/login', (req, res) => {
  const { password } = req.body;

  if (!password || password !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  res.json({ token: process.env.ADMIN_SECRET });
});

router.use(adminAuth);

router.get('/content', async (req, res) => {
  try {
    const { data: items, error } = await supabase
      .from('content_items')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const withThumbs = await Promise.all(
      items.map(async (item) => ({
        ...item,
        price_usd: item.price_usd ? parseFloat(item.price_usd) : null,
        thumbnail_url: await getThumbnailUrl(item.thumbnail_path),
      }))
    );

    res.json(withThumbs);
  } catch (err) {
    console.error('GET /api/admin/content error:', err.message);
    res.status(500).json({ error: 'Failed to fetch content' });
  }
});

router.post('/content', upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 },
]), async (req, res) => {
  try {
    const { title, description, type, is_free, price_usd } = req.body;

    if (!title || !type) {
      return res.status(400).json({ error: 'Title and type are required' });
    }

    const validTypes = ['video', 'photo', 'pdf', 'call'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: 'Invalid content type' });
    }

    const free = is_free === 'true' || is_free === true;
    let filePath = null;
    let thumbnailPath = null;

    if (req.files?.file?.[0]) {
      const file = req.files.file[0];
      filePath = await uploadFile(file.buffer, file.originalname, file.mimetype);
    }

    if (req.files?.thumbnail?.[0]) {
      const thumb = req.files.thumbnail[0];
      thumbnailPath = await uploadFile(thumb.buffer, thumb.originalname, thumb.mimetype);
    }

    const { data: item, error } = await supabase
      .from('content_items')
      .insert({
        title: sanitizeText(title, 200),
        description: sanitizeText(description, 2000),
        type,
        is_free: free,
        price_usd: free ? null : parseFloat(price_usd) || 0,
        file_path: filePath,
        thumbnail_path: thumbnailPath,
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      ...item,
      thumbnail_url: await getThumbnailUrl(item.thumbnail_path),
    });
  } catch (err) {
    console.error('POST /api/admin/content error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to create content' });
  }
});

router.patch('/content/:id', async (req, res) => {
  try {
    const updates = {};
    const allowed = ['title', 'description', 'price_usd', 'is_active', 'is_free'];

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        if (key === 'title' || key === 'description') {
          updates[key] = sanitizeText(req.body[key], key === 'title' ? 200 : 2000);
        } else if (key === 'is_active' || key === 'is_free') {
          updates[key] = req.body[key] === true || req.body[key] === 'true';
        } else if (key === 'price_usd') {
          updates[key] = parseFloat(req.body[key]) || 0;
        }
      }
    }

    const { data: item, error } = await supabase
      .from('content_items')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(item);
  } catch (err) {
    console.error('PATCH /api/admin/content/:id error:', err.message);
    res.status(500).json({ error: 'Failed to update content' });
  }
});

router.delete('/content/:id', async (req, res) => {
  try {
    const { data: item, error } = await supabase
      .from('content_items')
      .update({ is_active: false })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(item);
  } catch (err) {
    console.error('DELETE /api/admin/content/:id error:', err.message);
    res.status(500).json({ error: 'Failed to delete content' });
  }
});

router.get('/orders', async (req, res) => {
  try {
    const { data: orders, error } = await supabase
      .from('orders')
      .select('*, content_items(title, type, price_usd)')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(orders);
  } catch (err) {
    console.error('GET /api/admin/orders error:', err.message);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

router.post('/orders/:id/verify', async (req, res) => {
  try {
    const result = await verifyOrder(req.params.id);
    res.json({ link_token: result.link_token, status: 'verified' });
  } catch (err) {
    console.error('POST /api/admin/orders/:id/verify error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.post('/orders/:id/reject', async (req, res) => {
  try {
    await rejectOrder(req.params.id);
    res.json({ status: 'rejected' });
  } catch (err) {
    console.error('POST /api/admin/orders/:id/reject error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
