const express = require('express');
const supabase = require('../db/client');
const { getThumbnailUrl } = require('../services/storage');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { data: models, error } = await supabase
      .from('models')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const withCoverUrls = await Promise.all(
      models.map(async (model) => ({
        ...model,
        cover_photo_url: model.cover_photo ? await getThumbnailUrl(model.cover_photo) : null,
      }))
    );

    res.json(withCoverUrls);
  } catch (err) {
    console.error('GET /api/models error:', err.message);
    res.status(500).json({ error: 'Failed to fetch models' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { data: model, error } = await supabase
      .from('models')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !model) {
      return res.status(404).json({ error: 'Model not found' });
    }

    const { data: items, error: itemsError } = await supabase
      .from('content_items')
      .select('*')
      .eq('model_id', req.params.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (itemsError) throw itemsError;

    const { getThumbnailUrl, getSignedUrl } = require('../services/storage');
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

    const formattedContent = await Promise.all(
      items.map((item) => formatContentItem(item, item.is_free))
    );

    res.json({
      ...model,
      cover_photo_url: model.cover_photo ? await getThumbnailUrl(model.cover_photo) : null,
      content: formattedContent,
    });
  } catch (err) {
    console.error('GET /api/models/:id error:', err.message);
    res.status(500).json({ error: 'Failed to fetch model' });
  }
});

module.exports = router;
