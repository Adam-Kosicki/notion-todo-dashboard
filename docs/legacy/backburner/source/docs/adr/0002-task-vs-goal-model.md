> LEGACY DOCUMENTATION — archived 2026-09-07 from Backburner/docs/adr/0002-task-vs-goal-model.md. Historical context only; original claims and instructions below are not current Burner Board requirements. Read the archive README and the active roadmap before using.

# ADR-0002: Explicit Separation of Tasks, Goals, Projects, and Notes

## Status
Accepted

## Date
2026-08-31

## Context
Standard todo applications treat all inputs as flat checklist items with a single boolean `is_completed` state. When users input long-term or complex aspirations (e.g., "Gain 15 pounds", "Apply to grad school"), they remain perpetual checkboxes, leading to psychological fatigue and list abandon.

Conversely, notes or reference material ("Gemini Pro rate limits") pollute the task view if treated as actionable todos.

## Decision
We introduce a 4-way polymorphic Item classification in Backburner's domain model:
1. **Task**: Single actionable unit of work with clear completion criteria.
2. **Goal**: Desired outcome over a horizon with quantifiable targets, decomposed into milestones and child tasks.
3. **Project**: Multi-task initiative with explicit scope and deliverables.
4. **Note**: Passive reference information requiring no completion state.

Goals are never displayed as flat daily checklist items; only their decomposed active child tasks are surfaced on the user's daily dashboard.

## Consequences
- Prevents list clutter and "checkbox fatigue".
- Enables structured AI decomposition workflows (prompting the user for target metrics, milestones, and routine actions).
- Requires a hierarchical relational schema supporting parent-child associations across Goals, Milestones, and Tasks.
