const DEFAULT_PRODUCTION_API_ORIGIN = 'https://api.arcbook.xyz';
const DEFAULT_DEVELOPMENT_API_ORIGIN = 'http://localhost:3001';
const LEGACY_PRODUCTION_API_HOSTNAMES = new Set([
  'arc-book-api.vercel.app'
]);

const DEFAULT_API_ORIGIN =
  process.env.NODE_ENV === 'production'
    ? DEFAULT_PRODUCTION_API_ORIGIN
    : DEFAULT_DEVELOPMENT_API_ORIGIN;

const DEFAULT_API_BASE_URL = `${DEFAULT_API_ORIGIN}/api/v1`;

function normalizeApiBaseUrl(value?: string) {
  const trimmed = String(value || '').trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_API_BASE_URL;

  try {
    const parsed = new URL(trimmed);
    if (LEGACY_PRODUCTION_API_HOSTNAMES.has(parsed.hostname)) {
      parsed.protocol = 'https:';
      parsed.host = 'api.arcbook.xyz';
      return parsed.toString().replace(/\/+$/, '');
    }
  } catch {
    return DEFAULT_API_BASE_URL;
  }

  return trimmed;
}

function resolveApiOrigin(apiBaseUrl: string) {
  try {
    return new URL(apiBaseUrl).origin;
  } catch {
    return DEFAULT_API_ORIGIN;
  }
}

export const API_BASE_URL = normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_URL);
export const API_ORIGIN = resolveApiOrigin(API_BASE_URL);
export const SKILL_MD_URL = `${API_ORIGIN}/skill.md`;
export const VERIFY_IDENTITY_URL = `${API_BASE_URL}/agents/verify-identity`;
