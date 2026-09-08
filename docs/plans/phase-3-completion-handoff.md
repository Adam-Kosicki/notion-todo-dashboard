# Phase 3 completion batch handoff

Status: implementation report for `docs/plans/phase-3-completion-batch.md`'s ordered package.
Written by Claude Sonnet for Astra's next batch review. This is evidence of what was done and
verified, not a self-declaration that Phase 3 has passed acceptance - the completion batch doc
itself is explicit that only Astra's review closes that loop.

## Implemented range

Base: `3106dea` (tip of `claude-dev` at the start of this batch - "Phase 3 extension: generic
Today/Month/Year planning periods"). This handoff covers the commits on top of it, on branch
`claude-dev` (not yet pushed to `origin` - confirm with Adam before pushing, per this repo's
normal caution).

## What the completion batch doc's "ordered implementation package" asked for, and what happened

1. **Complete the shared progress refactor** (`computeWeekStats` -> `computePeriodStats`,
   consumers/tests). **Already done before this batch started** - `tests/progress.test.mjs` was
   19/19 green at the start of this session (verified by running it standalone before touching
   any code). No action needed; recorded here only because the completion batch doc flagged it as
   an open risk from mid-flight observation.
2. **Finish the period command/query lifecycle** (real dispatcher, transactional adapter,
   receipts/replay, cross-period scoping, migration 0010 assertions). **Already done** -
   `tests/period-commands.test.mjs` (14 tests) already covered this before the batch started.
   No action needed.
3. **Finish and verify the whole user flow**, explicitly including "the persisted timezone
   setting and bounded selected-week/history access" and "the required added/withdrawn/deferred
   presentation." **This batch's actual work** - see below.
4. **Reconcile the contract and finish the handoff.** This document, plus the roadmap/CONTEXT.md/
   ARCHITECTURE.md updates described below.

## What this batch built

### 1. Persisted owner planning-timezone preference

`lib/server/queries.ts`'s `DEFAULT_PLANNING_TIMEZONE` ("America/Chicago") is now genuinely a
*suggested default*, not the only value: a new `settings.setPlanningTimezone` command
(`lib/domain/contracts.ts`'s `SettingsSetPlanningTimezoneSchema`, `lib/server/commands.ts`'s
`settingsSetPlanningTimezone`) persists an owner's chosen IANA timezone name.

- **Storage**: reuses the pre-existing `app_meta` key/value table (`lib/server/repository.ts`'s
  `getOwnerPlanningTimezone`/`setOwnerPlanningTimezoneStmt`), the same pattern
  `board-store.ts`'s `getVisibility`/`updateVisibility` already uses for `home_visibility` - no
  migration needed.
- **Validation**: the Zod schema rejects anything that isn't a real IANA zone name via
  `new Intl.DateTimeFormat(undefined, { timeZone: value })` (throws for garbage input) rather
  than shipping/maintaining a separate zone-name list.
- **Effect boundary** (the completion batch's explicit requirement - "never reinterpret
  already-frozen reports"): `lib/server/queries.ts`'s new `getOwnerTimezone()` is read only by
  `app/api/board/route.ts`'s `getFocusAndWeekProgress()`, and only feeds
  `getOrCreateCurrentPlanningWeek`/`getOrCreateCurrentPlanningPeriod`'s "create a NEW row"
  path. An existing `planning_weeks`/`planning_periods` row already stored its own `timezone`
  at creation time and is never touched by a later preference change - proven by
  `tests/phase-3-completion.test.mjs`'s "changing the timezone preference affects only NEW
  weeks" test (creates a week under the default, changes the preference, re-reads the same week
  by id, asserts its stored timezone is unchanged).
- **Audit trail**: the command records a `settings.timezone_changed` activity event with
  before/after values (`make timezone changes' effect clear` from the completion batch doc).
- **No Notion equivalent** - like `focus.*`/`week.*`/`period.*`, exempt from the `d1_primary`
  gate (`requiresD1Primary` in `commands.ts` is unchanged; `settings.` doesn't match its
  `items.`/`lists.` prefix check), so it works for the real owner today.
- **UI**: `components/board/planning-timezone.tsx` - a small select (full IANA list via
  `Intl.supportedValuesOf("timeZone")` where available, an 11-zone curated fallback otherwise),
  shown at the top of the Focus tab, with explicit copy: "Applies to new weeks and periods going
  forward - existing ones keep the timezone they were created with."

### 2. Bounded, owner-scoped prior-weeks read path

The gap: `GET /api/board` only ever resolved the *current* planning week
(`getOrCreateCurrentPlanningWeek`), so a prior week's frozen report - which fully survives in
`planning_weeks` - became unreachable in the browser the moment a new week started.

- **New repository function**: `listPlanningWeeks(db, ownerId, limit)` - every week the owner has
  touched, most-recent-first, bounded by `limit` (new `LIMITS.maxPlanningWeekHistory = 52`, about
  a year of weekly history - "bounded... not a general analytics UI" per the completion batch
  doc).
- **New query functions**: `listRecentPlanningWeeks()` (wraps the above with the default bound)
  and `getPlanningWeekProgressById(db, ownerId, weekId)` - looks up an arbitrary owner-scoped week
  by ID (current or historical) and returns its full `WeekProgress` (live or frozen, reusing the
  existing `getWeekProgress`/`computeCurrentWeekStats` - one implementation, not two). Returns
  `null` for an unknown or not-owned ID (never leaks another owner's week - covered by test).
- **New route**: `app/api/board/weeks/route.ts` (GET only). No query param returns the bounded
  list; `?weekId=<id>` returns that week's full progress or 404. This is a read-only sibling to
  the existing `/api/board` route - closing/committing/withdrawing on a selected week still goes
  through the existing `POST /api/board` versioned-command envelope unchanged (`week.close`/
  `week.commit`/`week.withdraw` already accepted an arbitrary `weekId`; the gap was purely that
  the browser had no way to *discover* one).
- **UI**: `components/board/weekly-progress.tsx` gained a "Prior weeks" toggle that lazily loads
  the list (`onLoadPastWeeks`) and a `<select>` to view any of them (`onSelectWeek`). Viewing a
  prior week reuses the exact same add/withdraw/close controls, gated by that week's own
  `status === "open"` - a still-open stale prior week (never closed before the next week started)
  can be added to, withdrawn from, and closed, not just viewed; a closed one is read-only exactly
  like the current week's closed state already was. `app/board-app.tsx` wires this with a
  deliberately separate set of handlers (`commitToHistoricalWeek`/`withdrawFromHistoricalWeek`/
  `closeHistoricalWeek`) rather than generalizing `commitToWeek`/`withdrawFromWeek`/`closeWeek` -
  those three keep targeting the current week unconditionally, so Home-page row quick actions
  (`toggleWeekCommitment`) are completely unaffected by whatever the Focus tab's history selector
  happens to have selected.

### 3. Optional withdrawal reason, surfaced as an explicit deferral

The `withdrawal_reason` column and the `reason` field on `week.withdraw`/`period.withdraw`'s
schemas already existed from slice 1/the period extension - the gap was entirely in the UI, which
never collected or displayed one. Now:

- Clicking withdraw (in both `weekly-progress.tsx` and `period-progress.tsx`) prompts
  `window.prompt` for an optional reason (same blocking-native-dialog pattern this file already
  used for `window.confirm` on close-week). Cancelling the dialog aborts the withdrawal entirely;
  OK with blank text withdraws with no reason recorded.
- A withdrawn commitment with a reason renders `Deferred: <reason>` instead of the generic
  `Withdrawn` label (full reason in a `title` tooltip for anything the truncated text clips).
- **Does not touch the stats denominator or reschedule anything** - the completion batch's
  explicit constraint. `computePeriodStats` is unchanged; this is presentation only.

### 4. Sample-mode decision (explicit limitation, not simulated)

The completion batch doc asked to either implement deterministic sample-mode planning
interactions or explicitly record the limitation instead of claiming parity. **Decision: keep the
existing explicit-limitation behavior, unchanged.** Sample mode already shows "Focus and planning
progress aren't available in the sample board" (the Focus tab's fallback branch) and each
row-level quick action shows an explicit "Exit the sample board to use Focus/weekly progress/
planning periods" toast rather than silently no-opping or faking success. This was true before
this batch and remains true after it - verified by reading `app/board-app.tsx`'s demo-mode
branches, not changed. Rationale for not building simulated sample interactions: Focus/weekly/
period commitments are already real, low-risk, non-Notion D1 writes reachable by every real
owner today (not gated behind any cutover), so the actual feature is one click away from a
real board; simulating it in-memory for the sample board would be meaningful new state-management
surface (a second, parallel in-memory command layer) for a demo-only convenience. Recorded here
as the explicit choice the completion batch doc asked for - see the new memory entry
`phase3-sample-mode-decision` for future sessions.

## Files changed

| File | Change |
| --- | --- |
| `lib/domain/contracts.ts` | `SettingsSetPlanningTimezoneSchema`/type, added to `COMMAND_SCHEMAS`; new `LIMITS.maxPlanningWeekHistory` |
| `lib/server/repository.ts` | `getOwnerPlanningTimezone`/`setOwnerPlanningTimezoneStmt` (reuse `app_meta`); `listPlanningWeeks`/`PlanningWeekSummary` |
| `lib/server/commands.ts` | `settingsSetPlanningTimezone` handler, registered in the non-atomic `HANDLERS` map |
| `lib/server/queries.ts` | `getOwnerTimezone`; `listRecentPlanningWeeks`; `getPlanningWeekProgressById` |
| `app/api/board/route.ts` | `getFocusAndWeekProgress` resolves the owner timezone and returns `planningTimezone`; command dispatch condition widened to `settings.*` |
| `app/api/board/weeks/route.ts` | **new** - GET-only sibling route for the prior-weeks list/single-week read path |
| `lib/board-types.ts` | `BoardPayload.planningTimezone`; re-exports `PlanningWeekSummary` |
| `components/board/planning-timezone.tsx` | **new** - the timezone picker |
| `components/board/weekly-progress.tsx` | withdrawal-reason prompt + deferral display; prior-weeks history selector props/UI |
| `components/board/period-progress.tsx` | withdrawal-reason prompt + deferral display (no history selector - the completion batch doc named only weeks) |
| `app/board-app.tsx` | `changePlanningTimezone`; `loadPastWeeks`/`selectWeek`/`refreshHistoricalWeek`/`commitToHistoricalWeek`/`withdrawFromHistoricalWeek`/`closeHistoricalWeek`; Focus-tab wiring |
| `tests/phase-3-completion.test.mjs` | **new** - 10 tests: timezone command validation/persistence/effect-boundary/audit-event; prior-weeks listing/bounding/ownership-isolation; reaching a closed AND a still-open prior week by id |
| `tests/weekly-progress-workflows.test.mjs` | **new** - 6 real-component (jsdom + RTL) tests: deferral label rendering, the withdraw-reason prompt's three outcomes (reason given / cancelled / blank), and the history selector's load-then-select flow |

## Migrations

**None.** The timezone preference reuses the existing `app_meta` table; the prior-weeks read path
reuses the existing `planning_weeks` table as-is. Migration 0010 (already applied last session)
is unaffected.

## Verification commands and actual results

Run from this batch's worktree (`node_modules` junctioned from the main checkout - identical
`package-lock.json`/`package.json`, confirmed via `git diff main..claude-dev` before linking).

