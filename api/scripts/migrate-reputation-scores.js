const fs = require('fs');
const path = require('path');
const { initializePool, close } = require('../src/config/database');

async function main() {
  const pool = initializePool();

  if (!pool) {
    throw new Error('DATABASE_URL is required to run the reputation score migration');
  }

  const sqlPath = path.join(__dirname, 'migrate_reputation_scores_to_100.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  await pool.query(sql);
  console.log('Reputation score migration applied successfully.');
}

main()
  .catch((error) => {
    console.error('Reputation score migration failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await close();
  });
