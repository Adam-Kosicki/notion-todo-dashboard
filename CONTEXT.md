# Burner Board — Domain Glossary

Burner Board is a task-triage desk layered over a Notion database: the terms below describe how
work is modeled and surfaced, not how the code implements it. For "why was it built this way,"
see [docs/adr/](docs/adr/); for "how is it built," see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Core entities

**Item**:
A single task, goal, reminder, event, purchase, or other tracked thing — one row a user
interacts with. Carries a Priority score, an ItemType, and optionally a List.
_Avoid_: Task (too narrow — an Item is not always a task), todo, entry.

**ItemType**:
What kind of thing an Item is: `Task`, `Goal`, `Reminder`, `Event`, `Purchase`, `List item`,
`Someday`, or `Reference`. Drives which fields are relevant (only `Task` uses the Priority
score) and, for `Event`, where the Item can even appear (see List, below).
_Avoid_: Category, type (ambiguous with List Type).

**List**:
A named, user-created grouping of Items — shown as a card on the Home page. A List has its own
List Type, its own field-visibility settings, and its own display rule (see Home). Deleting a
List does not delete its Items; they simply lose that List.
_Avoid_: Collection (the same concept, but that name is legacy — prefer List going forward),
folder, category.

**List Type**:
_Status: contested — see [docs/adr/0003](docs/adr/0003-deferred-questions-for-astra.md) topic 1.
Documented here as it exists today; this is not a settled design._
A classification on a List (`general`, `goal`, `shopping`, `recurring_payment`, `reference`)
that supplies *default* field-visibility for that List — e.g. whether the priority slider or
long-term-goal grouping make sense to show. A List can always override its Type's defaults.
New Lists default straight to `general` with no Type choice up front (Phase 2 of
`docs/plans/burner-board-roadmap.md`) — Type stays available afterward for anyone who wants it.
List Type never retroactively reclassifies Items already in the List, and (also Phase 2) no
longer soft-prefills an Item's ItemType when it's assigned to the List either — list assignment
changes membership only now. Whether List Type should exist at all, versus moving "what kind of
thing is this" onto the Item exclusively, is still an open question — do not treat this term as
resolved.

**Group**:
A hard bundling of several Items into one unit that moves together and shares a single combined
Priority/attention signal (the maximum across members). The first Item merged becomes the
anchor; every other member links to that same anchor. Formed by dragging one Item onto another.
Distinct from a List: a Group is a small, deliberate bundle of specific Items; a List is an
open-ended named category.
_Avoid_: Bundle, merge (merge is the action that creates a Group, not the noun for it).

## Navigation and views

**Home**:
The default landing page: Inbox, then Today, This week, and Longer, then every List as a
collapsed card. The single destination for both "what needs sorting" and "browse my Lists" —
there is no separate destination for either.

**Needs review**:
An Item still needing a first pass: `Task`-typed, no Priority, no List, no due/scheduled date.
Renamed from "Inbox" (Phase 2) for clarity — the old name collided with the unrelated
`ListRule` value `"inbox"` used by pinned Inbox-style Lists. Not a stored flag: an Item leaves
this set automatically the moment any of those fields is set. Distinct from **Unfiled**
(no List, regardless of the other fields) — both are separate filters now, where "Needs
review" used to be the only one.
_Avoid_: Inbox (the prior name for this concept — still used for the `ListRule` value and any
pinned List built on it, which is a different thing).

**Calendar**:
The dedicated page for `Event`-type Items. Since Phase 2, Events can also live in a mixed List —
Calendar is a projection (another way to find them), not their exclusive home.

**Goals**:
The dedicated page listing every `Goal`-type Item, regardless of any individual List's
visibility settings for goals. A Goal can also still appear inside a List if that List chooses
to show goals.

**Organize (mode)**:
A focused, one-Item-at-a-time triage flow: accept a suggested List/date, skip, or undo. Distinct
from the Home page's always-visible Lists — Organize is a deliberate workflow for working through
a backlog, not a place Items live.

## Status and lifecycle

