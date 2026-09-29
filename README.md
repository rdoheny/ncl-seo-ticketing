# SEO Team Request Form

A simple internal ticketing page. Teams fill out a form to request ad hoc work
from the SEO team; each submission is emailed straight to an Outlook inbox via Resend.

No database, no login — just a form and an email notification. Hosted free on
Cloudflare Workers (static assets + a small Worker script).

## What's in this folder

- `public/index.html` — the request form (static page, no build step)
- `src/index.js` — the Worker script that serves the form and, for POST requests to
  `/api/submit`, sends the notification email via Resend
- `wrangler.jsonc` — Cloudflare configuration: tells it where the static files live
  and which script handles requests

## One-time setup

### 1. Create a Resend account and API key

1. Go to https://resend.com and sign up (free tier: 100 emails/day, 3,000/month).
2. In the Resend dashboard, go to **API Keys** → **Create API Key**. Copy the key.
3. (Recommended before real use) Go to **Domains** → **Add Domain** and verify a domain
   you control. Until then, `onboarding@resend.dev` only sends to the email you signed
   up with.

### 2. Connect this repo to Cloudflare

1. Go to https://dash.cloudflare.com and sign up if you haven't already.
2. Go to **Workers & Pages** → **Create** → connect this GitHub repo.
3. Cloudflare should detect `wrangler.jsonc` automatically and pre-fill the deploy
   settings. Click **Deploy**.
4. You'll get a live URL like `https://seo-ticketing.<your-subdomain>.workers.dev`.

### 3. Add secrets

1. In the Cloudflare dashboard, select this Worker project → **Settings** →
   **Variables and Secrets**.
2. Add:
   - `RESEND_API_KEY` — encrypted secret
   - `NOTIFY_EMAIL` — the inbox that should receive ticket notifications
   - `FROM_EMAIL` — optional; defaults to `onboarding@resend.dev`
3. Redeploy (push any small commit, or use the dashboard's redeploy option) so the
   Worker picks up the new variables.

### 4. Test it

Open the live URL, submit the form, and check the inbox set as `NOTIFY_EMAIL`.
