# Burner Board development roadmap

Status: approved architecture direction; implementation handoff. Written 2026-09-07.

This document records the planning session so implementation can continue without its chat history. The owner approved writing this plan, not running migrations, deleting personal data, deploying, or implementing in this planning session. Claude Code is the intended implementing agent. Astra reviews completed phases against this document.

## 1. Read this first

Burner Board is a personal workspace for tasks, goals, plans, proposals, reminders, context, and progress. Its immediate problem is that imported material is hard to organize and use. The first deliverable must make the existing board useful, rather than build a large autonomous-agent framework.

The approved sequence is:

1. Reliable data and a usable cleanup workflow.
2. AI-assisted organization of explicitly selected material.
3. Turning selected goals into actionable plans.
4. Progress summaries and recurring accountability experiments.
5. Eventually, AI chat inside Burner Board and richer automation/messaging.

Keep the existing app and evolve it incrementally. Do not replace the framework, build a second task application, or port the sibling Backburner project wholesale.

All paths below are relative to `notion-todo-dashboard/` unless stated otherwise. Existing paths are evidence; paths marked **new** are intended additions. Migration filenames must use the next actual Drizzle sequence, not a hardcoded number from this document.

## 2. Approved product decisions

| Decision | Meaning and rationale |
| --- | --- |
| Personal use first | Optimize for the owner's daily workflow. Retain ownership isolation and authentication, but defer multi-user onboarding, organizations, billing, and sharing infrastructure. |
| D1 is the target source of truth | Data stays hosted on Cloudflare, not on the owner's PC. The app already has D1-only Lists, Groups, and preferences. A single authority avoids ongoing two-way consistency complexity. |
| Notion is transitional | Preserve existing data and integration during migration. Verify replacement access before retiring live synchronization. Do not build a comprehensive new two-way sync system. Notion may remain an optional import/export destination later. |
| Mixed Lists | Tasks, Goals, Purchases, Events, and other retained types can coexist. Dedicated views are additional ways to find items, not exclusive destinations. Visibility and columns are customizable per List. |
| Simple checkable work | An actionable item has an ordinary complete/reopen interaction. Groceries and bill occurrences do not require separate task applications. |
| Preserve history | Completed work leaves the everyday active view but remains recoverable/searchable. Cleanup does not authorize automatic deletion. |
| User selects AI scope | The owner chooses items or batches to organize and later chooses current priorities. AI must not continually process the entire database. |
| AI proposes organizational changes | AI can inspect selected context, ask questions, prepare plans, and save proposals. Substantive changes are reviewable before application. Explicit user commands such as completing a named task can later use narrowly scoped tools. |
| Interchangeable subscriptions | Claude and ChatGPT must work against the same stored data, context, proposals, and progress. Switching clients must not require migrating plans or starting the explanation from scratch. |
| Setup guide inside the app | A persistent Guide/AI Setup page explains connecting either client, gives reusable workflow instructions, verifies the connection, and supports troubleshooting and revocation. Developer documentation alone is insufficient. |
| Companion AI chat initially | Conversations initially occur in connected Claude/ChatGPT. Burner Board stores the durable result and context. This compromise was explicitly approved. |
| Embedded chat eventually | In-app AI chat is an explicit future requirement, not a rejected idea. Its runtime/auth/billing feasibility is a later decision gate. Do not promise that an ordinary chat subscription automatically powers an embedded website chat. |
| No metered AI billing by default | Use existing subscriptions and their supported workflows. Do not enable API billing, paid overages, or an API-key backend without a new decision. Hosting costs are separate from AI billing. |
| In-app progress first | Start with selected weekly work and clear completion counts. External notifications and conversational coaching come after organization works. |

Implementation defaults chosen for this handoff, rather than direct user prescriptions: additive schema migrations; stable item/List IDs; one primary List per item initially; versioned commands; reviewable bounded proposals; completion history retained; new Lists default to plain containers. These are reversible engineering choices. Any change that contradicts the approved product behavior needs discussion.

## 3. Current-state architecture and evidence

### Runtime and execution paths

- `worker/index.ts` forwards requests to vinext and handles the image-optimizer route.
- `vite.config.ts` configures vinext/Vite and local Cloudflare bindings. `.openai/hosting.json` participates in hosting configuration. `wrangler.deploy.jsonc` is the separately named production configuration; do not rename it to an automatically discovered config and accidentally bind local development to production.
- The runtime is vinext on Vite, React, TypeScript, and Cloudflare Workers, despite Next-style App Router filenames. Do not assume conventional Next.js deployment behavior.
- `app/page.tsx` renders `BoardApp`; `app/layout.tsx` supplies the shell.
- `app/board-app.tsx`: `BoardApp` owns most client state; `boardRequest()` calls `/api/board`; `TaskRow`, `TaskTable`, `CollectionsView`, `EditorSheet`, `QuickEditor`, `ConnectionsSheet`, and `UpcomingWidget` contain most UI behavior.
- `app/api/board/route.ts`: `GET` returns the board; `POST` dispatches string actions. Types are cast, not a comprehensive runtime validation contract.
- `lib/server/board-store.ts` owns SQL, CRUD, group operations, Notion access, settings, and lazy backfills. Important symbols: `requireOwnerId`, `getBoard`, `createItem`, `updateItem`, `updateBoardItem`, `deleteItem`, `createList`, `updateList`, `deleteList`, `mergeItems`, `unlinkFromGroup`, `disbandGroup`, `syncNotion`, and `patchNotionItem`.
- `getBoard()` reads D1 and runs initialization/backfill helpers. Reads are therefore not currently side-effect-free. `ensureHomeLists()` can recreate Lists from item collection names.
- `db/schema.ts` defines `items`, `lists`, `integrations`, and `appMeta`; `db/index.ts` obtains the binding. SQL migrations currently run through `drizzle/0007_cheerful_jocasta.sql`.
- `lib/list-behavior.ts` owns `belongsToList`, `listMoveChanges`, `compareListItems`, and `reorderedListIds`.
- `lib/organizing.ts` supplies deterministic suggestions and `needsOrganization`. `app/organize-mode.tsx` implements an ephemeral triage session with accept/skip/undo.
- `lib/sample-board.ts` supplies non-persisted demo data.

### Data and sync behavior that must influence migration

- All current tables are owner-scoped. `requireOwnerId()` trusts hosting-provided OAI identity headers or a Cloudflare Access email header. Application source alone does not prove the deployment prevents forged headers. `app/chatgpt-auth.ts` is not the board's authorization gate. `proxy.ts` supplies a development identity.
- Lists have stable IDs, but `items.collection` stores the List's **name**, not its ID. List rename/deletion therefore edits item data. Name uniqueness is primarily application-enforced.
- Groups use `items.group_id`, with a self-referencing anchor; they are not goals/subtasks. Group moves can fan changes out to members. Group collapse happens after view filtering, so partial groups can appear in different Lists.
- Connected `createItem()` creates a Notion page before inserting D1. A Notion failure can block capture. Disconnected creation uses a local ID; the current pull sync does not later upload those local items.
- `updateItem()` saves locally, then attempts a Notion patch. Failed patches leave `dirty=1`; no bulk retry queue exists.
- `deleteItem()` attempts remote archival, swallows failure, and deletes the local row. If the remote page remains queryable, a later pull can reintroduce it.
- List entities, Group relationships, and display preferences are not fully represented in Notion.
- Attention/staleness fields are imported from Notion; local UI computes an additional due-date floor and combines it with importance. Editing a timestamp is not evidence of task progress.
- Preferences are split between List columns and `app_meta` JSON. `json_patch` null removes a key; it does not store an explicit JSON null.

