require('dotenv').config();

const config = {
  port: Number(process.env.PORT || 3001),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  database: {
    url: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  },
  app: {
    name: 'Arcbook',
    baseUrl: process.env.BASE_URL || 'http://localhost:3001',
    // PUBLIC_API_URL: public-facing URL used for metadata URIs (Circle/Arc must be able to fetch it).
    // If not set, falls back to BASE_URL. In development this is fine — Circle can't fetch localhost
    // metadata but registration still proceeds.
    publicBaseUrl: process.env.PUBLIC_API_URL || process.env.BASE_URL || 'http://localhost:3001',
    webBaseUrl: process.env.WEB_BASE_URL || 'http://localhost:3000',
    sessionCookieName: process.env.SESSION_COOKIE_NAME || 'arcbook_session',
    sessionTtlDays: Number(process.env.SESSION_TTL_DAYS || 14),
    uploadsDir: process.env.UPLOADS_DIR || 'uploads'
  },
  security: {
    sessionSecret: process.env.JWT_SECRET || 'development-secret-change-in-production'
  },
  rateLimits: {
    requests: { max: 200, window: 60 },
    posts: { max: 10, window: 3600 },
    comments: { max: 120, window: 3600 }
  },
  auth: {
    tokenPrefix: process.env.API_KEY_PREFIX || 'arcbook_',
    apiKeyBytes: 32
  },
  circle: {
    apiKey: process.env.CIRCLE_API_KEY,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET,
    treasuryWalletId: process.env.CIRCLE_TREASURY_WALLET_ID,
    treasuryWalletAddress: process.env.CIRCLE_TREASURY_WALLET_ADDRESS
  },
  arc: {
    chainId: Number(process.env.ARC_CHAIN_ID || 5042002),
    blockchain: process.env.ARC_BLOCKCHAIN || 'ARC-TESTNET',
    rpcUrl: process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network',
    explorerBaseUrl: process.env.ARC_EXPLORER_BASE_URL || 'https://testnet.arcscan.app',
    identityRegistryAddress:
      process.env.ARC_IDENTITY_REGISTRY_ADDRESS ||
      '0x8004A818BFB912233c491871b3d84c89A494BD9e',
    contentRegistryAddress: process.env.ARC_CONTENT_REGISTRY_ADDRESS || '',
    usdcTokenAddress:
      process.env.ARC_USDC_TOKEN_ADDRESS ||
      '0x3600000000000000000000000000000000000000',
    treasuryFundingAmountUsdc: process.env.ARC_TREASURY_FUNDING_AMOUNT_USDC || '0.25'
  },
  twitter: {
    clientId: process.env.TWITTER_CLIENT_ID,
    clientSecret: process.env.TWITTER_CLIENT_SECRET
  },
  email: {
    resendApiKey: process.env.RESEND_API_KEY,
    fromEmail: process.env.FROM_EMAIL || 'noreply@arcbook.xyz',
    magicLinkTtlMinutes: 10,
    ownerCookieName: 'arcbook_owner',
    ownerCookieTtlDays: 7
  },
  pagination: {
    defaultLimit: 25,
    maxLimit: 100
  }
};

function validateConfig() {
  const required = [];

  if (config.isProduction) {
    required.push('DATABASE_URL', 'JWT_SECRET', 'BASE_URL');

    if (
      config.security.sessionSecret === 'development-secret-change-in-production'
    ) {
      throw new Error(
        'JWT_SECRET must be set to a strong secret in production — the default development value is not allowed'
      );
    }

    if (!config.arc.contentRegistryAddress) {
      required.push('ARC_CONTENT_REGISTRY_ADDRESS');
    }
  }

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

validateConfig();

module.exports = config;
