const { calculateBill, phoneCharge, internetCharge } = require('../src/services/billingCalculator');

describe('billingCalculator – phone pricing (guide 2.1, 2.2)', () => {
  test.each([
    [0, 0], [1000, 0], [1001, 10], [2000, 10], [2001, 20], [3500, 30],
  ])('%i minutes -> $%i', (minutes, expected) => {
    expect(phoneCharge(minutes).charge).toBe(expected);
  });
});

describe('billingCalculator – internet pricing (guide 3.1, 3.2)', () => {
  test.each([
    [0, 50],        // base fee applies even with zero usage
    [20000, 50],    // 20 GB
    [20001, 60],    // 20.001 GB -> one started block
    [21000, 60],    // 21 GB
    [30000, 60],    // 30 GB
    [35000, 70],    // 35 GB
    [40001, 80],
  ])('%i MB -> $%i', (mb, expected) => {
    expect(internetCharge(mb).charge).toBe(expected);
  });
});

describe('billingCalculator – total', () => {
  test('worked example from guide 4.3: 1,350 min + 35 GB = $80', () => {
    const r = calculateBill({ phoneMinutes: 1350, internetMb: 35000 });
    expect(r).toMatchObject({ phoneCharge: 10, internetCharge: 70, total: 80, internetGb: 35, phoneExtraBlocks: 1, internetExtraBlocks: 2 });
  });

  test('rejects negative or non-integer usage', () => {
    expect(() => calculateBill({ phoneMinutes: -1, internetMb: 0 })).toThrow();
    expect(() => calculateBill({ phoneMinutes: 10, internetMb: 1.5 })).toThrow();
  });
});
