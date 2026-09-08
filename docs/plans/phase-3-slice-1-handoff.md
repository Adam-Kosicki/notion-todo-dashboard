# Phase 3 slice 1 handoff (for Astra re-review)

Status: Phase 3 slice 1 (`c02e352`) plus three blocker-remediation rounds (`7060176`, `fc8a2a3`,
`e578dd5`), all on `claude-dev`. Astra's first review of `89e5ef1..c02e352` returned **BLOCK - FIX
BEFORE SLICE 2** (three blockers + one roadmap gap, addressed in `7060176`); Astra's second review
of `7060176^..1698bc8` returned **NOT READY** (three P1 persistence findings + one re-add
regression left over from round 1, addressed in `fc8a2a3`); Astra's third review of
`7060176^..fc8a2a3` confirmed those three P1 fixes and the re-add fix, but found one new
regression introduced by round 2 itself (commit/withdraw history mixed across weeks), addressed in
`e578dd5`. **Phase 3 slice 2 has not started** - no slice-2 files exist, no UI wiring has begun.
This doc exists so Astra can re-review from the repository rather than this session's chat
history, per `AGENTS.md`'s Astra/Claude handoff protocol. See "Round 2" and "Round 3" below for
the second and third remediations; everything above them is unchanged from round 1's original
handoff.

Current commit: **`e578dd5d0346dcc81e33d056b065b2138d43aeec`** (`e578dd5` short), branch
`claude-dev`. Working tree clean except pre-existing untracked `.agents/`, `.claude/skills/`,
`skills-lock.json` (not part of this work, not modified by it). **Not yet pushed to
`origin/claude-dev` as of writing this section** - push before sending to Astra.

**Standards note from Astra's second review - resolved, no code/history change:** both round-1
commits (`7060176`, `1698bc8`) include a `Claude-Session:` URL, which `AGENTS.md` explicitly
forbids in public commit messages for this repo. That came from a session-level default
conflicting with the repo rule; every commit from `fc8a2a3` onward omits it. The owner was asked
whether to rewrite the already-pushed history to strip it from those two commits and declined -
left as-is intentionally, not an oversight.

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

## Round 2: Astra's second review (`7060176^..1698bc8`), findings confirmed and fixed

Astra reviewed the round-1 remediation plus its handoff commit and returned **NOT READY**: three
P1 persistence findings (spec/implementation) plus one Standards finding. All three P1 findings
were independently reproduced before any fix, using the technique of wrapping the real D1 test
adapter's `db.batch()` to inject a competing write at the exact race window a partial fix would
otherwise miss - not just asserting the final state.

### Findings confirmed

1. **P1 - live completions can still lose their history** (`board-store.ts:892`). Confirmed: the
   round-1 fix added the `activity_events` INSERT but ran it as a second, separate `.run()` call
   after the item `UPDATE`. Reproduced: if the INSERT fails, the item is left `Done` with no event,
   and because the emission condition checks `before.status !== "Done"`, a retry of the same edit
   no longer detects the transition at all - the completion is permanently lost from weekly
   reports, not just delayed.
2. **P1 - concurrent withdrawals can persist success while returning conflict**
   (`commands.ts:438`). Confirmed: `weekWithdrawPlan`'s bookkeeping `guardSql` checked only
   `EXISTS (planning_weeks status = 'open')`, while `withdrawWeekCommitmentStmt` (the primary
   statement) additionally required `withdrawn_at IS NULL`. Reproduced with a `db.batch()` spy
   that withdraws the same commitment via a raw SQL statement immediately before the real batch
   runs: the primary UPDATE correctly affected zero rows, but before the fix the weaker
   bookkeeping guard would have still let the event/receipt land, storing a success receipt for a
   request that returned CONFLICT - a same-request-ID retry would have replayed that false
   success.
3. **P1 - concurrent commands record incorrect revisions** (`commands.ts:536`). Confirmed:
   `applyAtomicPlan` computed `boardRevision = boardRevisionBefore + 1` from an earlier read, while
   the SQL bump was a relative `revision = revision + 1` with no precondition tying it to that
   read. Reproduced with a `db.batch()` spy that bumps `board_state.revision` via raw SQL
   immediately before the real batch runs, simulating a fully unrelated concurrent command: before
   the fix, this command would have computed and reported/receipted an incorrect revision number
   despite the database having moved past it.
