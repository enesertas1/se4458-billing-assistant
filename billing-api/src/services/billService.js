const { calculateBill } = require('./billingCalculator');
const { billSummary, ensureSubscriber, billNotFound } = require('./billShared');

// Calculate Bill, Query Bill and Query Bill Detailed.
function createBillService(repo) {
  async function getStoredBill(subscriberNo, year, month) {
    const bill = await repo.getBill(subscriberNo, year, month);
    if (!bill) throw billNotFound(subscriberNo, year, month);
    return bill;
  }

  return {
    async calculateBill({ subscriberNo, year, month }) {
      await ensureSubscriber(repo, subscriberNo);
      const totals = await repo.getUsageTotals(subscriberNo, year, month);
      const c = calculateBill(totals);
      const { bill, created } = await repo.upsertBill({
        subscriberNo, year, month,
        phoneMinutes: c.phoneMinutes, internetMb: c.internetMb,
        phoneCharge: c.phoneCharge, internetCharge: c.internetCharge, total: c.total,
      });
      return { transactionStatus: 'SUCCESS', created, bill: billSummary(bill) };
    },

    async queryBill({ subscriberNo, year, month }) {
      return billSummary(await getStoredBill(subscriberNo, year, month));
    },

    async queryBillDetailed({ subscriberNo, year, month, page, pageSize }) {
      const bill = await getStoredBill(subscriberNo, year, month);
      const c = calculateBill({ phoneMinutes: bill.phoneMinutes, internetMb: bill.internetMb });
      const { items, total } = await repo.listUsageEvents(subscriberNo, year, month, {
        offset: (page - 1) * pageSize, limit: pageSize,
      });
      return {
        ...billSummary(bill),
        usage: {
          phoneMinutes: bill.phoneMinutes,
          internetMb: bill.internetMb,
          internetGb: bill.internetMb / 1000,
        },
        charges: [
          {
            item: 'PHONE',
            description: `First 1,000 minutes free; ${c.phoneExtraBlocks} extra 1,000-minute block(s) x $10`,
            amount: bill.phoneCharge,
          },
          {
            item: 'INTERNET',
            description: `$50 base (up to 20 GB) + ${c.internetExtraBlocks} extra 10 GB block(s) x $10`,
            amount: bill.internetCharge,
          },
        ],
        usageRecords: {
          page, pageSize,
          totalItems: total,
          totalPages: Math.ceil(total / pageSize),
          items,
        },
      };
    },
  };
}

module.exports = { createBillService };
