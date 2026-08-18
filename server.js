const express = require('express');

const app = express();
app.use(express.json({ limit: '25mb' }));

const PORT = process.env.PORT || 3000;
const SHARED_SECRET = process.env.EMAIL_WEBHOOK_SECRET;
// Optional: forward every parsed email to another agent/webhook URL
const AGENT_WEBHOOK_URL = process.env.AGENT_WEBHOOK_URL;

// Keep the last N emails in memory, just for quick debugging via GET /emails
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

app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'email-agent-webhook' });
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

  recent.unshift({ receivedAt: new Date().toISOString(), ...email });
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;

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

app.listen(PORT, () => {
  console.log(`email-agent-webhook listening on port ${PORT}`);
});
