# Legacy Backburner context

Archived 2026-09-07. These are historical product ideas, not an alternate implementation plan.
The [active roadmap](../../plans/burner-board-roadmap.md) and
[Phase 3 completion package](../../plans/phase-3-completion-batch.md) govern current work.
Start with the [reuse handoff](../../plans/backburner-reuse-handoff.md) for implementation guidance.

## Provenance

`source/` preserves 17 selected documents from the sibling `Backburner/` directory with a
legacy banner prepended. Original bodies remain unchanged. `manifest.json` records source
paths and original SHA-256 hashes. Originals remain in place so existing references keep working.
Old ADRs remain inside this archive; they are not accepted Burner Board ADRs.
Agent rules, skill bundles, and external repositories were not imported.
Links inside original bodies retain their historical spelling; links to omitted operational
files or agent instructions may only resolve in the original Backburner directory. Use this
index for current navigation. Claims that the old roadmap is canonical apply only historically.

Backburner's `src/` contains a structure README, not an implemented attention engine to port.
The competitive analysis is an old assessment, not verified current upstream capability or
license guidance. Use the local code evidence in the reuse handoff and recheck before copying.

## Feature reconciliation

| Legacy intent and source | Fit in Burner Board | Disposition |
| --- | --- | --- |
| [Low-friction capture](source/specs/capture-pipeline.md) | Phase 2 capture without metadata or AI | Preserve the UX intent. Local-first writes, global hotkeys, voice, and automatic Gemini processing are historical proposals, not requirements. |
| [Bulk paste of the owner's text](source/docs/human/features.md) | Phase 4 selected cleanup; potentially a later bounded import preview | Explicit legacy request worth retaining. Creating many records from raw text needs a scoped extension: preserve raw text, preview splits/types, ask about ambiguity, and apply once with receipts. Current Phase 4 operations do not authorize general bulk task creation. |
| [Goals into milestones and actions](source/specs/goal-decomposition.md) | Phase 5 | Strong fit. Preserve raw goals/context, propose children for review, retain completed steps during revisions. Task completion does not prove a goal's real-world outcome. |
| [Meaningful engagement and staleness](source/CONTEXT.md), [attention scoring](source/specs/attention-engine.md) | Phase 7 briefings; richer attention policy later | Retain explainable resurfacing and human control. The old numerical weights, inferred deadlines, automatic reprioritization, and whole-database processing are not approved policy. Phase 3 Focus remains explicit selection. |
| [Reliable nudges](source/specs/nudge-engine.md) | Phase 7 opt-in briefings; external delivery later | Retain deduplication, quiet-hours questions, snooze and recovery scenarios. Aggressive alarms, exact cadences, and automatic escalation need a separate owner-visible decision. |
| Recurring actionable steps in [goal decomposition](source/specs/goal-decomposition.md) | Phase 6 | Use separate occurrences and preserved history under the current roadmap; do not implement recurring goal children early. |
| [Structured output evaluations](source/specs/evaluations.md) | Phases 4–5 and 7 | Reuse scenario categories: ambiguous captures, actionable children, context-aware tone. Re-author expected outcomes for reviewed proposals, no fabricated dates, and provider neutrality. Old 95% accuracy/latency targets have no benchmark evidence here. |
| [In-app feedback](source/specs/suggestion-box.md) | Unscheduled backlog | Useful lightweight personal feedback idea. First consider an ordinary ideas List. Dedicated ingestion, offline sync, or GitHub publishing needs its own scope. |
| [External task adapters](source/specs/adapters-super-productivity.md) | Optional later import/export | Historical architecture is superseded by D1 authority. No second database, Super Productivity dependency, or new bidirectional sync is implied. |

## Architectural differences to keep explicit

The old project proposed a separate attention layer, Python/FastAPI or TypeScript/Fastify,
local SQLite/PostgreSQL, Gemini API calls, and desktop/plugin clients. Burner Board evolves
its existing app toward D1 authority, companion Claude/ChatGPT clients, selected scopes,
reviewed proposals, and no metered AI backend by default. Read the archived
[architecture](source/docs/ARCHITECTURE.md) and [roadmap](source/docs/ROADMAP.md) as history.

The old four-kind taxonomy and dual-priority fields are not schema migrations to apply.
Preserve Burner Board's mixed item kinds, Lists, separate Groups and goal hierarchy, explicit
Focus, independent planning periods, and command/receipt/version protections.

## Coverage limits

This archive captures the product-facing Backburner docs/specs and historical ADR rationale.
It does not claim every old idea is approved or that upstream apps were exhaustively audited.
Backburner's operational contribution log and agent-workflow documents remain at their source;
they add no current product requirements. No external application code was copied.
