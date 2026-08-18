const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const db = require('./db');

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const SHARED_SECRET = process.env.EMAIL_WEBHOOK_SECRET;
// Optional: forward every parsed email to another agent/webhook URL
const AGENT_WEBHOOK_URL = process.env.AGENT_WEBHOOK_URL;
// How often (ms) the dashboard auto-refreshes over the websocket, even with no new mail
const BROADCAST_INTERVAL_MS = Number(process.env.BROADCAST_INTERVAL_MS || 10000);
const MAX_RECENT = 50;

// Optional: OpenAI-compatible endpoint (vLLM / mistral.rs / etc) serving a Hermes model.
// Every incoming email gets triaged through it automatically.
const HERMES_API_URL = process.env.HERMES_API_URL; // e.g. https://your-host:8000
const HERMES_API_KEY = process.env.HERMES_API_KEY; // optional bearer token
const HERMES_MODEL = process.env.HERMES_MODEL || 'hermes-3';

async function triageWithHermes(email) {
  if (!HERMES_API_URL) return null;
  const body = (email.text || email.html || '').slice(0, 4000);
  const resp = await fetch(`${HERMES_API_URL.replace(/\/$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(HERMES_API_KEY ? { authorization: `Bearer ${HERMES_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      model: HERMES_MODEL,
      messages: [
        { role: 'system', content: 'You triage incoming emails. Reply with a 1-3 sentence summary and flag anything that needs action. Be concise, no preamble.' },
        { role: 'user', content: `From: ${email.from}\nSubject: ${email.subject}\n\n${body}` },
      ],
      max_tokens: 250,
      temperature: 0.2,
    }),
  });
  if (!resp.ok) throw new Error(`Hermes API returned ${resp.status}`);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content?.trim() || null;
}

function checkSecret(req, res, next) {
  if (!SHARED_SECRET) return next(); // no secret configured yet, allow through
  const provided = req.get('x-email-secret');
  if (provided !== SHARED_SECRET) {
    return res.status(401).json({ error: 'invalid secret' });
  }
  next();
}

app.get('/api/status', async (_req, res) => {
  const recent = await db.listRecent(1);
  res.json({ ok: true, service: 'email-agent-webhook', dbConnected: true, hasEmails: recent.length > 0 });
});

app.get('/emails', async (_req, res) => {
  res.json(await db.listRecent(MAX_RECENT));
});

app.post('/webhook/email', checkSecret, async (req, res) => {
  const email = req.body;

  console.log('Received email:', {
    from: email.from,
    to: email.to,
    subject: email.subject,
  });

  const record = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, receivedAt: new Date().toISOString(), ...email };

  try {
    await db.insertEmail(record);
  } catch (err) {
    console.error('Failed to persist email to db:', err);
  }

  broadcast({ type: 'new_email', email: record });

  // Hand off to your agent(s) here. A few common patterns:
  // 1) Forward to another service/agent over HTTP:
  if (AGENT_WEBHOOK_URL) {
    try {
      await fetch(AGENT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(email),
      });
    } catch (err) {
      console.error('Failed to forward to agent webhook:', err);
    }
  }

  // 2) Auto-triage every email through a Hermes (OpenAI-compatible) endpoint.
  // Runs after responding to Cloudflare so it never delays/risks the email accept.
  if (HERMES_API_URL) {
    triageWithHermes(record)
      .then(async (summary) => {
        if (!summary) return;
        record.agentSummary = summary;
        try {
          await db.setAgentSummary(record.id, summary);
        } catch (err) {
          console.error('Failed to persist agent summary:', err);
        }
        broadcast({ type: 'email_update', id: record.id, agentSummary: summary });
      })
      .catch((err) => console.error('Hermes triage failed:', err));
  }

  // 3) Or call your agent logic directly in-process, e.g.:
  // await runAgent(email);

  res.status(200).json({ ok: true });
});

// --- Authenticated read API, meant for agents/tools (e.g. an MCP server for Claude Code) ---
app.get('/api/emails', checkSecret, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, MAX_RECENT);
  res.json(await db.listRecent(limit));
});

app.get('/api/emails/:id', checkSecret, async (req, res) => {
  const found = await db.getById(req.params.id);
  if (!found) return res.status(404).json({ error: 'not found' });
  res.json(found);
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) client.send(data);
  });
}

wss.on('connection', async (ws) => {
  const recent = await db.listRecent(MAX_RECENT);
  ws.send(JSON.stringify({ type: 'init', emails: recent }));
});

// Periodic refresh broadcast, independent of new mail arriving
setInterval(async () => {
  const recent = await db.listRecent(MAX_RECENT);
  broadcast({ type: 'refresh', emails: recent, serverTime: new Date().toISOString() });
}, BROADCAST_INTERVAL_MS);

db.init()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`email-agent-webhook listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
