const DEFAULT_API_ORIGIN = process.env.NODE_ENV === 'production'
  ? 'https://api.arcbook.xyz'
  : 'http://localhost:3001';
const DEFAULT_API_BASE_URL = `${DEFAULT_API_ORIGIN}/api/v1`;

function resolveApiOrigin() {
  const configuredBaseUrl = (process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_BASE_URL).replace(/\/+$/, '');

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
