// End-to-end MCP protocol test: a real SDK Client talks to our SDK server through an
// in-memory transport (same JSON-RPC messages as stdio/HTTP, but no process or network).

const request = require('supertest');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { buildIndex } = require('../src/searchIndex');
const { createBillingMcpServer } = require('../src/mcpServer');
const { createHttpApp } = require('../src/http');

const index = buildIndex();
let client;

beforeAll(async () => {
  const server = createBillingMcpServer(index);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(clientT);
});

afterAll(async () => client.close());

describe('MCP protocol', () => {
  test('lists exactly one tool with the required name and input schema', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['search_billing_documentation']);
    const tool = tools[0];
    expect(tool.inputSchema.required).toEqual(['query']);
    expect(tool.inputSchema.properties).toHaveProperty('query');
    expect(tool.outputSchema.properties).toHaveProperty('matches');
    expect(tool.annotations.readOnlyHint).toBe(true);
  });

  test('tools/call returns structured excerpts with section references', async () => {
    const res = await client.callTool({ name: 'search_billing_documentation', arguments: { query: 'extra internet cost', maxResults: 2 } });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({ document: 'Mobile_Provider_Billing_Guide.md', documentId: 'MOB-BILLING-2026-01', query: 'extra internet cost' });
    expect(res.structuredContent.matches).toHaveLength(2);
    expect(res.structuredContent.matches[0]).toMatchObject({ section: '8.1' });
    expect(JSON.parse(res.content[0].text)).toEqual(res.structuredContent); // text mirror for older clients
  });

  test('invalid input (query too short) is rejected with an MCP tool error', async () => {
    const res = await client.callTool({ name: 'search_billing_documentation', arguments: { query: 'x' } });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/Input validation error/);
  });

  test('maxResults above 8 is rejected', async () => {
    const res = await client.callTool({ name: 'search_billing_documentation', arguments: { query: 'payment', maxResults: 50 } });
    expect(res.isError).toBe(true);
  });

  test('a query with no hits returns an empty match list (not an error)', async () => {
    const res = await client.callTool({ name: 'search_billing_documentation', arguments: { query: 'xyzzy' } });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent.matches).toEqual([]);
  });
});

describe('HTTP wrapper', () => {
  const app = createHttpApp({ index, apiKey: 'k1' });

  test('/health reports the index that was built at startup', async () => {
    const res = await request(app).get('/health');
    expect(res.body).toMatchObject({ status: 'ok', chunks: 26, indexedAt: index.indexedAt });
  });

  test('POST /mcp without the API key returns 401', async () => {
    const res = await request(app).post('/mcp').send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBe(401);
  });

  test('GET /mcp is not allowed on the stateless server (405)', async () => {
    const res = await request(app).get('/mcp').set('Authorization', 'Bearer k1');
    expect(res.status).toBe(405);
  });
});
