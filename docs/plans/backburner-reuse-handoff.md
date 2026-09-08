# Backburner reference reuse handoff for Claude

Status: planning supplement, 2026-09-07. Claude implements; Astra supplies direction.

## Decision and current work

Use the sibling reference repositories selectively. Small independent utilities, test cases,
and interaction patterns can save work; importing another app's storage, AI runtime, or state
management would conflict with the existing design. No external source code is imported by
this handoff, and candidate selection below is not a verified integration or license clearance.

Finish the [Phase 3 completion batch](phase-3-completion-batch.md) using its current acceptance
criteria. The slice-1 handoff contains historical review evidence and an obsolete next-action
statement; it is not the sole current scope. This document adds no Phase 3 implementation work.
Use the active worktree's latest roadmap and implementation evidence when resolving status.

The main and `phase3-completion` worktree roadmaps differed at inspection: the worktree records
the approved extra planning horizons and newer implementation claims. Neither was overwritten
or reconciled during this reference assessment; those claims were not independently retested.

## Read only what the phase needs

Start with the [legacy feature reconciliation](../legacy/backburner/README.md). The archived
source documents are historical context, not accepted specifications. In particular, preserve
D1 authority, provider-neutral selected AI scopes, reviewed proposals, independent Focus and
planning membership, historical progress, and the existing command/revision/receipt boundary.

| Phase | Reference task for Claude | Completion criterion |
| --- | --- | --- |
| 3 | Continue the current completion package. Consult examples only for a concrete unresolved UI detail. | Existing phase acceptance and batch evidence; no replacement statistics algorithm. |
| 4 | Inspect the MCP and proposal-related candidates below at the minimal connection-proof gate. | A short adopt/adapt/reject note naming the exact useful part; synthetic authenticated cross-client proof under the roadmap. Local stdio or broadly privileged tools do not satisfy remote OAuth/scope requirements. |
| 5 | Inspect decomposition examples and the archived goal specification before implementing plan proposals. | Reviewable children with durable context, no invented dates, atomic apply and duplicate protection; preserve original goal and completed steps. |
| 6 | Inspect recurrence calculations and their edge-case tests. | The roadmap's fixed-calendar, month-clamp, separate-occurrence and timezone semantics pass through Burner Board's own domain/command tests. |
| 7 | Inspect reminder/check-in examples for lifecycle and wording. | Deterministic in-app briefings first, selected grants and opt-in cadence; no automatic alarms or metered AI dependency. |
| Later | Revisit bulk-text capture, feedback, external adapters, voice/hotkey capture and richer nudges. | A scoped proposal and explicit disposition before these become implementation commitments. |

## Concrete local code candidates

Paths below are relative to `Backburner/existing-projects/`. These findings come from source
and test inspection, not execution of upstream suites. License labels are local file evidence,
not advice about compatibility. Super Productivity is the strongest direct adaptation candidate.

| Candidate | Exact entry points | Useful part and boundary |
| --- | --- | --- |
| **Phase 6: Super Productivity recurrence** | `super-productivity/src/app/features/task-repeat-cfg/store/get-next-repeat-occurrence.util.ts` (`getNextRepeatOccurrence`), adjacent `get-next-repeat-occurrence.util.spec.ts`, `get-nth-weekday-of-month.util.ts`, `get-repeatable-task-id.util.ts` | MIT root `LICENSE`. Consider adapting a small pure calculation/ID utility and relevant tests with attribution. Inspect model/date-helper dependencies first. Tests cover month ends, leap days, DST, boundaries and multiweekday schedules. Its full recurrence semantics are broader than ours; verify the mandated month-clamp and separate-occurrence behavior rather than inheriting defaults. Leave Angular/NgRx UI/effects behind. |
| **Phase 4: AllisWell MCP security scenarios** | `alliswell/apps/api/src/lib/mcp/jsonrpc.js` (`isValidRequest`, `toolResult`), `tools.js` (`MCP_TOOLS`, `requireScope`), `actions.js` (`findMcpReplay`, `recordMcpAction`); `apps/api/test/unit/mcp-protocol.test.js`, `mcp-oauth.test.js`, `mcp-tools.test.js` | Pattern reference only under this package: root `LICENSE` is PolyForm Noncommercial 1.0.0. Useful scenarios include bearer auth, Origin checks, PKCE, refresh/replay revocation, owner isolation, pagination and idempotency. Fastify/Knex/MySQL code does not plug into Workers/D1. Use a supported OAuth implementation per the roadmap, with our own scope/proposal enforcement. |
| **Phase 6: AllisWell bounded materialization** | `alliswell/apps/api/src/lib/recurrence.js` (`validateRule`, `daysInMonthFor`, `expandOccurrences`, `countOccurrences`, `MAX_OCCURRENCES`), `apps/api/test/unit/recurrence.test.js`, `docs/adr/0020-recurring-tasks-and-materialization.md` | Pattern only; same restricted license. Useful clamp, deduplication, anchor and bound scenarios. Its 400-occurrence cap is evidence of bounding, not our chosen limit. |
| **Phase 5: ADHD Planner AI task breakdown** | `adhd-planner-ai/src/prompts.ts` (`TaskAnalysis`, `TaskChunk`, `ADHDPrompts.analyzeTask`, `chunkTask`, `suggestByEnergy`); `src/tasks.ts` (`TaskManager.createSubtasks`) | MIT root `LICENSE`; use interaction ideas such as a small first action and concrete steps. Direct Anthropic calls, regex/raw JSON parsing, fabricated fallback steps/estimates and simplistic SQLite parenting are unsuitable for our reviewed, validated, client-neutral proposals. Re-author wording and validation for our context; do not import the backend. |
| **Focus / next-action UX: Ilseon** | `ilseon/app/src/main/java/com/ilseon/ui/screen/NextTaskActivationScreen.kt` (`NextTaskActivationScreen`), adjacent `DashboardScreen.kt`; locate `TaskViewModel.kt` and `prepareForNextTaskTransition` / `startNextTask` | MIT root `LICENSE`; Kotlin/Compose/Room means interaction reference only. Current/next action can inform later goal-child UX. Its momentum/streak scoring is not our commitment denominator. No Phase 3 redesign is requested. |
| **Phase 7 and later delivery: todo** | `todo/notify/notifier.go` (`Notifier`), `retry.go` (`doWithRetry`), `postback.go` (`PostbackNotifier`, `Send`); `todo/cmd/daemon.go` (`buildNotifiers`, `checkAndNotify`) | MIT root `LICENSE`; Go daemon means design reference only. A small channel interface and retry boundary are useful after in-app briefings. Daemon polling and external channels are not Phase 3 prerequisites. |

