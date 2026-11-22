require('dotenv').config({ quiet: true });
const path = require('path');

// All settings come from agent/.env (see .env.example).
function loadConfig(env = process.env) {
  return {
    geminiApiKey: env.GEMINI_API_KEY,
    geminiModel: env.GEMINI_MODEL || 'gemini-3.1-flash-lite',
    geminiApiVersion: env.GEMINI_API_VERSION || '', // optional, e.g. v1beta

    // Base URL of the API GATEWAY (e.g. https://<apim>.azure-api.net). Locally it can point
    // straight at the Billing API (http://localhost:3000) until the gateway exists.
    billingApiUrl: (env.BILLING_API_URL || 'http://localhost:3000').replace(/\/+$/, ''),
    // Azure API Management subscription key, sent as "Ocp-Apim-Subscription-Key" (optional).
    gatewayKey: env.GATEWAY_SUBSCRIPTION_KEY || '',

    // MCP: if MCP_URL is set -> Streamable HTTP; otherwise the local stdio server is started.
    mcpUrl: env.MCP_URL || '',
    mcpApiKey: env.MCP_API_KEY || '',
    mcpStdioScript: env.MCP_STDIO_SCRIPT || path.join(__dirname, '..', '..', 'mcp-server', 'src', 'stdio.js'),

    logDir: env.AGENT_LOG_DIR || path.join(__dirname, '..', 'logs'),
    maxToolRounds: Number(env.AGENT_MAX_TOOL_ROUNDS) || 6,
  };
}

module.exports = { loadConfig };
