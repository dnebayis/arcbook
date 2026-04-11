const app = require('./app');
const config = require('./config');
const { initializePool, healthCheck, close } = require('./config/database');

let server = null;

async function start() {
  console.log('Starting Arcbook API...');

  try {
    initializePool();
    const dbHealthy = await healthCheck();
    console.log(dbHealthy ? 'Database connected' : 'Database unavailable');
  } catch (error) {
    console.warn('Database connection failed:', error.message);
  }

  server = app.listen(config.port, () => {
    console.log(`Arcbook API listening on ${config.app.baseUrl}`);
  });

  server.on('error', async (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `Arcbook API port ${config.port} is already in use. Another instance is probably running; reusing that process.`
      );
      await close();
      return;
    }

    throw error;
  });
}

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('SIGTERM', async () => {
  if (server?.listening) {
    await new Promise((resolve) => server.close(resolve));
  }
  await close();
  process.exit(0);
});

start();
