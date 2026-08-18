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

## داشبورد زنده

آدرس ریشه سرویس (`/`) یه داشبورد زنده نشون می‌ده — لیست ایمیل‌های دریافتی، با WebSocket که خودش هر ۱۰ ثانیه sync می‌شه و ایمیل جدید رو هم فوری push می‌کنه (لازم نیست صفحه رو رفرش کنی).

با متغیر محیطی `BROADCAST_INTERVAL_MS` می‌تونی فاصله‌ی sync دوره‌ای رو تغییر بدی (پیش‌فرض ۱۰۰۰۰ = ۱۰ ثانیه).

## وصل کردن به Hermes (خودمیزبان، OpenAI-compatible)

روی Railway این متغیرها رو ست کن:

- `HERMES_API_URL` — آدرس سرور vLLM/mistral.rs (بدون `/v1/...` در آخرش)، مثلاً `https://your-host:8000`
- `HERMES_API_KEY` — اگه سرورت auth می‌خواد (اختیاری)
- `HERMES_MODEL` — اسم مدل، مثلاً `NousResearch/Hermes-3-Llama-3.1-8B` (پیش‌فرض `hermes-3`)

از اون به بعد هر ایمیل خودکار برای triage به Hermes فرستاده می‌شه و خلاصه‌ش زیر همون ایمیل روی داشبورد (لایو، بدون رفرش) نشون داده می‌شه.

## وصل کردن به Claude Code (از طریق MCP)

پوشه‌ی `mcp-server/` یه MCP server کوچیکه که دو تا ابزار می‌ده: `list_recent_emails` و `get_email`. این‌ها از همون API روی Railway (با `x-email-secret`) می‌خونن.

```bash
git clne https://github.com/parsawwebid/email-agent-webhook
cd email-agent-webhook/mcp-server
npm install
claude mcp add --transport stdio email-agent \
  --env RAILWAY_BASE_URL=https://xxxx.up.railway.app \
  --env EMAIL_WEBHOOK_SECRET=<Railway Secret> \
  -- node /<FullPath>/mcp-server/index.js
```

بعدش داخل یه session از Claude Code می‌تونی بگی: «آخرین ایمیل‌هایی که رسیده رو نشونم بده» یا «ایمیل فلان id رو کامل بخون» و از طریق همین ابزارها جواب می‌ده.

## دیتابیس (Postgres)

ایمیل‌ها دیگه در حافظه نگه‌داری نمی‌شن — توی یه سرویس Postgres جدا (با volume دائمی) روی همین پروژه‌ی Railway ذخیره می‌شن، پس با هر redeploy/restart از بین نمی‌رن.

سرویس اصلی باید متغیر `DATABASE_URL` رو داشته باشه، مثلاً:
```
postgresql://appuser:${{postgres.POSTGRES_PASSWORD}}@postgres.railway.internal:5432/emailagent
```
(این یه Railway variable reference هست، خودش موقع دیپلوی resolve می‌شه.)
