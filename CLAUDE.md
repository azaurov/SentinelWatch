# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start          # launch the Electron app
npm run dev        # launch with verbose Electron logging (--enable-logging)
npm run dist       # build an installer for the current platform (electron-builder)
npm run dist:mac   # .dmg + .zip
npm run dist:win   # NSIS installer (.exe)
npm run dist:linux # AppImage + .deb
```

No test suite, no lint config. Files are loaded directly by Electron at runtime.
`electron-builder` (config lives in the `build` key of `package.json`) packages
installers into `dist/` (gitignored). Cross-building for a different OS than the
host generally doesn't work — build macOS targets on macOS, Windows on Windows,
Linux on Linux (or via a CI matrix).

## Project shape

Electron desktop app for real-time process monitoring with AI diagnosis.
Single main process (`main.js`), single preload (`preload.js`), renderer (`renderer/`).

- **Main**: `main.js` — Electron lifecycle, polling loop, IPC handlers.
- **Preload**: `preload.js` — `contextBridge.exposeInMainWorld('sentinel', {...})` exposing the renderer's API surface.
- **Renderer**: `renderer/index.html` + `renderer.js` + `styles.css` — UI only, no Node APIs (security).
- **Launchers**: `launch.bat`, `launch_v2.bat`, `silent.vbs`, `SentinelWatch.ps1` — Windows convenience launchers.

## IPC contract

`window.sentinel` (renderer) ↔ `ipcMain.handle` (main):

| Renderer call | IPC channel | Main handler |
|---|---|---|
| `window.sentinel.onProcessUpdate(cb)` | `process-update` (push from main) | `mainWindow.webContents.send` |
| `window.sentinel.diagnoseProcess(info)` | `diagnose-process` (invoke) | fetch to the SentinelWatch Worker |
| `window.sentinel.killProcess(pid)` | `kill-process` (invoke) | `taskkill`/`kill -9` via `exec` |

If you add a method, update **both** `preload.js` (expose it) and `renderer/renderer.js` (call it).
The preload is the only place that touches `ipcRenderer` directly.

## AI diagnosis provider (Groq, via Cloudflare Worker)

`main.js` no longer calls Groq directly. It POSTs the process snapshot to
`process.env.SENTINELWATCH_WORKER_URL` (a deployed `worker/` Worker — see
`worker/README.md`), which holds `GROQ_API_KEY` as a Cloudflare secret and
proxies to `https://api.groq.com/openai/v1/chat/completions`. `main.js` uses
Node 18+ built-in `fetch`; no external SDK either side. The Worker's default
model (`worker/wrangler.toml` `[vars] GROQ_MODEL`) is `openai/gpt-oss-120b`.

**Prompt structure** (built in `worker/src/index.js`): system message carries
the formatting instructions (`**What it is:**` etc.); user message carries the
process snapshot. Response is rendered as-is by `formatDiagnosis()` in
`renderer.js` (converts `**bold**` and bullet lines to HTML spans — no
markdown library).

**If you ever switch providers**, you must also update:
- `worker/src/index.js` (URL, headers, request body shape, env var name)
- `worker/wrangler.toml` and `worker/.dev.vars.example` (document new secret/vars)
- `.env.example` (if the app-facing contract changes)
- `README.md` (Requirements + Setup sections)
- This file (the provider section above)

**If you change the Worker's request/response contract**, update `main.js`'s
`diagnose-process` handler to match — it's a thin passthrough of `info` to the
Worker and expects back `{ success, diagnosis }` or `{ success: false, error }`.

## Hang detection

`detectHanging()` in `main.js` tracks per-process rolling state in
`processHistory` (a `Map<pid, {lastCpuTime, highCpuSince, lastPollTime, name}>`).
A process is flagged `hanging` when `cpu >= HIGH_CPU_THRESHOLD` (10%)
continuously for `HANG_DURATION_MS` (10 minutes). The 10-min window resets
to null on any dip below threshold.

**Windows CPU% is computed from the delta** in `Get-Process`'s accumulated CPU
time between polls, normalized by `NUM_CORES`. The `ps aux` parser on
Linux/macOS gets CPU% directly. The branch in `detectHanging` handles both.

## Detail panel — stale-process freeze

The detail panel stays open when the selected process disappears from the
process list (e.g., it died). Implemented in `renderer.js` `onProcessUpdate`
handler: when `processes.find(p => p.pid === selectedPid)` returns undefined,
add the `.stale` class to the panel (not `closeDetail()`). The panel freezes
the displayed stats and diagnosis so the user can keep reading after the
process exits. `closeDetail()` clears `.stale` on close.

`.detail-panel.stale` CSS rule shows a `⚠ PROCESS ENDED` prefix on the
command title and disables the Kill button (can't kill a dead process).

## Layout gotcha

`.detail-panel` is `display: flex; flex-direction: column`. **All flex
children must set `flex-shrink: 0`** if they should keep their natural height
when the panel is shorter than their content. The diagnosis block
(`.diagnosis-wrap`) has this — without it, the diagnosis is silently
compressed by the flex layout and the user sees only the first few lines.
If you add a new tall block to the panel, set `flex-shrink: 0` on it.

## GitHub Pages install shortcut (`docs/`)

`docs/` is a static, standalone PWA (manifest + service worker) meant for
GitHub Pages (`Settings → Pages → Source: main / docs`). It is **not** the
app — it's an installable landing page (icon + links to downloads/docs) for
users who want a home-screen shortcut. It cannot and must not attempt to
reimplement process listing/killing: those require OS APIs (`ps`,
`Get-Process`, `taskkill`) unavailable to any browser-sandboxed page. Treat
`docs/` as fully independent from `main.js`/`preload.js`/`renderer/` — it has
its own `styles.css`, `app.js`, `manifest.json`, `service-worker.js`, and
`icon.svg`, and shares only the color palette with `renderer/styles.css`.

## Linux SUID sandbox

`npm install` does NOT set the SUID bit on
`node_modules/electron/dist/chrome-sandbox`. Without it, Electron aborts on
startup with `SIGTRAP`. Fix (one-time per install):
```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

In containerized/restricted environments where user namespaces are disabled,
the SUID sandbox may still fail. Workaround:
`ELECTRON_DISABLE_SANDBOX=1 npm start` — acceptable for a local single-user desktop tool.

## What NOT to commit

`.env` contains `SENTINELWATCH_WORKER_URL`; `worker/.dev.vars` (if present)
contains a real `GROQ_API_KEY`. `.gitignore` already excludes both.
**Never use `git add -A` or `git add .`** — stage files explicitly by name.

## Deploying

`.claude/skills/deploy/SKILL.md` is the canonical deploy workflow — pre-deploy
checks, commit/push, clean-clone verification, then update this file plus
`README.md` to reflect session changes. Read it before pushing.
