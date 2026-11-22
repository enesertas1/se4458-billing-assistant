const fs = require('fs');
const path = require('path');
const { chunkMarkdown } = require('../src/chunker');

const guide = fs.readFileSync(path.join(__dirname, '..', 'data', 'Mobile_Provider_Billing_Guide.md'), 'utf8');

describe('chunkMarkdown', () => {
  const { title, documentId, chunks } = chunkMarkdown(guide);

  test('reads document title and ID', () => {
    expect(title).toBe('Mobile Provider Billing Guide');
    expect(documentId).toBe('MOB-BILLING-2026-01');
  });

  test('creates one chunk per subsection plus overview / section-only chunks', () => {
    expect(chunks).toHaveLength(26);
    const sections = chunks.map((c) => c.section);
    expect(sections).toEqual(expect.arrayContaining(['0', '1', '2.1', '3.2', '4.3', '5.2', '6.3', '7.1', '8.4', '9']));
    expect(new Set(sections).size).toBe(sections.length); // unique IDs
  });

  test('keeps section number, heading and parent section', () => {
    const c = chunks.find((x) => x.section === '3.2');
    expect(c).toMatchObject({ heading: 'Additional internet blocks', parentSection: '3', parentHeading: 'Internet pricing' });
    expect(c.text).toContain('Each additional 10 GB block costs $10');
    expect(c.text).not.toContain('**'); // markdown bold removed
  });

  test('does not treat "#" lines inside code blocks as headings', () => {
    const md = '# T\n\n## 1. A\n\ntext\n\n```\n## 2. not a heading\n```\n';
    const r = chunkMarkdown(md);
    expect(r.chunks).toHaveLength(1);
    expect(r.chunks[0].text).toContain('## 2. not a heading');
  });

  test('handles an empty document', () => {
    expect(chunkMarkdown('').chunks).toEqual([]);
  });
});
