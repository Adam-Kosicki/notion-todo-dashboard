# 0003: Deferred architecture questions for GPT ASTRA

_This file is a running list of open architecture questions the user has raised but explicitly does not want decided or implemented now. Each is its own topic below._

## 1. List Type doesn't do what users expect; item type may need to own this instead

### Status
Deferred — 2026-09-06. Not decided, not implemented. Left for GPT ASTRA to figure out.

### Context
User report: they changed the "Wish List" list's Type from "Reference / someday" to "Shopping / things to buy", expecting the items already in that list to become Purchases. They didn't. Nothing broke — this is working as designed, per an earlier confirmed decision: List Type only supplies `defaultItemType`, a **soft default** that pre-fills the itemType of items newly moved into the list; it never rewrites items already there, and an explicit itemType always wins (see [[0001-lists-become-real-entities]]). The design is sound but the UI gives no indication anywhere that changing a list's Type is forward-only, not a retroactive relabel. From the user's side this reads as a bug.

Compounding it: "Someday" is three different overlapping things in this codebase today:
1. A `Burner` value (`"Unsorted" | "Front Burner" | "Simmering" | "Back Burner" | "Someday"`) — the original prioritization model the app (Burner Board) is named after.
2. One of the eight `ITEM_TYPES` values.
3. Folded into the "reference" List Type's display label, "Reference / someday" (`LIST_TYPES` in `lib/board-types.ts`).

A user setting a list's type or an item's type runs into "someday" meaning three unrelated things depending on which control they touched. The user's exact words: "what the fuck even is 'someday' that's confusing."

### The user's proposed direction (not yet a decision)
Given both of the above, the user is now questioning List Type as a concept at all:

- A list should just be a plain container for tasks. Creating a new list should default straight to a general list, no type picker up front.
- The thing that carries "kind of thing this is" should live on the **item** (itemType: Task/Goal/Reminder/Event/Purchase/List item/Someday/Reference), not the list.
- Further: when an item's type is something other than a plain Task, the user is leaning toward it not living inside a general list at all — instead surfacing in its own dedicated area, the way Events were just pulled out to a dedicated Calendar page this session, and the way Goals now have a dedicated Goals page that shows every goal regardless of any list's visibility setting.

This would generalize a pattern that already exists in inconsistent, partial forms:
- **Event** — hard-excluded from every list unconditionally (`belongsToList()` in `lib/list-behavior.ts` returns `false` for any Event, full stop), with its own Calendar tab.
- **Goal** / **Purchase** — soft per-list show/hide toggle (tri-state, default from a global Home setting), still eligible to live inside a regular list when shown; Goal additionally has a dedicated Goals tab that always lists every goal regardless of the toggle.
- **Reminder** — has its own tab, but is not excluded from general lists the way Event is.
- **Task**, **List item**, **Someday**, **Reference** — no special placement at all today.

Three different behaviors for "what happens to a non-Task item type" is itself part of the confusion.