### Features already present

Home, Organize, Calendar, Goals, Reminders, Finished; quick capture and extensive editing; List creation/reorder/visibility; grouping; date controls; Notion connection/sync; CSV export; sample mode; priority coloring; browser-local Upcoming-widget preferences.

### Documentation inventory and contradictions

Read `AGENTS.md`/`CLAUDE.md`, `CONTEXT.md`, and `docs/ARCHITECTURE.md` first, but distinguish current evidence from historical or proposed design.

| Document | Role / correction |
| --- | --- |
| `README.md` | Product introduction plus starter-template operations material. |
| `CONTEXT.md` | Domain glossary. Inbox definition differs from current `needsOrganization()`. This roadmap replaces that ambiguity with explicit review state. |
| `docs/ARCHITECTURE.md` | Implementation handoff, partly stale. Says tag editing was removed, but Organize still edits tags and carries suggestions. |
| `docs/PRODUCT_SPEC.md` | Product expectations. Some navigation, tag, group, and sync-retry claims are stale. |
| `docs/adr/0001-lists-become-real-entities.md` | Accepted first-class Lists; this roadmap continues that work using stable membership IDs and removes implicit type-changing moves. |
| `docs/adr/0002-groups-and-tags-are-separate.md` | Group/Tag history; older claims about Lists not collapsing groups are superseded by code. |
| `docs/adr/0003-deferred-questions-for-astra.md` | Deferred questions; topic 10 contains the fuller AI vision. Decisions in this roadmap supersede the corresponding open direction, not all unresolved details. |
| `docs/ORGANIZING_PREVIEW.md` | Historical preview, including obsolete Todoist references. |
| `docs/2026-09-03-grilling-session-status.md` | Historical decisions and checkpoint, not current completion proof. |
| `docs/HABIT_TRACKER_PLAN.md` | Separate unimplemented proposal; not an instruction to build habits now. |
| `docs/adr/local/` | Private original wording. Owner permitted reading during this session. Do not copy raw private notes into public documentation. This plan stands alone without them. |
| Sibling `../Backburner/docs/` and `../Backburner/specs/` | Prior art for capture, attention, decomposition, suggestions, and nudges. Its API-based AI/runtime choices are not adopted. |

Code-proven contradictions to address: Events are excluded by `belongsToList` yet Organize can assign them; drag-to-List can change type while other move paths differ; tags remain editable in Organize; Groups are collapsed after membership filters; optimistic saves can resolve out of order. Tests currently cover heuristics, built HTML, and generic UI components, not core D1 workflows.

### Private CSV discovery

The user supplied `../burner-board-2026-09-07.csv` for read-only analysis. It contains 569 records: 382 Done and 187 Not started. Grocery contains 237 records, 224 completed. There are 16 nonblank collection names and 11 unassigned records. Types include Task, Goal, Someday, Reference, Reminder, Event, and Purchase; imported types should not be assumed accurate. There are 379 completion timestamps, but only 47 last-interaction values. Four rows contain recurrence labels. The `goal` field is empty throughout; some area/project values are linked URLs rather than human-readable relations.

This is a partial export, not a full backup: it omits List preferences, groups, tags, integration data, and other internal fields. Repeated titles may represent legitimate grocery/repeat history. Never use title equality as a deletion rule. Do not commit personal records, titles, notes, or this CSV as fixtures. Use synthetic equivalents.

## 4. Target architecture

```text
Burner Board UI ------------------+
                                 |
Claude / ChatGPT -> authenticated MCP -> shared commands and queries -> Cloudflare D1
                                 |
Future embedded chat ------------+

Persistent workflow instructions -> selected scope -> proposals -> user review -> commands
Deterministic progress queries -----------------------> board summaries
Later client-hosted scheduled AI ---------------------> saved briefings / proposals
```

The application owns truth, authorization, scope limits, validation, persistence, history, and statistics. AI clients own reasoning and conversation. Their output never bypasses application rules. Durable goal context and decisions live in D1, not solely in a client's chat memory.

Use one shared application layer behind browser and MCP transports. Do not expose unrestricted SQL, infrastructure credentials, arbitrary HTTP requests, or an unrestricted full-board write tool to an AI client. Avoid a separate backend/framework unless the actual deployment proves it necessary.

Keep `board-store.ts` temporarily as a compatibility facade. Extract modules when a phase needs the behavior; do not split every function before delivering UI improvements.

| Module / intended file | Responsibility |
| --- | --- |
| **new** `lib/domain/contracts.ts` | Runtime schemas, command/query types, limits, error codes. Reuse installed Zod. |
| **new** `lib/domain/items.ts`, `lists.ts` | Pure lifecycle, membership, and visibility rules. |
| **new** `lib/domain/progress.ts`, `recurrence.ts` | Deterministic calculations with injected time/timezone. |
| **new** `lib/server/identity.ts` | Validated principal to existing owner mapping; browser and MCP principals converge. |
| **new** `lib/server/commands.ts` | One mutation entry point, preconditions, idempotency, audit events, atomic persistence. |
| **new** `lib/server/queries.ts` | Board/History, scoped context, progress, cursor pagination. |
| **new** `lib/server/repository.ts` | D1 SQL and transactional batches; no remote AI/Notion side effects inside transactions. |
| **new** `lib/server/notion-legacy.ts` | Transitional Notion code and explicit import staging; never silently overwrite D1 after cutover. |
| **new** `lib/server/proposals.ts`, `ai-scopes.ts`, `plans.ts` | Proposal validation/application, bounded grants, goal context. |
| **new** `lib/server/mcp.ts` | Protocol adapter and tool schemas over shared commands/queries. |
| **new** `lib/server/ai-setup.ts` | Connection verification status, capabilities, revocation; never persist raw subscription credentials. |
| **new** `components/board/` | Extract History, bulk actions, Focus, plan/proposal rendering from BoardApp as implemented. |
| **new** `app/guide/ai/page.tsx` | Persistent user-facing setup and usage guide, linked from the board. |

## 5. Domain model and behavioral rules

### Core terms

- **Item**: persisted record. Keep this technical umbrella while using Task for actionable work in the UI.
- **Task**: checkable action. Purchase and reminder-oriented items may share its completion behavior without losing their existing kind metadata.
- **Goal**: desired outcome with context, questions, and actionable children. Child completion is evidence of progress; never automatically declare a goal achieved solely because all current children are done.
- **List**: named primary container identified by ID. Mixed item kinds are allowed. Visibility does not change stored data or importance.
- **View**: a filtered presentation, such as Calendar, Goals, This week, or History. Appearing in a view does not move an item from its List.
- **Group**: existing explicit peer bundle. It is not a parent-child plan. Preserve existing groups; do not create new groups to represent subtasks.
- **History**: completed items hidden from active views by default. Archived and deleted items remain distinguishable from completed work.
- **Review state**: needs review / reviewed. This replaces using an accidental combination of type, priority, dates, and relations as the only indication of organization.
- **AI selection**: explicit bounded grant to inspect a batch for a purpose, particularly initial cleanup. It does not imply a commitment to complete that work.
- **Focus**: user-selected current priorities. Optional review-until date, independent of List membership, importance, and last interaction.
- **Weekly commitment**: task selected for a particular planning week. This is the population used in weekly completion statistics.
- **Proposal**: persisted, typed suggested changes with evidence, questions, preconditions, and a review status.
- **Activity event**: recorded user/app/AI action. A save, completion, reopening, rescheduling, and reported progress are distinct events.
- **Recurrence series / occurrence**: reusable schedule definition and an individual checkable instance, respectively.

