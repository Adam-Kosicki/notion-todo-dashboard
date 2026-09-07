# Architecture

How Burner Board is actually built. For product/UX rules see [PRODUCT_SPEC.md](PRODUCT_SPEC.md);
for domain terms see [../CONTEXT.md](../CONTEXT.md); for why a given decision was made see
[adr/](adr/). This file is implementation-level only — if you're duplicating one of those docs,
cut it and link instead.

## Stack

- **vinext** (`vinext` package) on **Vite 8** + **React 19** + **TypeScript**, using the Next.js
  App Router file convention (`app/page.tsx`, `app/layout.tsx`, `app/api/.../route.ts`) even
  though the runtime is not Next.js itself — vinext reimplements that convention on top of
  Cloudflare Workers.
- Deploys as a **Cloudflare Worker** (`worker/index.ts` is the fetch entry point) with a
  **D1** database bound as `DB`, accessed through **Drizzle ORM** (SQLite dialect,
  `db/schema.ts`). There is no `wrangler.toml`/`wrangler.jsonc` in this project — the D1/R2
  binding config is inline in `vite.config.ts` (`localBindingConfig`, fed by
  `.openai/hosting.json`), and a separate `wrangler.deploy.jsonc` covers production deploy.
- **Notion** is the only remaining external sync integration. Todoist was removed entirely in
  this session (server code, schema references, docs) — see
  [adr/0003-deferred-questions-for-astra.md](adr/0003-deferred-questions-for-astra.md) topic 2
  for the removal note. One historical trace remains by design:
  `item.source === "Todoist"` in `sourceClass()` (`app/board-app.tsx`) still colors rows
  imported from the old Todoist export — that's import provenance on old data, unrelated to the
  removed live sync, and is not a bug to "fix".
- UI components are shadcn/radix-ui primitives under `components/ui/`, styled with Tailwind 4.

## Directory map

