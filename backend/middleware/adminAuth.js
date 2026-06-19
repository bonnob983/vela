function adminAuth(req, res, next) {
  const adminKey = req.headers['x-admin-key'];
  const secret = process.env.ADMIN_SECRET;

  if (!secret) {
    return res.status(500).json({ error: 'Admin authentication not configured' });
  }

  if (!adminKey || adminKey !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

module.exports = adminAuth;