**Item Archive**:
A reversible, recoverable removal of a single Item from active views. Distinct from deleting an
Item (permanent) and from an Item's `Done` status (completion, not removal).
_Avoid_: Trash, delete (delete is the separate, permanent action).

**Active**:
A per-Item signal meaning "recently touched" — bumped automatically by any save, or manually via
an explicit action. Distinct from an Item simply being in a "Today" List, which means "planned
for today" rather than "recently interacted with." Whether these two signals should be merged or
kept separate is unresolved — see
[docs/adr/0003](docs/adr/0003-deferred-questions-for-astra.md) topic 6.
_Avoid_: Touched (the prior name for this concept).

**Burner**:
The original prioritization label an Item can carry: `Unsorted`, `Front Burner`, `Simmering`,
`Back Burner`, or `Someday` — the concept the app is named after. Largely superseded by the
numeric Priority score today, but still stored and shown.
_Note_: "Someday" is overloaded — it's also an ItemType value and part of a List Type's display
label ("Reference / someday"). These are three separate concepts that happen to share a word;
don't assume they mean the same thing in a given context. See
[docs/adr/0003](docs/adr/0003-deferred-questions-for-astra.md) topic 1.

## Planning and progress (Phase 3)

**Focus**:
A user-selected set of current priorities, independent of List membership, importance, and Last
Interaction. Optionally carries a review-until date. Distinct from a Weekly commitment (below):
Focus is "what matters right now," a commitment is "what's selected for a specific time period" -
an item can be one, both, or neither, and toggling one never changes the other.
_Avoid_: Priority (the separate 0-10 score), Active (recently-touched, a different signal).

**Weekly commitment**:
An Item explicitly selected for a specific Monday-start planning week. This is the population
used in weekly completion statistics (completed/total, shown as e.g. "12/20"). Withdrawing a
commitment keeps it in the denominator - it does not shrink the ratio or get deleted, only marked
withdrawn (optionally with a reason - see Deferral, below).
_Avoid_: Due date, scheduled date (those are per-Item date fields; a commitment is a separate
selection, not implied by a date).

**Planning period**:
The generic Today / This month / This year counterpart to a Weekly commitment - the same
selection/statistics mechanism, evaluated over a calendar day, month, or year instead of a week.
An Item can be independently selected for any combination of Today/This week/This month/This
year at once; selecting or withdrawing from one never changes another's membership or completion
credit. Unlike a week, a period does not need an explicit close step before its stats are
trustworthy.
_Avoid_: Time horizon (used in early planning discussion for the same concept - "planning period"
is the term that shipped).

**Deferral**:
An explicit, optionally-reasoned withdrawal from a Weekly commitment or Planning period -
presented as "Deferred: \<reason\>" rather than a bare "Withdrawn" when a reason was given. Purely
a presentation label: a deferral does not shrink the statistics denominator, reschedule the Item,
or change any date field.
_Avoid_: Snooze, reschedule (those imply a date change; a deferral only records why something was
withdrawn from this period's selection).

**Planning timezone**:
A persisted per-owner setting (suggested initial value: America/Chicago) used to compute the
calendar boundaries of newly created weeks and periods. Changing it never reinterprets a week or
period that already exists - each one keeps the timezone it was created with, permanently.

## Scoring

**Priority score**:
A 0–10 importance rating a person sets directly on an Item (`null` = unrated). Only meaningful
for Items whose ItemType uses it (`Task`); other ItemTypes are treated as priority `0`.
_Avoid_: Importance (used in the UI label, same concept).

**Attention score**:
A per-Item urgency number. Distinct from the Priority score: Priority is what a person decided
matters; Attention score reflects computed urgency (including how soon something is due). The
two are combined, not interchangeable.

**Staleness**:
How long an Item has gone without attention, in days. A separate signal from Attention score —
staleness measures neglect, attention measures current urgency.

**Attention color**:
The visual urgency cue — a whole-row background wash, not just a marker dot — computed from an
Item's combined Priority/Attention signal, intentionally kept low-contrast so the board reads as
gently tinted rather than alarmingly colored.