```
npm run typecheck
  -> clean, no output

npm run lint
  -> 15 problems (2 errors, 13 warnings) - IDENTICAL to the pre-existing baseline, confirmed by
     running lint again against `git stash` (this batch's changes fully reverted). The 2 errors
     are both pre-existing react-hooks/set-state-in-effect findings in app/board-app.tsx
     (localStorage-restoring effects, lines ~891/1457) - unrelated to this batch, not introduced
     by it, and not newly triggered by it.

npm test  (runs the build, then node --test tests/*.test.mjs)
  -> 113 tests, 111 pass, 2 fail
     The 2 failures are the same two PRE-EXISTING, unrelated failures noted in every prior Phase 3
     handoff back through slice 1: tests/rendered-html.test.mjs's "renders development preview
     metadata" (Node ESM loader rejects a `cloudflare:` URL scheme) and tests/ui-components.test.mjs's
     "emits the catalog's animation and scrolling utilities" (a scrollbar-width CSS regex
     mismatch). Re-confirmed as pre-existing by re-running the identical two tests standalone
     both before and after this batch's changes, with identical failure output either time.
     97 tests existed before this batch (95 pass/2 fail, matching); this batch added 16 new tests
     (10 domain/command in tests/phase-3-completion.test.mjs, 6 real-component in
     tests/weekly-progress-workflows.test.mjs), all passing.
```

