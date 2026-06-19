# Deploy SentinelWatch

Commit staged changes (never include `.env`, `node_modules/`, or `*.log`), push to `origin main`, then verify the app still boots from a clean checkout.

## Pre-deploy safety checks (run before `git add`)

Run all four; abort and fix if any fails.

1. **`.env` must not be staged.** The `.gitignore` already excludes it, but if `.env` was ever committed before `.gitignore` was added, `git add` will silently re-stage it on every edit. Check with:
   ```
   git check-ignore -v .env
   ```
   If it prints `!.env` or nothing, `.env` is tracked and is about to be re-committed with a new key. Fix: `git rm --cached .env` first.

2. **Preload.js still wired.** `main.js` must reference `preload.js` and `window.sentinel` must exist in the renderer. If you see any change to either, run the renderer's `node -e "require('./preload.js')"` smoke check and verify the three exposed methods (`onProcessUpdate`, `diagnoseProcess`, `killProcess`) line up with what `renderer.js` calls.

3. **No hardcoded API keys in code.** The diagnose handler must read from `process.env.GROQ_API_KEY` (or whatever the active provider is). Grep for `sk-`, `gsk_`, `key=` patterns in `main.js`, `preload.js`, `renderer/`. Fail on any hit.

4. **`chrome-sandbox` helper must be SUID-root on Linux.** `npm install` doesn't set the bit; without it, Electron aborts on startup with `SIGTRAP`. Check with `ls -l node_modules/electron/dist/chrome-sandbox` — must be `-rwsr-xr-x root root`. If mode is 755 and owner is the user, run `sudo chown root:root && sudo chmod 4755` on the file. (Document this in README under a "Linux install" note if it isn't already.)

## Deploy steps

1. **Stage and commit.**
   ```
   git add main.js preload.js renderer/ package.json package-lock.json .gitignore .env.example launch.bat launch_v2.bat silent.vbs SentinelWatch.ps1 .claude/
   # README.md and CLAUDE.md: add if they exist (created after the first deploy)
   [ -f README.md ] && git add README.md
   [ -f CLAUDE.md ] && git add CLAUDE.md
   git status        # eyeball — no .env, no node_modules, no .log
   git commit -m "<conventional message>"
   ```
   Never use `git add -A` or `git add .` — they will sweep up `.env` if it's tracked.
   On the very first deploy from a fresh `git init`, also stage `.claude/skills/` so the deploy skill ships with the repo (matches Zeev's pattern).

2. **Push.**
   ```
   git push origin main
   ```

3. **Verify on a clean checkout.** In a scratch directory:
   ```
   git clone https://github.com/azaurov/SentinelWatch.git /tmp/sw-verify
   cd /tmp/sw-verify
   npm install
   cp ../sentinelwatch/.env .env   # only if testing the same key
   chmod 4755 node_modules/electron/dist/chrome-sandbox 2>/dev/null || true   # Linux only
   npm start &
   sleep 5
   pgrep -af "electron \." | wc -l   # expect ≥ 5 (main + helpers)
   pkill -f "electron \."
   ```
   If process count is 0, `npm start` failed — tail the log and fix.

## After a successful deploy

1. **Update `/home/azaurov/sentinelwatch/CLAUDE.md`** to reflect any architectural changes made in this session (new env vars, new IPC handlers, new files, model changes, UI restructure, etc.). Keep it accurate and concise — describe what the code does today, not what it used to do.

2. **Update `/home/azaurov/sentinelwatch/README.md`** for a public audience. Especially watch for:
   - The diagnosis provider name and model ID (must match `main.js` defaults)
   - The `.env` key name (currently `GROQ_API_KEY`)
   - Any new features added (this session added: scrollable diagnosis, stale-process freeze, Groq provider switch, `.gitignore` hardening)
   - Linux SUID sandbox note if not already present

   Commit both files together in a single `docs:` commit and push.

3. **Do not touch the GitHub profile repo** (`github.com/azaurov/azaurov`) — SentinelWatch isn't listed there and adding it is out of scope for a deploy.
