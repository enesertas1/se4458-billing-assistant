const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const yaml = require('js-yaml');
const swaggerUi = require('swagger-ui-express');
const { createAuth } = require('./middleware/auth');
const { createAuthService } = require('./services/authService');
const { createUsageService } = require('./services/usageService');
const { createBillService } = require('./services/billService');
const { createPaymentService } = require('./services/paymentService');
const { createV1Router } = require('./routes/v1');
const { errorHandler, notFoundHandler } = require('./errors');

// The app is built from injected dependencies so tests can pass an in-memory repository.
function createApp({ repo, jwtSecret }) {
  if (!jwtSecret) throw new Error('jwtSecret is required');
  const app = express();
  const auth = createAuth({ jwtSecret });
  const deps = {
    auth,
    authService: createAuthService(repo, auth),
    usageService: createUsageService(repo),
    billService: createBillService(repo),
    paymentService: createPaymentService(repo),
  };

  app.use(cors());
  app.use(express.json());

  const openapi = yaml.load(fs.readFileSync(path.join(__dirname, 'openapi.yaml'), 'utf8'));
  app.get('/openapi.json', (_req, res) => res.json(openapi));
  app.use('/swagger', swaggerUi.serve, swaggerUi.setup(openapi));

  app.get('/health', async (_req, res) => {
    try {
      await repo.ping();
      res.json({ status: 'ok', database: 'up' });
    } catch {
      res.status(503).json({ status: 'degraded', database: 'down' });
    }
  });

  // Versioned API: a future breaking change would be mounted at /api/v2 next to v1.
  app.use('/api/v1', createV1Router(deps));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
