const { createBillingClient, BillingApiError } = require('../src/billingClient');

function fakeFetch(status, body) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    return { ok: status < 400, status, text: async () => JSON.stringify(body) };
  };
  fn.calls = calls;
  return fn;
}

describe('billingClient', () => {
  test('sends JWT and gateway subscription key headers to the gateway URL', async () => {
    const f = fakeFetch(200, { ok: 1 });
    const client = createBillingClient({ baseUrl: 'https://gw.example.net', gatewayKey: 'gk', fetchImpl: f });
    await client.queryBillDetailed({ token: 't1', subscriberNo: '5551001', year: 2026, month: 10, page: 1, pageSize: 10 });
    expect(f.calls[0].url).toBe('https://gw.example.net/api/v1/bills/detailed?subscriberNo=5551001&year=2026&month=10&page=1&pageSize=10');
    expect(f.calls[0].init.headers).toMatchObject({ Authorization: 'Bearer t1', 'Ocp-Apim-Subscription-Key': 'gk' });
  });

  test('posts JSON body for payments', async () => {
    const f = fakeFetch(201, { paymentStatus: 'SUCCESS' });
    const client = createBillingClient({ baseUrl: 'http://localhost:3000', fetchImpl: f });
    await client.payBill({ token: 't', subscriberNo: '5551001', year: 2026, month: 10, amount: 5, transactionId: 'X' });
    expect(f.calls[0].init.method).toBe('POST');
    expect(JSON.parse(f.calls[0].init.body)).toEqual({ subscriberNo: '5551001', year: 2026, month: 10, amount: 5, transactionId: 'X' });
  });

  test('maps API error bodies to BillingApiError', async () => {
    const client = createBillingClient({ baseUrl: 'http://x', fetchImpl: fakeFetch(409, { error: { code: 'DUPLICATE_TRANSACTION', message: 'dup' } }) });
    await expect(client.payBill({})).rejects.toMatchObject({ status: 409, code: 'DUPLICATE_TRANSACTION', message: 'dup' });
  });

  test('maps gateway-style errors ({statusCode, message}) too', async () => {
    const client = createBillingClient({ baseUrl: 'http://x', fetchImpl: fakeFetch(429, { statusCode: 429, message: 'Rate limit is exceeded' }) });
    await expect(client.queryBill({})).rejects.toMatchObject({ status: 429, code: 'GATEWAY_429' });
  });

  test('network failure becomes NETWORK_ERROR', async () => {
    const client = createBillingClient({ baseUrl: 'http://x', fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
    const err = await client.queryBill({}).catch((e) => e);
    expect(err).toBeInstanceOf(BillingApiError);
    expect(err.code).toBe('NETWORK_ERROR');
  });
});
