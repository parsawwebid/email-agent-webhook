const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const BASE_URL = process.env.RAILWAY_BASE_URL; // e.g. https://webhook-production-53ad.up.railway.app
const SECRET = process.env.EMAIL_WEBHOOK_SECRET;

if (!BASE_URL) {
  console.error('RAILWAY_BASE_URL env var is required');
  process.exit(1);
}

async function apiGet(path) {
  const resp = await fetch(`${BASE_URL.replace(/\/$/, '')}${path}`, {
    headers: SECRET ? { 'x-email-secret': SECRET } : {},
  });
  if (!resp.ok) throw new Error(`API request failed: ${resp.status}`);
  return resp.json();
}

const server = new McpServer({ name: 'email-agent-mcp', version: '1.0.0' });

server.tool(
  'list_recent_emails',
  'List the most recently received emails (newest first).',
  { limit: z.number().int().min(1).max(50).optional().describe('How many emails to return (default 20)') },
  async ({ limit }) => {
    const emails = await apiGet(`/api/emails?limit=${limit || 20}`);
    return { content: [{ type: 'text', text: JSON.stringify(emails, null, 2) }] };
  }
);

server.tool(
  'get_email',
  'Get the full content (including body) of a single email by id.',
  { id: z.string().describe('The email id, from list_recent_emails') },
  async ({ id }) => {
    const email = await apiGet(`/api/emails/${encodeURIComponent(id)}`);
    return { content: [{ type: 'text', text: JSON.stringify(email, null, 2) }] };
  }
);

const transport = new StdioServerTransport();
server.connect(transport);
