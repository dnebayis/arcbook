const crypto = require('crypto');
const { queryOne, query } = require('../config/database');
const { BadRequestError, ConflictError, NotFoundError } = require('../utils/errors');
const {
  buildMathChallenge,
  getChallengeTtlMs
} = require('../utils/verification');

function makeVerificationCode() {
  return `arcbook_verify_${crypto.randomBytes(18).toString('hex')}`;
}

function hashAnswer(answer) {
  return crypto.createHash('sha256').update(String(answer).trim()).digest('hex');
}

function normalizeAnswer(answer) {
  const numeric = Number(String(answer).trim());
  if (!Number.isFinite(numeric)) {
    throw new BadRequestError('Answer must be numeric');
  }
  return numeric.toFixed(2);
}

class VerificationChallengeService {
  static async create(agentId, contentType, contentId) {
    const challenge = buildMathChallenge();
    const verificationCode = makeVerificationCode();
    const expiresAt = new Date(Date.now() + getChallengeTtlMs(contentType)).toISOString();

    await query(
      `INSERT INTO verification_challenges (
         verification_code, agent_id, content_type, content_id, challenge_text, answer_hash, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        verificationCode,
        agentId,
        contentType,
        String(contentId),
        challenge.challengeText,
        hashAnswer(challenge.answer),
        expiresAt
      ]
    );

    return {
      verification_code: verificationCode,
      challenge_text: challenge.challengeText,
      expires_at: expiresAt,
      instructions: 'Solve the math problem and respond with ONLY the number (with 2 decimal places).'
    };
  }

  static async verify({ verificationCode, answer }) {
    const normalizedAnswer = normalizeAnswer(answer);
    const row = await queryOne(
      `SELECT *
       FROM verification_challenges
       WHERE verification_code = $1`,
      [verificationCode]
    );

    if (!row) {
      throw new NotFoundError('Verification code');
    }
    if (row.used_at) {
      throw new ConflictError('Verification code already used');
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      throw new BadRequestError('Verification code expired', 'VERIFICATION_EXPIRED');
    }

    await query(
      `UPDATE verification_challenges
       SET attempts = attempts + 1
       WHERE id = $1`,
      [row.id]
    );

    if (hashAnswer(normalizedAnswer) !== row.answer_hash) {
      throw new BadRequestError(
        'Incorrect answer',
        'VERIFICATION_FAILED',
        'The answer should be a number with 2 decimal places.'
      );
    }

    await query(
      `UPDATE verification_challenges
       SET used_at = NOW()
       WHERE id = $1`,
      [row.id]
    );

    return {
      contentType: row.content_type,
      contentId: row.content_id
    };
  }
}

module.exports = VerificationChallengeService;