### Why this isn't being decided now
This is a real architecture question, not a bug fix: removing or de-emphasizing List Type touches list creation (`NewListCard`), list management (`ListManagePopover`'s "List type" field and its tri-state toggles), `createList`/`updateList` validation in `lib/server/board-store.ts`, and the placement rules in `lib/list-behavior.ts`. It also has to reconcile with the visibility toggles and Goals page shipped this same session — those assume lists keep a Type. Deciding this properly needs its own pass, not a reactive patch on top of a bug report.

### Open questions for that pass
- Remove List Type outright, or just de-emphasize it (default silently to "general" on creation, move the picker into an "advanced" corner of Manage)?
- Does the Event-style hard exclusion generalize to Reminder and Purchase too, or does Goal/Purchase keep the softer per-list toggle shipped this session? Should the three placement behaviors converge on one rule?
- If an item's type change (e.g. Task → Event) auto-evicts it from its current list, what happens to `item.collection` — cleared to null, or left as inert metadata?
- Should "Someday" be renamed or split to remove the Burner/itemType/list-type-label collision, independent of whatever happens to List Type itself?

### Consequences of leaving this open
- List Type will keep looking like it should retroactively reclassify items when it only pre-fills new ones, until either the UI explains the soft-default behavior or the type concept is removed as proposed.
- The "Someday" naming collision (burner status vs. item type vs. list-type label) stays confusing until addressed on its own or as part of this.

## 2. Notion vs. Cloudflare D1 as the system of record

### Status
Deferred — 2026-09-07. Not decided, not implemented. Left for GPT ASTRA to figure out.

### Context
The end goal for this project is for an AI (ChatGPT, Claude) to have easy, direct access to the task data — possibly through a custom MCP server, possibly through something else; the user hasn't settled on the mechanism yet. They note that both ChatGPT and Claude already have solid off-the-shelf Notion access (this very session has `mcp__claude_ai_Notion__*` tools available out of the box), which is a point in Notion's favor. But Cloudflare also offers database hosting (D1, already in use here) and Workers can host a custom remote MCP server directly, which is a point in D1's favor. The user is still figuring out which way this should go and asked for the tradeoffs written down rather than decided now.

**Where things actually stand today**, for whoever picks this up:
- Notion is the original/primary data source for items that predate this app. D1 mirrors items via sync: `syncNotion()` pulls pages in, and per-field edits attempt to push back immediately via `patchNotionItem()` (`lib/server/board-store.ts`).
- A growing set of data is **D1-only and has no Notion equivalent at all**: the `lists` table and everything hung off it (type, per-field visibility, `pinned`/`rule`/`itemSort`/`showPurchases` preferences), Groups (`group_id`), and the new global visibility/home_visibility settings — see [[0001-lists-become-real-entities]] and [[0002-groups-and-tags-are-separate]]. None of this round-trips to Notion; it can't without adding matching Notion properties/databases, which nothing here does.
- Sync reliability is already a known weak spot independent of this question: there is no bulk "retry pushing dirty items to Notion" mechanism today (`dirty` flag exists per item, but nothing sweeps and retries it). At the time this was written, Todoist had an equivalent retry queue (`syncTodoistQueue`) that Notion lacked — Todoist was removed entirely later this same session, so that comparison point no longer applies, but the underlying gap (no Notion dirty-item retry) is still unaddressed.

### Considerations (not a recommendation)
**Staying on Notion:**
- Users already get Notion's mobile/desktop apps and whatever habits/workflows are built around them, for free.
- Both major AI assistants already have mature, first-party Notion access — nothing to build there.
- Costs: every new Burner-Board-specific concept (Lists as entities, Groups, per-list preferences) needs either a matching Notion property (schema surgery on both ends) or stays permanently local-only and silently drifts from what's visible in Notion itself. The existing dirty-item retry gap makes two-way sync reliability an open problem, not a solved one.

**Moving to Cloudflare D1 as the sole system of record:**
- It's already the live store for everything the app actually renders — Notion data flows *into* it today, not the other way around for most of the newer features.
- No schema-mapping tax going forward: new features (like everything shipped this session) already work this way by necessity.
- Cloudflare has official support/templates for hosting a remote MCP server directly on Workers, which lines up with the "AI has direct access" end goal and would be fully custom-controlled.
- Removes the two-way-sync reliability problem entirely by removing the second system it's a problem between.
- Costs: loses Notion's existing mobile/desktop apps and any workflows built around using Notion directly, unless Burner Board itself becomes the sole daily-use surface. Building and maintaining a custom MCP server is real, ongoing work versus Notion's MCP support already existing.

**A third option worth naming, not deciding:** the app is already a hybrid (Notion for legacy/synced items, D1-only for everything Burner-Board-specific). That hybrid could simply continue and deepen — e.g., D1 stays the system of record for anything without a Notion equivalent (already true) while Notion sync is kept, improved (fix the dirty-item retry gap), or scoped down, rather than an either/or migration.

## 3. The create/edit task view is overwhelming; likely needs a database schema revamp

### Status
Deferred — 2026-09-07. Not decided, not implemented. Left for GPT ASTRA to figure out, including whether AI belongs in the solution at all.

### Context
The user pasted the full task editor (`EditorSheet` in `app/board-app.tsx`) for one plain Task ("give cat flea medication") and called it overwhelming: "creating metadata for a single task is ridiculous." The fields on screen for one task, at the time this was written: a Show-in-Todoist switch (Todoist was removed entirely later this same session, so that specific field is gone, but the count below is otherwise still accurate), an Importance/priority slider with a written guide (0 = list/goal, 1–3 later, 4–7 next, 8–10 now), Status, Collection, Item type, Due date, Scheduled date, Date rule, (conditionally) Repeat and Reminder time, Energy, Context (multi-select chips: Computer/Phone/Errands/Home/Anywhere), Area, Project, Goal, Notes, "Mark active now", and Starred. That's roughly 15 fields for a single task, all present at once regardless of whether the task needs any of them.

This is the same underlying tension as topic 1 above (List Type vs item type): the schema has accreted a field for every feature added over time, and the editor just renders all of them. A redesign of task creation/editing will likely require deciding which fields are core (shown always), which are contextual (shown only when relevant — e.g. Repeat/Reminder time already only appear for Reminder/Event), and which should be inferred/suggested rather than manually set — which in turn likely means restructuring how those fields are stored, not just how they're displayed.

### What the user is considering
- Using an AI system to reduce the manual field-filling burden — auto-sorting a new task, suggesting an existing list it belongs in or proposing a new one, and by extension possibly suggesting other fields (type, area, project, tags) from the task's text.
- Two specific Obsidian plugins as inspiration/prior art, both present locally at the project's parent folder: `smart-connections` and `smart-lookup` (`C:\Users\maste\Desktop\Todo-List-Back-Burner Project\smart-connections` and `...\smart-lookup`). These do semantic/embedding-based note linking and lookup inside Obsidian's vault graph — the analogous idea here would be semantic matching between a new task's text and existing lists/tasks, rather than exact keyword matching.
- Hard constraint: whatever AI model is used must not cost the user money to run.

### What already exists in this codebase (don't rebuild from scratch)
`lib/organizing.ts` already implements a **free, non-AI, keyword-based** suggestion engine used today only by Organize Mode's one-at-a-time triage flow, not by task creation or the main editor:
- `suggestLists()` — scores every list against a new item's title/notes/tags using list-name word overlap, a small hardcoded keyword-category table (groceries, career, health, sports, bills, wishlist, coding), and word-overlap similarity to existing items already in each list; returns the top 3 matches with a human-readable reason and any tags to carry over.
- `suggestedType()` — maps a list's type/defaultItemType to a suggested item type.
- `suggestedDate()` — regex-based date inference from a title ("tomorrow", "today", an explicit `YYYY-MM-DD`).

This is real prior art for "suggest a list / infer fields without a paid model" and already ships in production. Whether ASTRA's answer is to extend this lexical approach, replace it with embeddings (Cloudflare Workers AI has free-tier text-embedding models that would run inside the same Workers/D1 infrastructure already in use, avoiding a new hosting dependency), or do something closer to the Obsidian plugins' approach is an open question — but it should start from what's already here rather than a clean-slate design.

Separately, the user asked earlier in this project (not yet answered in depth) whether the `smart-connections`/`smart-lookup` Obsidian plugins themselves could be used for automated indexing and tagging. That question is still open and should be folded into this same design pass rather than answered twice.

### Open questions for that pass
- Which of the ~15 current task fields are essential at capture time vs. edit-later-if-needed? (Quick-capture today only asks for a title — this question is about the *editor*, not initial capture.)
- Does a schema revamp mean fewer/consolidated columns, a more flexible schema (e.g. structured metadata as JSON, similar to how list preferences already live in `app_meta` rather than dedicated columns), or just a UI reorganization on top of the existing schema?
- If AI-assisted suggestion is adopted, is it opt-in per task, always-on with an override, or something like Organize Mode's existing accept/skip/undo flow extended to task creation itself?
- What's the actual zero-cost AI option: Cloudflare Workers AI's free tier (same infra, no new vendor), reusing whatever AI subscription the user already has access to some other way, or staying fully lexical/rule-based like `lib/organizing.ts` already is?
- Does this redesign fold in or depend on the List Type vs item type decision (topic 1) — e.g. if item type becomes AI-suggested, does list type still need to exist as a separate manual field at all?

### Consequences of leaving this open
- Task creation/editing stays as overwhelming as it is today until this pass happens.
- Any interim, smaller UX fixes to the editor (e.g. collapsing sections, hiding rarely-used fields) risk being throwaway work if the eventual answer is a schema revamp rather than a display change — worth keeping in mind before investing in small polish here.

## 4. Remove the Archive feature — its purpose is unclear, especially now that Delete exists

### Status
Deferred — 2026-09-07. Not decided, not implemented (explicitly: the user asked to document this rather than build it this pass).

### Context
The user doesn't know what Archive is for or why they'd use it: "i don't know what it's for or what it could be useful for." This is worth taking at face value rather than assuming it's just unfamiliarity — Archive's original purpose was a soft, recoverable removal (see the "Archived" status, the `in_trash: true` Notion patch, and the separate "Archived" sub-tab under Finished). But a real hard-delete (`deleteItem`, shipped this session) now exists and covers the same need more directly — trash the Notion page, then remove the local row entirely. Archive sitting alongside Delete as a second, softer "remove this" action may itself be the source of the confusion: two mechanisms for "get this out of my way," one recoverable and quiet about it, one final. The user may simply not need the recoverable one.

Removing it isn't a one-line change: `"Archived"` appears in roughly 15 places across `app/board-app.tsx` and `lib/server/board-store.ts` — it's `STATUSES[3]`, and nearly every "is this task done/finished" check in the codebase reads `["Done", "Archived"].includes(item.status)` rather than checking `"Done"` alone (list membership in `belongsToList`, the productivity/Finished tab's two sub-tables, sort comparators, stats counts). There are also 5 real items with `status = "Archived"` in the local database today (checked directly; production wasn't checked but is presumably similar) — any removal has to decide what happens to those, not just stop offering the option going forward.

### Open questions for that pass
- Remove "Archived" as a status entirely (existing archived rows would need to become something else — reassigned to "Done", to "Not started", or left as an orphaned status string nothing filters for specifically), or keep the status internally (e.g. for `deleteItem`'s Notion-trash step, which currently works by calling `updateItem(id, { status: "Archived" })` before deleting the row) while just removing the user-facing Archive button/tab/status option?
- If Delete is meant to fully replace Archive, should `deleteItem` stop going through an intermediate status change at all and just call the Notion-trash request directly?
- Is there a reason to keep *any* soft/recoverable removal, or does the user actually want exactly one "get rid of this" action (Delete) and nothing softer?

## 5. Add a visible, sortable "task created" date

### Status
Deferred — 2026-09-07. Not decided, not implemented.

### Context
The user considers this important and currently missing: "the date a task was created and the ability to sort for that." Today `BoardItem` has no created-date field at all — only `updatedAt` (a DB timestamp that changes on every edit, not the original creation moment) and `lastInteraction` (explicitly bumped by the "Mark active now" action and a few other touches, also not creation). Notion likely already has a native "Created time" property on each page that isn't currently pulled into Burner Board at all.

### Open questions for that pass
- Backfill strategy for existing items: pull Notion's native created-time property during `syncNotion()` for items that already exist there, and use the DB row's own creation moment for anything Burner-Board-native (`local_...` ids)?
- Where does it show — a column in `TaskRow`/`TaskTable` (adds to the same "too many columns" pressure noted in topic 3), the `EditorSheet`'s existing `record-meta` line (`Attention N · N days stale · Last active ...`), or both?
- Sort integration: does it become another `ListItemSort` option (alongside priority/attention/due/title/updated in `lib/list-behavior.ts`) or a separate top-level sort control?

## 6. "Active" quick-action vs. a "Today" list — possibly redundant signals

### Status
Deferred — 2026-09-07. Raised, then the user immediately flagged it as an open design question rather than a clear removal: "actually this also might be a question for astra the difference between a user selecting 'active' on a task vs what my actual setup is right now, i have a 'today' list."

### Context
Today there are at least two different ways a task can be marked as currently relevant: the "Active" quick-action button (`TaskRow`'s quick-toolbar and the EditorSheet's "Mark active now", both just set `lastInteraction` to the current time) and moving/assigning a task into a "Today" list (a `pinned` list with `rule` typically `"manual"` per this session's list-behavior work, or `"today"` if that rule is used). `lastInteraction` also already drives `needsOrganization()`'s definition of "does this task need triage" indirectly via Organize Mode, and is read (but not shown) in the editor's `record-meta` line. It's not obvious to the user what marking something "Active" is supposed to mean or accomplish that having a Today list doesn't already cover.

### Open questions for that pass
- Are "Active" and "in a Today list" meant to answer different questions (e.g. "I touched this recently" vs. "I plan to do this today"), or is one actually redundant with the other in practice?
- If "Active" stays, should it feed into the attention/urgency score (see topic 7) rather than being a no-visible-effect timestamp bump?
- If it goes, does anything else depend on `lastInteraction` being updated by user action specifically (as opposed to only being touched by edits)?

## 7. Configurable priority/attention weighting, an "ignore" (postpone) action, and the scoring system that already exists

### Status
Deferred — 2026-09-07. Not decided, not implemented. The user was explicit this is a brainstorm to document, not a build: "just make note of the conversation."

### Context
The user likes the priority slider and wants more control over how urgency is computed: "adding customization for the weights of the priorities. like should due dates be stronger or weaker?" They also proposed an "ignore" action — pushing off a task when first seeing it should itself raise that task's priority/attention over time, so repeatedly deferring something makes it harder to keep ignoring.

**What actually computes urgency today, for whoever picks this up:** `attentionScore` and `stalenessDays` are not computed by Burner Board at all — they're pulled read-only from Notion properties ("Attention Score", "Staleness (days)") during `syncNotion()`, meaning whatever formula produces them lives outside this codebase entirely (a Notion formula/automation, not something ASTRA can tune here without either reimplementing it locally or leaving it as an opaque external input). What Burner Board *does* compute locally is `effectiveAttention()` (`app/board-app.tsx`): a hardcoded due-date-proximity step function (overdue → 75, due today → 60, tomorrow → 50, within 3 days → 42, within a week → 32, within two weeks → 20, else → 0), taken as the max against the Notion-supplied `attentionScore`. `attentionHeat()` then takes the max of `priority * 10` and `effectiveAttention()`. None of these numbers (the due-date step table, the priority multiplier, how the two combine) are user-configurable today - they're all fixed constants in one function.

There's also unused infrastructure already in the data model that's directly relevant to the "ignore raises priority" idea: `lastNudge` and `lastInteraction` are both stored per item (and `lastNudge` is even pulled from a Notion "Last Nudge" property), but neither is currently read by any local computation or shown in the UI — they're pure passthrough today. This suggests either a prior design intent for a nudge system that was never finished locally, or a Notion-side automation that already does something with `lastNudge` independent of this app.

### Open questions for that pass
- Does weight customization mean exposing the due-date step table and priority multiplier as user-editable settings, or something more general (a formula the user can actually author)?
- Does an "ignore" action write to `lastNudge`, or introduce a new field/counter? Does it decay, or only escalate?
- Should Burner Board start computing attention/staleness locally (taking over from whatever Notion formula currently does it), or keep treating Notion's number as an input and only layer local adjustments (like `effectiveAttention()` already does) on top?
- Interacts directly with topic 6 above: if "ignore" raises urgency, should the "Active"/"Mark active now" action lower it (the opposite gesture), rather than being a no-effect timestamp bump?

## 8. "Let AI decide for you" / "let AI plan your day"

### Status
Deferred — 2026-09-07. Not decided, not implemented.

### Context
The user wants an optional AI-driven planning nudge for people who don't want to rely on their own judgment about what they'll actually get done: "a feature that says 'let ai decide for you' or 'let ai plan your day' for if the user really wants that extra nudge instead of fully relying on whether or not they will believe they would finish a task." No shape was specified (a ranked list, a subset of today's tasks, a generated schedule, etc.) - this is a raw feature idea, not a spec. It shares the same "free/zero-cost AI model" constraint already recorded in topic 3, and the same starting point (`lib/organizing.ts`'s existing lexical suggestion engine) is relevant prior art for whether this needs a real AI model at all or can start rule-based.

## 9. Product vision: less manual data entry, AI does the organizing, proactive nudges

### Status
Deferred — 2026-09-07. This is the user's own framing of what the app should fundamentally be, given as context for ASTRA rather than a specific build request.

### Context
The user's assessment of the app as it stands today, in their own words: "i like the priority slider, i like the look of the website, but it really is is a lot. its trying too hard to be what it is not ready for in my opinion... creating new tasks is a pain in the ass and everything doesn't have a lot of user empathy right now." Their stated vision for what Burner Board is actually for: "easily holding your ideas and tasks you've been putting off, and then ai comes in to help break those tasks apart, group your tasks, sort and organize... So far the user has to do a lot which is not what im looking for." They also want proactive resurfacing of neglected tasks: "the app would give you nudges like hey remember this task you wanted to do this long ago and haven't interacted with for so long? yeah you should probably get on that."

This is the umbrella that topics 3, 7, and 8 above all sit under - an overloaded manual editor, no AI assistance in capture/organizing, and no proactive nudging are three symptoms of the same underlying gap. Pieces already exist that point toward this vision without fully realizing it: Organize Mode's one-at-a-time triage with free keyword suggestions, Groups (manual hard-merge, not AI-driven), and the dormant `lastNudge`/`lastInteraction`/`stalenessDays` fields noted in topic 7 that look like they were meant to support exactly this kind of nudging but currently do nothing locally.

### Open questions for that pass
- Whatever ASTRA decides for topic 3 (task view overload) and topic 8 (AI-assisted planning) should probably be designed against this vision statement directly, rather than as isolated features - the user is describing a shift in where the *work* of organizing happens (from the user, to the app/AI), not just a UI polish pass.
- What would "nudges for neglected tasks" look like concretely: a Home widget (similar to the Upcoming-due-dates widget already shipped), a notification, a dedicated view, or something that surfaces inline wherever the task would normally appear?
- Same zero-cost AI constraint as topics 3 and 8 applies throughout.

## 10. Full AI-assisted planning, notifications, and workspace-cleanup vision (elaborates topics 3, 7, 8, 9)

### Status
Deferred — 2026-09-07. The user's own words, given as the authoritative elaboration of topics 3/7/8/9 above, explicitly to hand off to GPT ASTRA for planning — not a build request this pass.

### Context
The user's full framing lives verbatim in `docs/adr/local/ai-assisted-planning-vision.md` (gitignored, not for git — see `docs/adr/local/README.md` for the convention). What follows is the structured summary for ASTRA.

**Runtime constraint, stated concretely for the first time:** the AI implementation must run on the user's existing ChatGPT Plus and $20/mo Claude subscriptions, not metered API billing. The user's own proposed mechanism: a custom MCP server, so their subscription chat clients (not API keys) do the actual reasoning work by connecting to this app's data as an MCP tool provider. This directly sharpens topic 2 (Notion vs D1): whichever store wins needs to be reachable as an MCP server from a subscription-based chat client specifically, not just from a coded backend calling a paid API.

**Core loop the user wants**, illustrated with their own worked example ("I gained fat, don't know whether to bulk or cut"):
1. User states a goal/problem in their own words, optionally attaching files or freeform context, and characterizes it as long-term (slow, ongoing) or short-term (quick to finish) — no due date required up front.
2. AI does not assume missing information — it asks clarifying questions using the existing `/grilling` / `/grill-me` skills, per explicit user instruction: "the ai will not make assumptions and instead use skills for example '/grill-me' or '/grilling' to get important information."
3. Once enough context exists, AI proposes a plan: breaks the goal into subtasks/milestones, suggests due dates informed by context (e.g. "your week doesn't look busy, let's get started"), and can suggest filing the task into an existing list ("this table already exists, let's put this in there") or creating a new one. The user reviews and can push back — final say stays with the user: "the ai will make suggestions, how does this plan sound for you?"
4. AI tracks adherence over time: pushed-back/snoozed due dates and missed check-ins are recorded and surfaced back to the user ("i haven't made progress, is this still a priority?"), and the plan adapts.
5. Recurring daily/weekly/monthly summary check-ins — explicitly called out as a setup priority: "a way for my ai from my subscriptions to send me notifications and say yes this is what you need to get done, this is what your week is looking like, your week looks empty."

**Scoping mechanism to control AI usage/cost:** the user explicitly does not want AI running over the entire database at all times: "i dont want it to always be active on everything otherwise itll use all my usage limits for claude and chatgpt subscriptions." Their proposed mechanism: the user manually curates a bounded "active/priority" set — tasks/goals explicitly flagged as "help me with these right now" — and AI only works from that curated set, never the full unsorted backlog. This needs first-class UI support (quick, easy selection into that set), not just an existing list repurposed. The user separately proposed the same usage-conserving shape for model selection: "lower tier agents can ask the user for context and higher tier smarter agents will help with planning it out and delegating out tasks" — the same expensive-orchestrator-delegates-to-cheap-workers pattern already implemented this session for the Codex/GPT-6 Astra coding workflow (`~/.codex/astra.config.toml`: Astra delegates bounded work to cheaper Terra/Sol subagents rather than doing everything itself), grounded in the same OpenAI guide the user pointed at again here: https://developers.openai.com/api/docs/guides/latest-model.

**Workspace cleanup, a related but separate ask:** the user bulk-imported Apple Reminders, Google Tasks, and Apple Calendar into this app, and much of it lacks metadata and is unorganized — recurring monthly payments, scheduled bills, recurring events (e.g. "volleyball at rec center on Monday"), goals (e.g. "lose fat"), and networking contacts ("contact my references... to look for a better job") are all mixed together with no clear way to tell what's important. The user wants AI to suggest regrouping, propose new lists, and generally help tidy the existing mess — overlapping with topic 1 (list type) and topic 9 (product vision) but now grounded in a concrete real-data cleanup use case rather than an abstract principle.

### Existing resources to build from, not from scratch (explicit user instruction)
The user was explicit: find and reuse existing skills and source code rather than building everything new — "i know there are existing skills that do all of the stuff and delegation work so we can find those skills instead of having to make them from scratch or work off of them at least."

**A parallel planning project already exists locally, further along than anything documented in this repo's ADRs**: `C:\Users\maste\Desktop\Todo-List-Back-Burner Project\Backburner\`. It has its own README, `CONTEXT.md`, `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/COMPETITIVE-ANALYSIS.md`, `docs/OSS-CONTRIBUTIONS.md`, 4 ADRs (`docs/adr/0001`–`0004`), and detailed specs (`specs/attention-engine.md`, `capture-pipeline.md`, `goal-decomposition.md`, `nudge-engine.md`, `suggestion-box.md`, `evaluations.md`) describing almost exactly this same vision under the name "Backburner: an intelligent attention layer" — zero-friction capture, automated goal decomposition, a deterministic (non-LLM) attention-scoring engine, and an LLM-driven contextual nudge engine. **ASTRA should read that project's docs before designing anything here** — a large fraction of this design question may already be answered there.

**Candidate source repos already cloned locally** for reuse, at `Backburner\existing-projects\` (full list with GitHub URLs in `Backburner\existing-projects\repos.txt`): AllisWell, FreeTodo, Super Productivity, ADHD Planner AI, Ilseon, Open Tasks, vividvilla/todo, Vikunja, Vikunja Reminder Agent, and **SP-MCP** — an existing MCP server built for Super Productivity, directly relevant prior art for the "MCP server + subscription client" mechanism above, since it's a real, working example of the same shape.

**Candidate skills found** (via `npx skills find` this session, not installed — evaluate before adopting):
- `jwynia/agent-skills@task-decomposition` (581 installs) — goal/task breakdown, closest match to the "break goals into subtasks" need.
- `anthropics/claude-plugins-official@build-mcp-server` (5.5K installs, official Anthropic) — building an MCP server, directly relevant to the subscription-based architecture above.
- `cloudflare/skills@building-mcp-server-on-cloudflare` (3.6K installs) — MCP server specifically on Cloudflare Workers, this app's existing host.
- No strong existing skill was found for the daily/weekly/monthly summary notification piece specifically — that likely needs custom work regardless.
- `/grilling` and `/grill-me` (already available in this environment) are the user's own named mechanism for the "ask clarifying questions, don't assume" requirement — a real, working pattern already, not hypothetical.

### Cross-references
- Elaborates and largely supersedes the brief mentions in topics 3 (AI-assisted task creation), 7 (attention weighting/nudges), 8 ("let AI plan your day"), and 9 (product vision) above — those remain as the historical record of what was said first; this topic is the fuller, later elaboration.
- Directly extends topic 2 (Notion vs D1): whichever wins needs to be reachable as an MCP server from a subscription-based chat client specifically.
- The zero-cost/subscription-only AI constraint from topics 3/8/9 is now sharpened into a specific mechanism (subscription-connected MCP server) rather than a general "must be free" requirement.

### Open questions for that pass
- MCP server design: what does it expose (read/write task data as tools/resources), and how does a ChatGPT Plus/Claude subscription client actually connect to and drive it — a remote MCP server the user manually adds to their ChatGPT/Claude client, or something more automatic?
- Model tiering for the in-app AI features themselves (distinct from the Codex/Astra dev-tooling tiering already configured this session): which parts are cheap-model routine (asking clarifying questions, drafting summaries) vs. expensive-model (synthesis, planning, conflict resolution)?
- Shape of the "curated active/priority set" UI: a special reserved list, a tag/flag on any item, something else? How does it interact with existing Pinned lists and the Goals/Calendar pages?
- Shape of the adaptive due-date/snooze tracking: a new field, reuse of the existing dormant `lastNudge`/`lastInteraction` (see topic 7), or something new entirely?
- Notification delivery mechanism: `docs/PRODUCT_SPEC.md`'s existing "Future integration work" section already names Apple Reminders / Google Calendar as candidate delivery providers for reminder scheduling — does the new daily/weekly/monthly AI summary/nudge system reuse that same delivery channel, or need its own?
- How much of Backburner's existing design (attention engine, nudge engine, capture pipeline specs) should be adopted wholesale into Burner Board vs. adapted vs. kept as a separate project entirely?

### Consequences of leaving this open
- This is now the single most detailed vision statement in this ADR file — any future work on topics 1, 2, 3, 7, 8, or 9 should probably be checked against it first rather than planned in isolation.
- The Backburner project and its cloned candidate repos exist and are directly relevant; not consulting them before designing this from scratch would be redundant, avoidable work.
