# Phase 3 completion batch for Claude Sonnet

Status: architecture/planning handoff; implementation remains Claude's responsibility.
Review baseline: committed batch `9cce82f..f13b56e`, plus the uncommitted Phase 3 period
extension observed during review. Working-tree observations describe unfinished work, not a
claim that those changes shipped. Reconcile any later edits before applying these instructions.

## Working arrangement

Adam has replaced per-slice Astra approval with substantial implementation batches. Claude
should work through this Phase 3 completion package, resolve routine engineering choices,
commit coherent changes, and return one evidence-backed completion handoff. Astra supplies
architecture direction, priorities, and batch review, delegating detailed evidence gathering.
An individual commit is a checkpoint, not an automatic request for another Astra review.
Escalate material product/architecture decisions or the roadmap's explicit operational gates;
continue independent authorized work while a dependent decision is pending.

## Scope and direction

The roadmap's section 6 statistics contract and section 8 Phase 3 acceptance criteria remain
the baseline. Adam additionally approved Today/Week/Month/Year planning horizons and the
recent frontend simplification. Record these approved extensions in public product terms in
the roadmap; keep private source notes private.

- Focus means explicitly selected main priorities. Time horizons mean selected work for a
  calendar period. Neither implies an AI access grant, recent interaction, a hard due date,
  an item type change, or exclusive List membership.
- An item can belong to several horizons independently. Adding or withdrawing from one must
  not alter another horizon's membership or completion credit.
- Keep the new in-app controls and simpler row interactions. Removing legacy Active/Archive
  buttons is consistent with Adam's direction; it does not authorize deleting stored history,
  migrating storage authority, or removing recoverability.
- Finish Phase 3 before expanding to connector, proposal, briefing, recurrence, or embedded
  chat implementation. Those later capabilities reuse this trustworthy data foundation.

## What the batch gets right

- Round 3 records week identity on withdrawals and filters membership history by the week
  being evaluated. The handoff records a regression test for the previously failing two-week
  example, including evidence that it failed before the fix.
- Focus and weekly progress now have actual UI and route/query integration. The Home-row
  controls make planning available where the owner already works.
- Row-control deduplication, the corrected attention tooltip, and the persistent Focus
  indicator follow the owner's usability direction rather than creating a separate task app.
- The period extension uses explicit commitments instead of requiring manually named Lists
  or interpreting due dates as selection. Its migration is additive.

## Where the work needs correction

The main divergence is between implementation progress and its tests/documentation, rather
than the owner's product direction. The extra horizons are authorized; leaving the old
statistics regressions broken or declaring completion without the new equivalents is not.
Keep frontend polish bounded until the extended planning flow meets acceptance.

Two committed completion gaps need implementation, not another review loop:

- **Owner timezone:** `lib/server/queries.ts` hardcodes `DEFAULT_PLANNING_TIMEZONE` to
  America/Chicago and explicitly defers the preference. The roadmap's section 6 requires the
  known preference or a setup choice. Ship a small persisted owner setting with Chicago as
  the suggested initial value, use it for new periods, and retain the recorded timezone of
  existing periods. Make timezone changes' effect clear; never reinterpret frozen reports.
- **Selected-week/history access:** `app/api/board/route.ts` returns only the current week.
  A prior week's frozen report survives in storage but drops out of the browser after rollover.
  Add a bounded owner-scoped week selector/read path so the owner can inspect and close prior
  weeks and read their frozen reports. This makes the roadmap's selected-week progress usable
  beyond the current Monday-to-Sunday window; it need not expand into a general analytics UI.

Also close the smaller presentation gap: the weekly card shows added/withdrawn counts but
does not capture a reason or distinguish deferral. Provide an optional reason and explicit
deferral representation without reducing the denominator or automatically rescheduling work.
Keep this interaction small. Sample mode currently labels planning unavailable rather than
simulating it; implement deterministic sample interactions or explicitly record the limitation
in the completion handoff rather than claiming parity.

During this review the delegated worker ran two focused commands against the current tree:

| Check | Observed result | Meaning |
| --- | --- | --- |
| `node --test tests/focus-week-commands.test.mjs` | 16/16 passed | Existing Focus/week command regressions remain green, including cross-week scoping. |
| `node --test tests/progress.test.mjs` | 4 passed, 10 failed | The WIP renamed `computeWeekStats` to `computePeriodStats`, while the test imports the former. Failures were `TypeError: computeWeekStats is not a function`. |

These are observations of a changing working tree, not results for a frozen release commit.
Claude may already have addressed them; check once and preserve any subsequent fixes. No
full suite was rerun for this planning assessment. The review also found no focused tests
for `period.commit`/`period.withdraw` or the new period boundaries at that checkpoint.

