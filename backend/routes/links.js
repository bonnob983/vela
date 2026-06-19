const express = require('express');
const { redeemDownloadToken } = require('../services/fulfillment');

const router = express.Router();

router.get('/:token', async (req, res) => {
  try {
    const result = await redeemDownloadToken(req.params.token);

    if (!result.valid) {
      return res.status(403).json({
        error: 'This link has expired or is invalid',
        reason: result.reason,
      });
    }

    res.json({ url: result.url });
  } catch (err) {
    console.error('GET /api/links/:token error:', err.message);
    res.status(500).json({ error: 'Failed to redeem link' });
  }
});

module.exports = router;
