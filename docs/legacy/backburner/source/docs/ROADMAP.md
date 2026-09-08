> LEGACY DOCUMENTATION — archived 2026-09-07 from Backburner/docs/ROADMAP.md. Historical context only; original claims and instructions below are not current Burner Board requirements. Read the archive README and the active roadmap before using.

# Backburner Roadmap & Milestone Plan

This document defines the canonical development roadmap for Backburner. Each milestone represents a discrete vertical slice of capability with defined deliverables and explicit exit criteria.

---

## Milestone 0 — Project Foundation & Architecture

**Goal**: Establish the repository foundation, ubiquitous language, architectural boundaries, and agent governance.

**Deliverables**:
- Repository scaffold (`AGENTS.md`, `README.md`, `CONTEXT.md`, `specs/`, `docs/`, `src/`).
- Local agent engineering skill suite in `.agents/skills/`.
- Foundational ADRs (`ADR-0001` Independent Architecture, `ADR-0002` Task vs Goal Model).
- Reference repository analysis ([`docs/COMPETITIVE-ANALYSIS.md`](./COMPETITIVE-ANALYSIS.md)).

**Exit Criteria**:
- [x] All initial architecture documents, glossary, and rules established.
- [x] Relative linking rules verified across all project documentation.
- [x] Issue tracker conventions and triage roles configured.
- [x] Clean `.gitignore` protecting reference repositories.

---

## Milestone 1 — Backburner Core Domain & Persistence

**Goal**: Establish the domain model and persistence layer independently from any external task system or AI dependency.

**Deliverables**:
- Core domain entities (`Task`, `Goal`, `Project`, `Note`, `Milestone`, `Priority`, `Nudge`, `ReminderEvent`, `TaskInteraction`, `AttentionScore`).
- Relational database schema with SQLite / PostgreSQL persistence and migrations.
- Dual-priority model implementation (`user_priority` + `ai_priority` $\rightarrow$ `effective_priority`).
- Entity repository interfaces with ACID guarantees.

**Exit Criteria**:
- [ ] Core domain models strictly typed and fully documented in [`CONTEXT.md`](../CONTEXT.md).
- [ ] Database schema and initial migrations passing without errors.
- [ ] Comprehensive unit test suite exercising full domain CRUD and state transitions.
- [ ] **Zero external LLM / network dependencies** in core domain logic.
- [ ] Core can be exercised 100% offline through unit tests.
- [ ] Architecture decisions recorded in `docs/adr/`.

---

## Milestone 2 — Zero-Friction Quick Capture

**Goal**: Enable sub-2-second raw capture without demanding categories, tags, or deadlines upfront.

**Deliverables**:
- Ingestion API endpoint accepting raw text/voice strings.
- CLI capture tool (`backburner capture "..."`).
- Desktop global hotkey overlay prototype (`Ctrl+Shift+Space`).
- Local write pipeline guaranteeing sub-50ms acknowledgement.

**Exit Criteria**:
- [ ] Raw captures persist instantly to local database before any parsing starts.
- [ ] End-to-end capture latency measured and validated under 50ms.
- [ ] CLI and desktop hotkey triggers function reliably across daemon restarts.
- [ ] Unit & integration tests passing for capture ingestion endpoints.

---

## Milestone 3 — AI Classification & Goal Decomposition

**Goal**: Transform unstructured captures into typed domain entities and break long-term goals into actionable milestones and tasks.

**Deliverables**:
- Gemini Structured Output pipeline with strict Pydantic/Zod schemas.
- 4-way classifier (`Task` vs `Goal` vs `Project` vs `Note`) with implied deadline and duration extraction.
- Automated Goal Decomposition engine generating measurable milestones and recurring daily/weekly child tasks.
- Baseline evaluation benchmark datasets (`tests/evals/captures.jsonl` and `tests/evals/decomposition.jsonl`).

**Exit Criteria**:
- [ ] 100% of LLM outputs pass schema validation with zero JSON parsing errors.
- [ ] Classifier achieves $\ge 95\%$ accuracy on `captures.jsonl` benchmark suite.
- [ ] Goal decomposition produces discrete actionable tasks without creating flat 10-month checkbox items.
- [ ] Deterministic fallback policy executes when LLM is unavailable.
- [ ] ADR recorded on structured outputs and evaluation gates (`ADR-0003`).

---

## Milestone 4 — Deterministic Attention Engine

**Goal**: Calculate numerical attention scores to identify when active commitments and stale goals require user re-engagement without polling LLMs.

**Deliverables**:
- Multi-factor Attention Score calculation module:
  $$\text{AttentionScore} = S_{\text{priority}} + S_{\text{deadline}} + S_{\text{staleness}} + S_{\text{ignored}} + S_{\text{dependency}} + S_{\text{goal}}$$
- Candidate filter logic and configurable score thresholds.
- Staleness tracking based on elapsed interaction timestamps.
- Priority scenario evaluation test suite (`tests/evals/priority_scenarios.jsonl`).

**Exit Criteria**:
- [ ] Attention scoring is 100% deterministic, mathematically verifiable, and free of LLM calls.
- [ ] Unit tests verify all edge cases (overdue items, stale high-priority tasks, ignored nudge escalation).
- [ ] Execution benchmarks verify evaluation across 1,000 tasks in $< 10\text{ms}$.
- [ ] Candidate selector successfully flags only items exceeding threshold.

---

