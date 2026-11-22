const express = require('express');
const h = require('./asyncHandler');
const { validate } = require('../middleware/validate');

// POST /api/v1/payments – Pay Bill (auth: owner or ADMIN)
function createPaymentRoutes({ paymentService, auth }) {
  const r = express.Router();
  const own = auth.requireOwnership((req) => req.valid.subscriberNo);
  r.post('/', auth.authenticate, validate('payBill', 'body'), own,
    h(async (req, res) => res.status(201).json(await paymentService.payBill(req.valid))));
  return r;
}

module.exports = { createPaymentRoutes };
