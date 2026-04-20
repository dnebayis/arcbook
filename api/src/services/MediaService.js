const crypto = require('crypto');
const { queryOne } = require('../config/database');
const { BadRequestError } = require('../utils/errors');
const config = require('../config');
const PinataService = require('./PinataService');

const MIME_EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif'
};

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
    const key = filename || `${Date.now()}-${crypto.randomUUID()}.${ext}`;

    let url;
    let storageKey;

    if (PinataService.isConfigured()) {
      // Upload to IPFS via Pinata
      const cid = await PinataService.pinFile(key, data, contentType);
      url = PinataService.gatewayUrl(cid);
      storageKey = `ipfs://${cid}`;
    } else {
      // Fallback: base URL reference (local dev only — not persistent on Vercel)
      storageKey = key;
      url = `${config.app.publicBaseUrl}/uploads/${key}`;
    }

    return queryOne(
      `INSERT INTO media_assets (agent_id, usage, storage_key, url, mime_type, size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, usage, url, mime_type, size_bytes, created_at`,
      [agentId, usage, storageKey, url, contentType, buffer.length]
    );
  }
}

module.exports = MediaService;