### Defaults and edge cases

1. Capture requires a title only. No date, List, priority, or AI call is mandatory. Save D1 before returning success.
2. Preserve legacy ItemType values on migration. New captures default to Task. Do not automatically convert Someday to Task, delete it, or reinterpret its meaning as a Burner value. Simplifying the type vocabulary remains a later explicit cleanup choice.
3. List moves change membership only. Type/date changes are separate explicit actions or reviewed proposal operations.
4. Events may live in mixed Lists and also appear in Calendar. A hidden type contributes a visible hidden-count/filter affordance, so hiding does not resemble disappearance.
5. New Lists are plain containers. Existing List Type settings migrate into explicit effective display preferences before type controls are retired. Preserve tri-state overrides and global defaults; hiding priority must not zero/null the stored value or silently change ranking.
6. Preserve existing date-rule cards as compatibility views initially. Label their rule and separate explicit membership from computed inclusion. Creating/moving into an ordinary List must not silently schedule a task. Converting old rule cards to dedicated views requires a preview preserving explicit memberships.
7. List deletion detaches items and removes List preferences, never deletes items. No lazy backfill may recreate a deleted List from stale collection strings.
8. Preserve Done and Archived distinctly. New Delete sets a recoverable tombstone; permanent purge and retention duration are not selected. History defaults to Done with a separate Archived/Deleted filter. Do not translate Archived into Done for statistics.
9. Existing creation times stay unknown unless trustworthy source creation metadata is available. Store when the app first recorded a row separately. Do not substitute `updatedAt`, last interaction, or a migration timestamp as original creation time.
10. Choosing a List for AI creates a visible snapshot of selected IDs, with preview and a limit. Future List additions do not silently expand the grant. Whole-library cleanup is allowed as a succession of explicitly selected batches, not as continuous autonomous access.
11. Focus and AI selection are independent: the initial cleanup batch can include unimportant historical records without marking them as current priorities.
12. For first-release group consistency, prevent new cross-List merges. Show existing cross-List groups honestly without changing membership; require an explicit choice to move the entire group or ungroup. Group operations must not modify hidden members outside an AI grant.

## 6. Data-model changes, introduced by phase

Use additive migrations. Keep legacy columns until the replacement is exercised and rollback consequences are documented. All domain tables and relationships include `owner_id`; cross-owner IDs must never resolve. Use composite foreign keys where practical, plus command validation. Store timestamps as UTC instants and calendar dates as `YYYY-MM-DD`; retain raw imported values when normalization is ambiguous.

| Phase | Additions / changes |
| --- | --- |
| 1 | `items.list_id` nullable; `created_at` nullable; `created_at_source`; `recorded_at` non-null; `deleted_at` nullable; `review_state`; integer `version`. Keep `collection` as compatibility/source text. Add owner-scoped `board_state` with revision and storage mode, `command_receipts`, and `activity_events`. |
| 1 | Unique normalized List-name key per owner after ambiguous collisions have been reviewed. Backfill `list_id` by exact existing owner/name mapping first. Preserve IDs; never regenerate all item IDs to remove Notion provenance. |
| 2 | Versioned List display preferences, stored in `app_meta` where appropriate: visible fields/types and completed visibility. Materialize current effective settings before changing inheritance behavior. Add explicit reviewed state changes rather than inference from priority. |
| 3 | `focus_items(owner_id,item_id,selected_at,review_until)`; `planning_weeks(owner_id,id,start_date,timezone,status)`; `week_commitments(owner_id,week_id,item_id,added_at,withdrawn_at,withdrawal_reason)`. Capture immutable event history for membership/completion transitions. |
| 4 | `ai_scopes(owner_id,id,purpose,status,expires_at,version)`; `ai_scope_items(owner_id,scope_id,item_id)`; authenticated connector grants mapped to the existing owner, stored hashed/encrypted as appropriate. OAuth storage requirements follow the selected supported library. |
| 4 | `proposals(owner_id,id,scope_id,status,version,source_client,summary,questions_json,created_at,applied_at)`; `proposal_operations(owner_id,proposal_id,ordinal,operation_json,preconditions_json)`; `ai_runs(owner_id,id,scope_id,client,status,started_at,finished_at,input_revision,result_id)`. |
| 5 | `items.parent_id` nullable for goal/task hierarchy; `goal_context(owner_id,goal_id,version,summary,constraints_json,open_questions_json,updated_at)`; versioned `plans` linked to the goal and originating proposal; plan-step links to real item IDs. Existing text `goal` is preserved as legacy metadata, not used as the new relationship. |
| 6 | `recurrence_series` with owner, schedule, timezone, next occurrence, paused state and template fields; items gain `series_id` and `occurrence_key`. Unique `(owner_id,series_id,occurrence_key)` prevents duplicate generation. |
| 7 | `briefings(owner_id,id,scope_id,period_start,period_end,input_revision,source,body,created_at)`; per-scope schedule preferences/run policy. Keep deterministic facts separate from AI narrative. |

`command_receipts` stores request ID, normalized payload hash, committed revision, and response/result IDs. The same request ID with a different payload is a conflict. Receipts and domain writes commit together. `activity_events` records event ID, owner, item/entity ID, actor kind/client, event type, timestamp, request ID, and bounded before/after data needed for history/undo. Do not log integration secrets or full chat transcripts.

Do not add a general event-sourcing framework. Current-state tables serve normal queries; an append-only activity log supports progress, migration evidence, and targeted undo.

### Weekly statistics contract

- User timezone defaults to the existing known preference or asks during setup; suggested initial value for this owner is America/Chicago, never infer it permanently from the server timezone. Week starts Monday unless the owner changes it. **Implemented** (Phase 3 completion batch): a persisted per-owner timezone setting (`settings.setPlanningTimezone`) replaces the previously-hardcoded suggested default; changing it affects only newly created weeks/periods going forward and never reinterprets an already-created row's recorded timezone.
- Show completed / total tasks selected for that week, with added/withdrawn/deferred counts visible separately. Define the displayed denominator as all commitments added to the week, including withdrawals; do not improve the percentage by withdrawing unfinished work. **Implemented**: withdrawal now accepts an optional reason, shown as an explicit “Deferred: ...” label distinct from a bare withdrawal - presentation only, the denominator/percentage math is unchanged.
- A task contributes once per week, even if shown in several views. Goals and reference records are excluded from the task ratio; show goal milestones separately.
- Count completion events inside the week after commitment selection. Reopen within the same week reverses its current completion contribution. Completion outside the week is shown as late completion, not rewritten as on-time success.
- Closing a week freezes its report. Later edits do not rewrite historical reports. Explicit corrections must be labeled and versioned. **Implemented**: a bounded, owner-scoped prior-weeks selector (`GET /api/board/weeks`) keeps every past week - closed or still open past its natural rollover - reachable and closeable from the UI, not only the current week.
- Zero commitments shows “No tasks planned”, not 0% or 100%. Unknown imported completion dates do not create fabricated historical weekly results.

### Approved extension: Today/Month/Year planning periods

