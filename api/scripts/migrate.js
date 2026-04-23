const fs = require('fs');
const path = require('path');
const { initializePool, close } = require('../src/config/database');

async function migrate() {
  const pool = initializePool();

  if (!pool) {
    throw new Error('DATABASE_URL is required to run migrations');
  }

  const migrationFiles = [
    'schema.sql',
    'migrate_new_tables.sql',
    'migrate_reputation_scores_to_100.sql'
  ];

  for (const file of migrationFiles) {
    const sqlPath = path.join(__dirname, file);
    if (!fs.existsSync(sqlPath)) {
      continue;
    }

    const sql = fs.readFileSync(sqlPath, 'utf8');
    await pool.query(sql);
    console.log(`Applied ${file}`);
  }

  console.log('Database migrations applied successfully.');
}

migrate()
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await close();
  });
