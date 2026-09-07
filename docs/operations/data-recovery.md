# Data recovery, migration, and identity — Phase 0 findings

Written during Phase 0 of `docs/plans/burner-board-roadmap.md`. This is an operations doc, not
product documentation — see `docs/ARCHITECTURE.md` for how the app works and `CONTEXT.md` for
domain vocabulary.

## Local dev database (Miniflare-simulated D1)

The file lives at `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite`. It is a plain
SQLite file — the same dialect Cloudflare D1 itself uses (`drizzle.config.ts`: `dialect: "sqlite"`),
so ordinary file operations are a valid backup/restore mechanism:

- **Backup**: stop the dev server, `cp` the `.sqlite` file (and its `-shm`/`-wal` companions if
  present) somewhere outside the repo. Never commit it — it holds real personal task data and
  encrypted Notion tokens (already covered by `.gitignore`).
- **Restore**: stop the dev server, copy the backup back over the live file, restart.

**Rehearsed 2026-09-07** against an entirely synthetic, disposable database (never the real
`.wrangler/state` file): seeded 5 synthetic items + 1 list under owner id `zz-rehearsal-owner`,
copied the file as a backup, deleted all rows to simulate data loss, restored from the backup
copy, and diffed the full before/after row set (ids + titles + list names) — byte-identical.
Plain file copy is a valid, working backup/restore mechanism for this database shape.

## Production database (real Cloudflare D1)

Real name/id, from `wrangler.deploy.jsonc`: `burner-board-db` /
`1e9b149b-32c7-4d64-9cd5-561c0a70e208`.

**There is no `wrangler.jsonc`/`wrangler.toml` in this repo on purpose** (see the comment at the
top of `wrangler.deploy.jsonc`) — the Cloudflare Vite plugin would otherwise auto-discover a
default-named config file and merge production's real D1 binding into local dev's placeholder
one. This means **every** `wrangler d1 ...` command against production must pass
`--config wrangler.deploy.jsonc` explicitly. There is no default; omitting `--config` targets
whatever `dist/server/wrangler.json` vinext's build generated, which carries local dev's
placeholder database id, not the real one (see "Deployment bug found" below — this is exactly
the mistake that broke automated deploys).

Two real commands exist for this (confirmed via `npx wrangler d1 --help` — not guessed):

```bash
# Export production data + schema to a local .sql file
npx wrangler d1 export burner-board-db --config wrangler.deploy.jsonc --remote \
  --output backup-YYYY-MM-DD.sql

# Point-in-time restore/fork/copy without needing a prior manual export
npx wrangler d1 time-travel info burner-board-db --config wrangler.deploy.jsonc
npx wrangler d1 time-travel restore burner-board-db --config wrangler.deploy.jsonc
```

**Not yet rehearsed against real production** — only the local/synthetic rehearsal above has
been performed. Rehearsing `time-travel restore` or an `export`/re-`execute` cycle against the
real production database is real-data-affecting and should happen deliberately, not as a side
effect of Phase 0, and only with the owner present to confirm before anything executes.

## Migration runner (`scripts/migrate-board.mjs`)

New in this phase. Replaces the manual `sqlite3 "$DB" < migration.sql` process for applying
`drizzle/*.sql` files, with an explicit ledger (`_migrations_ledger` table) tracking what has
already been applied to a given database file, so re-running is safe and resumable.

```bash
node scripts/migrate-board.mjs --db <path> --mode dry-run   # list pending, no changes
node scripts/migrate-board.mjs --db <path> --mode check     # exit non-zero if pending/drifted
node scripts/migrate-board.mjs --db <path> --mode apply     # apply pending, ledgered, transactional per file
```

