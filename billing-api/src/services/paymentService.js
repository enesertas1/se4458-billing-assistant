const { ApiError } = require('../errors');
const { toCents, fromCents, statusFor, billNotFound } = require('./billShared');

// Pay Bill: simulated partial/full payment. Runs in a DB transaction with a row lock on the bill.
function createPaymentService(repo) {
  return {
    async payBill({ subscriberNo, year, month, amount, transactionId }) {
      return repo.withTransaction(async (tx) => {
        const existing = await tx.findPaymentByTransactionId(transactionId);
        if (existing) {
          throw new ApiError(409, 'DUPLICATE_TRANSACTION', `Transaction ${transactionId} was already processed`, {
            originalPayment: { transactionId: existing.transactionId, amount: existing.amount, createdAt: existing.createdAt },
          });
        }

        const bill = await tx.getBillForUpdate(subscriberNo, year, month);
        if (!bill) throw billNotFound(subscriberNo, year, month);

        const totalC = toCents(bill.total);
        const paidC = toCents(bill.paidAmount);
        const remainingC = totalC - paidC;
        const amountC = toCents(amount);

        if (remainingC <= 0) {
          throw new ApiError(409, 'BILL_ALREADY_PAID', 'This bill is already fully paid');
        }
        if (amountC > remainingC) {
          throw new ApiError(422, 'AMOUNT_EXCEEDS_BALANCE',
            `Payment amount ${amount} exceeds remaining balance ${fromCents(remainingC)}`,
            { remainingBalance: fromCents(remainingC) });
        }

        try {
          await tx.insertPayment({ transactionId, billId: bill.id, amount: fromCents(amountC) });
        } catch (err) {
          // Two requests with the same id at the same moment: the UNIQUE constraint catches the second one.
          if (err.code === 'DUPLICATE_TRANSACTION') {
            throw new ApiError(409, 'DUPLICATE_TRANSACTION', `Transaction ${transactionId} was already processed`);
          }
          throw err;
        }

        const newPaidC = paidC + amountC;
        const updated = await tx.updateBillPayment(bill.id, fromCents(newPaidC), statusFor(newPaidC, totalC));
        return {
          paymentStatus: 'SUCCESS',
          transactionId,
          subscriberNo, year, month,
          currency: 'USD',
          paidAmount: fromCents(amountC),
          totalPaid: updated.paidAmount,
          remainingBalance: fromCents(totalC - newPaidC),
          billStatus: updated.status,
        };
      });
    },
  };
}

module.exports = { createPaymentService };