### Inventory and snapshot anchors

Revisions identify the inspected local checkout HEAD, not a guarantee of a clean working tree
or current upstream status. Verify candidate-file diffs at adoption time.

| Repository | Local HEAD | Local license evidence / disposition |
| --- | --- | --- |
| `super-productivity` | `2316047be6a29ca2ee9169da849ddb6c0e2a0ae3` | MIT; strongest small TypeScript utility candidate. |
| `alliswell` | `dedbf979df3043d9747824c58572108b845a8640` | PolyForm Noncommercial 1.0.0; patterns only. |
| `adhd-planner-ai` | `fe05191afff635366a9a48b77f10accfc3ab0490` | MIT; Node/TypeScript, Telegram/Claude prompt and check-in ideas. |
| `ilseon` | `37bf1f57abf9346b141f95bfd27926e31dea9e50` | MIT; Android Focus UX. |
| `todo` | `0147747fb9317f2b99bd3a787a8e1d4ba78af5da` | MIT; Go notification seam. |
| `FreeTodo` | `800cd27344fe1eb99f429d0aec22e99ed189d921` | Custom FreeU Community License; no copying under this package. Python/FastAPI and React/desktop app. `lifetrace/config/prompts/plan.yaml` is a later decomposition reference if needed. |
| `SP-MCP` | `a99e549f515e65b999289ac2c51dc37012caea36` | MIT. `mcp_server.py` (`SuperProductivityMCPServer`) and `plugin.js` (`MCPBridgePlugin.executeCommand`, `executeBatchOperation`) show tools, but local file polling and broad write/delete powers do not satisfy remote OAuth and selected scopes. Do not reuse transport. |
| `open-tasks` | `1a1827532efc70fb5be4c338296dda5ae8ecc17e` | No root license found; no copying. Python Gemini/APScheduler autonomous reminders also conflict with manual-first, bounded access. |
| `vikunja` | `a4218eeb8fb3ada95e14a2331731524c9120d5bd` | AGPL-3.0; Go/Vue full app. Concept/API reference only under this package; code adoption would require a deliberate licensing decision. |
| `vikunja-reminders` | `ef217255bb26cc7ea9591474a1521e359903b86b` | No root license found; no copying. PowerShell `ReminderEngine.psm1`, `rules.schema.json`, `ReminderEngine.Tests.ps1` are optional later rule/lifecycle references. External channels remain deferred. |

## How to adopt a candidate

At the relevant phase, inspect only the named files and immediate dependencies. Record the
local repository revision, dirty-source status, exact upstream path, license/notice files,
intended destination, required dependencies, and behavior differences. Choose one of:
reuse an existing dependency, adapt a small permitted source unit with required notices,
or implement the behavior independently from its documented concept.

Prefer the smallest unit whose semantics match. Keep copied code attribution with the code
and in a source-provenance note. Verify the actual file's terms and transitive assets before
copying; a repository-level license label alone does not settle every file. Restricted or
unclear licensing means no code transplant under this package. Recheck current official
protocol/library documentation when implementing; this assessment uses local snapshots only.

Use synthetic tests for the behavior we need, including differences from upstream. A candidate
is accepted only when it fits the existing stack and reduces total implementation/maintenance
work. If it needs a parallel service or broad framework port, record why and proceed with a
small native implementation. Return one reuse decision summary in the phase completion handoff;
individual reuse choices do not require a new Astra review unless they change architecture,
product policy, licensing strategy, or an existing operational gate.

## Access from Claude's current worktree

This package is saved in the main checkout's `docs/`, not injected into your active files.
From `notion-todo-dashboard/.claude/worktrees/phase3-completion/`, the main docs directory is
`../../../docs/`; the local reference repositories are at
`../../../../Backburner/existing-projects/`. From the main checkout, references are at
`../Backburner/existing-projects/`. They are local evidence, not runtime dependencies.

Read `../../../docs/plans/backburner-reuse-handoff.md` now for orientation, then consult the
candidate for the phase being implemented. When moving this package through Git, bring only
these docs and preserve concurrent roadmap edits; do not copy the sibling repositories into
the application. Archive provenance lives in `docs/legacy/backburner/manifest.json`.
