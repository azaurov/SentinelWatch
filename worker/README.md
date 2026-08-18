# sentinelwatch-groq-proxy

A Cloudflare Worker that proxies SentinelWatch's Groq diagnosis requests, so
`GROQ_API_KEY` lives only in Cloudflare's secret store — never in a `.env`
file shipped with (or readable on) a user's desktop install.

Live at `https://sentinelwatch-groq-proxy.azaurov.workers.dev`. Standalone
sub-project with its own `package.json`/`wrangler.toml`; `main.js` calls it
via `SENTINELWATCH_WORKER_URL` in the app's `.env` (see the repo root
`CLAUDE.md`). `GET /` also serves a small browser demo page (`src/demo.js`)
for trying the endpoint without the desktop app — open the URL above.

## Setup

```bash
cd worker
npm install
npx wrangler login          # one-time, opens a browser to authorize Cloudflare
```

## Local dev

```bash
cp .dev.vars.example .dev.vars   # fill in your real GROQ_API_KEY
npm run dev
```

## Deploy

```bash
npx wrangler secret put GROQ_API_KEY   # one-time per environment; paste the key when prompted
npm run deploy
```

`wrangler deploy` prints the live `*.workers.dev` URL.

## API

`GET /` returns the browser demo page — a form that POSTs a sample process
snapshot to this same Worker and renders the diagnosis. Not used by the app;
purely for trying the endpoint by hand.

`POST /` with a JSON body shaped like the `info` object SentinelWatch's
`diagnose-process` IPC handler receives:

```json
{
  "pid": 1234,
  "command": "node server.js",
  "cpu": 87.3,
  "rss": 512000,
  "cpuTime": 934,
  "hangDurationMs": 660000,
  "platform": "linux (x64, 8 cores)"
}
```

Response (same shape `main.js` returns to the renderer today):

```json
{ "success": true, "diagnosis": "**What it is:** ..." }
```

or on failure:

```json
{ "success": false, "error": "..." }
```

## Config

- `wrangler.toml [vars] GROQ_MODEL` — default model (matches `main.js`'s
  default: `openai/gpt-oss-120b`).
- `wrangler.toml [vars] ALLOWED_ORIGIN` — CORS allowlist; defaults to `*`.
  Tighten this once the app is wired up, since Electron apps don't send a
  meaningful `Origin` by default.
