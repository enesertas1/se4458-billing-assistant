const express = require('express');
const h = require('./asyncHandler');
const { validate } = require('../middleware/validate');

// POST /api/v1/auth/login
function createAuthRoutes({ authService }) {
  const r = express.Router();
  r.post('/login', validate('login', 'body'),
    h(async (req, res) => res.json(await authService.login(req.valid))));
  return r;
}

module.exports = { createAuthRoutes };
