> LEGACY DOCUMENTATION — archived 2026-09-07 from Backburner/docs/COMPETITIVE-ANALYSIS.md. Historical context only; original claims and instructions below are not current Burner Board requirements. Read the archive README and the active roadmap before using.

# Reference Architecture & Competitive Analysis

This document details the architectural study of mature and specialized open-source productivity projects, clarifying what Backburner references, borrows, and distinctively builds.

---

## 1. Feature Comparison Matrix

| Feature | AllisWell | FreeTodo | ADHD Planner AI | Super Productivity | Ilseon | Backburner (Goal) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Tasks / Subtasks** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Notes / Context** | ✅ | Partial | ✅ Memory | ✅ | ✅ | ✅ (First-class Note) |
| **Manual Priority** | ✅ | Some | Partial | ✅ | — | ✅ (`user_priority`) |
| **AI Task Breakdown** | Partial | **✅** | **✅** | ❌ (via plugin) | Partial | **✅ Structured** |
| **Goal $\rightarrow$ Milestone Decomposition** | ❌ | Partial | Partial | ❌ | ❌ | **✅ Full Lifecycle** |
| **Proactive Check-ins & Reminders** | **✅ Alarms** | Weak | **✅** | ✅ | ✅ | **✅ Contextual** |
| **Persistent Nagging / Re-alerts** | **✅✅** | ❌ | Partial | ❌ | ❌ | **✅ Idempotent** |
| **Why-Now Reminder Timing** | ❌ | ❌ | Partial | ❌ | ❌ | **✅ Deterministic Attention** |
| **AI Dynamic Reprioritization** | ❌ | Planned | ❌ | ❌ | ❌ | **✅ Dual Priority Model** |
| **Staleness & Ignored Detection** | Rules only | Planned | Partial | Some | ❌ | **✅ Multi-factor Scoring** |
| **Conversational Reassessment** | ❌ | Partial | **Closest** | ❌ | ❌ | **✅ Gemini Evaluator** |
| **Frictionless Capture (<2s)** | ✅ | ✅ | Telegram | ✅ | **✅✅** | **✅ Global Hotkey + Single Box** |
| **Platform Maturity** | High | Medium | Low (Demo) | **Very High** | Low/Medium | Independent Core |

---

## 2. Deep Dive by Reference Repository

### 2.1 `super-productivity/super-productivity`
- **What to study**: Highly mature desktop/mobile architecture, time tracking, anti-procrastination, project/tag hierarchy, and Plugin API.
- **Our Strategy**: Build an adapter to synchronize task state with Super Productivity instead of rewriting UI from scratch. Contribute upstream PRs for missing plugin capabilities.
- **License**: MIT.

### 2.2 `FreeU-group/FreeTodo`
- **What to study**: Hierarchical task breakdown, guided questionnaire workflows, and overdue task replanning concepts.
- **Our Strategy**: Reference for goal decomposition algorithms. Avoid direct code copying due to FreeU Community License.

### 2.3 `mahirozdin/alliswell`
- **What to study**: Cross-platform urgent alarm delivery, SQLite offline sync, persistent re-alerting until acknowledged.
- **Our Strategy**: Reference for delivery layer and escalating alarm architecture. Avoid direct code copying due to PolyForm Noncommercial License.

### 2.4 `ran2207/adhd-planner-ai`
- **What to study**: Agent interaction loops, proactive check-ins (*"It's been 45 min, working on X, how's it going?"*), memory, and time-blind scheduling.
- **Our Strategy**: Proof-of-concept reference for conversational re-engagement tone and interaction design.
- **License**: MIT.

### 2.5 `cladam/ilseon`
- **What to study**: Sub-2-second quick capture UX and Idea Inbox.
- **Our Strategy**: UX benchmark for zero-friction capture.
- **License**: MIT.

---

## 3. Backburner's Unique Architectural Value

1. **The Deterministic Attention Engine**: Calculates numerical urgency without calling costly LLM loops on crons.
2. **First-Class Goal vs Task Separation**: Prevents goals from degenerating into 10-month dead checkboxes.
3. **The Dual Priority Model**: Balances explicit user intent (`user_priority`) with context-derived urgency (`ai_priority`).
4. **Contextual Reassessment**: Re-engages stale tasks with empathy and situational context rather than robotic repeating alarms.
