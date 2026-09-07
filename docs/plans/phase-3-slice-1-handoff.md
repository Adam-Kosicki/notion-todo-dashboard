# Phase 3 slice 1 handoff (for Astra re-review)

Status: Phase 3 slice 1 (`c02e352`) plus a blocker-remediation follow-up (`7060176`), both on
`claude-dev`. Astra's first review of `89e5ef1..c02e352` returned **BLOCK - FIX BEFORE SLICE 2**,
citing three material blockers plus one explicit roadmap-acceptance-criteria gap. All four are
addressed in `7060176`. **Phase 3 slice 2 has not started** - no slice-2 files exist, no UI
wiring has begun. This doc exists so Astra can re-review from the repository rather than this
session's chat history, per `AGENTS.md`'s Astra/Claude handoff protocol.

Current commit: **`70601763dfb39fa3ffe6b02d341b5625df71103e`** (`7060176` short), branch
`claude-dev`, pushed to `origin/claude-dev`. Working tree clean except pre-existing untracked
`.agents/`, `.claude/skills/`, `skills-lock.json` (not part of this work, not modified by it).

## Astra's blockers, confirmed against the code

Before making any change, each blocker was independently verified against `c02e352`:

1. **Blocker A (legacy completions invisible to weekly reports).** Confirmed:
   `lib/server/board-store.ts`'s `updateItem` - the write path the live app actually uses, since
   `items.complete`/`items.reopen` aren't wired into `app/api/board/route.ts` yet - never wrote to
   `activity_events`. `weekClose`'s `listActivityEventsForItems` query therefore returned nothing
   for any item completed through the real app, regardless of edge case; this wasn't a corner
   case, it was total.
2. **Blocker B (command persistence not atomic).** Confirmed: `applyCommand` ran a command's
   mutation, board-revision bump, activity-event append, and receipt save as four separate
   awaited D1 calls with no shared transaction. Matches Terra's described fault-injection
   failure mode exactly, and the same separation left `week.commit`/`week.withdraw` able to race
   a concurrent `week.close`'s read-compute-freeze sequence.
3. **Blocker C (weekly statistics contract violations).** Confirmed all three counterexamples
   against `lib/domain/progress.ts`'s `computeWeekStats`: it compared raw event-timestamp strings
   directly against plain `YYYY-MM-DD` date strings (timezone-naive - a timestamp string always
   lexicographically sorts after its own date prefix, regardless of actual time of day), and
   walked each item's entire complete/reopen history globally rather than bounding it to the week
   being evaluated or to the commitment's `addedAt`.
