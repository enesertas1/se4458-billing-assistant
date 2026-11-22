const { USAGE_UNIT } = require('./billingCalculator');
const { ensureSubscriber } = require('./billShared');

// Add Usage: every call records +10 minutes (PHONE) or +1 MB (INTERNET).
function createUsageService(repo) {
  return {
    async addUsage({ subscriberNo, year, month, usageType }) {
      await ensureSubscriber(repo, subscriberNo);
      const amount = USAGE_UNIT[usageType];
      const event = await repo.addUsageEvent({ subscriberNo, year, month, usageType, amount });
      const totals = await repo.getUsageTotals(subscriberNo, year, month);
      return {
        transactionStatus: 'SUCCESS',
        usageId: event.id,
        subscriberNo, year, month, usageType,
        amountAdded: amount,
        unit: usageType === 'PHONE' ? 'minutes' : 'MB',
        periodTotals: totals,
      };
    },
  };
}

module.exports = { createUsageService };