4. **Re-add statistics regression** (`repository.ts:275`, a consequence of round 1's own fix, not
   present before it). Confirmed and reproduced exactly as Astra described: select Monday, complete
   Tuesday, withdraw Wednesday, re-add Thursday flipped a legitimately-earned 1/1 to 0/1, because
   `upsertWeekCommitmentStmt`'s `ON CONFLICT DO UPDATE SET added_at = excluded.added_at` overwrote
   the timestamp `computeWeekStats`'s on-time check compared the completion against.

### Exact fixes made

**P1 #1** - `lib/server/board-store.ts`'s `updateItem`: the item `UPDATE` and its
`activity_events` INSERT are now built as unexecuted statements and run together via one
`(runtime().DB as unknown as Database).batch([updateStmt, activityStmt])` call when a
complete/reopen transition applies; a plain `.run()` when it doesn't (no event, nothing to batch).
The cast is needed because the real `D1Database` type requires a `.raw()` method on prepared
statements that `repository.ts`'s narrower `Database`/`PreparedStatement` interface doesn't
declare - both the real binding and the test harness already satisfy the narrower interface
structurally.

**P1 #2** - `lib/server/commands.ts`'s `weekWithdrawPlan`: `guardSql`/`guardParams` now mirror
`withdrawWeekCommitmentStmt`'s full precondition exactly - `EXISTS (planning_weeks status =
'open')` **AND** `EXISTS (week_commitments ... AND withdrawn_at IS NULL)` - not just the
week-open half of it. The `AtomicPlan.guardSql` doc comment now states this as a hard rule for any
future atomic command: the bookkeeping guard must always be the *exact same* precondition the
primary statement's own WHERE clause checks, never a subset.

**P1 #3** - `lib/server/repository.ts` gained `revisionGuard(ownerId, expectedBoardRevision)`,
an `EXISTS (SELECT 1 FROM board_state WHERE owner_id = ? AND revision = ?)` fragment. Every
atomic-plan handler (`focusSetPlan`, `weekCommitPlan`, `weekWithdrawPlan`, `weekClosePlan`) now
captures its own `expectedBoardRevision` via `getBoardState` (freshly, as close as practical to
building the plan - `weekClosePlan` re-reads it *after* its stats computation, right before
finalizing, to minimize the staleness window for that slower handler) and passes it to the
repository Stmt-builders (`upsertWeekCommitmentStmt`, `withdrawWeekCommitmentStmt`,
`finalizeClosedPlanningWeekStmt`, `setFocusItemStmt`, `removeFocusItemStmt`), each of which now
embeds `revisionGuard` into its own WHERE/SELECT clause alongside its domain precondition.
`applyAtomicPlan` folds the same `revisionGuard` into the bookkeeping guard (`plan.guardSql AND
revisionGuard(...)`), so a command's mutation and its board-revision bump now share one
precondition end to end.

A first attempt at this fix (committed only locally, never pushed) gated the revision-bump
statement on a direct re-check of `plan.guardSql`'s domain condition and failed its own new
positive-path test: on a genuine *success*, `primaryStatement` (running immediately before the
revision bump) had already mutated the very row that domain condition reads, so the revision
bump's copy of that check read back false right after success - silently skipping the bump while
`applyAtomicPlan` still returned `success` to the caller. Fixed by gating the revision-bump
statement on `EXISTS (SELECT 1 FROM command_receipts WHERE owner_id = ? AND request_id = ?)`
instead: the receipt-insert statement (which runs first, before anything in the batch mutates
anything) already evaluates the identical combined guard against a genuinely untouched pre-image,
and nothing later in the batch mutates `command_receipts` - so its presence is a hazard-free proxy
for "the guard held," safe for a later statement to depend on without re-reading a row something
else in the same batch may have just changed. `applyAtomicPlan` now determines overall
success/failure from two independent signals: the receipt statement's own change count (`guardHeld`
- a "no" is always `CONFLICT`, regardless of `onZeroChanges`) and the primary statement's change
count (given the guard held, `onZeroChanges` governs whether zero rows is a legitimate no-op).

**Re-add regression** - `lib/domain/progress.ts`'s `computeWeekStats` no longer compares a
completion against a single `addedAt` snapshot at all (the field was removed from
`CommitmentInput` as dead). It now accepts `commitmentEvents: CommitmentEventInput[]` (the item's
full `week.commit`/`week.withdraw` history) and replays it merged chronologically with the
complete/reopen history, tracking an `isActive` flag (true after a `week.commit`, false after a
`week.withdraw`); a completion only sets the tracked `completedAt` while `isActive`, and
`items.reopen` always clears it unconditionally (withdrawing does not - withdrawing isn't
reopening). An item with zero commit/withdraw history at all (data predating this event's
introduction) is treated as active throughout, matching the pre-remediation behavior for such
rows. `week_commitments.added_at` still refreshes on re-add (`upsertWeekCommitmentStmt` unchanged
in this respect) purely for display purposes - nothing in the statistics computation reads it
anymore. `lib/server/commands.ts`'s `weekClosePlan` now fetches both `items.complete`/`items.reopen`
and `week.commit`/`week.withdraw` events in one `listActivityEventsForItems` call (entity_id is the
item ID for both categories) and splits them before calling `computeWeekStats`.

### Files / symbols changed (round 2, in addition to round 1's table above)

| File | Symbols |
| --- | --- |
| `lib/domain/progress.ts` | `CommitmentInput.addedAt` removed (dead); new `CommitmentEventInput` type; `computeWeekStats` gained `commitmentEvents` param and an internal `completionAsOf` replay helper |
| `lib/server/commands.ts` | `AtomicPlan` gained `expectedBoardRevision` (removed the externally-threaded `boardRevisionBefore` param from `applyAtomicPlan`); `weekWithdrawPlan`'s `guardSql` fixed; `weekClosePlan` fetches/splits commit-vs-status events; `applyAtomicPlan` rewritten around the receipt-as-guard-proxy design |
| `lib/server/repository.ts` | New: `revisionGuard`, `appendActivityEventStmt` (`appendActivityEvent` is now a thin wrapper over it), `ActivityEventInput` type. Changed: `setFocusItemStmt`, `removeFocusItemStmt`, `upsertWeekCommitmentStmt`, `withdrawWeekCommitmentStmt`, `finalizeClosedPlanningWeekStmt` all gained an `expectedBoardRevision` param and embed `revisionGuard` |
| `lib/server/board-store.ts` | `updateItem`'s item-UPDATE and activity-event-INSERT now batched atomically |
| `tests/progress.test.mjs` | Fixtures drop `addedAt`, gain `commitmentEvents`; +1 exact re-add repro, +1 while-withdrawn negative case |
| `tests/focus-week-commands.test.mjs` | +2 direct concurrency-race reproductions (P1#2, P1#3) via `db.batch()` interception, +1 positive-path revision-persistence test |

### Migrations affected

**None**, same as round 1 - this remains a code-only remediation.

### Focused verification (round 2)

```
node --test tests/progress.test.mjs
  -> 14/14 pass (was 12; +1 re-add repro, +1 while-withdrawn negative case)

