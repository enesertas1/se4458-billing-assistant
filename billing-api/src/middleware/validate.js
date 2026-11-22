const { z } = require('zod');
const { ApiError } = require('../errors');

const subscriberNo = z.string().trim().regex(/^[0-9]{4,20}$/, 'subscriberNo must be 4-20 digits');
const year = z.coerce.number().int().min(2000).max(2100);
const month = z.coerce.number().int().min(1).max(12);
const money = z.coerce.number()
  .positive('amount must be greater than 0')
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'amount can have at most 2 decimals');

const schemas = {
  login: z.object({ username: z.string().min(1), password: z.string().min(1) }),
  addUsage: z.object({ subscriberNo, year, month, usageType: z.enum(['PHONE', 'INTERNET']) }),
  period: z.object({ subscriberNo, year, month }),
  periodPaged: z.object({
    subscriberNo, year, month,
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  }),
  payBill: z.object({
    subscriberNo, year, month,
    amount: money,
    transactionId: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, 'transactionId may contain letters, digits, - and _'),
  }),
};

// source = 'body' | 'query'. Parsed values are put on req.valid.
function validate(schemaName, source) {
  const schema = schemas[schemaName];
  return (req, _res, next) => {
    const result = schema.safeParse(req[source] || {});
    if (!result.success) {
      const details = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
      return next(new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed', details));
    }
    req.valid = result.data;
    return next();
  };
}

module.exports = { validate, schemas };
