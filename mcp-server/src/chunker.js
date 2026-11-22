// Splits the billing guide (Markdown) into searchable chunks.
//
// Strategy: one chunk per "###" subsection (e.g. "3.2 Additional internet blocks").
// A "##" section that has text before its first subsection (or no subsections at all,
// e.g. "1. Scope and terminology") becomes its own chunk too. The document header
// (ID, version, scope note) becomes section "0". Every chunk keeps its section number
// so answers can cite "Section 3.2".

const H1 = /^#\s+(.+)$/;
const H2 = /^##\s+(\d+)\.\s+(.+)$/;
const H3 = /^###\s+(\d+\.\d+)\s+(.+)$/;

function clean(lines) {
  return lines
    .join('\n')
    .replace(/\*\*(.+?)\*\*/g, '$1') // **bold** -> bold
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function chunkMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const chunks = [];
  let title = '';
  let documentId = '';
  let current = { section: '0', heading: 'Document overview', parentSection: '0', parentHeading: 'Document overview', lines: [] };
  let parent = { section: '0', heading: 'Document overview' };
  let inCode = false;

  const flush = () => {
    const text = clean(current.lines);
    if (text) {
      chunks.push({
        id: `S${current.section}`,
        section: current.section,
        heading: current.heading,
        parentSection: current.parentSection,
        parentHeading: current.parentHeading,
        text,
      });
    }
  };

  for (const line of lines) {
    if (line.trim().startsWith('```')) inCode = !inCode;
    if (!inCode) {
      const h1 = line.match(H1);
      const h2 = line.match(H2);
      const h3 = line.match(H3);
      if (h1 && !h2 && !h3) {
        title = h1[1].trim();
        continue;
      }
      if (h2) {
        flush();
        parent = { section: h2[1], heading: h2[2].trim() };
        current = { section: parent.section, heading: parent.heading, parentSection: parent.section, parentHeading: parent.heading, lines: [] };
        continue;
      }
      if (h3) {
        flush();
        current = { section: h3[1], heading: h3[2].trim(), parentSection: parent.section, parentHeading: parent.heading, lines: [] };
        continue;
      }
      const id = line.match(/\*\*Document ID:\*\*\s*([A-Z0-9-]+)/);
      if (id) documentId = id[1];
    }
    current.lines.push(line);
  }
  flush();

  return { title, documentId, chunks };
}

module.exports = { chunkMarkdown };
