# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start          # launch the Electron app
npm run dev        # launch with verbose Electron logging (--enable-logging)
```

No build step, no test suite, no lint config. Files are loaded directly by Electron.

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
| `window.sentinel.diagnoseProcess(info)` | `diagnose-process` (invoke) | Groq chat-completions fetch |
| `window.sentinel.killProcess(pid)` | `kill-process` (invoke) | `taskkill`/`kill -9` via `exec` |

If you add a method, update **both** `preload.js` (expose it) and `renderer/renderer.js` (call it).
The preload is the only place that touches `ipcRenderer` directly.

## AI diagnosis provider (Groq)

`main.js` calls `https://api.groq.com/openai/v1/chat/completions` directly via Node 18+
built-in `fetch`. No external SDK. Reads `process.env.GROQ_API_KEY` and optional
`process.env.GROQ_MODEL` (defaults to `llama-3.3-70b-versatile`; see `.env.example` for alternatives).

**Prompt structure**: system message carries the formatting instructions
(`**What it is:**` etc.); user message carries the process snapshot. Response
is rendered as-is by `formatDiagnosis()` in `renderer.js` (converts `**bold**` and bullet lines to HTML spans — no markdown library).

**If you ever switch providers**, you must also update:
- `main.js` (URL, headers, request body shape, env var name)
- `.env.example` (document new key)
- `README.md` (Requirements + Setup sections)
- This file (the provider section above)

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

`.env` contains a real `GROQ_API_KEY`. `.gitignore` already excludes it.
**Never use `git add -A` or `git add .`** — stage files explicitly by name.

## Deploying

`.claude/skills/deploy/SKILL.md` is the canonical deploy workflow — pre-deploy
checks, commit/push, clean-clone verification, then update this file plus
`README.md` to reflect session changes. Read it before pushing.