Adam approved generalizing the weekly commitment mechanism to three additional selectable
planning horizons - Today, This month, This year - alongside the week (Phase 3 completion batch,
building on the already-implemented weekly mechanism above). In product terms: an item can be
independently selected for any combination of Today/This week/This month/This year through one
“Plan” control per row; adding or withdrawing from one horizon never changes another horizon's
membership or completion credit, matching the weekly contract's own independence rule. Each
horizon uses the same completed/total ratio, added/withdrawn/deferred presentation, and
timezone-aware calendar boundaries (calendar day/month/year, not fixed hour counts) as the weekly
contract. Unlike a week, a Today/Month/Year period does not require an explicit close step before
its statistics are trustworthy - the underlying calculation already bounds on-time credit against
that period's own end instant regardless of open/closed status, so it reports correctly whether
or not it has ever been explicitly closed. Focus (user-selected current priorities) remains
independent of all four horizons, per the domain model's existing Focus/Weekly-commitment
distinction.

## 7. API and mutation contracts

Retain `/api/board` during transition. Route legacy actions through the shared command layer as they are migrated; eliminate direct legacy write bypasses before exposing MCP writes.

### Browser API v1

`GET /api/board` returns the current compatible payload plus `schemaVersion`, `boardRevision`, and capability flags. Add cursor-based queries for History and large item selections rather than always returning all historical notes. Existing board UI can retain its initial full active payload while that extraction occurs.

`POST /api/board` accepts an additive versioned envelope:

```json
{
  "apiVersion": 1,
  "requestId": "client-generated-uuid",
  "expectedBoardRevision": 42,
  "action": "items.update",
  "payload": { "id": "existing-item-id", "expectedVersion": 3, "changes": { "listId": "existing-list-id" } }
}
```

