// MCP over Streamable HTTP – for cloud deployment (Azure App Service).
// Endpoint: POST /mcp   (stateless: every request gets a fresh MCP server + transport,
// but all of them share the SAME index, which is built once at startup).
// Optional protection: if MCP_API_KEY is set, clients must send "Authorization: Bearer <key>".

require('dotenv').config({ quiet: true });
const express = require('express');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { buildIndex } = require('./searchIndex');
const { createBillingMcpServer } = require('./mcpServer');

function createHttpApp({ index, apiKey }) {
  const app = express();
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', document: index.document, documentId: index.documentId, chunks: index.chunkCount, indexedAt: index.indexedAt });
  });

  const requireKey = (req, res, next) => {
    if (!apiKey) return next();
    if (req.headers.authorization === `Bearer ${apiKey}`) return next();
    return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized: missing or invalid MCP API key' }, id: null });
  };

  app.post('/mcp', requireKey, async (req, res) => {
    const server = createBillingMcpServer(index);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[mcp] request failed:', err);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
      }
    }
  });

  // Stateless server: no server-initiated streams or sessions.
  const notAllowed = (_req, res) => res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
  app.get('/mcp', notAllowed);
  app.delete('/mcp', notAllowed);

  return app;
}

if (require.main === module) {
  const index = buildIndex();
  const port = Number(process.env.PORT) || 3001;
  createHttpApp({ index, apiKey: process.env.MCP_API_KEY }).listen(port, () => {
    console.log(`[mcp] indexed ${index.chunkCount} chunks of ${index.document} at ${index.indexedAt}`);
    console.log(`[mcp] Streamable HTTP endpoint: http://localhost:${port}/mcp${process.env.MCP_API_KEY ? ' (API key required)' : ''}`);
  });
}

module.exports = { createHttpApp };