node --test tests/focus-week-commands.test.mjs
  -> 15/15 pass (was 12 after round 1; +2 concurrency-race reproductions, +1 revision-persistence
  positive-path test)
```

### Full-suite / typecheck / lint (round 2)

```
npm run typecheck   -> clean, no output
npm run lint         -> same pre-existing app/board-app.tsx issues as round 1, unchanged
npm test             -> 82 tests, 80 pass, 2 fail - the same pre-existing, unrelated dev-server
                        port collision (tests/rendered-html.test.mjs, tests/ui-components.test.mjs)
                        confirmed against the unmodified baseline in round 1
```

### Remaining risks (unchanged from round 1, still applicable)

Everything in round 1's "Remaining risks" and "Intentionally deferred" sections above still
applies unchanged: `items.*`/`lists.*` non-atomicity remains deliberately out of scope
(unreached by any real owner); legacy hard-delete-vs-Focus/commitment dangling references remain
a Phase 1/4 cutover concern; `week.close`'s mutual exclusion has no lock timeout/expiry.

## Round 3: Astra's third review (`7060176^..fc8a2a3`), one new regression confirmed and fixed

Astra's third review scoped specifically to round 2's changes (per the refresh note - "keep this
to the previous findings and any material regression introduced by their fixes") confirmed the
three P1 fixes and the original re-add example, and found one new regression introduced by round
2's own fix, not present before it.

### Finding confirmed

**P1 - commitment history mixed across weeks** (`commands.ts:529`). Confirmed: round 2's
`listActivityEventsForItems(db, ownerId, itemIds, [...])` call in `weekClosePlan` filters by item
ID and event type only - it has no way to restrict results to one specific planning week. Since
`week_commitments`' primary key is `(owner_id, week_id, item_id)`, the same item can be (and
routinely will be) committed to multiple different weeks independently, and every one of those
commit/withdraw events shares the same `entity_id` (the item ID) in `activity_events`. Compounding
this, `weekWithdrawPlan`'s activity event never recorded which week it belonged to at all -
`weekCommitPlan`'s did (`after: { weekId }`), but `weekWithdrawPlan`'s only had `after: { reason }`.

Reproduced exactly as Astra described: commit an item to this week AND next week, withdraw it from
next week only, complete it within this week's window, close this week - the frozen report showed
0/1 instead of 1/1. Mechanism: `computeWeekStats`'s `isActive` replay (added in round 2) merged
*all* of the item's commit/withdraw events regardless of which week they belonged to into one
timeline, so the untagged withdrawal (intended for next week) flipped `isActive` to false for this
week's evaluation too, even though this week's own commitment was never withdrawn. Verified the
fix actually closes the gap - not just that the new test happens to pass - by reverting the fix
(`git stash push -- lib/server/commands.ts`) and rerunning the new regression test, which failed
exactly as expected (`0 !== 1`) before the fix was restored.

### Exact fix made

No schema change was needed - the week identity was already available, just not recorded/used
correctly:

- `lib/server/commands.ts`'s `weekWithdrawPlan`: its activity event's `after` payload now includes
  `weekId`, matching what `weekCommitPlan`'s already did.
- `lib/server/repository.ts`: `ActivityEventRow` and `listActivityEventsForItems` now also return
  `after_json`, so callers can recover which week a commit/withdraw event belongs to.
- `lib/server/commands.ts`'s `weekClosePlan`: the `commitmentEvents` filter now also parses each
  event's `after_json` and keeps only those whose `weekId` matches the week actually being closed,
  before handing them to `computeWeekStats`. `statusEvents` (items.complete/items.reopen) are
  unaffected - those aren't per-week, they belong to the item regardless of which week it's
  committed to.

### Files / symbols changed (round 3)

| File | Symbols |
| --- | --- |
| `lib/server/commands.ts` | `weekWithdrawPlan`'s activity `after` payload gained `weekId`; `weekClosePlan`'s `commitmentEvents` filter now parses `after_json` and scopes by `weekId` |
| `lib/server/repository.ts` | `ActivityEventRow` gained `after_json`; `listActivityEventsForItems`'s SELECT now returns it |
| `tests/focus-week-commands.test.mjs` | +1 test: Astra's exact two-week reproduction (commit to week 1 and week 2, withdraw from week 2 only, complete within week 1, close week 1 expects 1/1) |

### Migrations affected

**None** - same as rounds 1 and 2. The week identity was already stored in the existing
`activity_events.after_json` column; this only changes how it's queried and filtered.

### Focused verification (round 3)

```
node --test tests/focus-week-commands.test.mjs
  -> 16/16 pass (was 15; +1 two-week scoping regression)

Regression-test validity check: reverted lib/server/commands.ts only (git stash), reran the new
test - failed with "0 !== 1" exactly as expected, confirming the test genuinely exercises the bug
before the fix, not just after it.
```

### Full-suite / typecheck / lint (round 3)

```
npm run typecheck   -> clean, no output
npm run lint         -> same pre-existing app/board-app.tsx issues as prior rounds, unchanged
npm test             -> 83 tests, 81 pass, 2 fail - the same pre-existing, unrelated dev-server
                        port collision as every prior round
```

### Remaining risks (unchanged from round 1/2, still applicable)

Everything in round 1's "Remaining risks" and "Intentionally deferred" sections still applies
unchanged. No new risk was introduced by this round's fix beyond what's already documented.

## Exact next unblocked action

Push `e578dd5` to `origin/claude-dev`, then send `e578dd5d0346dcc81e33d056b065b2138d43aeec` (or
the range `7060176^..e578dd5` to cover all three remediation rounds) to Astra for re-review.
**Phase 3 slice 2 (Focus/weekly-progress UI, roadmap section 8) has not been started** - no
slice-2 files exist, no `app/board-app.tsx` wiring has begun - pending that re-review's outcome.
