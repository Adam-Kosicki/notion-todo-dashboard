> LEGACY DOCUMENTATION — archived 2026-09-07 from Backburner/docs/adr/0001-initial-architecture.md. Historical context only; original claims and instructions below are not current Burner Board requirements. Read the archive README and the active roadmap before using.

# ADR-0001: Independent Core Engine with Adapter Architecture

## Status
Accepted

## Date
2026-08-31

## Context
We evaluated whether to directly fork an existing open-source task management application (such as Super Productivity, AllisWell, FreeTodo, or Ilseon) and modify its internals or build Backburner as an independent core engine with adapter interfaces.

Requirements:
- Freedom to define domain models (Goals, Attention Scores, Reassessments) without being bound by legacy schemas.
- Ability to connect with multiple client platforms (Super Productivity, native web/desktop UI, Google Tasks).
- Strong standalone portfolio value demonstrating original system design and architecture.

## Decision
We will build Backburner as an **independent intelligent attention layer for task-management systems** (`Backburner Core`), operating as an autonomous executive-function supervisor connected to external task applications (such as Super Productivity, Google Tasks, and Microsoft To Do) via an adapter layer. 

Upstream contributions to open-source task managers will be submitted separately as standard OSS PRs whenever missing integration points are encountered.


## Alternatives Considered

### Direct Fork of Super Productivity
- **Pros**: Instant access to extensive UI features (time tracking, Jira/GitHub integrations).
- **Cons**: 20k+ stars codebase with complex legacy state; limits architectural freedom; makes Backburner look like a patched fork rather than an original system.
- **Rejected**: Modifying core application internals would entangle executive-function intelligence with UI framework concerns.

### Fork of ADHD Planner AI or Ilseon
- **Pros**: Direct alignment on ADHD/focus concepts.
- **Cons**: Both are early-stage prototypes with limited testing or custom ecosystems.
- **Rejected**: Better used as design inspiration rather than a foundation.

## Consequences
- Clean separation of concerns between intelligence (attention engine, LLM reasoning) and presentation.
- Ability to support multiple frontends (Super Productivity plugin, native quick-capture hotkey, CLI, mobile).
- Requires implementing our own persistence and core domain entities, which allows clean domain modeling.
