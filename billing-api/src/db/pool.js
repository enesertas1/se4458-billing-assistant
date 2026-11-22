const { Pool } = require('pg');

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set (see .env.example)');
  // Azure Database for PostgreSQL requires TLS -> set DB_SSL=true in the cloud.
  const ssl = process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false;
  return new Pool({ connectionString, ssl, max: 10 });
}

module.exports = { createPool };
