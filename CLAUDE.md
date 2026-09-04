# Working conventions for this repo

## Git commits

This is a **public** GitHub repo (owner: `Adam-Kosicki`). From this point forward:
https://github.com/Adam-Kosicki/notion-todo-dashboard

- **Split commits by feature**, not one mega-commit per session. When a session touches several distinct features (e.g. "Lists", "Tags", "UI polish"), commit each separately with its own message, even if that means staging the same shared file more than once across commits as it evolves.
- If splitting cleanly would require fragile manual patch/hunk surgery (interleaved changes across many shared files, no interactive `git add -p` available), it's fine to fall back to fewer/combined commits rather than risk a broken repo state — but say so explicitly instead of silently skipping the split.
- **Before every commit**, confirm nothing sensitive is going in:
  - `git status` / `git diff` review of exactly what's staged.
  - Confirm `.wrangler/`, `.env*`, `.dev.vars*`, `*.sqlite`, `*.db*` are covered by `.gitignore` (they already are — don't remove those entries) and aren't showing up in `git status`.
  - Grep staged/new content for things like `ntn_`, API keys, tokens, passwords before committing, not after.
- Never commit the local D1 database file or any backup of it (`.wrangler/state/**/*.sqlite*`) — it contains real personal task data and encrypted Notion/Todoist tokens.

## Local dev environment

- `node`/`npm` are not on the default PATH in this environment; a working Node install lives at `D:\DevOps`. Git Bash sessions get this from `~/.bashrc`/`~/.bash_profile` (`export PATH="/d/DevOps:$PATH"`) already — a fresh terminal should just work.
- `npm run dev` (the `dev` script) fails under `cmd.exe` because it sets an env var with POSIX syntax (`WRANGLER_LOG_PATH=... vite`). Run it directly instead from Git Bash:
  ```
  WRANGLER_LOG_PATH=.wrangler/wrangler.log ./node_modules/.bin/vite
  ```
- The local D1 database (Miniflare-simulated) lives under `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite`. New Drizzle migrations (`npx drizzle-kit generate`) need to be applied to that file by hand with `sqlite3` — there's no `wrangler.toml` in this project (config is inline in `vite.config.ts`), so `wrangler d1 migrations apply` isn't available. Always back up that sqlite file before applying a new migration to it (it holds real data).
- This app has a **live Notion connection** in this dev environment. Treat existing items/lists as real data: prefer creating disposable test items/lists (named e.g. `Zz Test ...`) for verification, and clean them up (archive/delete) afterward, rather than editing real rows.