By the final status check, `tests/progress.test.mjs` was modified and a new untracked
`tests/period-commands.test.mjs` existed. Those concurrent additions were not rerun or reviewed
here. Validate the latest versions before treating either earlier test observation as current.

## Ordered implementation package

1. **Complete the shared progress refactor.** Update consumers and tests to the intended
   `computePeriodStats` interface (or retain a justified compatibility wrapper). Preserve
   every existing weekly regression; add day/month/year boundary cases. Completion criterion:
   the original progress scenarios and new calendar cases pass with the actual public interface.
2. **Finish the period command/query lifecycle.** Exercise the real dispatcher and transactional
   SQL adapter, including receipts/replay, conflicting revisions, withdrawals, re-adds, and
   failures. Check the same item selected for overlapping day/week/month/year windows: each
   report consumes only its own membership events. Completion criterion: no partial receipt,
   revision, or event writes; no cross-period credit changes. Include migration 0010 upgrade
   assertions for the new schema on disposable storage. The existing harness is real SQLite,
   not full Workers/D1 emulation; describe that verification limit accurately.
3. **Finish and verify the whole user flow.** Cover capture/edit/complete/reopen, Focus toggles,
   horizon selection/withdrawal, progress display, and week closure from the actual components.
   Include the persisted timezone setting and bounded selected-week/history access above.
   Verify failed operations leave truthful controls and a recoverable error state. Check sample
   mode, keyboard/touch access, explicit timezone behavior, and period rollover. Selection must
   preserve List, type, dates, and the independent Focus state. Completion criterion: the
   owner can plan and complete work from Home and the planning views without legacy row controls.
4. **Reconcile the contract and finish the handoff.** Record the approved horizon extension,
   chosen current-versus-historical behavior, and accurate implementation status. Check the
   required added/withdrawn/deferred presentation and non-task counts, rather than treating
   a visible progress bar as all of Phase 3. Normalize accidental whitespace only in touched
   files. Run the batch-boundary checks below and commit a coherent, reviewable result.

Claude can complete these steps without returning to Astra between them. If a genuine product
decision blocks one behavior, state the choice narrowly and keep finishing the other steps.

## Architecture constraints for the completion work

Keeping the already-reviewed weekly storage alongside generic day/month/year storage is an
acceptable transitional choice. Avoid a schema-unification detour solely for symmetry.
Share period-boundary computation, progress rules, validation, and transactional command
behavior where their semantics are identical. Preserve independent membership history keyed
by owner, period identity, and item. Protect the previously fixed revision/receipt/event
atomicity when extending commands.

Calendar windows use an explicit owner timezone and calendar arithmetic. Monday weeks,
month/year changes, leap years, and DST must not be approximated as fixed hour counts.
Selections retain the denominator after withdrawal; complete/reopen and re-add history must
remain attributable to the correct period. Closed weekly reports retain their snapshots.
The approved extra horizons do not by themselves require a new historical-report product:
if they expose only current live views, document that limit clearly. If historical periods
are presented as final reports, define and implement freezing/correction semantics first.

## Documentation and handoff

The slice-1 handoff's final instruction still says Slice 2 has not started, despite the
committed UI. Replace that obsolete next-action statement with a pointer to the current
completion handoff, retaining the historical review evidence. Update the roadmap's progress,
`CONTEXT.md`, and `docs/ARCHITECTURE.md` to distinguish implemented behavior, unfinished work,
and approved extensions. The public explanation must stand alone without private note files.

The final handoff must name the implemented range, migrations and where they were actually
applied, verification results, manual checks, outstanding limitations, rollback implications,
and the next unblocked phase. Report failures with current evidence; earlier baseline results
do not automatically establish the cause of failures in newly changed files.

## Completion evidence

Use synthetic fixtures and disposable storage. Run focused domain, SQL/command, and UI-flow
checks as the work is completed; run typecheck, lint, and the existing full test command at
the batch boundary. An already successful full test command includes the build; repeat it
only when subsequent changes or failures justify doing so.

Required scenarios: 12/20 with unrelated groceries unchanged; denominator retained after
withdrawal; add/withdraw/re-add without erased completion; complete/reopen and late completion;
two weeks and overlapping day/week/month/year selections; empty and non-task-only selections;
explicit timezone and calendar boundaries; frozen weekly history; failure/retry and competing
commands with accurate revisions and receipts; real control interactions and sample-mode
behavior. Rehearse migration 0010 on a disposable upgrade before any real-data application.
Deployment and real-data migrations remain subject to the existing authorization/recovery
requirements; this planning review performs neither.

This is permission to continue routine work within the owner's Phase 3 implementation
direction, not a declaration that Phase 3 has passed acceptance. Return for batch review when
the acceptance evidence is complete or a material decision genuinely blocks progress.