Success: `{ok:true, requestId, boardRevision, result, changedItemIds, changedListIds}`. Errors: `{ok:false,error:{code,message,details?}}`. Codes/statuses: `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `VALIDATION_FAILED` 422, `CONFLICT` 409, `SCOPE_EXPIRED` 403, `LIMIT_EXCEEDED` 429, and `INTERNAL_ERROR` 500. Do not expose SQL, tokens, or raw internal stack traces. Unauthorized cross-owner lookups return not-found behavior without leaking existence.

Commands to implement as their phases arrive:

| Commands | Inputs and effects |
| --- | --- |
| `items.create` | title required; optional validated fields; server ID/timestamps; D1-only success independent of Notion. |
| `items.update`, `items.complete`, `items.reopen` | ID/version; allowlisted changes; lifecycle events; server-managed completion time. |
| `items.move`, `items.review` | explicit IDs/versions and destination/review state; no implicit kind or date mutation. |
| `items.delete`, `items.restore` | tombstone or restore; preserve history and related plan references. No purge command in MCP v1. |
| `lists.create/update/delete/reorder` | stable IDs, preference validation; delete detaches items atomically. |
| `groups.merge/unlink/disband` | reuse existing semantics within the clarified membership constraints. |
| `focus.set`, `week.commit`, `week.withdraw`, `week.close` | explicit selected IDs, week and reason where applicable; append events. |
| `scopes.create/revoke` | purpose, explicit IDs, expiry; authenticated browser owner controls grants. |
| `proposals.submit/reject/apply` | scope, typed operations and preconditions; apply is owner-reviewed and all-or-nothing. |
| `goals.context.update`, `plans.apply` | versioned context/proposal; parent links and new children commit atomically. |
| `recurrence.create/update/pause`, `occurrences.complete` | explicit schedule/instance IDs; preserve prior occurrences. |
| `briefings.save` | bounded narrative plus exact source revision/period; cannot mutate tasks as a side effect. |

Initial limits: at most 50 items per cleanup scope, 25 proposal operations, 100 records per query page, and 64 KiB per proposal body. Return a useful “split this selection” response when exceeded. These are tunable engineering defaults, not subscription-quota estimates. Validate maximum field lengths and reject unknown command fields. Use installed Zod rather than introducing a second schema system.

### Atomicity, retries, and concurrency

Each command must atomically enforce revision preconditions, update domain rows, append events, and store its receipt. Browser optimistic state is not a lock. A pre-read version check alone is insufficient against races. D1 batches are transactional on statement failure; implement a database-enforced revision guard that fails the batch on a stale version. Verify concurrent callers in the real isolated D1 harness. Do not issue SQL `BEGIN` around separate requests or assume a zero-row UPDATE automatically aborts a batch.

For the personal first release, an owner-level board revision is an acceptable simple serialization boundary. Also use item/context/proposal versions for useful conflict reporting. All write paths, including transitional imports/backfills and recurrence generation, must participate or be disabled during mutation windows. Idempotent replay returns the prior receipt; if the original response was lost, it must not create duplicate tasks/events. Refresh authoritative records after a conflict; never silently overwrite newer content.

Never include a Notion request, model call, or notification delivery in the D1 transaction. Keep command results distinguishable from optional external delivery status. Multi-command bulk operations may be split into explicitly shown batches; never claim a whole batch applied if only a portion committed.

### MCP v1

Expose remote authenticated Streamable HTTP at `/mcp`, integrated at the Worker routing boundary or an explicitly documented thin companion Worker sharing the same application modules. Prefer one deployment; use a companion only if runtime constraints require it. OAuth/auth discovery must work with both clients and map to the same existing owner. Do not grant a client a different empty board because its identity format differs.

Initial tools:

- `get_capabilities`: protocol/schema version, supported workflows, bounds, client setup diagnostics.
- `list_ai_scopes`: grant metadata only, not all task titles or contents.
- `get_scope_snapshot(scopeId,cursor?)`: authorized IDs, versions, bounded context, List summaries, purpose and outstanding questions.
- `get_items(scopeId,ids)`: further details only within the grant; explicit linked-goal context requires inclusion/authorization.
- `get_progress(scopeId,weekId)`: deterministic facts with timeframe and denominator.
- `submit_proposal(scopeId,proposal)`: saves a draft, never applies it.
- `get_proposal(scopeId,proposalId)`: review state and details within scope.
- `save_briefing(scopeId,period,inputRevision,body)`: introduced in phase 7; cannot alter completion, dates, or Focus.

Browser review owns `proposals.apply` initially. Do not expose blanket autonomous apply/delete/import tools. Later explicit low-risk write commands may be added only with a documented permission policy and tests. Client tool annotations describe behavior; server authorization is what enforces it.

Both clients use the same IDs and schema. `source_client` is provenance only; it must not affect ownership or lock a plan to a provider. A Claude draft can be read and refined in ChatGPT, and vice versa. Revoking a scope invalidates access immediately, including subsequent calls from a previously running session. Empty selection must return empty, never fall back to all items.

### Proposal lifecycle

`draft -> ready -> applied | rejected`; stale preconditions produce a conflict/review-needed state, not a partial apply. Drafts may hold unanswered questions. Only fully specified, validated operations become ready. Store the rendered before/after preview against the same versions applied. Editing operations invalidates prior approval. The apply button submits that proposal version, preventing a different client from swapping content after review.

Supported v1 operations: update allowed fields, move item, mark reviewed, create List, and attach items to that newly proposed List through a proposal-local reference. Phase 5 adds create child task and update goal context. Resolve proposal-local IDs server-side. AI cleanup cannot delete records, manufacture completion history, invent priority/importance, or infer hard due dates from vague intent. Suggested dates need explicit review and a reason.

Undo is a new compensating command with preconditions. If affected records changed since application, show the conflicts rather than overwriting them. The audit log must retain the original and compensation.

## 8. Implementation phases

For each phase: inspect current diff, implement only that phase and its prerequisites, run its checks, summarize changes/risks, and provide an Astra-review handoff. Do not mark a phase done solely because code compiles. Do not start gated future phases by guessing missing decisions.

### Phase 0 — Baseline, isolation, recovery, and identity evidence

**Purpose:** establish a safe implementation/test environment before touching the real data path.

Existing files: `AGENTS.md`, `CLAUDE.md`, `package.json`, `scripts/build-verified.sh`, `scripts/sites-env.sh`, `db/schema.ts`, `drizzle/`, `vite.config.ts`, `wrangler.deploy.jsonc`, `proxy.ts`, `lib/server/board-store.ts`, `tests/`.

New files: `tests/helpers/d1.mjs`, `tests/migrations.test.mjs`, `scripts/migrate-board.mjs`, and `docs/operations/data-recovery.md`.

Work:

- Record baseline commit and dirty paths. Planning baseline was commit `54d6bc6` with existing modified/untracked documentation and configuration; do not assume it is still current or clean.
- Run existing typecheck/lint/tests and record pre-existing failures separately. Do not clean up unrelated failures silently.
- Introduce a disposable local D1/Miniflare test harness with synthetic owners and records. Add an explicit test dependency if necessary during authorized implementation; never resolve test storage to the real `.wrangler/state` database.
- Create a migration runner with dry-run/check/apply modes, explicit database target, ordered SQL and data migration ledger, resumability, and no default production target. Its apply mode is an operator action, not part of ordinary tests.
- Document backup/restore for the exact local and production deployment. Rehearse restoration with a disposable database and compare row counts/IDs and settings.
- Verify which deployment edge authenticates browser requests and blocks forged identity headers/direct Worker access. Identify the actual existing owner key without exporting credentials or personal content. Document how future OAuth subjects map to it.

Acceptance: baseline outcomes recorded; test DB isolation enforced; migration/restore rehearsal succeeds; deployment identity assumptions are explicit. No real data migration occurs in tests.

Required checks: existing verification commands plus isolated schema upgrade from every supported existing migration state, idempotent migration ledger, owner-isolation fixtures, and restore rehearsal.

### Phase 1 — D1 authority foundation and shared commands

Existing files: `db/schema.ts`, `lib/board-types.ts`, `lib/server/board-store.ts`, `app/api/board/route.ts`, `app/board-app.tsx`, `lib/list-behavior.ts`, `drizzle/`.

New files: `lib/domain/contracts.ts`, `lib/server/identity.ts`, `commands.ts`, `queries.ts`, `repository.ts`, `notion-legacy.ts`; `tests/commands.test.mjs`, `tests/identity.test.mjs`.

Work:

- Add phase-1 schema, migration ledger/backfills, stable List IDs, versions, receipts, and activity events. Preserve all old data and IDs.
- Resolve name collisions through a migration report, not arbitrary first-match mapping. Unmatched names preserve source text and appear as unresolved review candidates.
- Introduce explicit storage modes: `legacy_notion` for unmigrated owners and `d1_primary` after owner cutover. Avoid a permanent hybrid authority. Build and test D1-primary mode against fixtures first.
- In D1-primary mode, create/update/delete never invoke Notion and legacy pulls cannot overwrite working records. Disable name-based lazy creation after List-ID migration. Move remaining required initialization into explicit idempotent migration steps.
- Route item/List/group writes through validated commands and align optimistic client reconciliation. Replace hard deletion with tombstones in D1-primary mode.
- Read paths return stored state and do not perform domain backfills after migration.

Acceptance: disconnected and connected D1-primary capture succeeds without a Notion call; rename preserves membership; deletion cannot resurrect on import; stale writes conflict; duplicate request replay causes no duplicate event; all mutation paths enforce owner/revision rules.

Tests: create/update/complete/reopen/delete/restore, List rename/delete, group fan-out, malformed inputs, concurrent versions, transaction rollback and response-loss retry, no remote call in D1-primary mode, migration preserving archived/completed data and unknown timestamps.

Release note: do not enable D1-primary on the real owner until the cutover gate in phase 4 is satisfied. Foundation and UI work can be exercised in an isolated copied/synthetic environment meanwhile.

### Phase 2 — Usable organization, History, and simple mixed Lists

Existing files: `app/board-app.tsx`, `app/organize-mode.tsx`, `app/globals.css`, `app/organize.css`, `lib/list-behavior.ts`, `lib/organizing.ts`, `lib/sample-board.ts`, `lib/board-types.ts`.

New files: `components/board/history-view.tsx`, `bulk-actions.tsx`, `list-settings.tsx`, `lib/domain/items.ts`, `lib/domain/lists.ts`, `app/guide/ai/page.tsx`, `tests/list-behavior.test.mjs`, `tests/board-workflows.test.mjs`.

Work:

- Default active Lists to open items; provide History with search, List/date filters, and separate Archived/Deleted filters. Show completed counts without expanding hundreds of historical rows.
- Add explicit select-all-visible with count, per-item selection, batch move/type/review actions and before/after preview. Search/filter changes must not secretly widen selection.
- Simplify the editor: title, notes/context, status, optional List/date/importance; reveal advanced fields on demand. Preserve existing values even when fields are hidden.
- Allow Events and other kinds in all Lists. Dedicated Calendar/Goals/Reminders views are projections. Preserve current kinds during cleanup.
- Replace implicit Inbox criteria with a visible Needs review queue; unfiled remains a separate useful filter. Capture adds needs-review; a reviewed item may remain unfiled or undated.
- Remove type-changing move behavior. Preserve current List display defaults explicitly and expose field/type visibility controls without requiring a List Type choice.
- Make group membership/partial display honest; disable new cross-List merges until explicitly resolved.
- Add a Guide link and a preliminary AI Setup page explaining the coming connection workflow. Clearly label unavailable connection features; do not show fake success states.

Acceptance: a grocery-like fixture with 224 completed and 13 open entries shows only 13 active by default; history remains searchable; user can organize 25 selected items in one reviewed batch; Event remains visible in its mixed List and Calendar; hiding fields never changes data; quick capture works without metadata or AI.

Tests: visibility inheritance/reset, mixed kinds, History filters, selection bounds, failed bulk operation, group hidden-member protection, sample-mode parity, keyboard/touch alternatives to drag, and date/type preservation on all move paths.

### Phase 3 — Focus and trustworthy weekly progress

Existing files: `db/schema.ts`, `lib/board-types.ts`, `app/board-app.tsx`, command/query modules, `drizzle/`.

New files: `lib/domain/progress.ts`, `components/board/focus-view.tsx`, `weekly-progress.tsx`, `tests/progress.test.mjs`.

Work: add phase-3 schema and explicit Focus/weekly commitment controls; keep them distinct from AI selection and recent activity. Implement the statistics contract in section 6. Show selected-week counts, late completions, additions, deferrals, and a simple progress bar. Default check-ins to in-app cards; no external provider required.

Acceptance: 12 completed of 20 commitments shows 12/20 (60%); adding unrelated groceries does not change it; withdrawing unfinished work does not inflate it; reopening, duplicate views, week boundaries, and unknown imported timestamps behave as documented. Closed weeks remain historically stable.

Tests: injected timezone/clock, daylight-saving transition, empty week, add/withdraw/re-add, reopening, late completion, goal-parent exclusion and closed-week snapshot behavior.

### Phase 4 — Interchangeable AI connectors, setup guide, and cleanup proposals

Existing files: `worker/index.ts`, `vite.config.ts`, `wrangler.deploy.jsonc`, `app/api/board/route.ts`, `db/schema.ts`, shared modules, `app/guide/ai/page.tsx`, `app/board-app.tsx`, `drizzle/`.

New files: `lib/server/mcp.ts`, `ai-scopes.ts`, `proposals.ts`, `ai-setup.ts`, `components/board/ai-selection.tsx`, `proposal-review.tsx`, `lib/ai/workflow-instructions.ts`, `tests/mcp.test.mjs`, `tests/proposals.test.mjs`, `docs/operations/ai-connections.md`.

Work:

- Add bounded AI scope and proposal schema. Build authenticated MCP with the tools/contracts in section 7. Select an existing supported OAuth implementation; do not invent cryptography or expose an unauthenticated personal-data endpoint.
- Resolve actual identity/endpoint/client-registration prerequisites through the gate below. Use the same board owner for both clients. Only necessary authentication storage/bindings should be added.
- Create provider-neutral workflow instructions: read selected scope and saved context; identify missing facts; ask only material questions; propose a small batch; do not alter importance/dates/history without review; record unresolved questions; stop at bounds.
- The Guide provides separate Claude and ChatGPT instructions, copyable endpoint and starter workflow, expected permissions, a harmless connection test, current capability/version status, revoke/reconnect steps, usage controls, and a visible last-verified date with official documentation links.
- Guide content must be usable by the owner without reading this plan or a CLI manual. Explain that conversation is in the selected AI client and results appear in Burner Board. Include a switching-client walkthrough.
- Implement proposal review with before/after values, reasons, affected count, unanswered questions, reject/apply and guarded undo. AI submits drafts; browser owner applies ready proposals.
- Persist context/questions and proposal results so switching clients does not depend on sharing private chat transcripts. The app's stored context is authoritative.

Acceptance: complete the same synthetic cleanup workflow in **both** actual account clients: connect, read a selected batch, ask a question, draft a move/new-List proposal, review/apply in the website, and observe the result from the other client. A revoked grant, out-of-scope item, hidden group member, stale proposal, replay, or empty selection cannot widen access or mutate unintended records. A guide-only user can reconnect successfully.

Tests: OAuth/principal mapping, same-owner cross-client behavior, scope expiry/revocation, payload/page/operation limits, proposal-local references, stale approval race, all-or-nothing application, safe undo conflicts, no arbitrary query/write tool, and untrusted notes attempting to override scope.

**Real-data cutover gate:** before switching the owner's storage mode, back up complete D1 and confirm relevant Notion-only changes are reconciled through a preview. Compare IDs/counts/completion/Lists/groups/preferences; resolve dirty local-versus-remote conflicts with the owner. Verify both replacement AI connections. Then switch to D1-primary, disable legacy background/read/write sync, and preserve the Notion source untouched. Verify create/edit/restore on disposable records and read-only reconcile counts. Do not delete Notion pages or tokens as part of an automatic cleanup. A later explicit import must stage changes for review and honor tombstones.

This phase's first slice is a minimal connection proof with synthetic data, before elaborate guide styling or full proposal UI. Failure of account capabilities blocks connector-dependent release, not phase-2 usability work.

### Phase 5 — Goals, context, and actionable plans

Existing files: `db/schema.ts`, `lib/board-types.ts`, `app/board-app.tsx`, commands/queries/proposals/MCP/guide, `drizzle/`.

New files: `lib/server/plans.ts`, `components/board/goal-detail.tsx`, `plan-review.tsx`, `tests/plans.test.mjs`.

Work: add goal parent-child relationships and versioned durable context; support desired outcome, constraints, available time, current situation, open questions, and plan revisions without making them all required capture fields. AI proposes actionable children/milestones and optional dates. Applying a plan creates real tasks and relationships atomically. Goals can appear in mixed Lists and dedicated Goals view. Preserve the original goal and raw notes; never replace them with a generated summary alone.

Acceptance: a goal can begin without a due date; Claude can ask questions and draft a plan, ChatGPT can continue from stored context, and the approved children become checkable tasks. Reapplying does not duplicate children. Rejecting leaves tasks unchanged. Parent cycles and cross-owner links fail. Completing all steps prompts goal review rather than inventing achievement.

Tests: hierarchy/cycle constraints, context version conflicts, client switching, duplicate application, plan revision preserving completed steps, deleted child references, distinction between Groups and hierarchy, and no fabricated dates/assumptions.

Files/attachments: preserve text context first. Binary uploads require an explicit storage/size/access decision and are not a hidden dependency of basic goal planning. Existing links may be stored as context; AI access requires explicit scope.

### Phase 6 — Recurring tasks with preserved occurrence history

Existing files: `db/schema.ts`, item editor, shared commands/queries, progress module, `drizzle/`.

New files: `lib/domain/recurrence.ts`, `lib/server/recurrence.ts`, `components/board/recurrence-editor.tsx`, `tests/recurrence.test.mjs`.

Work: introduce series/occurrences for daily/weekly/monthly calendar recurrence. Each occurrence is independently completable and linkable to a weekly commitment. Monthly schedules clamp to the final valid day for short months and display that policy. Editing a series affects future occurrences only. Late completion does not erase or shift fixed-calendar history. Pause does not delete history. Grocery repurchase can create a new ordinary task without forcing a recurring schedule.

Legacy recurrence labels are candidates for setup review, not enough evidence to infer a fully specified series/timezone/start date. Generate only a bounded near-term horizon, with idempotent occurrence keys. Initially refresh occurrences on an explicit command/app refresh; do not introduce a cloud scheduler solely to make the first version work.

Acceptance: completing one monthly bill leaves its completed instance visible while the next occurrence is separate; repeat generation produces no duplicate; schedule edits preserve past completions. No payment is initiated by this app.

Tests: leap years, month ends, timezone/DST, late completion, skipped/missed periods, pause/resume, retry/concurrent generation, week statistics across separate occurrences.

Decision gate: interval-after-completion recurrence and handling a long missed backlog need an owner-visible policy before supporting those modes. Unsupported imported recurrence must be labeled, not guessed.

### Phase 7 — Scheduled briefings and accountability experiments

Existing files: MCP/queries/guide, Focus/progress UI, `db/schema.ts`, `drizzle/`.

New files: `lib/server/briefings.ts`, `components/board/briefings.tsx`, `tests/briefings.test.mjs`.

Work: first show deterministic briefings in-app. Then guide the owner through one optional low-frequency scheduled workflow in a supported subscription client. Read only the selected ongoing Focus grant and relevant saved context; save a bounded briefing/proposal, not automatic task changes. Each run records source revisions and timestamps. Skip substantive reanalysis if no relevant change, while acknowledging the client invocation itself may still consume usage. Default to manual until the owner enables a cadence. Avoid simultaneous duplicate schedules in both clients.

Acceptance: latest analysis is visible in Burner Board with client/time/period; client switching works; duplicate runs do not duplicate a period/revision briefing; revoked/expired grants stop data access; rate/usage exhaustion leaves the app fully usable and marks the briefing stale rather than fabricated. Schedule can be paused and revoked from documented controls.

Tests: duplicate run keys, stale input, no-change result, failure reporting, scope changes during execution, deterministic facts preserved alongside narrative, and zero task mutation through briefing tools.

External Discord/WhatsApp/SMS delivery is not part of this phase. Choose one channel later based on actual usage, costs, credentials, reply routing, and notification preferences. A scheduled in-app briefing does not imply push notifications while the website is closed.

### Phase 8 — Embedded AI chat and richer automation (required future direction, gated)

Do not silently drop this requirement. Before implementation, compare currently supported subscription/client embedding or agent-runtime options against API-backed options, hosting needs, and billing rules. Document a concrete supported route and get approval for any new spend or account/runtime requirements. A custom MCP connection alone does not establish embedded chat feasibility.

Likely files: **new** `components/board/assistant-chat.tsx`, `lib/server/assistant-runtime.ts`, chat transport routes, and changes to goal/proposal/scope UI and guide. Exact runtime dependencies and transport contract are intentionally gated.

Required outcome: chat inside Burner Board can read selected context, ask questions, draft plans, and navigate to proposal review. It must reuse the existing command/query/scope model, support provider interchangeability where capabilities permit, disclose capability differences, and never require data migration to switch models. Persist user-approved summaries/decisions independent of the runtime. No unbounded background agents or hidden full-library reads.

Before expanding to motivational coaching, notification replies, free-form scoring formulas, habits, or autonomous plan changes, review actual usage with the owner. Each requires its own acceptance criteria and permissions, rather than being implied by “AI secretary”.

## 9. Verification commands and required evidence

The following scripts exist at planning time. Run from the repository root in Git Bash on this machine; Node/npm are documented under `D:\DevOps`. Do not assume PowerShell/cmd handles the POSIX env syntax in `npm run dev`.

```bash
npm run typecheck
npm run lint
npm run test:organizing
npm test
```

`npm test` already runs the bounded build, then `node --test tests/*.test.mjs`. Do not run an extra identical build after it passes without a reason. `npm run build` is available when validating only a build. The build wrapper requires GNU `timeout`; do not remove its bounds to hide a hang. No baseline tests or builds were run during the planning session.

Introduce these scripts in phase 0/1 and keep their exact names in the handoff:

```bash
npm run test:domain
npm run test:db
npm run test:flows
```

They do not exist yet. `test:domain` covers pure rules with injected time; `test:db` uses a disposable real D1-compatible runtime for schema, SQL, ownership, concurrency and rollback; `test:flows` covers the app-level interaction workflows. A JavaScript fake alone is insufficient evidence for SQL transactions, constraints, migration, or D1 behavior. Reuse Node's existing runner where practical; add only the smallest necessary test/runtime/browser dependency and pin it.

For phase completion run relevant focused suites, typecheck, lint, and `npm test`. Manual browser checks supplement automated tests for keyboard/touch, visibility, proposal review, Guide usability, and actual provider connectivity. Use synthetic data or disposable `Zz Test ...` records; do not mutate real goals/items as test fixtures. Verify cleanup does not remove the record being used as migration evidence.

For generated migrations:

```bash
npm run db:generate
```

Review generated SQL, test an upgrade on a disposable database, and check in the SQL plus corresponding Drizzle metadata. Do not edit old generated migrations to pretend deployed schemas were different.

Deployment/migration commands belong in the verified phase-0 operations guide. The repo currently uses explicit SQL application with local `sqlite3`, and production uses `wrangler d1 execute` with an explicit production config/target. Do not prescribe `wrangler d1 migrations apply` against a nonexistent default config. Resolve exact paths and targets first; never put a wildcard or guessed database name into an apply command. Back up and rehearse restore before applying anything to real D1. Follow the repository's Sites/Cloudflare hosting skills when implementation reaches deployment; this planning document does not bypass those operational requirements.

## 10. Migration and rollback strategy

1. Inventory the actual owner/database/schema state and preserve existing dirty work. The CSV is not sufficient for backup or reconstruction.
2. Create a complete backup and migration report containing counts and identifiers, kept private. Rehearse restore to an isolated target.
3. Apply additive schema changes and idempotent data backfills. Preserve item/List IDs, completion states, timestamps, group links, notes, settings, and raw source values.
4. Detect ambiguous List names, missing references, inconsistent groups, dirty sync conflicts, and unknown dates. Produce a review report; stop only the dependent migration step, not unrelated UI work.
5. Verify the revised app and both AI clients on isolated data, then perform the explicit real-owner D1 cutover after reconciliation.
6. Disable old sync writes/pulls and name-based lazy backfills in D1-primary mode. New import operations stage proposals and respect deleted-item tombstones.
7. Keep legacy columns/integration metadata through a documented observation period. Column removal, Notion deletion, and permanent personal-data purge require a separate reviewed change.

Rollback before cutover: restore the prior app build against its compatible schema or the isolated backup; additive unused fields may remain. Rollback after cutover: do **not** re-enable legacy Notion authority automatically, because D1 now contains newer work. Prefer disabling the faulty feature and rolling forward. If restoration is necessary, export post-cutover changes first, restore to a separate database, reconcile differences, then deliberately switch. A rollback that loses completed tasks, plans, or preferences is not acceptable without an explicit owner decision.

Use per-phase feature flags/capabilities for AI, proposals, recurrence, and schedules. Disabling AI must never disable basic task storage/editing. Show an unavailable or stale state instead of silently discarding queued proposals or briefings.

## 11. Unresolved questions and gates that must not be guessed

These do not block writing this plan or implementing independent earlier phases.

| Gate | Resolve before | Required evidence / decision |
| --- | --- | --- |
| Actual production identity and owner mapping | Publishing MCP or migrating owner keys | Verify trusted edge, bypass prevention, actual existing owner, and OAuth identity mapping. Never infer ownership solely from a client-supplied email/header. |
| Both subscription accounts' current connection capabilities | Connector release / Notion cutover | End-to-end connection tests in Claude and ChatGPT. Documentation establishes feasibility, not account-specific success. |
| OAuth registration/issuer/deployment endpoint | Phase 4 deployment | Pick supported existing implementation compatible with both clients; record callback/discovery requirements and minimal permissions. |
| Dirty Notion/local conflicts and missing data | Real-owner cutover | Preview differences and ask the owner on conflicting values; preserve both until resolved. |
| Ambiguous classification or duplicates | Applying cleanup | Owner reviews proposals. No guessed completion, deletion, importance, or due dates. |
| Permanent deletion and retention | Purge feature | Owner decides retention and recoverability. Default is preserve. |
| Legacy Someday/Burner/type vocabulary | Removing stored values | Review explicit mapping; retain values until then. |
| Binary attachments | Upload feature | Storage, size, access and export policy; text and links can precede it. |
| Advanced recurrence and missed backlog | Supporting those modes | Fixed-date versus completion-relative behavior, catch-up policy, timezone/start date. |
| Schedule/cadence/overages | Enabling unattended AI | Owner chooses cadence and grant; no paid-overage enrollment. Start with one workflow, not both clients running the same job. |
| Embedded AI runtime | Phase 8 | Supported auth/hosting/billing proof and owner approval of any changed constraints. |
| External messaging | Discord/WhatsApp/SMS implementation | Choose one channel, notification timing, reply behavior, credentials/costs, and privacy scope. |

The user has already decided mixed Lists, personal-only audience, D1 direction, provider interchangeability, in-app setup guidance, companion chat initially, embedded chat eventually, and cleanup-first priorities. Do not ask these questions again.

## 12. Explicit non-goals for initial delivery

- Multi-user productization, shared household/company workspaces, public wish-list sharing, billing, and roles beyond the existing owner boundary.
- Rewriting vinext/Vite/React or replacing D1 with a PC-hosted database.
- Comprehensive Notion bidirectional sync, resurrecting Todoist integration, or importing every possible provider.
- Autonomous whole-database organization, destructive AI cleanup, automatic priority/date decisions, and uncontrolled agent loops.
- An API-key AI backend or enabled paid overages under the existing subscription-only constraint.
- A finance ledger, payment execution, grocery inventory/pricing system, or medical/coaching decision engine inferred from task contents.
- Habits/streaks, arbitrary attention formulas, vector search/embeddings, always-running multi-agent orchestration, and external messaging before the basic workflow proves useful.

## 13. Instructions for Claude Code / implementing agent

1. Read this plan, `AGENTS.md`/`CLAUDE.md`, `CONTEXT.md`, and `docs/ARCHITECTURE.md`. Treat architecture sections here as target behavior unless explicitly labeled current. Older deferred ADR proposals are not additional build scope.
2. Inspect current git status and preserve pre-existing edits. The planning session changed only this roadmap. Do not reset, clean, reformat, or stage unrelated user files.
3. Begin with phase 0. Implement one reviewable phase or coherent slice at a time. Keep useful user-visible progress ahead of speculative infrastructure.
4. Use synthetic fixtures shaped like completed groceries, open tasks, vague goals, recurring bills, and mixed Lists. Never copy private records/notes into public tests or docs.
5. Keep authorization, scope, validation, idempotency, and domain invariants shared between browser and MCP. Do not let an integration bypass the command layer for convenience.
6. Use the existing deterministic organizing engine as prior art. Reuse established skills/libraries when appropriate, reviewing compatibility/licensing before copying source from `../Backburner/existing-projects/`. No need to audit every cloned repository before the first phase.
7. Update `CONTEXT.md` as terminology ships; update `docs/ARCHITECTURE.md` to describe actual implementation, not future aspirations. Add a new sequential ADR recording D1 authority and mixed-List decisions; retain historical ADRs and mark superseded sections through links. Reconcile stale Product Spec/tag/Inbox/navigation descriptions as their phase changes them.
8. Build the in-app Guide as a maintained feature. Include both providers and client switching. Store guide/workflow source centrally so copyable instructions and developer docs do not drift. Never present a UI checkbox as proof that OAuth or tool access works.
9. Report actual verification outcomes, not planned tests. If a pre-existing test fails, distinguish it from the phase's new failures and state whether it blocks acceptance.
10. At each phase handoff provide: phase/slice completed, files changed, migrations, tests/commands and results, manual verification, remaining issues, rollback implications, and the next unblocked phase. Update this roadmap's progress section only with evidence.
11. Stop at material unresolved gates and ask a focused question; continue independent work. Do not invent credentials, production targets, billing consent, or data-retention decisions.
12. Do not deploy, run destructive data operations, or enable recurring external actions merely because a plan mentions them. Follow the owner's implementation authorization and repository operational requirements at execution time. Split commits by feature where practical and review staged changes for personal data/secrets before any commit.

### Suggested initial instruction to Claude Code

> Read docs/plans/burner-board-roadmap.md and the repository instructions. Implement Phase 0 first, preserving existing changes and using only disposable test data. Report baseline checks, the migration/test isolation design, and recovery/identity findings. Do not migrate production, delete personal data, enable paid services, or jump ahead to AI features. After the phase is reviewed, continue with the next authorized phase.

## 14. Feasibility sources and maintenance

Checked during planning on 2026-09-07. Recheck changing account features before implementing the relevant integration. No connection, schedule, or account mutation was performed during research.

- [Cloudflare D1](https://developers.cloudflare.com/d1/): managed database supporting the no-PC-database requirement.
- [D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/): failed statements roll back the batch; command precondition failures must actually fail atomically.
- [ChatGPT developer mode](https://developers.openai.com/api/docs/guides/developer-mode): documents Plus eligibility and remote read/write MCP support. Verify actual account availability.
- [OpenAI plugin skills](https://developers.openai.com/plugins/concepts/skills): reusable workflow instructions complement live MCP tools.
- [Claude remote connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp): custom remote connections support the companion-client design.
- [Claude Cowork scheduled tasks](https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork): documents paid-plan schedules using connectors, with remote execution; local-file/app requirements change execution constraints.
- [ChatGPT scheduled tasks](https://learn.chatgpt.com/docs/automations): documents web tasks with connected tools/skills; specific entitlement and behavior require verification.
- [Claude Agent SDK subscription update](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan): current update pauses previously announced billing changes. Do not treat historical text below that update as current policy or assume all embedded-hosting arrangements are supported. This is a phase-8 research input, not a chosen runtime.

## 15. Progress and planning-session verification

- Architecture discovery: complete, using bounded Terra server/client/documentation agents and Astra spot checks.
- Private original notes and CSV: read with user authorization; aggregate CSV counts spot-checked by Astra.
- Product questions: answered; architecture direction approved, including the final requirement for a persistent in-app setup guide and interchangeable Claude/ChatGPT clients.
- This roadmap: written for implementation handoff. No application code changed, dependencies installed, real data modified, provider connections made, schedules enabled, or tests/builds run during planning.
- Implementation phases 0–8, as of the Phase 3 completion batch (this update):
  - **Phase 0** (baseline/isolation/recovery/identity): done - see `docs/operations/data-recovery.md` and the migration runner (`scripts/migrate-board.mjs`).
  - **Phase 1** (D1 authority foundation, shared commands): done for its own scope - `lib/domain/contracts.ts`, `lib/server/{commands,queries,repository,identity}.ts` exist and are tested (`tests/commands.test.mjs`, `tests/identity.test.mjs`). The real owner's storage mode remains `legacy_notion`; the phase-4 cutover gate has not been exercised, by design.
  - **Phase 2** (organization/History/mixed Lists): done - History view, bulk actions, simplified editor, Needs-review queue, and the Guide/AI-setup placeholder are implemented (see `docs/ARCHITECTURE.md`).
  - **Phase 3** (Focus and trustworthy weekly progress), including the approved Today/Month/Year extension above: **substantially implemented across several batches; this update records implementation status, not a declaration of formal acceptance** (that determination is Astra's, per the batch-review workflow in `AGENTS.md`). Focus, weekly commitments, the Today/Month/Year extension, atomic command/receipt/event handling, the persisted owner timezone setting, and the bounded prior-weeks history read path are all implemented and covered by `node --test tests/*.test.mjs` (`tests/focus-week-commands.test.mjs`, `tests/period-commands.test.mjs`, `tests/progress.test.mjs`, `tests/phase-3-completion.test.mjs`, `tests/weekly-progress-workflows.test.mjs`). See `docs/plans/phase-3-completion-handoff.md` for the latest batch's exact evidence and remaining limitations (no live-browser pass this batch; sample mode intentionally still states its limitation rather than simulating planning interactions).
  - **Phases 4–8**: not started. Phase 4's real-data cutover gate and OAuth/endpoint selection remain open per section 11's gates table.

If the planning session ends or usage resets, this file is the durable handoff. Resume from actual repository state and this progress section rather than reconstructing decisions from memory.

### Usage monitoring and checkpoint requirement

The owner explicitly requested protection against losing work when subscription usage runs out. During future sessions, save approved decisions, completed work, verification results, unresolved questions, and the exact next action incrementally in the authorized handoff document. Checkpoint before long reviews/research and immediately when the owner reports low remaining usage; do not leave the only useful result in an agent's reasoning or unsaved output. Respect any session restriction on creating documents until approval is given.

Usage monitoring/notifier is a separate development-tooling follow-up, not an initial Burner Board feature. First investigate whether the current Codex client exposes a supported, reliable quota/status source and notification mechanism. If available, check at session start and phase boundaries and notify/checkpoint at an owner-selected threshold. Do not assume model token counts equal five-hour or weekly subscription usage, claim a live quota reading without evidence, or start an agent loop merely to poll usage. Until a source is verified, use owner-reported allowance and short durable checkpoints. Do not promise notifications after the session ends unless a real scheduler/notifier has been configured and tested.
