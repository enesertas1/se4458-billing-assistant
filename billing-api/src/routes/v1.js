const express = require('express');
const { createAuthRoutes } = require('./authRoutes');
const { createUsageRoutes } = require('./usageRoutes');
const { createBillRoutes } = require('./billRoutes');
const { createPaymentRoutes } = require('./paymentRoutes');

// Version 1 of the public API: mounts one router per resource under /api/v1.
function createV1Router(deps) {
  const r = express.Router();
  r.use('/auth', createAuthRoutes(deps));
  r.use('/usage', createUsageRoutes(deps));
  r.use('/bills', createBillRoutes(deps));
  r.use('/payments', createPaymentRoutes(deps));
  return r;
}

module.exports = { createV1Router };
