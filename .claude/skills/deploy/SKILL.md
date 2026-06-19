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

3. **Decide whether this deploy warrants a release.** Not every deploy needs a tagged release — docs-only or chore commits shouldn't bump the version. Use this rubric:

   | Change type | Version bump | Tag/release? |
   |---|---|---|
   | Bug fix, internal refactor, deps only | patch (`1.0.0` → `1.0.1`) | yes |
   | New feature, backwards-compatible | minor (`1.0.0` → `1.1.0`) | yes |
   | Breaking API/UX change (env var rename, removed IPC method, etc.) | major (`1.0.0` → `2.0.0`) | yes, call it out in release notes |
   | `docs:` commit only, `chore:` commit only (no version bump) | none | no |
   | `chore: bump version to X.Y.Z` is itself a commit | — | always accompanied by tag |

   If this deploy qualifies, run the versioning block below. If it's a docs-only follow-up to an already-released version, skip this step entirely.

   **Versioning block** (run once per release):

   ```
   # 1. Bump version in package.json (manually edit the "version" field, or use npm)
   npm version patch   # or minor / major — runs git tag + commit in one step
   # If you used `npm version`, skip step 2 (it created the tag). Otherwise:
   # git tag -a v1.1.0 -m "<release notes summary>"

   # 2. Push the version commit + tag
   git push origin main --follow-tags

   # 3. Create the GitHub release from the tag.
   #    Use --notes-file so multi-paragraph notes render correctly.
   git tag -l --format='%(contents)' v1.1.0 > /tmp/sw-release-notes.md
   gh release create v1.1.0 \
     --title "v1.1.0 — <short summary>" \
     --notes-file /tmp/sw-release-notes.md \
     --target main
   rm /tmp/sw-release-notes.md

   # 4. Verify
   gh release view v1.1.0 --json name,tagName,publishedAt,url,isPrerelease
   curl -s https://api.github.com/repos/azaurov/SentinelWatch/tags | grep '"name"'
   ```

   **Release notes template** — annotated tag message and release body share the same text. Cover these sections in order:
   - One-line headline (what changed at a glance)
   - `Changes since vX.Y.Z:` bulleted list — `feat:` / `fix:` / `chore:` / `docs:` headings grouped
   - `Breaking:` (or "none") — for renames, removals, env var changes
   - `Upgrade notes:` — exact `.env` key renames, one-time install commands (e.g., the Linux SUID sandbox one-liner), new optional dependencies
   - Don't repeat the README — link to it instead

4. **Do not touch the GitHub profile repo** (`github.com/azaurov/azaurov`) — SentinelWatch isn't listed there and adding it is out of scope for a deploy.
