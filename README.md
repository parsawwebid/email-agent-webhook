# Email → Agent Webhook

دو بخش:

1. `./` (ریشه) — سرویس Node/Express که روی Railway بالا میاد و ایمیل‌های پارس‌شده رو می‌گیره (`POST /webhook/email`).
2. `./cloudflare-worker` — Cloudflare Email Worker که ایمیل خام رو می‌گیره، پارس می‌کنه، و به سرویس بالا فوروارد می‌کنه.

## راه‌اندازی سرویس Railway

1. این ریپو (یا فقط ریشه‌ش) رو push کن به GitHub.
2. توی Railway پروژه رو از همون ریپو دیپلوی کن.
3. متغیرهای محیطی رو ست کن:
   - `EMAIL_WEBHOOK_SECRET` — یه رشته تصادفی طولانی (مثلاً با `openssl rand -hex 32`).
   - (اختیاری) `AGENT_WEBHOOK_URL` — اگه می‌خوای هر ایمیل رو مستقیم به یه agent دیگه فوروارد کنه.
4. یه دامنه پابلیک براش بساز (Railway generate domain). آدرس نهایی می‌شه چیزی مثل:
   `https://xxxx.up.railway.app/webhook/email`

## راه‌اندازی Cloudflare

1. `Email → Email Routing` رو روی دامنه فعال کن (رکوردهای MX رو تایید کن).
2. `cd cloudflare-worker && npm install`
3. سکرت‌ها رو ست کن:
   ```
   npx wrangler secret put RAILWAY_WEBHOOK_URL
   # -> https://xxxx.up.railway.app/webhook/email

   npx wrangler secret put EMAIL_WEBHOOK_SECRET
   # -> همون مقداری که روی Railway گذاشتی
   ```
4. دیپلوی: `npx wrangler deploy`
5. توی Cloudflare Dashboard → Email Routing → Routing rules، یه catch-all rule بساز:
   `*@yourdomain.com` → Send to a Worker → `email-agent-forwarder`

## تست

یه ایمیل به `test@yourdomain.com` بفرست، بعد لاگ‌های Railway رو نگاه کن یا `GET /emails` رو باز کن تا آخرین ایمیل‌های دریافتی رو ببینی.
