const express = require('express');
const supabase = require('../db/client');
const { getThumbnailUrl, getSignedUrl } = require('../services/storage');

const router = express.Router();

const TYPE_LABELS = {
  video: 'Video',
  photo: 'Photo',
  pdf: 'PDF Guide',
  call: 'Live Call',
};

async function formatContentItem(item, includeFile = false) {
  const thumbnailUrl = await getThumbnailUrl(item.thumbnail_path);
  const formatted = {
    id: item.id,
    title: item.title,
    description: item.description,
    type: item.type,
    type_label: TYPE_LABELS[item.type] || item.type,
    is_free: item.is_free,
    price_usd: item.price_usd ? parseFloat(item.price_usd) : null,
    thumbnail_url: thumbnailUrl,
    created_at: item.created_at,
  };

  if (includeFile && item.is_free && item.file_path) {
    formatted.file_url = await getSignedUrl(item.file_path, 3600);
  }

  return formatted;
}

router.get('/', async (req, res) => {
  try {
    const { data: items, error } = await supabase
      .from('content_items')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const formatted = await Promise.all(
      items.map((item) => formatContentItem(item, item.is_free))
    );

    res.json(formatted);
  } catch (err) {
    console.error('GET /api/content error:', err.message);
    res.status(500).json({ error: 'Failed to fetch content' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { data: item, error } = await supabase
      .from('content_items')
      .select('*')
      .eq('id', req.params.id)
      .eq('is_active', true)
      .single();

    if (error || !item) {
      return res.status(404).json({ error: 'Content not found' });
    }

    const formatted = await formatContentItem(item, item.is_free);
    res.json(formatted);
  } catch (err) {
    console.error('GET /api/content/:id error:', err.message);
    res.status(500).json({ error: 'Failed to fetch content' });
  }
});

module.exports = router;
