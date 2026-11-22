const express = require('express');
const h = require('./asyncHandler');
const { validate } = require('../middleware/validate');

// POST /api/v1/usage  – Add Usage (auth: ADMIN)
function createUsageRoutes({ usageService, auth }) {
  const r = express.Router();
  r.post('/', auth.authenticate, auth.requireRole('ADMIN'), validate('addUsage', 'body'),
    h(async (req, res) => res.status(201).json(await usageService.addUsage(req.valid))));
  return r;
}

module.exports = { createUsageRoutes };