## Milestone 5 — Idempotent Nudge Engine & Re-engagement Scheduler

**Goal**: Build a robust, event-driven background service for delivering contextual check-ins, snoozing, and progressive escalation.

**Deliverables**:
- Background scheduler daemon with deterministic idempotency keys `(item_id, trigger_date, escalation_level)`.
- Missed-job startup recovery engine (handling missed alerts after system sleep/reboot).
- Contextual Gemini Reassessment prompt generator (*"Why should this reminder happen now?"*).
- Multi-tier escalation policies (`P0` continuous alarm $\rightarrow$ `P1` conversational check-in $\rightarrow$ `P2` periodic $\rightarrow$ `P3` weekly review).
- Reminder evaluation benchmark dataset (`tests/evals/reminder_scenarios.jsonl`).

**Exit Criteria**:
- [ ] Nudge state machine (`Scheduled` $\rightarrow$ `Delivered` $\rightarrow$ `Acknowledged` / `Snoozed` / `Ignored` $\rightarrow$ `Escalated`) fully covered by integration tests.
- [ ] Zero duplicate notifications under daemon restart and concurrent execution tests.
- [ ] Missed-job recovery passes clock-skew and sleep/wake simulation tests.
- [ ] Quiet-hours policy verified (no non-P0 alerts between 22:00 and 08:00).
- [ ] ADR recorded on nudge engine idempotency (`ADR-0004`).

---

## Milestone 6 — Super Productivity Adapter

**Goal**: Connect Backburner Core to Super Productivity via its Plugin API and SP-MCP interface for two-way task and notification synchronization.

**Deliverables**:
- Bidirectional adapter bridging Backburner Core with Super Productivity local tasks.
- Task synchronization service (reading active/scheduled tasks, creating decomposed subtasks).
- Task completion listener to update Backburner staleness metrics and milestone completion.
- Notification bridge surfacing Backburner nudges within Super Productivity.

**Exit Criteria**:
- [ ] Backburner Core operates with zero direct code dependencies on Super Productivity internals.
- [ ] Two-way synchronization verified (creating task in Backburner reflects in Super Productivity, and vice-versa).
- [ ] Task completion in Super Productivity updates Backburner goal progress in real-time.
- [ ] End-to-end adapter integration test suite passing.

---

## Milestone 7 — Open-Source Contributions

**Goal**: Contribute enhancements, hooks, and bugfixes upstream to the Super Productivity open-source repository.

**Deliverables**:
- Upstream issues opened for missing Plugin API capabilities (e.g. schedule metadata hooks).
- Clean, well-tested pull requests submitted to `super-productivity/super-productivity`.
- Contribution log updated in [`docs/OSS-CONTRIBUTIONS.md`](./OSS-CONTRIBUTIONS.md).

**Exit Criteria**:
- [ ] Capability validated as genuinely missing from upstream public interface.
- [ ] Upstream contribution adheres to upstream coding standards and passes upstream CI.
- [ ] Pull requests submitted, reviewed, and tracked to resolution.
- [ ] [`docs/OSS-CONTRIBUTIONS.md`](./OSS-CONTRIBUTIONS.md) updated with PR links and technical impact.

---

## Milestone 8 — In-App Suggestion Box & User Feedback

**Goal**: Provide an in-app suggestion box enabling users to submit feature requests and bug reports directly to cloud storage / issue tracking.

**Deliverables**:
- In-app feedback widget / submission modal.
- Cloud ingestion bridge (GitHub Issues API / lightweight cloud endpoint).
- Offline caching and automatic upload when network connectivity resumes.

**Exit Criteria**:
- [ ] Users can submit feedback directly in the client interface.
- [ ] Submissions successfully create labeled records on the tracking backend.
- [ ] Offline submission queue verified with network reconnect simulation.

---

## Milestone 9 — Production Hardening & CI/CD

**Goal**: Transform Backburner into a hardened, observable, portfolio-grade production system.

**Deliverables**:
- Docker containerization and `docker-compose.yml` for local and server deployment.
- GitHub Actions CI/CD pipeline (linting, type checking, unit/integration tests, evaluation benchmark gates).
- Structured JSON logging, Prometheus metrics, and health check endpoints (`/health`, `/metrics`).
- Secrets management, rate limiting, and cost-aware token budget tracking.

**Exit Criteria**:
- [ ] Full CI/CD pipeline executes green on every pull request.
- [ ] Evaluation benchmark suite runs automatically in CI with $\ge 95\%$ accuracy gate.
- [ ] Docker image builds and passes container security scan.
- [ ] Structured logs and metrics output accurately during load testing.

---

## Milestone 10 — v0.1.0 Release & Portfolio Demonstration

**Goal**: Ship the v0.1.0 release with documentation, release artifacts, and a 60-second video demo.

**Deliverables**:
- Tagged `v0.1.0` release on GitHub with release notes and changelog.
- 60-second recorded demonstration showcasing Zero-Friction Capture, Goal Decomposition, and Attention Re-engagement.
- Hosted live demo or downloadable desktop release bundle.
- Complete documentation review verifying all ADRs, specs, and architectural diagrams.

**Exit Criteria**:
- [ ] Release binaries / packages built and verified.
- [ ] Demo video published and linked in [`README.md`](../README.md).
- [ ] All milestone exit criteria across Milestones 0–9 satisfied and checked.
- [ ] Post-release retrospective documented in `docs/retrospectives/v0.1.0.md`.
