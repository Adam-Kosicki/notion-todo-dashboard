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
- Sync reliability is already a known weak spot independent of this question: there is no bulk "retry pushing dirty items to Notion" mechanism today (`dirty` flag exists per item, but nothing sweeps and retries it) — Todoist has an equivalent retry queue (`syncTodoistQueue`), Notion does not. This was flagged in an earlier review pass and is still unaddressed.

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
