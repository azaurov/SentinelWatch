# SentinelWatch

![SentinelWatch process monitor](screenshot.png)

An Electron desktop app that monitors all running system processes in real time, detects hung processes (sustained high CPU for 10+ minutes), and uses AI to diagnose them.

## Features

- Live process table updated every 5 seconds — shows CPU%, memory, accumulated CPU time, and user
- Hang detection: flags any process that stays above 10% CPU for 10 consecutive minutes
- Per-process status badges: OK / HIGH CPU / HANGING
- Filter by All / Hanging / High CPU; search by name or PID; sort by CPU, memory, PID, CPU time, or name
- Detail panel with one-click AI diagnosis powered by **Groq** (default `llama-3.3-70b-versatile`)
- Detail panel stays open after a process dies so you can finish reading the diagnosis
- Kill process with confirmation dialog
- Works on Windows (PowerShell) and macOS/Linux (`ps aux`)

## Requirements

- Node.js 18+ (uses built-in `fetch`)
- A [Groq API key](https://console.groq.com/keys)

## Setup

```bash
npm install
```

Create a `.env` file in the project root:

```
GROQ_API_KEY=gsk_...
# Optional: override the diagnosis model
# GROQ_MODEL=llama-3.3-70b-versatile
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

## How hang detection works

The main process polls all running processes every 5 seconds via PowerShell (`Get-Process`) on Windows or `ps aux` on macOS/Linux. CPU% on Windows is computed from the delta in accumulated CPU time between polls, normalized by the number of cores. If a process stays at or above 10% CPU continuously for 10 minutes, it is flagged as hanging.

## AI diagnosis

Clicking **Diagnose with AI** on a selected process sends a snapshot (PID, command, CPU%, memory, accumulated CPU time, hang duration, platform) to Groq's OpenAI-compatible chat-completions endpoint and asks it to explain:

- What the process is
- Why it may be hanging
- The risk of killing it
- A recommended action

The API key is read from `.env` at runtime — never bundled into the app. Override the model by setting `GROQ_MODEL` in `.env` (any Groq-supported model ID; `llama-3.1-8b-instant` is faster, `openai/gpt-oss-120b` is larger).

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
```

## Dependencies

| Package | Purpose |
|---|---|
| `electron` | Desktop window and IPC |
| `dotenv` | Load API key from `.env` |

The diagnose handler uses Node's built-in `fetch` to call Groq directly — no LLM SDK is required.
