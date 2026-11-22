// Small helpers shared by the bill and payment services.
const { ApiError } = require('../errors');

const toCents = (x) => Math.round(Number(x) * 100);
const fromCents = (c) => c / 100;

// Guide 6.1: a monthly bill is due 15 calendar days after the end of its billing month.
function dueDateOf(year, month) {
  const endOfMonth = new Date(Date.UTC(year, month, 0)); // day 0 of next month = last day of this month
  endOfMonth.setUTCDate(endOfMonth.getUTCDate() + 15);
  return endOfMonth.toISOString().slice(0, 10);
}

function statusFor(paidCents, totalCents) {
  if (paidCents >= totalCents) return 'PAID';
  if (paidCents > 0) return 'PARTIALLY_PAID';
  return 'UNPAID';
}

const periodLabel = (year, month) => `${year}-${String(month).padStart(2, '0')}`;

// Public representation of a stored bill (used by Query Bill and Calculate Bill responses).
function billSummary(bill) {
  return {
    subscriberNo: bill.subscriberNo,
    year: bill.year,
    month: bill.month,
    currency: 'USD',
    billTotal: bill.total,
    paidAmount: bill.paidAmount,
    remainingBalance: fromCents(Math.max(0, toCents(bill.total) - toCents(bill.paidAmount))),
    status: bill.status,
    dueDate: dueDateOf(bill.year, bill.month),
    calculatedAt: bill.calculatedAt,
  };
}

async function ensureSubscriber(repo, subscriberNo) {
  if (!(await repo.subscriberExists(subscriberNo))) {
    throw new ApiError(404, 'SUBSCRIBER_NOT_FOUND', `Subscriber ${subscriberNo} does not exist`);
  }
}

function billNotFound(subscriberNo, year, month) {
  return new ApiError(404, 'BILL_NOT_FOUND',
    `No calculated bill for subscriber ${subscriberNo} in ${periodLabel(year, month)}. Call Calculate Bill first.`);
}

module.exports = { toCents, fromCents, dueDateOf, statusFor, billSummary, ensureSubscriber, billNotFound };
