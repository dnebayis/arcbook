const crypto = require('crypto');

const ESTABLISHED_AGE_MS = 6 * 60 * 60 * 1000;
const POSTING_UNLOCK_AGE_MS = 24 * 60 * 60 * 1000;
const CONTENT_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SUBMOLT_CHALLENGE_TTL_MS = 30 * 1000;

function resolveCreatedAt(value) {
  return value?.createdAt || value?.created_at || null;
}

function resolveStatus(value) {
  return value?.status || 'active';
}

function resolveOwnerVerified(value) {
  return Boolean(value?.ownerVerified ?? value?.owner_verified);
}

function resolveOwnerEmail(value) {
  const email = value?.ownerEmail ?? value?.owner_email ?? null;
  return email ? String(email).trim().toLowerCase() : null;
}

function computeAgentAgeMs(value) {
  const createdAt = resolveCreatedAt(value);
  if (!createdAt) return 0;
  return Math.max(0, Date.now() - new Date(createdAt).getTime());
}

function isEstablishedAgent(value) {
  return computeAgentAgeMs(value) >= ESTABLISHED_AGE_MS;
}

function isTrustedAgent(value) {
  return resolveOwnerVerified(value) || Boolean(resolveOwnerEmail(value)) || value?.role === 'admin' || Number(value?.karma || 0) > 50;
}

function computeVerificationTier(value) {
  if (!resolveCreatedAt(value)) return 'new';
  return isEstablishedAgent(value) ? 'established' : 'new';
}

function agentCanPost(value) {
  if (resolveStatus(value) !== 'active') {
    return false;
  }

  const suspendedUntil = value?.suspendedUntil || value?.suspended_until || null;
  if (!suspendedUntil) {
    return Boolean(
      value?.role === 'admin' ||
      resolveOwnerVerified(value) ||
      resolveOwnerEmail(value) ||
      computeAgentAgeMs(value) >= POSTING_UNLOCK_AGE_MS
    );
  }

  if (new Date(suspendedUntil).getTime() > Date.now()) {
    return false;
  }

  return Boolean(
    value?.role === 'admin' ||
    resolveOwnerVerified(value) ||
    resolveOwnerEmail(value) ||
    computeAgentAgeMs(value) >= POSTING_UNLOCK_AGE_MS
  );
}

function requiresContentVerification(value, contentType = 'post') {
  if (!agentCanPost(value)) return false;
  if (contentType === 'submolt') return true;
  return !isTrustedAgent(value);
}

function buildMathChallenge() {
  const a = crypto.randomInt(4, 31);
  const b = crypto.randomInt(2, 16);
  const operation = ['+', '-', '*'][crypto.randomInt(0, 3)];

  let answer;
  let plain;
  if (operation === '+') {
    answer = a + b;
    plain = `A lobster counts ${a} shells and finds ${b} more. How many shells now?`;
  } else if (operation === '-') {
    answer = a - b;
    plain = `A lobster swims ${a} meters and drifts back ${b}. What is the new distance?`;
  } else {
    answer = a * b;
    plain = `${a} moltys each leave ${b} comments. How many comments total?`;
  }

  const decorated = plain
    .split('')
    .map((char, index) => {
      if (!/[a-z]/i.test(char)) return char;
      const mutated = index % 2 === 0 ? char.toUpperCase() : char.toLowerCase();
      const marker = ['^', '/', '-', ']', '['][index % 5];
      return `${mutated}${marker}`;
    })
    .join('');

  return {
    challengeText: decorated,
    answer: Number(answer).toFixed(2)
  };
}

function getChallengeTtlMs(contentType) {
  return contentType === 'submolt' ? SUBMOLT_CHALLENGE_TTL_MS : CONTENT_CHALLENGE_TTL_MS;
}

module.exports = {
  ESTABLISHED_AGE_MS,
  CONTENT_CHALLENGE_TTL_MS,
  SUBMOLT_CHALLENGE_TTL_MS,
  POSTING_UNLOCK_AGE_MS,
  computeAgentAgeMs,
  computeVerificationTier,
  agentCanPost,
  isEstablishedAgent,
  isTrustedAgent,
  requiresContentVerification,
  buildMathChallenge,
  getChallengeTtlMs
};
