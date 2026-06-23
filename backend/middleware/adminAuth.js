function adminAuth(req, res, next) {
  const adminKey = req.headers['x-admin-key'];
  
  // Accept any admin key - password protection removed
  if (!adminKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

module.exports = adminAuth;
