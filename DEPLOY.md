# ISO 9001:2026 Readiness Check v2 (English) — Deploy guide

## What is in this folder

```
public/index.html            The tool: questionnaire, GAP report on screen, automatic PDF download, "email me the report" form
public/vendor/               pdfmake (PDF engine, MIT licence), self-hosted, no external CDN needed
lib/report-mail.mjs          Email logic: validation, spam protection, visitor and sales emails, Resend/SendGrid
api/send-report.js           Vercel function   -> POST /api/send-report
netlify/functions/send-report.mjs  Netlify function -> POST /api/send-report
vercel.json / netlify.toml   Platform settings (publish folder: public)
dev-server.mjs               Local test server (npm run dev)
google-sheets/               Apps Script for the Google Sheets lead log + setup guide (Turkish)
.env.example                 Environment variables
```

No `npm install` is needed: the project has no dependencies. Node 18 or newer.

## What happens when a visitor asks for the report by email

1. The browser builds the PDF and sends it to `/api/send-report` with the form details and the score summary.
2. The visitor receives a branded email with a summary (scores, top gaps, recommended QDMS modules, booking button) and the PDF attached.
3. The addresses in `SALES_INBOX` receive a lead email: subject `[HOT · wants contact] ISO 9001:2026 lead – Company (Country) – readiness 37`, all form details, UTM/AM source and the same PDF. Replying to it goes to the visitor.
4. Optional: a row is added to a Google Sheet and the PDF is saved to Google Drive (`SHEETS_WEBHOOK_URL`).
5. Optional: the full record is posted as JSON to `CRM_WEBHOOK_URL`.

## Step 1. Choose an email service

**Resend (recommended, simplest):**
1. Create an account at resend.com.
2. Domains → Add domain → e.g. `bimser.com` or a subdomain such as `mail.bimser.com`. Add the DNS records it shows (SPF, DKIM). Your IT team may need to add these.
3. API Keys → Create API key (Sending access).
4. `MAIL_FROM` must use the verified domain, e.g. `Bimser QDMS <qdms@bimser.com>`.

**SendGrid (if Bimser already uses it):** create an API key with Mail Send permission, verify the sender domain, set `EMAIL_PROVIDER=sendgrid`.

Until the domain is verified you can test with Resend's `onboarding@resend.dev` sender, but it only delivers to your own Resend account address.

## Step 2a. Deploy on Vercel

1. Put this folder in a GitHub repository (or use `npx vercel` from the folder).
2. vercel.com → Add New → Project → import the repository. Framework preset: **Other**. Leave build command empty. Output directory comes from `vercel.json` (`public`).
3. Settings → Environment Variables → add the variables from Step 3.
4. Deploy. Test at `https://<project>.vercel.app`.

## Step 2b. Deploy on Netlify

1. app.netlify.com → Add new site → Import from Git (or drag-and-drop is not enough, because the function needs a Git or CLI deploy: `npx netlify deploy --prod`).
2. Build command: empty. Publish directory: `public` (read from `netlify.toml`).
3. Site configuration → Environment variables → add the variables from Step 3.
4. Deploy. The function answers at `/api/send-report` automatically.

## Step 3. Environment variables

| Variable | Required | Example |
|---|---|---|
| `EMAIL_PROVIDER` | yes | `resend` or `sendgrid` |
| `RESEND_API_KEY` / `SENDGRID_API_KEY` | yes | the key from Step 1 |
| `MAIL_FROM` | yes | `Bimser QDMS <qdms@bimser.com>` |
| `SALES_INBOX` | yes | `mehmet.onur@bimser.com,sales.mea@bimser.com` |
| `BOOKING_URL` | yes | meeting booking page used in the email button |
| `MAIL_REPLY_TO` | no | where visitor replies go |
| `ALLOWED_ORIGINS` | recommended | `https://iso.bimser.com,https://<project>.vercel.app` |
| `TURNSTILE_SECRET` | recommended | Cloudflare Turnstile secret (see below) |
| `SHEETS_WEBHOOK_URL` | recommended | Google Sheets lead log + PDFs in Drive, see `google-sheets/KURULUM-GOOGLE-SHEETS.md` |
| `CRM_WEBHOOK_URL` | no | CRM or Make/Zapier/n8n webhook |

## Step 4. Page settings (`public/index.html`, CONFIG block at the top of the script)

- `bookingUrl`, `privacyUrl`, `starterUrl`: real Bimser pages
- `shareUrl`: the final public address of the tool
- `turnstileSiteKey`: only if you use Turnstile
- `reportEndpoint`: leave `/api/send-report`; set to `""` to switch email off

## Spam and abuse protection

- Hidden honeypot field, strict email validation, PDF check (must be a real PDF, max ~2 MB)
- Rate limits: 6 requests per IP per hour, 3 emails per recipient per day (per server instance, best effort)
- `ALLOWED_ORIGINS` stops other sites from calling your endpoint
- **Recommended before a LinkedIn campaign:** Cloudflare Turnstile (free). Create a widget at dash.cloudflare.com → Turnstile, put the site key in `CONFIG.turnstileSiteKey` and the secret in `TURNSTILE_SECRET`. The form then shows a small check box and the server verifies it.

## Local test

```bash
cp .env.example .env        # fill in your keys, or skip for a dry run
DEV_CAPTURE=1 npm run dev   # http://localhost:3000 ; emails are written to ./.outbox instead of being sent
npm run dev                 # sends real emails with the keys in .env
```

## Custom domain

Vercel: Settings → Domains → add `iso.bimser.com` and create the CNAME it shows. Netlify: Domain management → Add domain. Then update `ALLOWED_ORIGINS` and `CONFIG.shareUrl`.

## Channel links (UTM)

- Company LinkedIn: `?utm_source=linkedin&utm_medium=company&utm_campaign=iso9001-2026`
- Account manager: `?utm_source=linkedin&utm_medium=personal&am=gizem`
- Partner: `?utm_source=partner&partner=<name>`
- Webinar QR: `?utm_source=webinar&utm_campaign=iso9001-2026-dubai`

These appear in the sales email under Source / AM / Partner.

## Before going live

- Confirm module names with the QDMS product team, especially Opportunity Management and Change Management.
- Have legal review the consent text and privacy notice (GDPR, UAE PDPL, KSA PDPL).
- Send yourself one test report on the live URL and check the spam folder; if it lands there, finish the DNS (SPF/DKIM/DMARC) setup.
