require('dotenv').config({ quiet: true });
const { createPool } = require('./db/pool');
const { migrate } = require('./db/migrate');
const { createPgRepository } = require('./repositories/pgRepository');
const { createApp } = require('./app');

async function main() {
  const pool = createPool();
  await migrate(pool); // tables are created on startup if missing
  const app = createApp({ repo: createPgRepository(pool), jwtSecret: process.env.JWT_SECRET });
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => console.log(`Billing API listening on :${port}  (Swagger: /swagger)`));
}

main().catch((e) => {
  console.error('Failed to start:', e);
  process.exit(1);
});
