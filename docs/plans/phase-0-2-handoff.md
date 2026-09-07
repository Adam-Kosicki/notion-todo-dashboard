# Phase 0-2 handoff (for Astra review)

Status: implementation complete against `docs/plans/burner-board-roadmap.md`'s acceptance
criteria for Phases 0, 1, and 2 (both slices). Written so Astra can verify from the repository
rather than reconstructing this from chat history, per `CLAUDE.md`'s Astra/Claude handoff
protocol.

Branch state: `main`, `claude-dev`, and `feature/quick-capture-organize` are all at the same
commit and match `origin/main`. Working tree is clean except for this handoff doc itself and
one small test-infrastructure follow-up committed alongside it (see below).

## Phase 0 - baseline verification and tooling

Commit `b5da24c` (plus the deploy-trigger fix in `dada4bc` and the production redeploy in
`6c5bba7`, found necessary while verifying Phase 0's baseline).

- `tests/helpers/d1.mjs`: node:sqlite-based D1 test harness (in-memory/temp-file only, never
  touches `.wrangler/state`).
- `tests/migrations.test.mjs`: migration runner tests, including a regression test that seeds
  rows before applying the newest migration (added after the Phase 1 SQLite bug below - this is
  what makes that class of bug fail loudly instead of silently in the future).
- `scripts/migrate-board.mjs`: dry-run/check/apply/seed migration runner with a ledger table;
  no default `--db` target ever.
- `docs/operations/data-recovery.md`: recovery/migration process, later extended in Phase 1.
- Found and fixed in passing: the "Deploy non-production branches" Cloudflare Build trigger was
  missing `--config wrangler.deploy.jsonc`; the `main`-branch trigger was already correct.
  Production had actually never been deployed via the git pipeline before this was fixed
  (previous deploys were all manual `wrangler deploy`). Confirmed Cloudflare Access is live on
  the production URL (unauthenticated requests to `/` and `/api/board` both 302 to
  `cloudflareaccess.com`).

## Phase 1 - D1 authority foundation and shared command layer

Commit `c5ae141`, plus `bbbc0c1` (CLAUDE.md restore after an external overwrite) and `1e3974e`
(production migration record).

- `db/schema.ts` / `drizzle/0008_sticky_dakota_north.sql`: `items` gains `listId`, `createdAt`/
  `createdAtSource`, `recordedAt`, `deletedAt`, `reviewState`, `version`; new tables
  `boardState`, `commandReceipts`, `activityEvents`.
- `lib/domain/contracts.ts`, `lib/server/repository.ts`, `lib/server/commands.ts`,
  `lib/server/queries.ts`, `lib/server/identity-resolver.ts`, `lib/server/notion-legacy.ts`:
  the new `d1_primary` command layer - idempotent (`command_receipts`), version-guarded writes,
  storage-mode gated (`FORBIDDEN` for `legacy_notion` owners), zero Notion/network access
  (verified by a test scanning the source for `fetch(`).
- **Not wired into the live app.** `board_state.storage_mode` defaults to `legacy_notion` and
  nothing in `board-store.ts`/`app/api/board/route.ts` checks it yet. This is deliberate per the
  roadmap - the real owner stays on `legacy_notion` until the Phase 4 cutover gate. Confirmed
  today (see Notion note below) that `board-store.ts` still talks to Notion unconditionally.
- **Real bug caught before it hit production data:** SQLite rejects `ALTER TABLE ADD COLUMN`
  with a non-constant default (`CURRENT_TIMESTAMP`) on a non-empty table - invisible against any
  freshly-migrated empty test database, but would have broken identically against the real,
  non-empty local dev D1 (569 rows) and production D1. Fixed by dropping the DB-level default
  and backfilling via `UPDATE` in the migration; the regression test in `migrations.test.mjs`
  (seed-then-migrate) exists specifically so this can't hide again.
- Migration 0008 applied to **both** local dev D1 and, with Adam's explicit approval (backed by
  a CSV export as a restore point), **production D1** (`burner-board-db`).
- Tests: `tests/commands.test.mjs` (17), `tests/identity.test.mjs` (5), plus the
  `list-behavior.test.mjs` additions below - all passing.

## Phase 2 - everyday usability (slice 1 + slice 2)

Commits `862adf9`, `8522f1c`, `881a6b7`.

Slice 1:
- `lib/list-behavior.ts`: Events can live in Lists (Calendar is a projection, not exclusive);
  list moves no longer auto-set `itemType` from a list's default (membership only).
