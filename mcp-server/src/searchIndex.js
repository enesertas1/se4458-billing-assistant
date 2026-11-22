// Full-text index over the guide chunks, built ONCE at server start (not per query).
//
// - Library: MiniSearch (in-memory inverted index, BM25+ ranking).
// - Fields: heading (boost 3), parentHeading (boost 1.5), text (boost 1).
// - English stop words are dropped; prefix matching for terms > 3 chars
//   ("pay" also hits "payment"); small typo tolerance for long terms.
// - Query expansion with a tiny domain synonym list ("data" -> "internet", ...),
//   because the guide uses its own vocabulary.

const fs = require('fs');
const path = require('path');
const MiniSearch = require('minisearch');
const { chunkMarkdown } = require('./chunker');

const DEFAULT_DOC = path.join(__dirname, '..', 'data', 'Mobile_Provider_Billing_Guide.md');

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'does', 'for', 'from', 'how', 'i',
  'if', 'in', 'is', 'it', 'its', 'me', 'my', 'of', 'on', 'or', 'the', 'this', 'to', 'what', 'when',
  'which', 'who', 'why', 'will', 'with', 'you', 'your', 'much', 'there', 'that', 'should', 'would',
]);

const SYNONYMS = {
  data: ['internet'],
  mobile: ['internet'],
  gb: ['internet'],
  mb: ['internet'],
  call: ['phone', 'minutes'],
  calls: ['phone', 'minutes'],
  talk: ['phone', 'minutes'],
  price: ['cost', 'costs', 'charge'],
  pricing: ['cost', 'costs', 'charge'],
  fee: ['cost', 'charge'],
  fees: ['cost', 'charge'],
  expensive: ['higher', 'charge'],
  high: ['higher'],
  part: ['partial'],
  installment: ['partial'],
  installments: ['partial'],
  late: ['due', 'unpaid'],
  overdue: ['due', 'unpaid'],
  deadline: ['due'],
  complaint: ['dispute'],
  refund: ['dispute', 'refund'],
  wrong: ['dispute'],
  suspend: ['restricted', 'restriction'],
  cut: ['restricted', 'restriction'],
};

function processTerm(term) {
  const t = term.toLowerCase();
  return STOP_WORDS.has(t) ? null : t;
}

function expandQuery(query) {
  const words = query.toLowerCase().match(/[a-z0-9]+/g) || [];
  const extra = words.flatMap((w) => SYNONYMS[w] || []);
  return [...new Set([...words, ...extra])].join(' ');
}

function buildIndex(docPath = DEFAULT_DOC) {
  const markdown = fs.readFileSync(docPath, 'utf8');
  const { title, documentId, chunks } = chunkMarkdown(markdown);

  const mini = new MiniSearch({
    idField: 'id',
    fields: ['heading', 'parentHeading', 'text'],
    storeFields: ['section', 'heading', 'parentSection', 'parentHeading', 'text'],
    processTerm,
    searchOptions: {
      boost: { heading: 3, parentHeading: 1.5, text: 1 },
      prefix: (term) => term.length > 3,
      fuzzy: (term) => (term.length > 5 ? 0.2 : false),
      combineWith: 'OR',
    },
  });
  mini.addAll(chunks);

  return {
    document: path.basename(docPath),
    documentId,
    title,
    chunkCount: chunks.length,
    indexedAt: new Date().toISOString(),
    chunks,

    search(query, maxResults = 3) {
      const expanded = expandQuery(query);
      if (!expanded) return [];
      return mini.search(expanded)
        .slice(0, maxResults)
        .map((r) => ({
          section: r.section,
          heading: r.heading,
          parentSection: r.parentSection,
          parentHeading: r.parentHeading,
          text: r.text,
          score: Math.round(r.score * 100) / 100,
        }));
    },
  };
}

module.exports = { buildIndex, expandQuery };
