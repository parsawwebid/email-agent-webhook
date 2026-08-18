const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const BASE_URL = process.env.RAILWAY_BASE_URL;
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

server.tool(
  'list_emails_by_domain',
  'List emails received from a given sender domain (e.g. "github.com").',
  {
    domain: z.string().describe('Sender domain, without the @, e.g. "github.com"'),
    limit: z.number().int().min(1).max(100).optional(),
  },
  async ({ domain, limit }) => {
    const q = new URLSearchParams({ domain, limit: String(limit || 20) });
    const emails = await apiGet(`/api/emails/search?${q}`);
    return { content: [{ type: 'text', text: JSON.stringify(emails, null, 2) }] };
  }
);

server.tool(
  'search_emails',
  'Search emails by keyword, optionally restricted to one field.',
  {
    query: z.string().describe('Keyword to search for'),
    field: z.enum(['subject', 'body', 'from', 'to', 'all']).optional().describe('Which field to search (default: all)'),
    limit: z.number().int().min(1).max(100).optional(),
  },
  async ({ query, field, limit }) => {
    const q = new URLSearchParams({ keyword: query, limit: String(limit || 20) });
    if (field) q.set('field', field);
    const emails = await apiGet(`/api/emails/search?${q}`);
    return { content: [{ type: 'text', text: JSON.stringify(emails, null, 2) }] };
  }
);

server.tool(
  'list_emails_in_range',
  'List emails received within a date/time range (ISO 8601 timestamps).',
  {
    from_date: z.string().describe('Start of range, ISO 8601, e.g. "2026-08-01T00:00:00Z"'),
    to_date: z.string().describe('End of range, ISO 8601, e.g. "2026-08-18T23:59:59Z"'),
    limit: z.number().int().min(1).max(100).optional(),
  },
  async ({ from_date, to_date, limit }) => {
    const q = new URLSearchParams({ since: from_date, until: to_date, limit: String(limit || 20) });
    const emails = await apiGet(`/api/emails/search?${q}`);
    return { content: [{ type: 'text', text: JSON.stringify(emails, null, 2) }] };
  }
);

server.tool(
  'list_emails',
  'List/filter emails with any combination of filters: sender, domain, date range, keyword, attachments.',
  {
    sender: z.string().optional().describe('Substring to match in the from address'),
    domain: z.string().optional().describe('Sender domain, without the @'),
    from_date: z.string().optional().describe('Start of range, ISO 8601'),
    to_date: z.string().optional().describe('End of range, ISO 8601'),
    has_attachment: z.boolean().optional(),
    keyword: z.string().optional().describe('Keyword to search for'),
    field: z.enum(['subject', 'body', 'from', 'to', 'all']).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  },
  async (args) => {
    const q = new URLSearchParams();
    if (args.sender) q.set('sender', args.sender);
    if (args.domain) q.set('domain', args.domain);
    if (args.from_date) q.set('since', args.from_date);
    if (args.to_date) q.set('until', args.to_date);
    if (args.has_attachment) q.set('has_attachment', 'true');
    if (args.keyword) q.set('keyword', args.keyword);
    if (args.field) q.set('field', args.field);
    q.set('limit', String(args.limit || 20));
    const emails = await apiGet(`/api/emails/search?${q}`);
    return { content: [{ type: 'text', text: JSON.stringify(emails, null, 2) }] };
  }
);

const transport = new StdioServerTransport();
server.connect(transport);
