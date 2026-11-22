const express = require('express');
const h = require('./asyncHandler');
const { validate } = require('../middleware/validate');

// /api/v1/bills
function createBillRoutes({ billService, auth }) {
  const r = express.Router();
  const own = auth.requireOwnership((req) => req.valid.subscriberNo);

  // POST /api/v1/bills/calculate – Calculate Bill (auth: ADMIN)
  r.post('/calculate', auth.authenticate, auth.requireRole('ADMIN'), validate('period', 'body'),
    h(async (req, res) => {
      const result = await billService.calculateBill(req.valid);
      res.status(result.created ? 201 : 200).json(result);
    }));

  // GET /api/v1/bills/detailed – Query Bill Detailed (auth: owner or ADMIN, paging)
  r.get('/detailed', auth.authenticate, validate('periodPaged', 'query'), own,
    h(async (req, res) => res.json(await billService.queryBillDetailed(req.valid))));

  // GET /api/v1/bills – Query Bill (no auth, no paging)
  r.get('/', validate('period', 'query'),
    h(async (req, res) => res.json(await billService.queryBill(req.valid))));

  return r;
}

module.exports = { createBillRoutes };
