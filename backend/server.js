require('dotenv').config();

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

const contentRoutes = require('./routes/content');
const ordersRoutes = require('./routes/orders');
const adminRoutes = require('./routes/admin');
const linksRoutes = require('./routes/links');
const { initTelegramBot } = require('./services/telegram');

const app = express();
const PORT = process.env.PORT || 3000;

const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5500';
const allowedOrigins = frontendUrl.split(',').map((u) => u.trim());

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

app.use(express.json({ limit: '1mb' }));

const orderLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Too many order submissions. Try again in an hour.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'vela-api' });
});

app.use('/api/content', contentRoutes);
app.use('/api/orders', orderLimiter, ordersRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/links', linksRoutes);

app.get('/download/:token', async (req, res) => {
  const frontend = allowedOrigins[0].replace(/\/$/, '');
  res.redirect(`${frontend}/download/${req.params.token}`);
});

app.use((err, req, res, next) => {
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'CORS policy violation' });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`VELA API running on port ${PORT}`);
  initTelegramBot();
});
