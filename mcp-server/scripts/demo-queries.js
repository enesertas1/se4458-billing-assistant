#!/usr/bin/env node
// Runs the three required retrieval tests through a REAL MCP client.
//
//   npm run demo                      -> starts src/stdio.js and talks to it over stdio
//   MCP_URL=https://<host>/mcp npm run demo   -> talks to a deployed server over Streamable HTTP
//   (add MCP_API_KEY=... if the server requires a key; add --save to write docs/mcp-retrieval-demo.md)

require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const QUERIES = [
  'How much does extra internet cost?',
  'Can I pay only part of my bill?',
  'How do I dispute a charge?',
];

function makeTransport() {
  if (process.env.MCP_URL) {
    const headers = process.env.MCP_API_KEY ? { Authorization: `Bearer ${process.env.MCP_API_KEY}` } : {};
    return { transport: new StreamableHTTPClientTransport(new URL(process.env.MCP_URL), { requestInit: { headers } }), label: `Streamable HTTP ${process.env.MCP_URL}` };
  }
  return {
    transport: new StdioClientTransport({ command: process.execPath, args: [path.join(__dirname, '..', 'src', 'stdio.js')], stderr: 'ignore' }),
    label: 'stdio (local process)',
  };
}

async function main() {
  const { transport, label } = makeTransport();
  const client = new Client({ name: 'billing-demo-client', version: '1.0.0' });
  await client.connect(transport);

  const out = [];
  const log = (s = '') => { console.log(s); out.push(s); };

  const { tools } = await client.listTools();
  log(`# MCP retrieval tests\n\nTransport: ${label}  \nDate: ${new Date().toISOString()}\n`);
  log(`Tools exposed by the server: ${tools.map((t) => `\`${t.name}\``).join(', ')}\n`);

  for (const [i, query] of QUERIES.entries()) {
    const res = await client.callTool({ name: 'search_billing_documentation', arguments: { query, maxResults: 3 } });
    const data = res.structuredContent;
    log(`## Test ${i + 1}: \`search_billing_documentation(${JSON.stringify(query)})\`\n`);
    log('| # | Section | Heading | Score |');
    log('|---|---|---|---|');
    data.matches.forEach((m, k) => log(`| ${k + 1} | ${m.section} | ${m.heading} | ${m.score} |`));
    log(`\nTop passage (Section ${data.matches[0].section}):\n\n> ${data.matches[0].text.replace(/\n/g, '\n> ')}\n`);
  }

  await client.close();

  if (process.argv.includes('--save')) {
    const target = path.join(__dirname, '..', '..', 'docs', 'mcp-retrieval-demo.md');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, out.join('\n') + '\n');
    console.log(`\nSaved to ${path.relative(process.cwd(), target)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
