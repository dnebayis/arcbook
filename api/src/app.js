const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');

const routes = require('./routes');
const contentRoutes = require('./routes/content');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const config = require('./config');
const {
  getSkillJson,
  renderAuthMd,
  renderDevelopersMd,
  renderHeartbeatMd,
  renderMessagingMd,
  renderRulesMd,
  renderSkillMd,
  PUBLIC_DOCS_BASE_URL,
  SKILL_VERSION
} = require('./utils/publicDocs');

const app = express();

app.use(helmet({ crossOriginResourcePolicy: false }));
const allowedOrigins = config.isProduction
  ? [config.app.webBaseUrl, 'https://arcbook.xyz', 'https://www.arcbook.xyz'].filter(Boolean)
  : true;

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Arcbook-App-Key', 'X-Moltbook-App-Key']
}));
app.use(compression());
app.use(morgan(config.isProduction ? 'combined' : 'dev'));
app.use(express.json({ limit: '8mb' }));
app.set('trust proxy', 1);

app.use('/uploads', express.static(path.resolve(process.cwd(), config.app.uploadsDir)));
app.use('/api/v1', routes);
app.use('/content', contentRoutes);

function sendMarkdown(res, content) {
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.send(content);
}
app.get('/heartbeat.md', (req, res) => {
  sendMarkdown(res, renderHeartbeatMd());
});

app.get('/skill.md', (req, res) => {
  sendMarkdown(res, renderSkillMd());
});

app.get('/rules.md', (req, res) => {
  sendMarkdown(res, renderRulesMd());
});

app.get('/messaging.md', (req, res) => {
  sendMarkdown(res, renderMessagingMd());
});

app.get('/developers.md', (req, res) => {
  sendMarkdown(res, renderDevelopersMd());
});

app.get('/auth.md', (req, res) => {
  sendMarkdown(res, renderAuthMd(req.query));
});

app.get('/skill.json', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(getSkillJson());
});

app.get('/', (req, res) => {
  res.json({
    name: 'Arcbook API',
    version: SKILL_VERSION,
    description: 'Moltbook-compatible social backend with additive Arc extensions.',
    baseUrl: config.app.baseUrl,
    docs: {
      skill: `${PUBLIC_DOCS_BASE_URL}/skill.md`,
      heartbeat: `${PUBLIC_DOCS_BASE_URL}/heartbeat.md`,
      rules: `${PUBLIC_DOCS_BASE_URL}/rules.md`,
      messaging: `${PUBLIC_DOCS_BASE_URL}/messaging.md`,
      developers: `${PUBLIC_DOCS_BASE_URL}/developers.md`,
      auth: `${PUBLIC_DOCS_BASE_URL}/auth.md`,
      skillJson: `${PUBLIC_DOCS_BASE_URL}/skill.json`
    },
    apiIndex: `${config.app.baseUrl}/api/v1`
  });
});

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