Per the completion batch doc's evidence guidance: "an already successful full test command
includes the build; repeat it only when subsequent changes or failures justify doing so" - the
final `npm test` run above is the authoritative one; earlier runs during this batch (before all
files were finished) are not separately reported.

## Manual verification

**Not performed with a live browser this session.** This session's harness did not have the
`mcp__claude-in-chrome__*` tools available, which means Claude Code was started without the
`--chrome` flag (per `CLAUDE.md`'s guidance on this). Everything reported above is automated-test
and typecheck/lint evidence only. **Adam: if you want the Focus tab's new timezone picker and
prior-weeks selector actually clicked through in a real browser against local dev data (with a
synthetic `Zz Test ...` week/commitment, cleaned up after), relaunch Claude Code with
`claude --chrome` from this directory and ask for that pass explicitly** - the previous session's
Today/Month/Year batch did get a full live walkthrough; this one has automated coverage only.

## Outstanding limitations / not done in this batch

- **Sample mode still doesn't simulate planning interactions** - by explicit decision (see
  above), not an oversight.
- **No live browser verification** (see Manual verification above).
- **Prior-period (Today/Month/Year) history browsing was not built** - the completion batch doc
  named only "prior weeks" as the gap ("Add a bounded owner-scoped week selector/read path");
  Today/Month/Year periods roll over far more often (daily) and v1 periods never close, so
  "browsing a prior day" has much less of the "orphaned frozen report" problem a week has. Left
  out as out-of-scope for this batch; flag to Astra if historical period browsing turns out to
  matter in practice.
