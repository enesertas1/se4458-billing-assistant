const request = require('supertest');
const jwt = require('jsonwebtoken');
const { buildTestApp, login, seedBill, JWT_SECRET } = require('./helpers');

let app, repo, adminToken, ayseToken;

beforeEach(async () => {
  ({ app, repo } = buildTestApp());
  adminToken = await login(app, 'admin', 'Admin123!');
  ayseToken = await login(app, 'ayse', 'Ayse123!');
});

const auth = (t) => ({ Authorization: `Bearer ${t}` });

// ---------------------------------------------------------------------------
describe('POST /api/v1/auth/login', () => {
  test('returns a JWT with role and subscriberNo for valid credentials', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ username: 'ayse', password: 'Ayse123!' });
    expect(res.status).toBe(200);
    const payload = jwt.verify(res.body.accessToken, JWT_SECRET);
    expect(payload).toMatchObject({ sub: 'ayse', role: 'SUBSCRIBER', subscriberNo: '5551001' });
  });

  test('rejects wrong password with 401', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ username: 'ayse', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});

// ---------------------------------------------------------------------------
describe('POST /api/v1/usage (Add Usage)', () => {
  test('adds 10 minutes for PHONE and 1 MB for INTERNET', async () => {
    const phone = await request(app).post('/api/v1/usage').set(auth(adminToken))
      .send({ subscriberNo: '5551001', year: 2026, month: 11, usageType: 'PHONE' });
    expect(phone.status).toBe(201);
    expect(phone.body).toMatchObject({ transactionStatus: 'SUCCESS', amountAdded: 10, unit: 'minutes' });

    const net = await request(app).post('/api/v1/usage').set(auth(adminToken))
      .send({ subscriberNo: '5551001', year: 2026, month: 11, usageType: 'INTERNET' });
    expect(net.body).toMatchObject({ amountAdded: 1, unit: 'MB', periodTotals: { phoneMinutes: 10, internetMb: 1 } });
  });

  test('requires authentication (401 without token)', async () => {
    const res = await request(app).post('/api/v1/usage')
      .send({ subscriberNo: '5551001', year: 2026, month: 11, usageType: 'PHONE' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  test('subscriber role cannot add usage (403)', async () => {
    const res = await request(app).post('/api/v1/usage').set(auth(ayseToken))
      .send({ subscriberNo: '5551001', year: 2026, month: 11, usageType: 'PHONE' });
    expect(res.status).toBe(403);
  });

  test('validates usageType and month (400)', async () => {
    const res = await request(app).post('/api/v1/usage').set(auth(adminToken))
      .send({ subscriberNo: '5551001', year: 2026, month: 13, usageType: 'SMS' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d) => d.field).sort()).toEqual(['month', 'usageType']);
  });

  test('unknown subscriber returns 404', async () => {
    const res = await request(app).post('/api/v1/usage').set(auth(adminToken))
      .send({ subscriberNo: '9999999', year: 2026, month: 11, usageType: 'PHONE' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SUBSCRIBER_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
describe('POST /api/v1/bills/calculate (Calculate Bill)', () => {
  test('calculates and stores the bill (guide 4.3 example = $80)', async () => {
    const res = await seedBill(app, repo, adminToken, { subscriberNo: '5551001', year: 2026, month: 10, phone: 1350, internetMb: 35000 });
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(true);
    expect(res.body.bill).toMatchObject({ billTotal: 80, paidAmount: 0, remainingBalance: 80, status: 'UNPAID', dueDate: '2026-11-15' });
  });

  test('a month with no usage still costs the $50 internet base fee', async () => {
    const res = await request(app).post('/api/v1/bills/calculate').set(auth(adminToken))
      .send({ subscriberNo: '5551002', year: 2026, month: 11 });
    expect(res.body.bill.billTotal).toBe(50);
  });

  test('re-calculation updates the total and keeps the paid amount (200)', async () => {
    await seedBill(app, repo, adminToken, { subscriberNo: '5551001', year: 2026, month: 10, internetMb: 10000 }); // $50
    await request(app).post('/api/v1/payments').set(auth(ayseToken))
      .send({ subscriberNo: '5551001', year: 2026, month: 10, amount: 20, transactionId: 'TX-1' });
    const res = await seedBill(app, repo, adminToken, { subscriberNo: '5551001', year: 2026, month: 10, internetMb: 15000 }); // now 25 GB -> $60
    expect(res.status).toBe(200);
    expect(res.body.bill).toMatchObject({ billTotal: 60, paidAmount: 20, remainingBalance: 40, status: 'PARTIALLY_PAID' });
  });

  test('requires ADMIN role (403 for subscriber)', async () => {
    const res = await request(app).post('/api/v1/bills/calculate').set(auth(ayseToken))
      .send({ subscriberNo: '5551001', year: 2026, month: 10 });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
describe('GET /api/v1/bills (Query Bill)', () => {
  test('returns total, paid amount, remaining balance and status without auth', async () => {
    await seedBill(app, repo, adminToken, { subscriberNo: '5551001', year: 2026, month: 10, phone: 1350, internetMb: 35000 });
    const res = await request(app).get('/api/v1/bills').query({ subscriberNo: '5551001', year: 2026, month: 10 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ billTotal: 80, paidAmount: 0, remainingBalance: 80, status: 'UNPAID' });
  });

  test('returns 404 when the bill has not been calculated', async () => {
    const res = await request(app).get('/api/v1/bills').query({ subscriberNo: '5551001', year: 2025, month: 1 });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('BILL_NOT_FOUND');
  });

  test('returns 400 for missing parameters', async () => {
    const res = await request(app).get('/api/v1/bills').query({ subscriberNo: '5551001' });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe('GET /api/v1/bills/detailed (Query Bill Detailed)', () => {
  beforeEach(async () => {
    for (let i = 0; i < 5; i++) await repo.addUsageEvent({ subscriberNo: '5551001', year: 2026, month: 10, usageType: 'PHONE', amount: 270 });
    await seedBill(app, repo, adminToken, { subscriberNo: '5551001', year: 2026, month: 10, internetMb: 35000 });
  });

  test('returns usage, charge breakdown and paged usage records', async () => {
    const res = await request(app).get('/api/v1/bills/detailed').set(auth(ayseToken))
      .query({ subscriberNo: '5551001', year: 2026, month: 10, page: 2, pageSize: 2 });
    expect(res.status).toBe(200);
    expect(res.body.usage).toEqual({ phoneMinutes: 1350, internetMb: 35000, internetGb: 35 });
    expect(res.body.charges).toEqual([
      expect.objectContaining({ item: 'PHONE', amount: 10 }),
      expect.objectContaining({ item: 'INTERNET', amount: 70 }),
    ]);
    expect(res.body.usageRecords).toMatchObject({ page: 2, pageSize: 2, totalItems: 6, totalPages: 3 });
    expect(res.body.usageRecords.items).toHaveLength(2);
  });

  test('a subscriber cannot read another subscriber\'s details (403)', async () => {
    const mehmetToken = await login(app, 'mehmet', 'Mehmet123!');
    const res = await request(app).get('/api/v1/bills/detailed').set(auth(mehmetToken))
      .query({ subscriberNo: '5551001', year: 2026, month: 10 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  test('requires authentication (401)', async () => {
    const res = await request(app).get('/api/v1/bills/detailed').query({ subscriberNo: '5551001', year: 2026, month: 10 });
    expect(res.status).toBe(401);
  });

  test('rejects an invalid / tampered token (401)', async () => {
    const forged = jwt.sign({ role: 'ADMIN' }, 'not-the-secret', { subject: 'x', issuer: 'se4458-billing-api' });
    const res = await request(app).get('/api/v1/bills/detailed').set(auth(forged))
      .query({ subscriberNo: '5551001', year: 2026, month: 10 });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  test('rejects pageSize above 100 (400)', async () => {
    const res = await request(app).get('/api/v1/bills/detailed').set(auth(ayseToken))
      .query({ subscriberNo: '5551001', year: 2026, month: 10, pageSize: 500 });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe('POST /api/v1/payments (Pay Bill)', () => {
  const pay = (token, body) => request(app).post('/api/v1/payments').set(auth(token))
    .send({ subscriberNo: '5551001', year: 2026, month: 10, ...body });

  beforeEach(async () => {
    await seedBill(app, repo, adminToken, { subscriberNo: '5551001', year: 2026, month: 10, phone: 1350, internetMb: 35000 }); // $80
  });

  test('partial payment keeps the remaining balance', async () => {
    const res = await pay(ayseToken, { amount: 30.5, transactionId: 'TX-A' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ paymentStatus: 'SUCCESS', paidAmount: 30.5, totalPaid: 30.5, remainingBalance: 49.5, billStatus: 'PARTIALLY_PAID' });
  });

  test('full payment marks the bill PAID and Query Bill reflects it', async () => {
    await pay(ayseToken, { amount: 30, transactionId: 'TX-A' });
    const res = await pay(ayseToken, { amount: 50, transactionId: 'TX-B' });
    expect(res.body).toMatchObject({ remainingBalance: 0, billStatus: 'PAID' });
    const bill = await request(app).get('/api/v1/bills').query({ subscriberNo: '5551001', year: 2026, month: 10 });
    expect(bill.body.status).toBe('PAID');
  });

  test('rejects duplicate transaction IDs (409) and does not charge twice', async () => {
    await pay(ayseToken, { amount: 10, transactionId: 'TX-DUP' });
    const res = await pay(ayseToken, { amount: 10, transactionId: 'TX-DUP' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_TRANSACTION');
    expect(repo.state.payments).toHaveLength(1);
    expect(repo.state.bills[0].paidAmount).toBe(10);
  });

  test('rejects an amount above the remaining balance (422)', async () => {
    const res = await pay(ayseToken, { amount: 80.01, transactionId: 'TX-BIG' });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: 'AMOUNT_EXCEEDS_BALANCE', details: { remainingBalance: 80 } });
  });

  test('rejects payment on a fully paid bill (409)', async () => {
    await pay(ayseToken, { amount: 80, transactionId: 'TX-FULL' });
    const res = await pay(ayseToken, { amount: 1, transactionId: 'TX-AGAIN' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BILL_ALREADY_PAID');
  });

  test('rejects zero / negative amounts and more than 2 decimals (400)', async () => {
    expect((await pay(ayseToken, { amount: 0, transactionId: 'TX-0' })).status).toBe(400);
    expect((await pay(ayseToken, { amount: -5, transactionId: 'TX-N' })).status).toBe(400);
    expect((await pay(ayseToken, { amount: 1.234, transactionId: 'TX-D' })).status).toBe(400);
  });

  test('cannot pay someone else\'s bill even with their subscriber number (403)', async () => {
    const mehmetToken = await login(app, 'mehmet', 'Mehmet123!');
    const res = await pay(mehmetToken, { amount: 10, transactionId: 'TX-X' });
    expect(res.status).toBe(403);
  });

  test('bill that was never calculated returns 404', async () => {
    const res = await request(app).post('/api/v1/payments').set(auth(ayseToken))
      .send({ subscriberNo: '5551001', year: 2026, month: 1, amount: 5, transactionId: 'TX-404' });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe('misc', () => {
  test('unknown route returns JSON 404', async () => {
    const res = await request(app).get('/api/v2/bills');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
  });

  test('health endpoint and OpenAPI document are served', async () => {
    expect((await request(app).get('/health')).body.status).toBe('ok');
    const spec = await request(app).get('/openapi.json');
    expect(spec.body.paths).toHaveProperty('/api/v1/payments');
  });
});
