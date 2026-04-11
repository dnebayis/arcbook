const fs = require('fs');
const path = require('path');
const { initializePool, close } = require('../src/config/database');

async function migrate() {
  const pool = initializePool();

  if (!pool) {
    throw new Error('DATABASE_URL is required to run migrations');
  }

  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  await pool.query(sql);
  console.log('Database schema applied successfully.');
}

migrate()
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await close();
  });
