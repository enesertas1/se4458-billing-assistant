const { buildIndex, expandQuery } = require('../src/searchIndex');

const index = buildIndex(); // built once for the whole test file, like in the server
const sectionsFor = (q, n = 3) => index.search(q, n).map((m) => m.section);

describe('three required retrieval tests', () => {
  test('1) "How much does extra internet cost?" -> internet pricing (8.1 / 3.2)', () => {
    const s = sectionsFor('How much does extra internet cost?');
    expect(s[0]).toBe('8.1');
    expect(s).toContain('3.2');
  });

  test('2) "Can I pay only part of my bill?" -> partial payments (8.3 / 5.1)', () => {
    const s = sectionsFor('Can I pay only part of my bill?');
    expect(s.slice(0, 2)).toEqual(['8.3', '5.1']);
  });

  test('3) "How do I dispute a charge?" -> disputes (8.4 / 7.x)', () => {
    const s = sectionsFor('How do I dispute a charge?');
    expect(s[0]).toBe('8.4');
    expect(s).toContain('7.1');
  });
});

describe('search behaviour', () => {
  test('returns section, heading, text and score for every match', () => {
    const [m] = index.search('payment confirmation', 1);
    expect(m).toMatchObject({ section: '5.2', heading: 'Payment confirmation', parentSection: '5' });
    expect(m.text).toMatch(/explicit confirmation/);
    expect(typeof m.score).toBe('number');
  });

  test('synonyms: "data" finds internet sections although the guide never says "data"', () => {
    expect(sectionsFor('extra data charges')).toEqual(expect.arrayContaining(['8.1', '3.2']));
  });

  test('prefix match: "restrict" finds "Service restriction"', () => {
    expect(sectionsFor('restrict', 1)).toEqual(['6.3']);
  });

  test('respects maxResults', () => {
    expect(index.search('bill', 5)).toHaveLength(5);
    expect(index.search('bill', 1)).toHaveLength(1);
  });

  test('unknown words or only stop words return no matches', () => {
    expect(index.search('xyzzy qwerty')).toEqual([]);
    expect(index.search('what is the')).toEqual([]);
  });

  test('index metadata is recorded once at build time', () => {
    expect(index).toMatchObject({ document: 'Mobile_Provider_Billing_Guide.md', documentId: 'MOB-BILLING-2026-01', chunkCount: 26 });
    expect(Date.parse(index.indexedAt)).not.toBeNaN();
  });

  test('expandQuery adds domain synonyms', () => {
    expect(expandQuery('data fee')).toBe('data fee internet cost charge');
  });
});
