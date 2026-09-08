> LEGACY DOCUMENTATION — archived 2026-09-07 from Backburner/specs/adapters-super-productivity.md. Historical context only; original claims and instructions below are not current Burner Board requirements. Read the archive README and the active roadmap before using.

# Technical Specification: Super Productivity Adapter

---

## 1. Overview
The Super Productivity adapter bridges Backburner Core with Super Productivity's desktop and web clients via its Plugin API and SP-MCP interface.

## 2. Capabilities & Data Sync
- **Task Reading**: Read current active, archived, and scheduled tasks from Super Productivity.
- **Task Creation & Update**: Push decomposed child tasks and priority updates into Super Productivity projects and tags.
- **Completion Hook**: Listen for task completion events to update Backburner's staleness metrics and mark milestones complete.
- **Notification Delivery**: Surface Backburner proactive re-engagement prompts inside Super Productivity's notification system.

## 3. Architecture & Interfaces

```text
Backburner Core
      │
      ▼
Super Productivity Adapter (TypeScript / Node bridge)
      │
      ├── Plugin API hooks (onTaskComplete, getTasks, createTask)
      └── SP-MCP Interface (Model Context Protocol endpoints)
      │
      ▼
Super Productivity Client
```

## 4. Upstream Contribution Strategy
Whenever the Backburner adapter requires capabilities not yet exposed by the Super Productivity Plugin API (e.g. detailed recurring schedule metadata or custom notification actions):
1. Document the missing requirement in an issue.
2. Implement the enhancement cleanly in `super-productivity/super-productivity`.
3. Submit a pull request adhering to Super Productivity's contribution guidelines.
4. Record the contribution in `docs/OSS-CONTRIBUTIONS.md`.
