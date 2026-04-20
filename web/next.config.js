const DEFAULT_API_ORIGIN = process.env.NODE_ENV === 'production'
  ? 'https://api.arcbook.xyz'
  : 'http://localhost:3001';
const DEFAULT_API_BASE_URL = `${DEFAULT_API_ORIGIN}/api/v1`;
const LEGACY_PRODUCTION_API_HOSTNAMES = new Set([
  'arc-book-api.vercel.app'
]);

function normalizeApiBaseUrl(value) {
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

function resolveApiOrigin() {
  const configuredBaseUrl = normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_BASE_URL);

  try {
    return new URL(configuredBaseUrl).origin;
  } catch {
    return DEFAULT_API_ORIGIN;
  }
}

const apiOrigin = resolveApiOrigin();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.githubusercontent.com' },
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${apiOrigin}/api/v1/:path*`,
      },
      {
        source: '/content/:path*',
        destination: `${apiOrigin}/content/:path*`,
      },
    ];
  },
  async redirects() {
    return [
      { source: '/home', destination: '/', permanent: true },
      { source: '/r/:path*', destination: '/h/:path*', permanent: true },
    ];
  },
};

module.exports = nextConfig;
