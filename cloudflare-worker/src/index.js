import PostalMime from 'postal-mime';

export default {
  async email(message, env, ctx) {
    const parser = new PostalMime();
    const email = await parser.parse(message.raw);

    const payload = {
      from: message.from,
      to: message.to,
      subject: email.subject || '',
      text: email.text || '',
      html: email.html || '',
      attachments: (email.attachments || []).map((a) => ({
        filename: a.filename,
        mimeType: a.mimeType,
        size: a.content ? a.content.byteLength : undefined,
      })),
    };

    const resp = await fetch(env.RAILWAY_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-email-secret': env.EMAIL_WEBHOOK_SECRET,
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      // If your Railway service is down, bounce the email back to reject it
      // instead of silently dropping it. Comment this out if you'd rather
      // swallow the failure.
      message.setReject(`Upstream webhook returned ${resp.status}`);
    }
  },
};
