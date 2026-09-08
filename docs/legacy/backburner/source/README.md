> LEGACY DOCUMENTATION — archived 2026-09-07 from Backburner/README.md. Historical context only; original claims and instructions below are not current Burner Board requirements. Read the archive README and the active roadmap before using.

# Backburner 🔥

> **An Intelligent Attention Layer for Task-Management Systems**  
> *Monitors unfinished commitments and proactively decides when they deserve the user's attention again.*

---

## The Vision

Most people don't need *another* to-do list app to store checkboxes. They need an **intelligent attention layer** that sits over the tools they already use (Super Productivity, Google Tasks, Microsoft To Do) to solve two core failures:

1. **Capture Friction**: Forcing users to immediately categorize, tag, schedule, and prioritize an idea before saving it interrupts flow.
2. **Organization Friction & Task Graveyards**: Tasks and decaying goals pile up silently in lists, un-prioritized and un-actionable, until an emergency strikes.

```text
                        Backburner Attention Engine
                                     │
             ┌───────────────────────┼───────────────────────┐
             ▼                       ▼                       ▼
    Super Productivity          Google Tasks          Microsoft To Do
         (Adapter)               (Adapter)               (Adapter)
```

---

## What Backburner Does

- **Universal Zero-Friction Capture**: Throw any raw thought into a single capture box in $<2\text{ seconds}$ (`Ctrl+Shift+Space`). Backburner asynchronously classifies it into a **Task**, **Goal**, **Project**, or **Note**.
- **Automated Goal Decomposition**: Intercepts long-term aspirations ("Gain 15 pounds in 2026") and breaks them into measurable milestones and active weekly/daily tasks.
- **Deterministic Attention Engine**: Continuously computes multi-factor urgency scores based on priority, deadline pressure, staleness, and ignored reminders without costly LLM polling.
- **Contextual Nudge Engine**: When an item deserves attention, Gemini evaluates situational context to generate conversational check-ins (*"You haven't touched your passport renewal in 2 weeks and your trip is in January. Is this still top of mind?"*).
- **Adapter Architecture**: Sits as an intelligent companion layer over existing task systems, starting with **Super Productivity**.

---

## System Architecture

```text
Thought / Raw Input
        ↓
[ Zero-Friction Capture ]
        ↓
[ AI Classification & Decomposition ] (Gemini Structured Outputs)
        ↓
[ Persistent Attention State ] (SQLite / PostgreSQL)
        ↓
[ Deterministic Attention Engine ] (Calculates When Attention Is Needed)
        ↓
[ Contextual Nudge & Re-engagement ] (Gemini Generates How to Re-engage)
        ↓
[ Adapters: Super Productivity Plugin, Google Tasks, OS Notifications ]
```

For a comprehensive technical breakdown, see [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

---

## Repository Structure

```
backburner/
├── AGENTS.md             # Instructions and conventions for AI assistants
├── README.md             # Project documentation and getting started
├── CONTEXT.md            # Domain model glossary and ubiquitous language
│
├── docs/                 # Architectural documentation and ADRs
│   ├── ARCHITECTURE.md
│   ├── ROADMAP.md
│   ├── COMPETITIVE-ANALYSIS.md
│   ├── OSS-CONTRIBUTIONS.md
│   └── adr/
│       ├── 0001-initial-architecture.md
│       └── 0002-task-vs-goal-model.md
│
├── specs/                # Technical specifications for core pipelines
├── .agents/              # Custom agent rules and skills
└── src/                  # Source code (core logic, engines, adapters)
```

---

## Quick Start

*(See [docs/ROADMAP.md](./docs/ROADMAP.md) for implementation milestones)*

```bash
# Clone the repository
git clone https://github.com/adamkosicki/backburner.git
cd backburner
```

---

## Documentation Links

- **Domain Glossary**: [CONTEXT.md](./CONTEXT.md)
- **Architecture**: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- **Roadmap**: [docs/ROADMAP.md](./docs/ROADMAP.md)
- **Competitive Analysis**: [docs/COMPETITIVE-ANALYSIS.md](./docs/COMPETITIVE-ANALYSIS.md)
- **Open-Source Strategy**: [docs/OSS-CONTRIBUTIONS.md](./docs/OSS-CONTRIBUTIONS.md)
- **Decisions (ADRs)**: [docs/adr/](./docs/adr/)
