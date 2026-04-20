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

## Routes

- `POST /` — upload session blob, returns `{ id: "abc12345" }`
- `GET /:id` — retrieve session blob by ID
