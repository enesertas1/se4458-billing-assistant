// MCP client side of the agent. This path is SEPARATE from the API Gateway path:
// the agent talks to the MCP server directly (stdio locally, Streamable HTTP in the cloud).

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

async function connectMcp({ mcpUrl, mcpApiKey, mcpStdioScript }) {
  let transport;
  let label;
  if (mcpUrl) {
    const headers = mcpApiKey ? { Authorization: `Bearer ${mcpApiKey}` } : {};
    transport = new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: { headers } });
    label = `HTTP ${mcpUrl}`;
  } else {
    transport = new StdioClientTransport({ command: process.execPath, args: [mcpStdioScript], stderr: 'ignore' });
    label = 'stdio (local mcp-server)';
  }

  const client = new Client({ name: 'billing-ai-agent', version: '1.0.0' });
  await client.connect(transport);
  const { tools } = await client.listTools();

  return {
    label,
    tools: tools.map((t) => t.name),
    async searchDocs(query, maxResults = 3) {
      const res = await client.callTool({ name: 'search_billing_documentation', arguments: { query, maxResults } });
      if (res.isError) throw new Error(res.content?.[0]?.text || 'MCP tool error');
      return res.structuredContent ?? JSON.parse(res.content[0].text);
    },
    close: () => client.close(),
  };
}

module.exports = { connectMcp };
