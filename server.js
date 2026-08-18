const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const SHARED_SECRET = process.env.EMAIL_WEBHOOK_SECRET;
// Optional: forward every parsed email to another agent/webhook URL
const AGENT_WEBHOOK_URL = process.env.AGENT_WEBHOOK_URL;
// How often (ms) the dashboard auto-refreshes over the websocket, even with no new mail
const BROADCAST_INTERVAL_MS = Number(process.env.BROADCAST_INTERVAL_MS || 10000);

// Keep the last N emails in memory
const recent = [];
const MAX_RECENT = 50;

function checkSecret(req, res, next) {
  if (!SHARED_SECRET) return next(); // no secret configured yet, allow through
  const provided = req.get('x-email-secret');
  if (provided !== SHARED_SECRET) {
    return res.status(401).json({ error: 'invalid secret' });
  }
  next();
}

app.get('/api/status', (_req, res) => {
  res.json({ ok: true, service: 'email-agent-webhook', received: recent.length });
});

app.get('/emails', (_req, res) => {
  res.json(recent);
});

app.post('/webhook/email', checkSecret, async (req, res) => {
  const email = req.body;

  console.log('Received email:', {
    from: email.from,
    to: email.to,
    subject: email.subject,
  });

  const record = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, receivedAt: new Date().toISOString(), ...email };
  recent.unshift(record);
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;

  broadcast({ type: 'new_email', email: record });

  // Hand off to your agent(s) here. Two common patterns:
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

  // 2) Or call your agent logic directly in-process, e.g.:
  // await runAgent(email);

  res.status(200).json({ ok: true });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) client.send(data);
  });
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'init', emails: recent }));
});

// Periodic refresh broadcast, independent of new mail arriving
setInterval(() => {
  broadcast({ type: 'refresh', emails: recent, serverTime: new Date().toISOString() });
}, BROADCAST_INTERVAL_MS);

server.listen(PORT, () => {
  console.log(`email-agent-webhook listening on port ${PORT}`);
});