There is no default `--db` — every invocation must name a target explicitly. Nothing about this
script prevents pointing it at the real local dev file or a production export; that is
intentional (an operator's deliberate choice), the same way `--config` is never defaulted for
`wrangler d1` commands above.

**Rehearsed 2026-09-07** against a fresh disposable file: `dry-run` correctly listed all 8
pending migrations, `apply` applied them all and ledgered each one, a second `check` reported
"up to date", and a second `apply` correctly no-op'd instead of erroring. See
`tests/migrations.test.mjs` for the automated version of this (also verifies resuming from every
one of the 8 migration checkpoints reaches the same final schema as a fresh apply).

## Identity and request authentication — open gate, not yet verified live

`requireOwnerId()` (`lib/server/board-store.ts`) trusts, in order: `oai-authenticated-user-id`,
`oai-authenticated-user-email`, then `cf-access-authenticated-user-email`. All three are
documented as edge-injected (OpenAI Sites dispatch or Cloudflare Access) and never
client-suppliable *if the edge in front of the Worker actually strips/verifies them*. **This
codebase does not verify that itself** — there is no signature check, no JWT verification, no
stripping logic in the Worker. The entire guarantee lives in whichever edge layer sits in front
of the deployed Worker, and that placement has not been confirmed for the current production
deployment.

This was scoped for direct verification this phase (a single harmless read-only request with a
synthetic, never-used owner id, to see whether a raw request to the deployed Worker can forge
identity) but was not performed, for two independent reasons:

1. The request was blocked by this session's own auto-mode permission classifier as a plausible
   auth-bypass attempt, even against the owner's own deployment — correctly cautious, not
   overridden without asking.
2. The owner then said not to treat `site-creator-vinext-starter.adamjkosicki.workers.dev` as
   the real production target right now, since its automated (Git-connected) deploy pipeline is
   currently broken (see below) — the currently-live version there is whichever manual deploy
   happened to work last, not a reliable target to draw conclusions from.

**Found afterward, in an existing doc this phase should have consulted first**
(`docs/2026-09-03-grilling-session-status.md`, part of the roadmap's own documentation
inventory): as of 2026-09-03, `site-creator-vinext-starter.adamjkosicki.workers.dev` was
"protected by a Cloudflare Access application restricted to the user's email via the built-in
'Login with Cloudflare' identity provider." If still true and unchanged, that closes the gap —
Access sits in front of the Worker and strips/verifies `cf-access-authenticated-user-email`
itself, so `requireOwnerId()` trusting it is sound. **Not treated as settled proof**, because the
same four-day-old doc also claims "Workers Builds... was attempted but never confirmed
connected" — and this session found direct evidence today that Workers Builds *is* now connected
and actively deploying (the build log the owner pasted). At least one claim in that doc has
already gone stale since it was written, which is a reason for a cheap re-check before relying on
the Access claim, not a reason to distrust it outright.

**Downgraded from "unknown, blocking" to "probably fine, cheap to re-confirm, not a Phase 0
blocker."** The roadmap's own gate table (section 11: "Actual production identity and owner
mapping... Verify trusted edge, bypass prevention...") still applies before publishing MCP or
migrating owner keys — re-verify then, ideally once there's a production deployment (and Deploy
command, see the bug below) the owner considers current and trustworthy, by checking the
Cloudflare Access application still exists and is still scoped to the owner's email (a dashboard
check, not a code change).

## Deployment bug found and fixed this phase (Cloudflare Workers Builds / Git-connected CI/CD)

The owner reported the automated deploy pipeline (Cloudflare Workers Builds, connected to
`Adam-Kosicki/notion-todo-dashboard`) failing on `npx wrangler versions upload` with:

```
D1 binding 'DB' references database '00000000-0000-4000-8000-000000000000' which was not found.
```

That id is `SITE_CREATOR_PLACEHOLDER_DATABASE_ID` in `vite.config.ts` — the local-dev fallback
used when `CF_D1_DATABASE_ID` isn't set.

**This Worker has two separate Cloudflare Build triggers, not one** (found via the Cloudflare
API — `GET /accounts/{account_id}/builds/workers/{script_tag}/triggers` — not visible from the
dashboard screen the owner had open, which only showed one trigger's settings):

- **`main`-branch trigger** (production): `npx wrangler deploy --config wrangler.deploy.jsonc` —
  already correct. Production was very likely never actually broken; the pasted build log was
  for a `feature/quick-capture-organize` push, not `main`.
- **"Deploy non-production branches" trigger** (`branch_includes: ["*"]`,
  `branch_excludes: ["main"]` — every feature/preview branch): `npx wrangler versions upload`
  with **no `--config`**, so Wrangler fell back to whatever `dist/server/wrangler.json` the
  build itself produced (baked from `vite.config.ts`'s local-dev binding config, carrying the
  placeholder id) instead of `wrangler.deploy.jsonc`. This is the one that was actually broken,
  on every non-`main` push.

**Fixed 2026-09-07** via the Cloudflare API (`PATCH /accounts/{account_id}/builds/triggers/{trigger_uuid}`,
trigger `39f87663-c35d-42a3-be20-3b0c9a20f3c2`): changed its `deploy_command` to

```bash
npx wrangler versions upload --config wrangler.deploy.jsonc
```

matching the production trigger's already-correct pattern, and the comment at the top of
`wrangler.deploy.jsonc` (which says that file exists for exactly this). **Verified live**, not
just assumed: triggered a manual build on `feature/quick-capture-organize` after the fix
(`build_uuid e4cc5e60-75e2-47f0-b9e6-533aec0f0fc8`) — it succeeded, and its logs show
`env.DB (burner-board-db)` (the real production database), not the placeholder.

## Summary for Phase 0's acceptance criteria

- Baseline outcomes recorded: see the Phase 0 handoff message for typecheck/lint/test results
  and the pre-existing (unrelated) failures.
- Test DB isolation enforced: `tests/helpers/d1.mjs` only ever opens `:memory:` or a fresh temp
  file; nothing in the test suite touches `.wrangler/state`.
- Migration/restore rehearsal: both rehearsed above, on synthetic data only.
- Deployment identity assumptions: made explicit above; live verification remains an open gate,
  not guessed at.
