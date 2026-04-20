# afminism-share worker

Cloudflare Worker + R2 for session sharing.

## One-time setup

```bash
npm install -g wrangler
wrangler login
wrangler r2 bucket create afminism-sessions
wrangler deploy
```

After deploying, note your worker URL (e.g. `https://afminism-share.<subdomain>.workers.dev`).
Update `WORKER_URL` in `src/share.ts` if it differs from the default.

## Set R2 lifecycle rule (auto-delete after 30 days)

In the Cloudflare dashboard:
1. R2 → `afminism-sessions` → **Settings** → **Lifecycle rules**
2. Add rule: **Expire current versions** → after **30 days** → Save

This keeps storage well within the 10 GB free tier (even at 2 MB/session that's ~170 shares/day indefinitely).

## Upload limit

The worker rejects payloads over 25 MB (returns 413). A full 6-scan 512×512 session compresses to ~3–6 MB, well under this limit.

## Routes

- `POST /` — upload session blob (max 25 MB), returns `{ id: "abc12345" }`
- `GET /:id` — retrieve session blob by ID