- **`app/board-app.tsx`** (~1650 lines) — the entire client UI as one component tree, exported
  as `BoardApp`. Notable pieces: `TaskRow`/`TaskTable` (row and list rendering), `CollectionsView`
  (the Lists section of Home), `EditorSheet` (full task editor), `QuickEditor` (inline row-level
  editor), `ConnectionsSheet` (Notion connect/sync/disconnect + CSV export), `UpcomingWidget`
  (Home's due-soon widget), plus the urgency/grouping helpers described below. `BoardApp` itself
  owns all client state (no external state library) and talks to the server exclusively through
  `boardRequest()`, a thin fetch wrapper around the one API route.
- **`app/api/board/route.ts`** — the single API route. `GET` returns the full `BoardPayload`.
  `POST` dispatches on a `body.action` string (`create`, `update`, `delete_item`, `list_create`,
  `list_update`, `list_delete`, `list_reorder`, `merge_items`, `unlink_item`, `disband_group`,
  `connect`, `disconnect`, `sync_notion`, `set_visibility`) rather than exposing REST endpoints
  per resource — one route, one dispatch table, one auth check (`requireOwnerId()`).
- **`app/organize-mode.tsx`** — the one-at-a-time triage flow (`OrganizeMode`), wired into
  `BoardApp` as the "Organize" tab. Uses `lib/organizing.ts`'s suggestion engine.
- **`app/layout.tsx`** — root HTML shell and metadata only.
- **`app/chatgpt-auth.ts`** — vinext-starter-template helpers for "Sign in with ChatGPT" (SIWC).
  Partially wired up: `getChatGPTUser()` is called from `app/page.tsx` to get a display name for
  the header, but that's cosmetic only — it is not what gates access. Actual auth/ownership is
  `requireOwnerId()` in `lib/server/board-store.ts`, which reads `oai-authenticated-user-id`,
  `oai-authenticated-user-email`, or (as a fallback) the Cloudflare-Access-verified
  `cf-access-authenticated-user-email` header directly. `requireChatGPTUser()`,
  `chatGPTSignInPath()`, and `chatGPTSignOutPath()` in the same file are unused anywhere in
  `app/` — vestigial starter-template scaffolding, not dead code to worry about but also not
  load-bearing.
- **`lib/server/board-store.ts`** (~1060 lines) — the only place that touches D1 or the Notion
  API. Item CRUD (`createItem`, `updateItem`, `updateBoardItem`, `deleteItem`), list CRUD
  (`createList`, `updateList`, `deleteList`, `reorderLists`), group operations (`mergeItems`,
  `unlinkFromGroup`, `disbandGroup`), Notion integration (`connectProvider`, `disconnectProvider`,
  `syncNotion`, `patchNotionItem`), visibility settings (`getVisibility`/`updateVisibility`), and
  `getBoard()` which assembles the full `BoardPayload` sent to the client. One-time backfill
  migrations that run lazily on first request per owner (`ensureSeed`, `ensureOrganization`,
  `ensureListsBackfill`, `ensureListsSortOrder`, `ensureHomeLists`) also live here, each gated by
  an `app_meta` marker row so they run exactly once per owner.
- **`lib/board-types.ts`** — shared types: `BoardItem`, `BoardList`, `BoardPayload`,
  `EditableList`, `EditableChanges`, `HomeVisibility`, plus the `ITEM_TYPES` and `LIST_TYPES`
  constant tables.
- **`lib/list-behavior.ts`** — pure, server- and client-shared functions: `belongsToList()`
  (list membership), `listMoveChanges()` (what changes when an item is dropped into a list),
  `compareListItems()` (list sort), `reorderedListIds()` (drag-to-reorder math). No I/O, easy to
  unit test in isolation from D1/React.
- **`lib/organizing.ts`** — free, non-AI heuristics used today only by Organize Mode:
  `suggestLists()` (keyword/word-overlap scoring against list names and existing items),
  `suggestedType()`, `suggestedDate()` (regex date inference), `needsOrganization()` (Inbox
  membership test). Referenced in
  [adr/0003](adr/0003-deferred-questions-for-astra.md) topic 3 as prior art for a possible
  future AI-assisted create/organize flow — read that ADR before building anything new here.
- **`lib/sample-board.ts`** — `sampleBoard()`, a hardcoded demo `BoardPayload` used for the
  "Try sample board" flow when a user has no real data yet. Never persisted or sent to Notion.
- **`db/schema.ts`** — Drizzle table definitions: `items`, `lists`, `integrations`, `appMeta`.
  `db/index.ts` reads the `DB` binding from the Workers `env` at request time.
- **`drizzle/000N_*.sql`** — generated migrations (currently through `0007`). Applied by hand to
  local D1 with `sqlite3` against
  `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite` (back that file up first — it holds
  real data), and to production with
  `npx wrangler d1 execute burner-board-db --remote --file drizzle/000N_*.sql` (no
  `wrangler d1 migrations apply`, since there's no `wrangler.toml`). See `CLAUDE.md` for the
  full local-dev workflow.
- **`worker/index.ts`** — the Cloudflare Worker `fetch` entry point: routes `/_vinext/image`
  to vinext's image optimizer, everything else to vinext's `app-router-entry` handler.
- **`worker-configuration.d.ts`** — Wrangler-generated Worker runtime types. Off-limits unless
  the task is specifically about Worker runtime type generation (see `CLAUDE.md`).

## Data flow

- **D1 is the fast working copy the app actually reads and writes for every UI operation.**
  Every request in `getBoard()`/`updateItem()`/etc. hits D1 directly; Notion is never queried
  synchronously on the read path.
- **Notion is the long-term canonical record** for items that predate this app or that a user
  wants mirrored there. `syncNotion()` pulls Notion pages into D1 (upsert, skipping any row with
  `dirty = 1` so an unsynced local edit is never clobbered by a stale pull). Per-field edits in
  `updateItem()` attempt to push back to Notion immediately via `patchNotionItem()`
  (best-effort: on failure the row stays `dirty = 1` and the UI surfaces a toast, but the local
  save always succeeds regardless of Notion's response).
- **There is no bulk retry queue for failed Notion pushes.** A `dirty` flag exists per item, but
  nothing sweeps it and retries later — this is an open gap, tracked in
  [adr/0003](adr/0003-deferred-questions-for-astra.md) topic 2.
- **A growing set of data is D1-only and has no Notion equivalent**, because Notion's schema is
  fixed/external and `notionProperties()` (`lib/server/board-store.ts`) only maps fields that
  have a matching Notion property: Lists as entities (the `lists` table itself), Groups
  (`group_id`), and all list/global display preferences (see the `app_meta` pattern below).
  None of this round-trips to Notion — see
  [adr/0001](adr/0001-lists-become-real-entities.md) and
  [adr/0002](adr/0002-groups-and-tags-are-separate.md).
- **`getBoard(ownerId)`** (`lib/server/board-store.ts`) is the single assembly point for
  everything the client renders: it runs the one-time backfill migrations, then queries items
  (sorted by status/priority/attention/title), lists (`listLists()`), connection status,
  relation option lists (areas/projects/goals, derived from item text), visibility settings, and
  returns one `BoardPayload`. The client's `BoardApp` fetches this once on mount and then patches
  its local copy optimistically as actions succeed.

## Key patterns

### `app_meta` key-value reuse to avoid schema migrations
`app_meta` (`owner_id`, `key`, `value` — see `db/schema.ts`) is a generic per-owner JSON blob
store. Two things live there today: per-list preferences, keyed `list_preferences:<listId>`
(JSON: `pinned`, `rule`, `itemSort`, `showPurchases`), and global settings, keyed
`home_visibility` (JSON: `goals`, `purchases`). Writes use
`INSERT ... ON CONFLICT DO UPDATE SET value = json_patch(app_meta.value, excluded.value)`
(`updateList`, `updateVisibility`, `reorderLists` in `lib/server/board-store.ts`) — SQLite's
`json_patch()` merges the new object into the stored one field-by-field, and **a JSON `null` in
the patch document deletes that key** rather than storing `null`. That deletion behavior is what
lets `showPurchases` reset to "inherit the default" (see tri-state below): sending
`{ showPurchases: null }` removes the key entirely rather than writing a literal null. This
pattern exists specifically to add new list/global-level fields without a Drizzle migration —
useful for fields that are genuinely per-owner display preferences with no Notion equivalent.

**Correction to a common assumption**: `showPriority` and `showLongTermGoals` are *not* in this
JSON blob — they're real nullable columns on the `lists` table (`show_priority`,
`show_long_term_goals`), set directly with `UPDATE lists SET ... = NULL` for a reset. Only
`pinned`, `rule`, `itemSort`, and `showPurchases` live in `app_meta`. If you're about to add a
new list-level setting, check `rowToList()` (`lib/server/board-store.ts`) to see which storage
a given field actually uses before assuming it follows the JSON-blob pattern.

### Tri-state list settings (`null` = inherit, `true`/`false` = override)
`showPriority`, `showLongTermGoals`, and `showPurchases` are all `boolean | null` on `BoardList`.
`null` means "use the default"; `true`/`false` is an explicit per-list override. The defaults
differ per field:
- `showPriority`: `list.showPriority ?? listTypeDefaults(list.type).showPriority` — falls back
  to the list's Type only (`CollectionsView`, `app/board-app.tsx`).
- `showLongTermGoals`: `list.showLongTermGoals ?? (typeDefaults.showLongTermGoals && visibility.goals)`
  — falls back to *both* the list's Type default *and* the global "Show long-term goals in
  lists" toggle.
- `showPurchases`: `list.showPurchases ?? visibility.purchases` — falls back to the global
  toggle only, no per-type default.
Overriding priority to invisible also makes the UI treat that list's items as having null
priority for display purposes, not just hide the column.

### Event exclusion from regular lists
`belongsToList()` (`lib/list-behavior.ts`) unconditionally returns `false` for any item with
`itemType === "Event"`, before any other membership check runs. Events only ever appear on the
dedicated Calendar tab. This is the first (and so far only fully consistent) instance of a
broader pattern under active debate — see
[adr/0003](adr/0003-deferred-questions-for-astra.md) topic 1, which questions whether Goal,
Purchase, and Reminder should get the same hard exclusion instead of their current
softer/inconsistent treatment.

### Delete reuses Archive's Notion-trash side effect
`deleteItem()` (`lib/server/board-store.ts`) calls
`updateItem(ownerId, id, { status: "Archived" })` internally, wrapped in try/catch, purely to
trigger the existing Notion `in_trash: true` PATCH before removing the local row. A sync failure
here is swallowed on purpose — the local hard delete must succeed regardless of Notion's
reachability. This coupling is called out as a design smell in
[adr/0003](adr/0003-deferred-questions-for-astra.md) topic 4, which raises removing Archive
entirely; if that happens, `deleteItem` will need its own direct Notion-trash call instead of
routing through a status change.

### Group anchor promotion
Groups have no dedicated table — `items.group_id` does the whole job. The first item merged
becomes the anchor by self-referencing (`group_id = own id`); every other member's `group_id`
points at that same anchor id (`mergeItems`, `lib/server/board-store.ts`). Deleting the anchor
(`deleteItem`) promotes the next member to be the new anchor (or, if only one member remains,
clears its `group_id` so it reads as solo again — same logic `unlinkFromGroup` uses when
unlinking leaves a lone member). Deleting a plain (non-anchor) member just detaches that one row;
the rest of the group is unaffected. `collapseGroups()` (`app/board-app.tsx`) is the client-side
counterpart: it folds every group into one synthetic row (anchor's fields, earliest member due
date, `attentionScore` pre-baked to `max()` of members' effective attention) so every existing
urgency/sort function keeps working unmodified against the collapsed row, with real members
riding along in `groupMembers` for the expanded view.

Note: [adr/0002](adr/0002-groups-and-tags-are-separate.md) states the Lists+goals view does
*not* collapse groups (a stated v1 scope cut). That's no longer accurate — `CollectionsView`
calls `collapseGroups()` the same as every other view. This likely changed when Plan and
Lists+goals were merged into the single Home page after that ADR was written; the ADR's
"Status update" section was not revised to match. Trust the code over that note until the ADR
is corrected.

### localStorage for per-viewer display preferences
The Upcoming widget's collapsed state (`burner-upcoming-collapsed`) and screen position
(`burner-upcoming-position`, top/bottom) are the first and only use of `localStorage` in this
codebase (`UpcomingWidget` and `BoardApp` in `app/board-app.tsx`). Deliberately not synced
server-side or per-owner in D1 — this is a personal, per-browser display convenience, not shared
application data. Every read/write is wrapped in try/catch (private browsing, disabled storage)
and the state is initialized inside a `useEffect` after mount, not during the initial render, to
avoid a server/client hydration mismatch (the server has no way to know a given browser's stored
value).

### `attentionScore`/`stalenessDays` are read-only inputs from Notion, not computed locally
`attentionScore` and `stalenessDays` on `BoardItem` are pulled verbatim from Notion properties
("Attention Score", "Staleness (days)") during `syncNotion()` — whatever formula produces them
lives entirely outside this codebase (a Notion formula or automation). What Burner Board *does*
compute locally is `effectiveAttention()` (`app/board-app.tsx`):

```
overdue → 75, due today → 60, tomorrow → 50, ≤3 days → 42, ≤7 days → 32, ≤14 days → 20, else → 0
```

taken as `Math.max(item.attentionScore, dueFloor)`. `attentionHeat()` then takes
`Math.max(priority * 10, effectiveAttention())`, and `heatColor()` maps that 0–100 value to a hue
for the row's background wash. None of these constants (the due-date step table, the `* 10`
priority multiplier, how the two scores combine) are user-configurable today — they're fixed in
one function. See [adr/0003](adr/0003-deferred-questions-for-astra.md) topic 7 for the open
question of making this weighting configurable, and note the two dormant fields (`lastNudge`,
`lastInteraction`) that exist in the schema but currently drive no local computation.

### Notion is the only integration; provider is no longer a parameter
`getIntegration(ownerId)`, `connectProvider`, and `disconnectProvider`
(`lib/server/board-store.ts`) were narrowed this session to Notion only — `connectProvider`/
`disconnectProvider` now take `provider: "notion"` as a literal type rather than a general
string, since Todoist's removal left Notion as the sole integration. `ConnectionsSheet`
(`app/board-app.tsx`) reflects this: one connection card, no provider picker.

### Tags were removed; the `tags` column and field were not
The tag picker UI, its CSS, and the tag-suggestion carry-over in `lib/organizing.ts`'s
`suggestLists()` were removed this session. `BoardItem.tags`, the `items.tags` column, and the
Notion `Tags` multi-select mapping in `notionProperties()` were **not** removed — `tags` is still
read in the Home search filter (`app/board-app.tsx`, the `filtered` memo) and still round-trips
to/from Notion in `syncNotion()`/`patchNotionItem()`. In practice this means existing tag data
keeps flowing through the system with no UI left to view, set, or clear it directly (short of the
full editor's absence of a tags field). Treat `tags` as vestigial plumbing, not a live feature,
until a future pass either removes it fully or reintroduces a UI for it.

## Auth model

`requireOwnerId()` (`lib/server/board-store.ts`) is the single authorization gate, called at the
top of every API action. It trusts (in order) `oai-authenticated-user-id`,
`oai-authenticated-user-email`, then `cf-access-authenticated-user-email` — all headers injected
by the hosting layer (OpenAI Sites dispatch or Cloudflare Access) after their own verification,
never supplied by the client directly. There is no separate session/cookie system in this
codebase; identity is entirely delegated to whichever edge layer sits in front of the Worker.
All D1 tables are scoped by `owner_id` as part of their primary key.

**Phase 0 finding (2026-09-07, `docs/plans/burner-board-roadmap.md`): this trust is not verified
by this codebase itself** — no signature check, no JWT verification, no stripping logic here; if
a request reached the Worker directly, `requireOwnerId()` would accept a client-supplied header
as-is. **Confirmed live the same day**, though: an unauthenticated request to the deployed Worker
redirects to `adamjkosicki.cloudflareaccess.com` (Cloudflare Access), so in practice a forged
header never reaches `requireOwnerId()` without a valid Access session first. See
`docs/operations/data-recovery.md`'s "Identity and request authentication" section for how this
was checked.

## Testing

`tests/organizing.test.mjs` covers `lib/organizing.ts`'s pure functions directly. `npm test` runs
a full build first, then `node --test tests/*.test.mjs` (see `package.json`). There is currently
no test coverage for `lib/server/board-store.ts` or `lib/list-behavior.ts` beyond what
`tests/organizing.test.mjs` exercises indirectly.
