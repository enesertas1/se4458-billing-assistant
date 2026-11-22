// In-memory implementation with the same interface as pgRepository.
// Used by unit tests so they run without a database, cloud or LLM.

function createMemoryRepository({ users = [], subscribers = [] } = {}) {
  const state = {
    users: new Map(users.map((u) => [u.username, { ...u }])),
    subscribers: new Set(subscribers),
    usage: [],
    bills: [],
    payments: [],
    seq: { usage: 0, bill: 0, payment: 0 },
  };

  const findBill = (no, y, m) => state.bills.find((b) => b.subscriberNo === no && b.year === y && b.month === m);
  const clone = (o) => (o ? { ...o } : null);

  const tx = {
    async getBillForUpdate(no, y, m) { return clone(findBill(no, y, m)); },
    async findPaymentByTransactionId(id) { return clone(state.payments.find((p) => p.transactionId === id)); },
    async insertPayment({ transactionId, billId, amount }) {
      if (state.payments.some((p) => p.transactionId === transactionId)) {
        const e = new Error('Duplicate transaction id');
        e.code = 'DUPLICATE_TRANSACTION';
        throw e;
      }
      const p = { id: ++state.seq.payment, transactionId, billId, amount, createdAt: new Date().toISOString() };
      state.payments.push(p);
      return clone(p);
    },
    async updateBillPayment(billId, paidAmount, status) {
      const b = state.bills.find((x) => x.id === billId);
      b.paidAmount = paidAmount;
      b.status = status;
      return clone(b);
    },
  };

  return {
    state,
    async findUser(username) { return clone(state.users.get(username)); },
    async subscriberExists(no) { return state.subscribers.has(no); },
    async addUsageEvent({ subscriberNo, year, month, usageType, amount, source = 'API' }) {
      const e = { id: ++state.seq.usage, subscriberNo, year, month, usageType, amount, source, createdAt: new Date().toISOString() };
      state.usage.push(e);
      return { id: e.id, createdAt: e.createdAt };
    },
    async getUsageTotals(no, y, m) {
      const rows = state.usage.filter((u) => u.subscriberNo === no && u.year === y && u.month === m);
      const sum = (t) => rows.filter((r) => r.usageType === t).reduce((a, r) => a + r.amount, 0);
      return { phoneMinutes: sum('PHONE'), internetMb: sum('INTERNET') };
    },
    async listUsageEvents(no, y, m, { offset, limit }) {
      const rows = state.usage.filter((u) => u.subscriberNo === no && u.year === y && u.month === m);
      return {
        total: rows.length,
        items: rows.slice(offset, offset + limit).map((r) => ({
          id: r.id, usageType: r.usageType, amount: r.amount,
          unit: r.usageType === 'PHONE' ? 'minutes' : 'MB', source: r.source, createdAt: r.createdAt,
        })),
      };
    },
    async upsertBill(b) {
      let bill = findBill(b.subscriberNo, b.year, b.month);
      const created = !bill;
      if (!bill) {
        bill = { id: ++state.seq.bill, paidAmount: 0, ...b };
        state.bills.push(bill);
      } else {
        Object.assign(bill, b);
      }
      bill.status = bill.paidAmount >= bill.total ? 'PAID' : bill.paidAmount > 0 ? 'PARTIALLY_PAID' : 'UNPAID';
      bill.calculatedAt = new Date().toISOString();
      return { bill: clone(bill), created };
    },
    async getBill(no, y, m) { return clone(findBill(no, y, m)); },
    async withTransaction(fn) { return fn(tx); },
    async ping() {},
  };
}

module.exports = { createMemoryRepository };