- `components/board/history-view.tsx` (new): search + List filter + date-range filter over
  Completed/Archived, 50-row cap with "show all".
- Filterbar: "Inbox" renamed "Needs review"; new separate "Unfiled (no list)" filter.
- `NewListCard`: dropped the upfront Type picker (defaults to General).
- `app/guide/ai/page.tsx` (new): honest "not available yet" AI setup guide, no fake connect flow.

Slice 2:
- `components/board/bulk-actions.tsx` (new): `BulkActionBar` - select multiple rows, apply one
  batch action (move list / set item type / set importance), before/after preview, honest
  partial-failure reporting. Sequential per-item calls to the existing single-item update (no
  bulk endpoint exists).
- Selection mode added to `TaskTable` (all call sites) and lifted into `CollectionsView`'s
  top-level state (`renderList` is a plain closure, can't hold hooks itself).
- `EditorSheet` restructured: core fields (Importance, Status, List, Due, Notes) always visible;
  everything else behind a "More fields" `Collapsible`, collapsed by default.
- Non-drag grouping alternative: "Group with..." `<select>` next to "Move to list...", closing
  the keyboard/touch accessibility gap for grouping specifically (move and reorder already had
  non-drag alternatives).

Follow-up committed alongside this handoff doc: `tests/board-workflows.test.mjs` and
`tests/helpers/dom.mjs` add jsdom + `@testing-library/react` component-interaction testing
(closing the gap flagged in the slice 2 handoff - previously only pure-function and
built-HTML-string tests existed). Three tests cover `BulkActionBar`'s move/type/priority actions
and the partial-failure-keeps-selection behavior, layered on the Vite `ssrLoadModule` pipeline
`tests/ui-components.test.mjs` already established for real `.tsx` loading.

## Verification (actual results, this session)

```
npm run typecheck   -> clean, no output
npm run lint         -> not re-run this session; was clean at each prior phase commit
npm test             -> 53 tests, 51 pass, 2 fail (both pre-existing, unrelated: a
                         `cloudflare:` ESM-scheme import in one file under plain `node --test`,
                         and a stale scrollbar-CSS regex in ui-components.test.mjs - both
                         present before this session's Phase 0 work started)
```

Manual/live verification:
- Confirmed via direct Cloudflare API access that both the `main` and non-production Build
  triggers now deploy correctly; watched one full triggered build succeed after the fix.
- Confirmed via unauthenticated `curl` that Cloudflare Access gates the production URL.
- Confirmed live in the browser (`localhost:5174`, Claude in Chrome integration, connected this
  session via `claude --chrome`) that selection mode, the bulk-action bar's preview text, and
  its list/type dropdowns behave identically to what `board-workflows.test.mjs` asserts. Stopped
  short of clicking Apply once it was clear the selected row was a real task, not a `Zz Test`
  fixture - selection was cleared instead, no real data mutated.

## Known risks / deferred, not blocking

- Cross-List-merge guard and bulk-action logic are UI-level only; `board-store.ts` has no
  server-side awareness of either. Low risk (no public-facing API), but real.
- `components/board/list-settings.tsx` extraction deferred - pure refactor, no behavior change,
  no acceptance-criteria cost.
- **Notion sync is still fully active in production, unconditionally** - `board-store.ts` has no
  storage-mode gate wired in yet. This is expected/by-design per the roadmap (Phase 4 cutover
  gate), not a regression, but flagging it explicitly since Adam asked about it this session.

## Rollback implications

- Migration 0008 added nullable/defaulted columns and new tables only - no destructive schema
  changes. Rolling back would mean reverting the drizzle migration and the corresponding code;
  the pre-migration CSV export (`burner-board-2026-09-07.csv`) remains the restore point for
  production data if ever needed.
- The `d1_primary` command layer is fully inert for the real owner (storage_mode defaults to
  `legacy_notion`) - nothing here changes real-owner behavior yet, so there is nothing to roll
  back on that front.
- Phase 2 UI changes (History view, bulk actions, editor restructuring) are additive/behavioral
  only, no schema or data changes - reverting is a plain code revert if ever needed.

## Exact next unblocked action

Phase 3 - Focus and trustworthy weekly progress (roadmap lines 346-352): new
`lib/domain/progress.ts`, `components/board/focus-view.tsx`, `weekly-progress.tsx`,
`tests/progress.test.mjs`; phase-3 schema for `focus_items`/`planning_weeks`/`week_commitments`;
explicit Focus/weekly-commitment controls kept independent of AI selection and Last Interaction.
Nothing blocks starting it. Already authorized by Adam pending this handoff.
