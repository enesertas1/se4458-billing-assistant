#!/usr/bin/env node
// MCP over stdio – for local use: the agent (or Claude Desktop / MCP Inspector) starts this process
// and talks JSON-RPC over stdin/stdout. Logs go to stderr so they do not corrupt the protocol stream.

const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { buildIndex } = require('./searchIndex');
const { createBillingMcpServer } = require('./mcpServer');

async function main() {
  const index = buildIndex();
  console.error(`[mcp] indexed ${index.chunkCount} chunks of ${index.document} at ${index.indexedAt}`);
  const server = createBillingMcpServer(index);
  await server.connect(new StdioServerTransport());
  console.error('[mcp] stdio server ready');
}

main().catch((err) => {
  console.error('[mcp] fatal:', err);
  process.exit(1);
});
