const crypto = require('crypto');
const config = require('../config');

function deriveKeyMaterial(input) {
  return crypto.createHash('sha256').update(String(input)).digest();
}

function getWebhookEncryptionKey() {
  const configured = config.webhooks.secretEncryptionKey;
  if (configured) {
    return deriveKeyMaterial(configured);
  }

  if (config.isProduction) {
    throw new Error('WEBHOOK_SECRET_ENCRYPTION_KEY must be set in production before webhook secrets can be used.');
  }

  return deriveKeyMaterial(config.security.sessionSecret);
}

function generateWebhookSecret() {
  return crypto.randomBytes(32).toString('hex');
}

function encryptWebhookSecret(secret) {
  const key = getWebhookEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(secret), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url')
  ].join('.');
}

function decryptWebhookSecret(payload) {
  const [ivValue, tagValue, encryptedValue] = String(payload || '').split('.');
  if (!ivValue || !tagValue || !encryptedValue) {
    throw new Error('Invalid encrypted webhook secret payload');
  }

  const key = getWebhookEncryptionKey();
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivValue, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final()
  ]);

  return decrypted.toString('utf8');
}

module.exports = {
  generateWebhookSecret,
  encryptWebhookSecret,
  decryptWebhookSecret,
  getWebhookEncryptionKey
};