- **The prior-weeks history selector list has no pagination UI** - `listRecentPlanningWeeks`
  is bounded server-side (52 weeks) but the client always fetches the whole bounded list in one
  request. Fine at this owner's actual weekly volume; would need real pagination if that bound
  is ever raised substantially.
- **`app/board-app.tsx` remains one large file** (now further grown by this batch's additions);
  no extraction was attempted here - out of this batch's scope per "keep frontend polish bounded
  until the extended planning flow meets acceptance."

## Rollback implications

Every change here is additive (new command, new route, new UI, no migration). Reverting this
batch's commits removes:
- the timezone picker and the `settings.setPlanningTimezone` command (owners silently return to
  the hardcoded `America/Chicago` default - no data loss, since no existing row's stored timezone
  was ever touched by this feature),
- the prior-weeks selector and its GET route (prior weeks remain in storage, simply unreachable
  in the UI again - the exact pre-existing state this batch fixed),
- the reason prompt and deferral label (the `withdrawal_reason` column and command-schema field
  predate this batch and are untouched either way).

No forward-only state was created. A revert is safe at any point.

## Unresolved issues / questions for Astra

None that block continuing. The completion batch doc's remaining explicit gates (real-data
cutover, OAuth/MCP, etc.) are later-phase concerns, not this batch's.

## Exact next unblocked action

Send this handoff (and the diff since `3106dea`) to Astra for the next batch review. Per this
batch's completion-batch doc: "Return for batch review when the acceptance evidence is complete
or a material decision genuinely blocks progress" - this batch believes the four-step ordered
package is now complete, but the batch itself does not declare Phase 3 accepted; that determination
is explicitly reserved for Astra's review.

If Astra's review comes back clean, the next unblocked work is **Phase 4** (interchangeable AI
connectors, setup guide, cleanup proposals - roadmap section 8) - not yet started, gated on its
own explicit prerequisites (OAuth/endpoint selection, the real-data cutover gate) per the
roadmap's section 11 gates table.
