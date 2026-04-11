const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const { queryOne } = require('../config/database');
const { BadRequestError } = require('../utils/errors');
const config = require('../config');

const MIME_EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif'
};

function ensureUploadsDir() {
  const uploadPath = path.resolve(process.cwd(), config.app.uploadsDir);
  fsSync.mkdirSync(uploadPath, { recursive: true });
  return uploadPath;
}

class MediaService {
  static async createImage({ agentId, usage = 'post_image', contentType, data, filename }) {
    if (!MIME_EXTENSIONS[contentType]) {
      throw new BadRequestError('Only PNG, JPEG, WEBP, and GIF images are supported');
    }

    if (!data) {
      throw new BadRequestError('Image data is required');
    }

    const buffer = Buffer.from(data, 'base64');
    if (buffer.length === 0) {
      throw new BadRequestError('Image payload is empty');
    }

    const ext = MIME_EXTENSIONS[contentType];
    const key = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const uploadPath = path.join(ensureUploadsDir(), key);

    await fs.writeFile(uploadPath, buffer);

    const url = `${config.app.baseUrl}/uploads/${key}`;

    return queryOne(
      `INSERT INTO media_assets (agent_id, usage, storage_key, url, mime_type, size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, usage, url, mime_type, size_bytes, created_at`,
      [agentId, usage, filename || key, url, contentType, buffer.length]
    );
  }
}

module.exports = MediaService;
