// Pure pricing rules from Mobile_Provider_Billing_Guide.md, sections 2-4.
// All internal arithmetic is done in integers (minutes, MB) to avoid floating point errors.

const PHONE_FREE_MINUTES = 1000;
const PHONE_BLOCK_MINUTES = 1000;
const PHONE_BLOCK_PRICE = 10;

const INTERNET_BASE_PRICE = 50;
const INTERNET_INCLUDED_MB = 20 * 1000; // 20 GB, 1 GB = 1,000 MB (guide 3.3)
const INTERNET_BLOCK_MB = 10 * 1000;    // 10 GB
const INTERNET_BLOCK_PRICE = 10;

function phoneCharge(minutes) {
  const extra = Math.max(0, minutes - PHONE_FREE_MINUTES);
  const blocks = Math.ceil(extra / PHONE_BLOCK_MINUTES);
  return { extraBlocks: blocks, charge: blocks * PHONE_BLOCK_PRICE };
}

function internetCharge(mb) {
  const extra = Math.max(0, mb - INTERNET_INCLUDED_MB);
  const blocks = Math.ceil(extra / INTERNET_BLOCK_MB);
  return { extraBlocks: blocks, charge: INTERNET_BASE_PRICE + blocks * INTERNET_BLOCK_PRICE };
}

function calculateBill({ phoneMinutes, internetMb }) {
  if (!Number.isInteger(phoneMinutes) || phoneMinutes < 0) throw new Error('phoneMinutes must be a non-negative integer');
  if (!Number.isInteger(internetMb) || internetMb < 0) throw new Error('internetMb must be a non-negative integer');
  const phone = phoneCharge(phoneMinutes);
  const internet = internetCharge(internetMb);
  return {
    phoneMinutes,
    internetMb,
    internetGb: internetMb / 1000,
    phoneExtraBlocks: phone.extraBlocks,
    internetExtraBlocks: internet.extraBlocks,
    phoneCharge: phone.charge,
    internetCharge: internet.charge,
    total: phone.charge + internet.charge,
  };
}

module.exports = {
  calculateBill,
  phoneCharge,
  internetCharge,
  USAGE_UNIT: { PHONE: 10, INTERNET: 1 }, // Add Usage: +10 minutes or +1 MB per call
};
