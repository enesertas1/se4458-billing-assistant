// Usage: npm run db:migrate   (creates tables if they do not exist)
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { createPool } = require('./pool');

async function migrate(pool) {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

if (require.main === module) {
  const pool = createPool();
  migrate(pool)
    .then(() => console.log('Schema is up to date.'))
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(() => pool.end());
}

module.exports = { migrate };
