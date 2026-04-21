const fs = require('fs');
const path = require('path');
const { initializePool, close } = require('../src/config/database');

async function main() {
  const pool = initializePool();

  if (!pool) {
    throw new Error('DATABASE_URL is required to run the owner email preflight');
  }

  const sqlPath = path.join(__dirname, 'preflight_duplicate_owner_emails.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const result = await pool.query(sql);

  if (!result.rows.length) {
    console.log('No duplicate owner emails found.');
    return;
  }

  console.log('Duplicate owner emails detected:');
  for (const row of result.rows) {
    console.log(`- ${row.normalized_owner_email} | count=${row.agent_count} | handles=${row.agent_handles}`);
  }

  process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error('Owner email preflight failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await close();
  });
