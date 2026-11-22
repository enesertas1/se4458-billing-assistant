// PostgreSQL implementation of the billing repository.
// The service layer only depends on the method names below, so tests can swap in
// the in-memory repository (dependency injection, as in the API Design lecture).

function mapBill(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    subscriberNo: r.subscriber_no,
    year: Number(r.year),
    month: Number(r.month),
    phoneMinutes: Number(r.phone_minutes),
    internetMb: Number(r.internet_mb),
    phoneCharge: Number(r.phone_charge),
    internetCharge: Number(r.internet_charge),
    total: Number(r.total),
    paidAmount: Number(r.paid_amount),
    status: r.status,
    calculatedAt: r.calculated_at instanceof Date ? r.calculated_at.toISOString() : r.calculated_at,
  };
}

function mapPayment(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    transactionId: r.transaction_id,
    billId: Number(r.bill_id),
    amount: Number(r.amount),
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  };
}

function txMethods(client) {
  return {
    async getBillForUpdate(subscriberNo, year, month) {
      // Row lock: concurrent payments for the same bill are serialized (pessimistic locking).
      const { rows } = await client.query(
        'SELECT * FROM bills WHERE subscriber_no = $1 AND year = $2 AND month = $3 FOR UPDATE',
        [subscriberNo, year, month]
      );
      return mapBill(rows[0]);
    },
    async findPaymentByTransactionId(transactionId) {
      const { rows } = await client.query('SELECT * FROM payments WHERE transaction_id = $1', [transactionId]);
      return mapPayment(rows[0]);
    },
    async insertPayment({ transactionId, billId, amount }) {
      try {
        const { rows } = await client.query(
          'INSERT INTO payments (transaction_id, bill_id, amount) VALUES ($1, $2, $3) RETURNING *',
          [transactionId, billId, amount]
        );
        return mapPayment(rows[0]);
      } catch (err) {
        if (err.code === '23505') {
          const e = new Error('Duplicate transaction id');
          e.code = 'DUPLICATE_TRANSACTION';
          throw e;
        }
        throw err;
      }
    },
    async updateBillPayment(billId, paidAmount, status) {
      const { rows } = await client.query(
        'UPDATE bills SET paid_amount = $2, status = $3 WHERE id = $1 RETURNING *',
        [billId, paidAmount, status]
      );
      return mapBill(rows[0]);
    },
  };
}

function createPgRepository(pool) {
  return {
    async findUser(username) {
      const { rows } = await pool.query('SELECT * FROM app_users WHERE username = $1', [username]);
      const r = rows[0];
      return r ? { username: r.username, passwordHash: r.password_hash, role: r.role, subscriberNo: r.subscriber_no } : null;
    },

    async subscriberExists(subscriberNo) {
      const { rowCount } = await pool.query('SELECT 1 FROM subscribers WHERE subscriber_no = $1', [subscriberNo]);
      return rowCount > 0;
    },

    async addUsageEvent({ subscriberNo, year, month, usageType, amount, source = 'API' }) {
      const { rows } = await pool.query(
        `INSERT INTO usage_events (subscriber_no, year, month, usage_type, amount, source)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
        [subscriberNo, year, month, usageType, amount, source]
      );
      return { id: Number(rows[0].id), createdAt: rows[0].created_at.toISOString() };
    },

    async getUsageTotals(subscriberNo, year, month) {
      const { rows } = await pool.query(
        `SELECT
           COALESCE(SUM(amount) FILTER (WHERE usage_type = 'PHONE'), 0)    AS phone_minutes,
           COALESCE(SUM(amount) FILTER (WHERE usage_type = 'INTERNET'), 0) AS internet_mb
         FROM usage_events WHERE subscriber_no = $1 AND year = $2 AND month = $3`,
        [subscriberNo, year, month]
      );
      return { phoneMinutes: Number(rows[0].phone_minutes), internetMb: Number(rows[0].internet_mb) };
    },

    async listUsageEvents(subscriberNo, year, month, { offset, limit }) {
      const where = 'WHERE subscriber_no = $1 AND year = $2 AND month = $3';
      const params = [subscriberNo, year, month];
      const count = await pool.query(`SELECT COUNT(*)::int AS n FROM usage_events ${where}`, params);
      const { rows } = await pool.query(
        `SELECT id, usage_type, amount, source, created_at FROM usage_events ${where}
         ORDER BY created_at, id OFFSET $4 LIMIT $5`,
        [...params, offset, limit]
      );
      return {
        total: count.rows[0].n,
        items: rows.map((r) => ({
          id: Number(r.id),
          usageType: r.usage_type,
          amount: Number(r.amount),
          unit: r.usage_type === 'PHONE' ? 'minutes' : 'MB',
          source: r.source,
          createdAt: r.created_at.toISOString(),
        })),
      };
    },

    async upsertBill(b) {
      // Re-calculating keeps already paid amount; status is derived again from the new total.
      const { rows } = await pool.query(
        `INSERT INTO bills (subscriber_no, year, month, phone_minutes, internet_mb,
                            phone_charge, internet_charge, total, paid_amount, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 'UNPAID')
         ON CONFLICT (subscriber_no, year, month) DO UPDATE SET
           phone_minutes = EXCLUDED.phone_minutes,
           internet_mb = EXCLUDED.internet_mb,
           phone_charge = EXCLUDED.phone_charge,
           internet_charge = EXCLUDED.internet_charge,
           total = EXCLUDED.total,
           status = CASE WHEN bills.paid_amount >= EXCLUDED.total THEN 'PAID'
                         WHEN bills.paid_amount > 0 THEN 'PARTIALLY_PAID'
                         ELSE 'UNPAID' END,
           calculated_at = now()
         RETURNING *, (xmax = 0) AS inserted`,
        [b.subscriberNo, b.year, b.month, b.phoneMinutes, b.internetMb, b.phoneCharge, b.internetCharge, b.total]
      );
      return { bill: mapBill(rows[0]), created: rows[0].inserted };
    },

    async getBill(subscriberNo, year, month) {
      const { rows } = await pool.query(
        'SELECT * FROM bills WHERE subscriber_no = $1 AND year = $2 AND month = $3',
        [subscriberNo, year, month]
      );
      return mapBill(rows[0]);
    },

    async withTransaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(txMethods(client));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    async ping() {
      await pool.query('SELECT 1');
    },
  };
}

module.exports = { createPgRepository };