4. **Explicit roadmap gap (not from Astra's numbered findings, but called out):** confirmed
   `week.commit` threw `CONFLICT` when re-adding a previously withdrawn commitment, while the
   roadmap's Phase 3 acceptance criteria (section 8) explicitly require add/withdraw/re-add.

No other material contradiction was found; Astra's assessment that the exemption
(Focus/weekly-commitments having no Notion equivalent, so not gated behind `d1_primary`) is
architecturally sound was not disputed and nothing here changes that.

## Exact fixes made, per blocker

**Blocker A** - `lib/server/board-store.ts`'s `updateItem`: after the existing `UPDATE items`
call, if `status` transitions to `"Done"` (and wasn't already), or transitions away from `"Done"`
while `completedAt` was set, it now calls `appendActivityEvent` (imported from
`lib/server/repository.ts`) with `eventType: "items.complete"` / `"items.reopen"` respectively -
the identical event types/shape `lib/server/commands.ts`'s `itemsComplete`/`itemsReopen` already
write for the (currently unreached) new command path. Both paths now feed the same history.

**Blocker B** - `lib/server/commands.ts`: `focus.set`, `week.commit`, `week.withdraw`, and
`week.close` (the four commands slice 2 will wire into the UI) no longer go through the old
`HANDLERS` dispatch. Each now returns either a true no-op outcome (nothing to write - e.g.
already-committed-and-active) or an `AtomicPlan`: a `guardSql`/`guardParams` precondition (an
`EXISTS (...)` subquery, or `"1=1"` where nothing needs guarding) plus one `primaryStatement`.
`applyAtomicPlan` assembles ONE `db.batch()` call containing the guard-gated revision bump,
guard-gated activity-event insert(s), guard-gated receipt insert, and finally the plan's own
primary statement (deliberately last, so nothing earlier in the batch can mutate a row the guard
itself reads before the guard is evaluated) - either everything in that batch takes effect
together or, if the precondition no longer holds when it actually runs, all of it is a no-op
together, determined by checking `meta.changes` on the primary statement's result.

- `lib/server/repository.ts`: `upsertWeekCommitmentStmt` (replaces `addWeekCommitment`) is an
  `INSERT ... SELECT ... WHERE EXISTS (week status = 'open') ON CONFLICT (...) DO UPDATE SET
  withdrawn_at = NULL, ...` - this single statement is both Blocker B's guard AND the re-add fix
  (an upsert against the existing `(owner_id, week_id, item_id)` primary key naturally handles
  first-add and re-add identically). `withdrawWeekCommitmentStmt` (replaces
  `withdrawWeekCommitment`) carries the same `EXISTS (status = 'open')` guard as a plain `AND`
  clause. `setFocusItemStmt`/`removeFocusItemStmt` (replace `setFocusItem`/`removeFocusItem`)
  return unexecuted statements for the same reason.
- `week.close`'s read-compute-write sequence can't be expressed as one batch (the compute step
  needs JS between the read and the write), so it gets explicit mutual exclusion instead: new
  `beginClosingPlanningWeek` does a compare-and-swap `UPDATE ... SET status = 'closing' WHERE
  status = 'open'`. While a week is `'closing'`, `week.commit`/`week.withdraw`'s own guard
  (`status = 'open'`) refuses to run - this is what stops the commit/withdraw-vs-close race Astra
  described. `finalizeClosedPlanningWeekStmt` (replaces `closePlanningWeekRow`) only takes effect
  `WHERE status = 'closing'`. If a process crashes after entering `'closing'` but before
  finalizing, the next `week.close` call (same or different request) finds `status = 'closing'`
  and resumes - recomputes and finalizes - rather than erroring or leaving the week stuck forever.
- Found and fixed in passing, needed for Blocker C's fix to be correct: `appendActivityEvent`
  relied on SQLite's own `CURRENT_TIMESTAMP` column default for `activity_events.timestamp`,
  which produces `"YYYY-MM-DD HH:MM:SS"` (a space, not `"T"`) - this sorts as **less than** any
  same-day ISO instant (`' ' < 'T'` in ASCII) regardless of actual time of day, which would have
  silently broken every one of Blocker C's new instant-based comparisons for any event written
  through the normal command path. Every `activity_events` write (both the atomic-plan path and
  the existing `finishViaBumpAndReceipt` path used by items./lists.) now binds an explicit
  `new Date().toISOString()` instead.
- `items.*`/`lists.*` are unchanged - see "Intentionally deferred" below.

**Blocker C** - `lib/domain/progress.ts`:
- New `zonedMidnightUtc(dateStr, timezone)`: resolves the real UTC instant of local midnight on a
  calendar date in a given IANA timezone (same double-conversion technique the existing
  `mondayStartOf` already used via `Intl.DateTimeFormat`, so DST transitions resolve correctly for
  that specific date rather than a fixed offset).
- `computeWeekStats`'s `week` parameter gained a required `timezone` field; week boundaries are
  now real UTC instants (`weekStartInstant`/`weekEndInstant`), not raw date strings.
- A completion only counts as on-time if it's `>= commitment.addedAt` (contract: "count completion
  events inside the week **after commitment selection**") - previously a completion predating the
  commitment's addition still counted.
- Each week's on-time determination now walks the item's event history bounded to `< weekEndInstant`
  only; late-completion detection is a separate pass over the full history. This is what stops a
  reopen in a *later* week from retroactively erasing an *earlier*, already-elapsed week's credit
  (previously "last event wins" was evaluated globally, with no per-week cutoff).

## Files / symbols changed

| File | Symbols |
| --- | --- |
| `lib/domain/progress.ts` | `computeWeekStats` (signature + logic), new `zonedMidnightUtc` |
| `lib/server/commands.ts` | New: `AtomicPlan` type, `focusSetPlan`, `weekCommitPlan`, `weekWithdrawPlan`, `weekClosePlan`, `applyAtomicPlan`, `ATOMIC_HANDLERS`, `finishViaBumpAndReceipt`. Removed: `focusSet`, `weekCommit`, `weekWithdraw`, `weekClose` (old non-atomic versions). `HANDLERS` is now `Partial` (items./lists. only). `applyCommand` branches on `ATOMIC_HANDLERS` first. |
| `lib/server/repository.ts` | New: `beginClosingPlanningWeek`, `finalizeClosedPlanningWeekStmt`, `upsertWeekCommitmentStmt`, `withdrawWeekCommitmentStmt`, `setFocusItemStmt`, `removeFocusItemStmt`. Removed: `addWeekCommitment`, `withdrawWeekCommitment`, `closePlanningWeekRow`, `setFocusItem`, `removeFocusItem`. Changed: `appendActivityEvent` now requires an explicit `timestamp` param. |
| `lib/server/board-store.ts` | `updateItem` gained the two `appendActivityEvent` calls (complete/reopen transitions) |
| `tests/progress.test.mjs` | Rewritten fixtures (`timezone` field), + 3 Astra-counterexample regressions + 1 DST regression |
| `tests/focus-week-commands.test.mjs` | + re-add test, 2 concurrency-guard tests, 1 stuck-`closing`-resumption test, 2 atomicity tests (single-batch-call proof, failed-batch-leaves-nothing proof) |

## Migrations affected

**None.** No new migration was created or is needed - this is a code-only remediation against the
existing `drizzle/0009_sour_tinkerer.sql` schema (`focus_items`, `planning_weeks`,
`week_commitments`) from slice 1. `planning_weeks.status` is a free-text column (not an enum
constraint), so the new `'closing'` transitional value required no schema change. Astra's
guidance to hold off running migration 0009 against production is unaffected either way - the
live route still doesn't use any of this code.

## Focused verification (this session)

```
node --test tests/progress.test.mjs
  -> 12/12 pass (includes the 3 Astra counterexamples + 1 DST-transition case)

node --test tests/commands.test.mjs tests/focus-week-commands.test.mjs
  -> 23/23, then 32/32 after adding the new regression tests - all pass
  (includes: re-add lifecycle; commit rejected while status='closing'; withdraw rejected while
  status='closing'; a week stuck in 'closing' is resumed and finalized by a later week.close call;
  a spy on db.batch proves week.commit's mutation+revision+event+receipt is exactly one batch()
  call; a db.batch that throws outright leaves no commitment row, no receipt, and revision at 0)
```

## Full-suite / typecheck / lint (this session)

```
npm run typecheck   -> clean, no output
npm run lint         -> 2 pre-existing errors + 13 pre-existing warnings, all in app/board-app.tsx
                        (react-hooks/set-state-in-effect, unused-vars) - a file untouched by this
                        work; confirmed pre-existing, not introduced here
npm test             -> (build + node --test tests/*.test.mjs) 77 tests, 75 pass, 2 fail
                        Both failures are tests/rendered-html.test.mjs "renders development
                        preview metadata" and tests/ui-components.test.mjs "emits the catalog's
                        animation and scrolling utilities" - a local dev-server WebSocket port
                        collision ("Port 24678 is already in use"), unrelated to this work.
                        Confirmed via `git stash` + rerun that both fail identically against the
                        unmodified c02e352 baseline.
```

## Intentionally deferred - items./lists.' own atomicity, and why it's unreachable

`items.*`/`lists.*` commands still run through the old, unchanged non-atomic path (mutation,
revision bump, activity event, receipt as four separate D1 calls) - the same shape as Blocker B,
just not fixed in this remediation. This is a deliberate scope cut, not an oversight:

- `requiresD1Primary()` in `lib/server/commands.ts` still gates every `items.*`/`lists.*` action
  behind `storage_mode = 'd1_primary'`, and `board_state.storage_mode` defaults to
  `'legacy_notion'` for every real owner (confirmed unchanged - nothing in this remediation
  touches storage-mode assignment). The real owner cannot reach these commands at all today.
- `app/api/board/route.ts` does not call `applyCommand` for any action yet (confirmed - this
  predates Phase 3 and is unchanged); the live app's only write path for items/lists is still
  `board-store.ts`.
- Astra's own framing tied the "fix before wiring the UI" urgency specifically to the commands
  slice 2 actually exposes - `focus.*`/`week.*`. Those are fixed. `items.*`/`lists.*`'s version
  of this weakness predates Phase 3 (Astra's review said as much) and remains exactly as
  reachable (not at all, by a real owner) as it was before this session.

This should be revisited when Phase 4's cutover gate is approached, since flipping
`storage_mode` to `d1_primary` for the real owner is exactly the point at which `items.*`/`lists.*`
stop being theoretical.

## Remaining risks

- **Legacy hard-delete vs. Focus/commitment references.** Astra noted legacy hard deletion
  (`board-store.ts`'s `deleteItem`, still a real `DELETE FROM items`, unchanged) can leave
  `focus_items`/`week_commitments` rows pointing at a since-deleted item. Not fixed here: the read
  path already degrades safely (`weekClose`'s `itemsById[itemId]` lookup treats a missing item as
  a task via its existing `? ... : true` fallback, so it doesn't crash or silently drop the
  commitment from the denominator), and changing legacy delete semantics to tombstone-on-delete is
  a Phase 1/4 cutover concern, not this slice's. Flagging so it isn't forgotten before cutover.
- **`items.*`/`lists.*` non-atomicity** - see above; unreached today, but will need the same
  `AtomicPlan` treatment (or equivalent) before Phase 4 flips `storage_mode`.
- **`week.close`'s mutual exclusion is process-local logic enforced by a DB compare-and-swap, not
  a DB-level lock/lease with a timeout.** A week can sit in `'closing'` indefinitely if no one ever
  calls `week.close` again (e.g. a crashed request and the owner never revisits that week). This is
  low-impact - `week.commit`/`week.withdraw` correctly refuse in that state (CONFLICT, not silent
  data loss) rather than corrupting anything - but the week's stats stay unavailable until someone
  retries the close. No expiry/cleanup mechanism exists yet.
- **No `docs/ARCHITECTURE.md`/`CONTEXT.md` update was made this session** - out of scope for a
  blocker-remediation pass; due whenever slice 2 actually ships user-visible Focus/weekly-progress
  behavior, per the roadmap's instruction 7.

## Exact next unblocked action

Send `70601763dfb39fa3ffe6b02d341b5625df71103e` (or the range `c02e352..7060176`) to Astra for
re-review. **Phase 3 slice 2 (Focus/weekly-progress UI, roadmap section 8) has not been started**
- no slice-2 files exist, no `app/board-app.tsx` wiring has begun - pending that re-review's
outcome, per Adam's explicit instruction not to start it yet.
