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

module.exports = { init, insertEmail, setAgentSummary, listRecent, getById };
