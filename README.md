# NCL SEO Team Request Form

A simple internal ticketing page. Teams at NCL fill out a form to request ad hoc work
from the SEO team; each submission is emailed straight to your Outlook inbox via Resend.

No database, no login — just a form and an email notification. Hosted free on
Cloudflare Pages.

## What's in this folder

- `index.html` — the request form (static page, no build step)
- `functions/api/submit.js` — a Cloudflare Pages Function that receives the form
  submission and sends the email via Resend

## One-time setup

### 1. Create a Resend account and API key

1. Go to https://resend.com and sign up (free tier: 100 emails/day, 3,000/month —
   plenty for ad hoc internal requests).
2. In the Resend dashboard, go to **API Keys** → **Create API Key**. Copy the key —
   you'll only see it once.
3. (Optional but recommended once you're past testing) Go to **Domains** → **Add Domain**
   and verify a domain you control by adding the DNS records Resend gives you. Until you
   do this, you can send test emails using `onboarding@resend.dev` as the "from" address,
   but Resend restricts that to sending only to the email you signed up with. If you want
   the form live for real use with a different Outlook inbox, verify a domain first (it
   can even be a random subdomain like `mail.yourdomain.com` if you don't want to touch
   NCL's main domain).

### 2. Create a GitHub repository

Already done — this repo is it.

### 3. Create your Cloudflare account and connect the repo

1. Go to https://dash.cloudflare.com and sign up (free, no credit card needed for Pages).
2. In the sidebar, go to **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
3. Authorize Cloudflare to access your GitHub account and select the `ncl-seo-ticketing` repo.
4. Build settings: choose **None / no framework**. Leave the build command blank and set
   the build output directory to `/` (root) — this is a static site with no build step.
5. Click **Save and Deploy**. Cloudflare will give you a live URL immediately, e.g.
   `https://ncl-seo-ticketing.pages.dev`.

### 4. Add your secrets to Cloudflare Pages

1. In your Pages project, go to **Settings** → **Environment variables**.
2. Add these as **Production** (and **Preview**, if you want previews to work too):
   - `RESEND_API_KEY` — the key from step 1 (mark it **Encrypt**)
   - `NOTIFY_EMAIL` — the Outlook address that should receive ticket notifications
   - `FROM_EMAIL` — either `onboarding@resend.dev` for initial testing, or an address on
     the domain you verified in Resend, e.g. `requests@mail.yourdomain.com`
3. Trigger a redeploy (Settings → Deployments → **Retry deployment**, or just push a new
   commit) so the function picks up the new variables.

### 5. Test it

1. Open your `.pages.dev` URL.
2. Fill out and submit the form.
3. Check the Outlook inbox you set as `NOTIFY_EMAIL` — you should get an email within a
   few seconds, with a "reply-to" set to the requester's email so you can respond directly.

## Notes

- This form does **not** store submissions anywhere — it only sends an email. If you
  later want a running log/dashboard of all requests, the next step would be adding
  Cloudflare D1 (a free SQLite database) to also save each ticket.
- No custom domain is required. If NCL's IT team later wants this on a proper subdomain
  (e.g. `seo-requests.ncl.com`), that just means adding a CNAME record in NCL's DNS
  pointing to your Pages project, then adding the custom domain in the Pages dashboard.
- If you'd rather send "as" an official Outlook/NCL mailbox instead of via Resend, that
  requires registering an app in NCL's Azure AD with `Mail.Send` permission via Microsoft
  Graph — more setup and likely needs IT/admin approval, so Resend is the faster path to
  get this live.
