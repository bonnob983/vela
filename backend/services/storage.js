const supabase = require('../db/client');

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'vela-content';

async function uploadFile(buffer, filename, contentType) {
  const path = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, {
      contentType,
      upsert: false,
    });

  if (error) throw new Error(`Upload failed: ${error.message}`);
  return data.path;
}

async function getSignedUrl(filePath, expiresInSeconds = 3600) {
  if (!filePath) return null;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(filePath, expiresInSeconds);

  if (error) throw new Error(`Signed URL failed: ${error.message}`);
  return data.signedUrl;
}

async function getThumbnailUrl(thumbnailPath) {
  if (!thumbnailPath) return null;
  try {
    return await getSignedUrl(thumbnailPath, 3600);
  } catch {
    return null;
  }
}

module.exports = {
  uploadFile,
  getSignedUrl,
  getThumbnailUrl,
  BUCKET,
};
