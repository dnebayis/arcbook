const fs = require('fs');
const path = require('path');
const { initializePool, close } = require('../src/config/database');

async function main() {
  const pool = initializePool();

  if (!pool) {
    throw new Error('DATABASE_URL is required to run the owner email migration');
  }

  const sqlPath = path.join(__dirname, 'migrate_unique_owner_email.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  await pool.query(sql);
  console.log('Owner email uniqueness migration applied successfully.');
}

main()
  .catch((error) => {
    console.error('Owner email migration failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await close();
  });
