const { queryOne, queryAll, query } = require('../config/database');
const { generateApiKey, hashToken } = require('../utils/auth');
const { BadRequestError, NotFoundError, UnauthorizedError } = require('../utils/errors');

const APP_KEY_PREFIX = 'arcdev_';

function generateDeveloperAppKey() {
  return `${APP_KEY_PREFIX}${generateApiKey().replace(/^arcbook_/, '')}`;
}

function extractAppKey(req) {
  return req.headers['x-arcbook-app-key'] || req.headers['x-moltbook-app-key'] || null;
}

class DeveloperAppService {
  static async list(ownerEmail) {
    return queryAll(
      `SELECT id, owner_email, name, created_at, revoked_at
       FROM developer_apps
       WHERE LOWER(owner_email) = $1
       ORDER BY created_at DESC`,
      [ownerEmail.toLowerCase()]
    );
  }

  static async create(ownerEmail, name) {
    const cleanName = String(name || '').trim();
    if (!cleanName) {
      throw new BadRequestError('name is required');
    }

    const appKey = generateDeveloperAppKey();
    const row = await queryOne(
      `INSERT INTO developer_apps (owner_email, name, app_key_hash)
       VALUES ($1, $2, $3)
       RETURNING id, owner_email, name, created_at, revoked_at`,
      [ownerEmail.toLowerCase(), cleanName, hashToken(appKey)]
    );

    return { app: row, appKey };
  }

  static async revoke(ownerEmail, appId) {
    const row = await queryOne(
      `UPDATE developer_apps
       SET revoked_at = NOW()
       WHERE id = $1
         AND LOWER(owner_email) = $2
         AND revoked_at IS NULL
       RETURNING id`,
      [appId, ownerEmail.toLowerCase()]
    );

    if (!row) {
      throw new NotFoundError('Developer app');
    }
  }

  static async verifyRequest(req) {
    const rawKey = extractAppKey(req);
    if (!rawKey || typeof rawKey !== 'string') {
      throw new UnauthorizedError('Developer app key required');
    }

    const app = await queryOne(
      `SELECT id, owner_email, name, created_at
       FROM developer_apps
       WHERE app_key_hash = $1
         AND revoked_at IS NULL`,
      [hashToken(rawKey)]
    );

    if (!app) {
      throw new UnauthorizedError('Invalid developer app key');
    }

    return app;
  }
}

module.exports = {
  DeveloperAppService,
  APP_KEY_PREFIX,
  generateDeveloperAppKey,
  extractAppKey
};
