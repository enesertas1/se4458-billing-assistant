const bcrypt = require('bcryptjs');
const request = require('supertest');
const { createApp } = require('../src/app');
const { createMemoryRepository } = require('../src/repositories/memoryRepository');

const JWT_SECRET = 'test-secret';

function buildTestApp() {
  const hash = (p) => bcrypt.hashSync(p, 4);
  const repo = createMemoryRepository({
    subscribers: ['5551001', '5551002'],
    users: [
      { username: 'ayse', passwordHash: hash('Ayse123!'), role: 'SUBSCRIBER', subscriberNo: '5551001' },
      { username: 'mehmet', passwordHash: hash('Mehmet123!'), role: 'SUBSCRIBER', subscriberNo: '5551002' },
      { username: 'admin', passwordHash: hash('Admin123!'), role: 'ADMIN', subscriberNo: null },
    ],
  });
  const app = createApp({ repo, jwtSecret: JWT_SECRET });
  return { app, repo };
}

async function login(app, username, password) {
  const res = await request(app).post('/api/v1/auth/login').send({ username, password });
  return res.body.accessToken;
}

// Puts usage straight into the repository and calculates the bill through the API.
async function seedBill(app, repo, adminToken, { subscriberNo, year, month, phone, internetMb }) {
  if (phone) await repo.addUsageEvent({ subscriberNo, year, month, usageType: 'PHONE', amount: phone, source: 'SEED' });
  if (internetMb) await repo.addUsageEvent({ subscriberNo, year, month, usageType: 'INTERNET', amount: internetMb, source: 'SEED' });
  return request(app).post('/api/v1/bills/calculate')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ subscriberNo, year, month });
}

module.exports = { buildTestApp, login, seedBill, JWT_SECRET };
