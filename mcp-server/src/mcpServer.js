// MCP server definition (official SDK). Exposes one tool: search_billing_documentation(query).
// The index is passed in, so it is built once and shared by every MCP session/request.

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { z } = require('zod');

const TOOL_NAME = 'search_billing_documentation';

const TOOL_DESCRIPTION =
  'Search the Mobile Provider Billing Guide (policy document MOB-BILLING-2026-01) and return the most ' +
  'relevant passages with section numbers. Use it for general rules: phone/internet pricing and allowances, ' +
  'extra data charges, bill calculation, billing cycles and due dates, partial payments, payment confirmation, ' +
  'late payments, service restriction and billing disputes. It does NOT contain any subscriber\'s usage, ' +
  'bill amounts or payments; use the Billing REST API for those.';

function searchResult(index, query, maxResults) {
  return {
    document: index.document,
    documentId: index.documentId,
    query,
    matches: index.search(query, maxResults),
  };
}

function createBillingMcpServer(index) {
  const server = new McpServer({ name: 'billing-guide-mcp', version: '1.0.0' });

  server.registerTool(
    TOOL_NAME,
    {
      title: 'Search billing documentation',
      description: TOOL_DESCRIPTION,
      inputSchema: {
        query: z.string().trim().min(2).max(300)
          .describe('Keywords or a short question, e.g. "extra internet cost" or "partial payment"'),
        maxResults: z.number().int().min(1).max(8).optional()
          .describe('Maximum number of passages to return (default 3)'),
      },
      outputSchema: {
        document: z.string(),
        documentId: z.string(),
        query: z.string(),
        matches: z.array(z.object({
          section: z.string(),
          heading: z.string(),
          parentSection: z.string(),
          parentHeading: z.string(),
          text: z.string(),
          score: z.number(),
        })),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, maxResults }) => {
      const result = searchResult(index, query, maxResults ?? 3);
      return {
        // structuredContent: machine-readable result; content: same JSON as text for older clients.
        structuredContent: result,
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  return server;
}

module.exports = { createBillingMcpServer, searchResult, TOOL_NAME };
