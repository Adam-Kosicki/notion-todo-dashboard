# 2026-09-03 grilling session — decisions, implementation status, and remaining backlog

This records the full outcome of the `/grill-with-docs` session run against the user's large batch of dashboard UI/UX feature requests, so work can resume without re-deriving context. Domain terms and architectural decisions also live in [`CONTEXT.md`](../CONTEXT.md), `docs/adr/0001-lists-become-real-entities.md`, and `docs/adr/0002-groups-and-tags-are-separate.md`; current user-facing behavior lives in [`PRODUCT_SPEC.md`](./PRODUCT_SPEC.md). This file is the plain-language status/roadmap view, kept current as work lands — if you're picking this up cold, read this file first.

## The original ask

The user's opening message was a large, unstructured dump of dashboard complaints and feature ideas in one go: group/merge tasks with a combined attention score; color task boxes by priority across the whole box, not just a marker; a way to delete/archive lists; a screenshot showing "long-term goals" and priority didn't make sense for lists like Grocery or a wish list; a way to manage lists (type, reminder settings, priority-slider visibility); a second screenshot showing drag-and-drop grouping with tags like "sports"; general sorting/filtering settings; and a batch of complaints about recent changes — "No date" should be a two-way toggle with a small calendar, "Touched" should be renamed "Active" and auto-update, "Quick edit" shouldn't need a separate click (should just show on hover, with a resize bug to fix), dropdowns should become selectable colored-blob buttons instead of click-through menus (with a setting to revert), and the create-new-task flow was confusing.

That got grilled into 8 concrete questions before any code was touched. The answers below are the confirmed decisions everything since has been built against.

## Decisions (all confirmed by the user unless noted)

1. **Groups vs. Tags are separate features**, not one mechanism. Group = hard merge with a combined attention score, moves as a unit. Tag = soft filterable label, items stay independent. (ADR 0002)
2. **Priority coloring = subtle background wash on the whole box**, not colored text. Text stays neutral for legibility.
3. **Lists: delete only, no archive tier.** Deleting a non-empty list warns the user and reassigns its items to no-list rather than deleting the items. Completed-task tracking is unaffected — it's the existing separate "Finished" tab. (ADR 0001)
4. **List field visibility (priority slider, "Long-term goals" section) is List-Type-driven with a per-list override.** Replaces the hardcoded "every list except literally 'Grocery'" rule. (ADR 0001, CONTEXT.md "List Type")
5. **"Active" (renamed from "Touched") keeps its manual button** *and* auto-updates on any real edit.
6. **Quick-edit toolbar: all actions visible on hover, no overflow menu.**
7. **Dropdown → colored-blob pills: a per-picker setting**, not one global toggle. Each picker (list, type, tags, sort, filters, quick-add) gets its own switch between blob-style and native dropdown, in a settings page.
8. **Create-task flow is confusing mainly because of the multi-click dropdown tax** (open dropdown, then select, repeated per field). The user wants to experiment with alternatives rather than lock in a design now — this is exactly what decision 7's per-picker toggle is for. No final layout has been decided.

## What happened to the two missing screenshots

The user referenced two images that never actually arrived in the original session: (a) a list showing the nonsensical "long-term goal"/priority setup, and (b) a drag-and-drop grouping mockup with tag labels like "sports." Neither ever got resent. Both ended up resolved without them:

- (a) was independently diagnosable straight from the code — the exact hardcoded bug (`name !== "Grocery"`) was found and fixed as part of Lists.
- (b) was resolved through two direct follow-up questions instead (combined-score formula, display model — see Groups below) plus reusing the app's *existing* drag-and-drop mechanic (dragging a row already moved it between lists; merging just extends that same interaction to "drop onto another row" instead of "drop onto a list").

Net: the missing screenshots are no longer a blocker for anything. Don't wait on them.

## Implementation status

**Done and verified** (built, tested against real or disposable test data, deployed live):

