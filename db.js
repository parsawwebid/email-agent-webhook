const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway.internal')
    ? false
    : { rejectUnauthorized: false },
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS emails (
      id TEXT PRIMARY KEY,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      "from" TEXT,
      "to" TEXT,
      subject TEXT,
      text_body TEXT,
      html_body TEXT,
      attachments JSONB,
      agent_summary TEXT
    );
    CREATE INDEX IF NOT EXISTS emails_received_at_idx ON emails (received_at DESC);
  `);
}

function toRecord(row) {
  return {
    id: row.id,
    receivedAt: row.received_at.toISOString(),
    from: row.from,
    to: row.to,
    subject: row.subject,
    text: row.text_body,
    html: row.html_body,
    attachments: row.attachments || [],
    agentSummary: row.agent_summary || undefined,
  };
}

async function insertEmail(record) {
  await pool.query(
    `INSERT INTO emails (id, received_at, "from", "to", subject, text_body, html_body, attachments)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      record.id,
      record.receivedAt,
      record.from || null,
      record.to || null,
      record.subject || null,
      record.text || null,
      record.html || null,
      JSON.stringify(record.attachments || []),
    ]
  );
}

async function setAgentSummary(id, summary) {
  await pool.query(`UPDATE emails SET agent_summary = $2 WHERE id = $1`, [id, summary]);
}

async function listRecent(limit = 20) {
  const { rows } = await pool.query(
    `SELECT * FROM emails ORDER BY received_at DESC LIMIT $1`,
    [limit]
  );
  return rows.map(toRecord);
}

async function getById(id) {
  const { rows } = await pool.query(`SELECT * FROM emails WHERE id = $1`, [id]);
  return rows[0] ? toRecord(rows[0]) : null;
}

// Flexible search/filter used by /api/emails/search and the MCP tools.
// filters: { sender, domain, since, until, hasAttachment, keyword, field, limit }
async function queryEmails(filters = {}) {
  const where = [];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };

  if (filters.sender) where.push(`"from" ILIKE ${p('%' + filters.sender + '%')}`);
  if (filters.domain) where.push(`"from" ILIKE ${p('%@' + filters.domain.replace(/^@/, ''))}`);
  if (filters.since) where.push(`received_at >= ${p(filters.since)}`);
  if (filters.until) where.push(`received_at <= ${p(filters.until)}`);
  if (filters.hasAttachment) where.push(`jsonb_array_length(coalesce(attachments, '[]'::jsonb)) > 0`);

  if (filters.keyword) {
    const kw = p('%' + filters.keyword + '%');
    const field = filters.field || 'all';
    const fieldMap = {
      subject: `subject ILIKE ${kw}`,
      body: `(text_body ILIKE ${kw} OR html_body ILIKE ${kw})`,
      from: `"from" ILIKE ${kw}`,
      to: `"to" ILIKE ${kw}`,
      all: `(subject ILIKE ${kw} OR text_body ILIKE ${kw} OR html_body ILIKE ${kw} OR "from" ILIKE ${kw} OR "to" ILIKE ${kw})`,
    };
    where.push(fieldMap[field] || fieldMap.all);
  }

  const limit = Math.min(Number(filters.limit) || 20, MAX_QUERY_LIMIT);
  const sql = `SELECT * FROM emails
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY received_at DESC LIMIT ${p(limit)}`;

  const { rows } = await pool.query(sql, params);
  return rows.map(toRecord);
}

const MAX_QUERY_LIMIT = 100;

module.exports = { init, insertEmail, setAgentSummary, listRecent, getById, queryEmails };
