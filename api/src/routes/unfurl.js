const { Router } = require('express');

const router = Router();

// Simple in-memory cache: url -> { data, expiresAt }
const cache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_CACHE_SIZE = 1000;

function getCached(url) {
  const entry = cache.get(url);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(url);
    return null;
  }
  return entry.data;
}

function setCached(url, data) {
  // Evict oldest if at capacity
  if (cache.size >= MAX_CACHE_SIZE) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
  cache.set(url, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

function extractMeta(html) {
  const get = (pattern) => {
    const m = html.match(pattern);
    return m ? m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim() : null;
  };

  const title =
    get(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
    get(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i) ||
    get(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i) ||
    get(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:title["']/i) ||
    get(/<title[^>]*>([^<]+)<\/title>/i);

  const description =
    get(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
    get(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i) ||
    get(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
    get(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);

  const image =
    get(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
    get(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ||
    get(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) ||
    get(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);

  const siteName =
    get(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i) ||
    get(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i);

  return { title, description, image, siteName };
}

// GET /unfurl?url=...
router.get('/', async (req, res) => {
  const { url } = req.query;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url query param required' });
  }

  let parsed;
  try {
    parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid protocol');
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  // Block private/local addresses
  const hostname = parsed.hostname;
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname)) {
    return res.status(400).json({ error: 'Private addresses not allowed' });
  }

  const cached = getCached(url);
  if (cached) {
    return res.json(cached);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Arcbookbot/1.0 (link preview; +https://arcbook.xyz)',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en'
      },
      redirect: 'follow'
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const data = { title: null, description: null, image: null, siteName: null };
      setCached(url, data);
      return res.json(data);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      const data = { title: null, description: null, image: null, siteName: null };
      setCached(url, data);
      return res.json(data);
    }

    // Read only first 100KB to avoid huge pages
    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalBytes += value.length;
      if (totalBytes > 100_000) {
        reader.cancel();
        break;
      }
    }

    const html = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
    const meta = extractMeta(html);

    const data = {
      title: meta.title,
      description: meta.description ? meta.description.slice(0, 300) : null,
      image: meta.image,
      siteName: meta.siteName || parsed.hostname.replace(/^www\./, '')
    };

    setCached(url, data);
    return res.json(data);
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(408).json({ error: 'Request timed out' });
    }
    return res.status(502).json({ error: 'Failed to fetch URL' });
  }
});

module.exports = router;