- **Priority/attention background wash** — subtle whole-row gradient by attention color, not just the marker dot (`app/globals.css`).
- **"Touched" → "Active" rename**, everywhere (toolbar button, EditorSheet "Mark active now" / "Last active"). Auto-updates on any save (was already server-side behavior; only the label needed to change).
- **Quick-edit reveals on hover** — the separate "Quick edit" click button and its `quickOpen` state are gone; the inline form uses the same hover-CSS pattern as the rest of the toolbar.
- **Resize bug fixed** — `.quick-editor-inner` had a hardcoded 5-column grid needing ~750px, but the "This week"/"Longer" dashboard panels are only 420–500px wide, so fields were overflowing on 2 of 3 dashboard columns essentially always. Now `repeat(auto-fit, minmax(120px, 1fr))`.
- **Date two-way toggle** — `DateQuickPopover` (shadcn `Popover` + `Calendar`) replaced the old one-way "No date" button. Shows "Add date" when unset (opens a small calendar to set one) or the date itself when set (same popover, pre-filled, with Clear). Verified working via a real `DragEvent`-equivalent test — the earlier "won't open" report during development was an artifact of the browser-automation tool double-firing clicks, not an app bug.
- **Lists as a real entity** (ADR 0001) — `lists` table, List Type-driven field visibility with per-list override, full manage UI (rename/retype/toggle/delete) from a gear icon per list card, 16 of the user's real lists auto-classified on first load.
- **Tags** — independent multi-select field, colored blob-pill picker (click to toggle, type to add — this is also the first working example of decision 7's blob-pill pattern), Notion multi-select sync (fails gracefully if the property doesn't exist yet in the user's Notion database).
- **Groups** (ADR 0002) — `group_id` self-referencing anchor column, drag-one-row-onto-another to merge, collapses to one row with an "N tasks" badge and combined score = max of members, expands to show full interactive member rows, per-member Unlink and whole-group Disband. Scoped to the `TaskTable`-based views (Today/This week/Longer/Prioritize/Reminders/Finished); Lists+goals still shows members individually — a deliberate v1 cut, not a bug.
- **Cloudflare deployment** (not part of the original ask, but happened in the same work stream) — live at `https://site-creator-vinext-starter.adamjkosicki.workers.dev`, D1 database `burner-board-db`, protected by a Cloudflare Access application restricted to the user's email via the built-in "Login with Cloudflare" identity provider. See `CLAUDE.md` for the git/deploy conventions this established (split commits by feature, pre-commit secret scan, local-dev PATH quirks). Workers Builds (Git-connected auto-deploy on push to `main`) was attempted but never confirmed connected — check `GET /accounts/{id}/builds/workers/site-creator-vinext-starter` before assuming pushes auto-deploy; as of the last check it still 404s ("no build configuration found"), meaning deploys are manual (`vinext build` + `wrangler deploy --config wrangler.deploy.jsonc`) until that dashboard connection is actually completed.

**Not started** (decision 7 and 8's territory, plus general polish):

- **Dropdown → colored-blob pills everywhere else.** Tags proved the pattern works; the List-type picker, sort controls, and other native `<select>`s haven't been converted, and there's no settings toggle yet to switch a picker between blob-style and dropdown per decision 7.
- **Settings page** to hold that per-picker toggle (and anything else that accumulates a "let the user configure this" need).
- **Sorting/filtering controls** beyond what already exists implicitly per view — no tag filter in the filterbar despite the tag vocabulary already being derived (`allTags` in `board-app.tsx`), no general sort-order control.
- **Create-task flow redesign** (decision 8) — genuinely still open. The user wants to *experiment* with alternatives rather than have one prescribed first, which likely means: build the per-picker blob/dropdown toggle (decision 7) first, then let the user try the quick-add flow with blobs and iterate from there, rather than designing a whole new create-task UI from scratch up front.

## One environment note worth keeping

Node/npm are not on this machine's default PATH. A working install lives at `D:\DevOps`, added to `~/.bashrc` / `~/.bash_profile` (`export PATH="/d/DevOps:$PATH"`) for Git Bash. The dev server has to be started by invoking `./node_modules/.bin/vite` directly (with `WRANGLER_LOG_PATH` set via a real env var) rather than `npm run dev`, because that script sets an env var using POSIX syntax that Windows' `cmd.exe` — npm's default script shell — can't parse. Full details, plus the Cloudflare/D1/deploy-specific environment notes, are in `CLAUDE.md`.
