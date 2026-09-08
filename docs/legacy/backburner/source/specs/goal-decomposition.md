> LEGACY DOCUMENTATION — archived 2026-09-07 from Backburner/specs/goal-decomposition.md. Historical context only; original claims and instructions below are not current Burner Board requirements. Read the archive README and the active roadmap before using.

# Technical Specification: Goal Decomposition & Milestone Engine

---

## 1. The Anti-Pattern: Checkbox Goals

Conventional to-do apps allow users to enter:
```text
☐ Gain 15 pounds in 2026
```
which sits on the daily to-do screen for 10 months without actionable steps, causing psychological overwhelm and task avoidance.

---

## 2. Structured Goal Decomposition Model

When the capture pipeline identifies an input as a `GOAL`, Backburner does not display the goal itself as a daily checkable item. Instead, it generates a structured hierarchy:

```text
GOAL: Gain 15 pounds in 2026
Target Metric: +15 lb
Horizon: 12 months

├── Milestone 1: Baseline & Nutrition Setup
│   ├── Child Task: Establish baseline body weight (scale)
│   ├── Child Task: Calculate target daily calorie surplus
│   └── Child Task: Create initial weekly grocery & meal template
│
├── Milestone 2: Consistent Weekly Execution
│   ├── Recurring Task: Record morning weight Monday
│   ├── Recurring Task: Record morning weight Wednesday
│   ├── Recurring Task: Record morning weight Friday
│   └── Weekly Review: Calculate 7-day average Sunday
│
└── Milestone 3: Dynamic Calibration
    └── Triggered Task: Adjust calorie target if 14-day weight trend stalls
```

---

## 3. Daily / Weekly Dashboard Presentation

On the active daily view, the user sees only **actionable child tasks scheduled for that day/week**:

```text
TODAY'S ACTIONS:
☐ Record morning weight (Mon)
☐ Pick up protein/groceries from template

(Under the hood: Progress on 'Gain 15 pounds' updates automatically)
```

---

## 4. Goal Reassessment & Progress Tracking

- The Attention Engine periodically checks Goal progress against elapsed time on the goal's horizon.
- If milestone tasks are neglected for $\ge 14\text{ days}$, the system generates a **Goal Reassessment Prompt**:
  > "*Your goal 'Gain 15 pounds' hasn't had weight logged in 2 weeks. Would you like to adjust your milestones, pause the goal, or schedule this week's check-ins?*"
