> LEGACY DOCUMENTATION — archived 2026-09-07 from Backburner/docs/adr/0004-nudge-engine-idempotency.md. Historical context only; original claims and instructions below are not current Burner Board requirements. Read the archive README and the active roadmap before using.

# ADR-0004: Event-Driven Nudge Engine with Idempotent Scheduling & Escalation

## Status
Accepted

## Date
2026-08-31

## Context
Proactive re-engagement requires reliable background scheduling that survives daemon restarts, prevents duplicate notifications, enforces quiet hours, and applies progressive escalation when reminders are repeatedly dismissed.

## Decision
We implement the Nudge Engine as a stateful, event-driven background service with:
- **Deterministic Idempotency Keys**: Formed from `(item_id, scheduled_date, escalation_level)` to prevent duplicate dispatches.
- **Missed-Job Recovery**: On startup, jobs missed within 2 hours are executed (respecting quiet hours); older missed jobs roll into the next evaluation cycle.
- **Explicit Escalation Policies**: Different cadences and channels mapped to item priorities (`P0` continuous alarm, `P1` conversational reassessment, `P2` periodic check-in, `P3` weekly review).

## Consequences
- Prevents notification spam, duplicate delivery, and alert fatigue.
- Provides predictable, reliable re-engagement across multiple delivery channels.
- Requires persisting full notification lifecycle states (`Scheduled`, `Delivered`, `Snoozed`, `Ignored`, `Acknowledged`).
