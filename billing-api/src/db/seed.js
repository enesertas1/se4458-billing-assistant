// Usage: npm run db:seed
// Resets all billing data and loads reproducible demo data (documented in README "Test data").
require('dotenv').config({ quiet: true });
const bcrypt = require('bcryptjs');
const { createPool } = require('./pool');
const { migrate } = require('./migrate');
const { createPgRepository } = require('../repositories/pgRepository');
const { createBillService } = require('../services/billService');
const { createPaymentService } = require('../services/paymentService');

const SUBSCRIBERS = [
  { no: '5551001', name: 'Ayse Yilmaz' },
  { no: '5551002', name: 'Mehmet Demir' },
  { no: '5551003', name: 'Zeynep Kaya' },
];

const USERS = [
  { username: 'ayse', password: 'Ayse123!', role: 'SUBSCRIBER', subscriberNo: '5551001' },
  { username: 'mehmet', password: 'Mehmet123!', role: 'SUBSCRIBER', subscriberNo: '5551002' },
  { username: 'zeynep', password: 'Zeynep123!', role: 'SUBSCRIBER', subscriberNo: '5551003' },
  { username: 'admin', password: 'Admin123!', role: 'ADMIN', subscriberNo: null },
];

// Aggregated monthly usage (minutes / MB). Inserted with source = 'SEED' because recording
// 35 GB through Add Usage would need 35,000 calls (1 MB per call).
const USAGE = [
  { no: '5551001', year: 2026, month: 9, phone: 800, internetMb: 18000 },   // $0 + $50 = $50
  { no: '5551001', year: 2026, month: 10, phone: 1350, internetMb: 35000 }, // $10 + $70 = $80 (guide 4.3)
  { no: '5551002', year: 2026, month: 10, phone: 2500, internetMb: 12000 }, // $20 + $50 = $70
  { no: '5551003', year: 2026, month: 10, phone: 500, internetMb: 21000 },  // $0 + $60 = $60
];

async function seed(pool) {
  await migrate(pool);
  await pool.query('TRUNCATE payments, bills, usage_events, app_users, subscribers RESTART IDENTITY CASCADE');

  for (const s of SUBSCRIBERS) {
    await pool.query('INSERT INTO subscribers (subscriber_no, full_name) VALUES ($1, $2)', [s.no, s.name]);
  }
  for (const u of USERS) {
    await pool.query(
      'INSERT INTO app_users (username, password_hash, role, subscriber_no) VALUES ($1, $2, $3, $4)',
      [u.username, await bcrypt.hash(u.password, 10), u.role, u.subscriberNo]
    );
  }

  const repo = createPgRepository(pool);
  const billService = createBillService(repo);
  const paymentService = createPaymentService(repo);

  for (const u of USAGE) {
    // split each month into a few records so the paged "detailed" view has several items
    const parts = 3;
    for (let i = 0; i < parts; i++) {
      const phone = Math.floor(u.phone / parts) + (i === parts - 1 ? u.phone % parts : 0);
      const mb = Math.floor(u.internetMb / parts) + (i === parts - 1 ? u.internetMb % parts : 0);
      if (phone > 0) await repo.addUsageEvent({ subscriberNo: u.no, year: u.year, month: u.month, usageType: 'PHONE', amount: phone, source: 'SEED' });
      if (mb > 0) await repo.addUsageEvent({ subscriberNo: u.no, year: u.year, month: u.month, usageType: 'INTERNET', amount: mb, source: 'SEED' });
    }
    await billService.calculateBill({ subscriberNo: u.no, year: u.year, month: u.month });
  }

  // Payment history: Ayse paid September fully, Mehmet paid part of October, Zeynep paid October fully.
  await paymentService.payBill({ subscriberNo: '5551001', year: 2026, month: 9, amount: 50, transactionId: 'SEED-TX-0001' });
  await paymentService.payBill({ subscriberNo: '5551002', year: 2026, month: 10, amount: 30, transactionId: 'SEED-TX-0002' });
  await paymentService.payBill({ subscriberNo: '5551003', year: 2026, month: 10, amount: 60, transactionId: 'SEED-TX-0003' });
}

if (require.main === module) {
  const pool = createPool();
  seed(pool)
    .then(() => console.log('Seed data loaded.'))
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(() => pool.end());
}

module.exports = { seed, USERS, SUBSCRIBERS };
