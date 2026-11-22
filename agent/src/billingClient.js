// REST client for the Billing API. Every call goes to config.billingApiUrl, which is the
// API GATEWAY base URL in the deployed system (all REST traffic is routed through the gateway).

class BillingApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message || `HTTP ${status}`);
    this.status = status;
    this.code = body?.error?.code || 'HTTP_ERROR';
    this.body = body;
  }
}

function createBillingClient({ baseUrl, gatewayKey = '', fetchImpl = globalThis.fetch }) {
  async function call(method, path, { token, query, body } = {}) {
    const url = new URL(baseUrl + path);
    if (query) Object.entries(query).forEach(([k, v]) => v !== undefined && url.searchParams.set(k, String(v)));
    const headers = { Accept: 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    if (gatewayKey) headers['Ocp-Apim-Subscription-Key'] = gatewayKey;

    let res;
    try {
      res = await fetchImpl(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch (err) {
      throw new BillingApiError(0, { error: { code: 'NETWORK_ERROR', message: `Cannot reach ${url.origin}: ${err.message}` } });
    }
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!res.ok) {
      // Gateways (e.g. Azure APIM) may use their own error shape: { statusCode, message }
      if (!data.error && data.message) data = { error: { code: `GATEWAY_${res.status}`, message: data.message } };
      throw new BillingApiError(res.status, data);
    }
    return data;
  }

  return {
    login: (username, password) => call('POST', '/api/v1/auth/login', { body: { username, password } }),
    queryBill: ({ subscriberNo, year, month }) =>
      call('GET', '/api/v1/bills', { query: { subscriberNo, year, month } }),
    queryBillDetailed: ({ token, subscriberNo, year, month, page, pageSize }) =>
      call('GET', '/api/v1/bills/detailed', { token, query: { subscriberNo, year, month, page, pageSize } }),
    payBill: ({ token, subscriberNo, year, month, amount, transactionId }) =>
      call('POST', '/api/v1/payments', { token, body: { subscriberNo, year, month, amount, transactionId } }),
  };
}

module.exports = { createBillingClient, BillingApiError };
