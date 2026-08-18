# SentinelWatch

![SentinelWatch process monitor](screenshot.png)

An Electron desktop app that monitors all running system processes in real time, detects hung processes (sustained high CPU for 10+ minutes), and uses AI to diagnose them.

## Features

- Live process table updated every 5 seconds — shows CPU%, memory, accumulated CPU time, and user
- Hang detection: flags any process that stays above 10% CPU for 10 consecutive minutes
- Per-process status badges: OK / HIGH CPU / HANGING
- Filter by All / Hanging / High CPU; search by name or PID; sort by CPU, memory, PID, CPU time, or name
- Detail panel with one-click AI diagnosis powered by **Groq** (default `openai/gpt-oss-120b`)
- Detail panel stays open after a process dies so you can finish reading the diagnosis
- Kill process with confirmation dialog
- Works on Windows (PowerShell) and macOS/Linux (`ps aux`)

## Requirements

- Node.js 18+ (uses built-in `fetch`)
- A deployed SentinelWatch Cloudflare Worker (see `worker/README.md`), which holds
  a [Groq API key](https://console.groq.com/keys) as a Cloudflare secret

## Setup

```bash
npm install
```

Deploy the Worker (one-time; see `worker/README.md` for details):

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put GROQ_API_KEY
npm run deploy
```

`wrangler deploy` prints a `*.workers.dev` URL. Create a `.env` file in the
project root with that URL:

```
SENTINELWATCH_WORKER_URL=https://sentinelwatch-groq-proxy.your-subdomain.workers.dev
```

### Linux install note

`npm install` does not set the SUID bit on Electron's chrome-sandbox helper.
Without it, Electron aborts on startup. Run once after `npm install`:

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

If you run inside a container or environment where user namespaces are
disabled, the SUID sandbox can still fail. Workaround:
`ELECTRON_DISABLE_SANDBOX=1 npm start`.

## Running

```bash
npm start        # launch app
npm run dev      # launch with verbose Electron logging
```

On Windows you can also double-click `launch.bat` or `silent.vbs` (runs without a terminal window).

## Building installers

Bundled installers for Linux, macOS, and Windows are built with
[`electron-builder`](https://www.electron.build/):

```bash
npm run dist         # build for the current platform
npm run dist:mac     # .dmg + .zip
npm run dist:win     # NSIS installer (.exe)
npm run dist:linux   # AppImage + .deb
```

Output lands in `dist/` (gitignored). Cross-building for a different OS than
the one you're running on generally requires that OS's native tooling (e.g.
you can't produce a `.dmg` from Linux) — build each target on its own
platform, or use a CI matrix.

No app icon is bundled yet, so builds fall back to the default Electron
icon. To brand it, add `build/icon.png` (1024x1024) to the repo —
`electron-builder` derives the platform-specific `.icns`/`.ico` from it
automatically.

## Install shortcut (GitHub Pages)

`docs/` contains a small installable PWA landing page for GitHub Pages
(`https://azaurov.github.io/SentinelWatch/` once Pages is enabled for this
repo under **Settings → Pages → Source: `main` / `docs`**). Visiting it on a
phone or desktop browser offers an "Add to Home Screen" / install prompt that
adds a SentinelWatch icon linking back to downloads and docs.

**This is a shortcut, not the app.** SentinelWatch itself is an Electron
desktop app — process listing/killing needs OS APIs (`ps`, `Get-Process`,
`taskkill`) that don't exist in a browser sandbox, so nothing under `docs/`
can run the actual process monitor on a phone.

## How hang detection works

The main process polls all running processes every 5 seconds via PowerShell (`Get-Process`) on Windows or `ps aux` on macOS/Linux. CPU% on Windows is computed from the delta in accumulated CPU time between polls, normalized by the number of cores. If a process stays at or above 10% CPU continuously for 10 minutes, it is flagged as hanging.

## AI diagnosis

Clicking **Diagnose with AI** on a selected process sends a snapshot (PID, command, CPU%, memory, accumulated CPU time, hang duration, platform) to the SentinelWatch Cloudflare Worker (`worker/`, deployed separately — see `worker/README.md`), which proxies it to Groq's OpenAI-compatible chat-completions endpoint and asks it to explain:

- What the process is
- Why it may be hanging
- The risk of killing it
- A recommended action

The Groq API key never touches the desktop app — it's a Cloudflare secret on
the Worker. `main.js` only needs `SENTINELWATCH_WORKER_URL` in `.env`.
Override the model by setting `GROQ_MODEL` in `worker/wrangler.toml` (any
Groq-supported model ID — check `GET /openai/v1/models` against your key,
since availability changes; `openai/gpt-oss-20b` is faster,
`openai/gpt-oss-120b` is larger) and redeploying the Worker.

## Project structure

```
main.js              — Electron main process: polling, hang detection, IPC handlers
preload.js           — contextBridge: exposes window.sentinel to the renderer
renderer/
  index.html         — app shell
  renderer.js        — UI logic: table rendering, filtering, sorting, detail panel
  styles.css         — dark theme styles
.claude/skills/
  deploy/SKILL.md    — canonical deploy workflow (commit, push, clean-clone verify)
docs/                — GitHub Pages install-shortcut PWA (see "Install shortcut" above)
worker/              — Cloudflare Worker: proxies AI diagnosis requests to Groq (see worker/README.md)
```

## Dependencies

| Package | Purpose |
|---|---|
| `electron` | Desktop window and IPC |
| `dotenv` | Load `SENTINELWATCH_WORKER_URL` from `.env` |

The diagnose handler uses Node's built-in `fetch` to call Groq directly — no LLM SDK is required.
