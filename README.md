# Whop Affiliate Agent — starter scaffold

Flow: pick a Whop affiliate program by niche → newsletter template auto-matches
by category → enter a lead's email → sends via your Gmail.

This is a working starting point, not a finished product — a few pieces need
your input to go live (marked below).

## What's here

```
backend/
  whop.js             Live Whop API client (fetches real products, pricing, links)
  server.js           Express API (live businesses, template preview, send)
  templateMatcher.js  Maps category to rich HTML newsletter templates
  templates/          HTML newsletter templates (trading, fitness, business, marketing, general)
  gmail.js            Sends mail via Gmail API (OAuth2)
  gmail-auth.js       One-time Gmail authorization script
  businesses.json     Live cached real Whop data
frontend/
  index.html          Modern single-page dashboard with real-time filters & preview
```

## 1. Run it right now with sample data

```bash
cd backend
npm install
npm start          # starts API on http://localhost:4000
```

Then open `frontend/index.html` directly in your browser. You'll see the 3
sample businesses, template previews, and a send form — sending will fail
until Gmail is set up (step 3).

## 2. Wire up real Whop data

Whop's Affiliate Marketplace (the page with commission %, EPC, conversion
rate for every program) is **inside your logged-in dashboard**, not a public
page — so the scraper drives a real browser, has you log in once, and reuses
that session after.

```bash
cd backend
npm run scrape
```

The CSS selectors in `scraper.js` are placeholders (marked `ADJUST ME`) —
open the Affiliate Marketplace in Chrome, right-click a listing → Inspect,
and update them to match Whop's actual markup. Re-run `npm run scrape`
whenever you want fresh data; it overwrites `businesses.json`.

**Check Whop's current Terms of Service** on automated access before relying
on this beyond light personal use.

## 3. Wire up Gmail sending

1. Go to https://console.cloud.google.com/ → new project → enable the
   **Gmail API**.
2. Create OAuth 2.0 credentials, type **Desktop app** → download the JSON →
   save it as `backend/credentials.json`.
3. Run the one-time authorization:
   ```bash
   cd backend
   node gmail-auth.js
   ```
   This opens a URL, you approve access, paste back the code, and it saves
   `token.json`. After this, `/api/send` will actually deliver mail.

## 4. Add more niches

Add a new `templates/<niche>.html` file, then add a matching rule in
`templateMatcher.js`:

```js
{ keywords: ["saas", "software"], template: "saas.html" },
```

## Notes / things to decide as you go

- **Compliance**: this is built for one-to-one outreach to leads you already
  have a relationship with, not bulk/unsolicited email — check CAN-SPAM/GDPR
  rules if you scale this up.
- **`credentials.json` and `token.json` are secrets** — don't commit them to
  a public repo. A `.gitignore` isn't included yet; add one before pushing
  anywhere public.
