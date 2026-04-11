const crypto = require('crypto');
const { hashToken } = require('./auth');

function generateClaimTokenPayload() {
  const token = crypto.randomBytes(32).toString('hex');
  return {
    token,
    tokenHash: hashToken(token)
  };
}

function classifyClaimTokenRecord(record, now = new Date()) {
  if (!record) return 'invalid';

  if (record.used_at && record.owner_verified) {
    return 'already_claimed';
  }

  if (record.superseded_at) {
    return 'superseded';
  }

  if (record.expires_at && new Date(record.expires_at) <= now) {
    return 'expired';
  }

  if (record.used_at) {
    return 'invalid';
  }

  return 'active';
}

module.exports = {
  generateClaimTokenPayload,
  classifyClaimTokenRecord
};
