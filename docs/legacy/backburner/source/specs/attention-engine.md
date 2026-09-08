> LEGACY DOCUMENTATION — archived 2026-09-07 from Backburner/specs/attention-engine.md. Historical context only; original claims and instructions below are not current Burner Board requirements. Read the archive README and the active roadmap before using.

# Technical Specification: Deterministic Attention Engine

---

## 1. Core Principle: Deterministic Scheduling First, LLM Reasoning Second

Rather than polling an LLM periodically on a cron loop to ask *"should we notify the user about this task?"* (which is costly, slow, and unpredictable), Backburner divides the responsibility:

- **The Deterministic Attention Engine decides *WHEN* an item needs attention.**
- **The Contextual LLM Evaluator decides *WHAT* that attention means and *HOW* to communicate it.**

---

## 2. Attention Score Formula

The numerical `AttentionScore` is computed continuously across all active items:

$$\text{AttentionScore} = S_{\text{priority}} + S_{\text{deadline}} + S_{\text{staleness}} + S_{\text{ignored}} + S_{\text{dependency}} + S_{\text{goal}}$$

### 2.1 Component Weights
1. **$S_{\text{priority}}$ (Base Priority Weight)**:
   - `P0` (Critical): +100
   - `P1` (High): +60
   - `P2` (Normal): +30
   - `P3` (Someday): +5
2. **$S_{\text{deadline}}$ (Deadline Proximity & Urgency)**:
   - Hard deadline within 24h: $+90$
   - Hard deadline within 3 days: $+60$
   - Hard deadline within 7 days: $+30$
   - Implied deadline approaching (e.g. 7-week trip processing window): $+40$
   - Overdue: $+100$
3. **$S_{\text{staleness}}$ (Inactivity Factor)**:
   - Evaluates elapsed days since last user interaction / edit / progress:
   - $\text{DaysInactive} \times 2.5$ (capped at $+50$)
4. **$S_{\text{ignored}}$ (Nudge Escalation Factor)**:
   - $\text{IgnoredCount} \times 15$
5. **$S_{\text{dependency}}$ (Blocker Pressure)**:
   - $+25$ if other active tasks depend on this item.
6. **$S_{\text{goal}}$ (Strategic Alignment)**:
   - $+30$ if linked to a high-priority active Goal.

---

## 3. Dual Priority Model

To keep the human in control while benefiting from AI intelligence, Backburner maintains two separate priority fields:

- **`user_priority`**: Explicit priority assigned by the human (`P0`, `P1`, `P2`, `P3`).
- **`ai_priority`**: Contextually suggested priority based on deadline proximity and dependencies.
- **`effective_priority`**: Runtime priority computed transparently with user explanation:

```text
Task: Renew passport
Your priority: P2
AI suggested:  P1 ↑
Reason: Trip is 7 weeks away; standard passport processing is 6-8 weeks.
[ Accept P1 ] [ Keep P2 ]
```

---

## 4. "Why Should This Reminder Happen Now?" Trigger Logic

When $\text{AttentionScore} \ge \text{Threshold}_{\text{Active}}$, Backburner constructs a context snapshot and invokes Gemini:

```json
{
  "task": "Renew passport",
  "user_priority": "P2",
  "created_days_ago": 20,
  "last_interaction_days_ago": 12,
  "ignored_nudges": 2,
  "deadline_context": "International trip in January",
  "staleness_alert": "No progress in 12 days"
}
```

Gemini returns a conversational, structured re-engagement prompt:
```json
{
  "action": "ASK_REASSESSMENT",
  "message": "You haven't touched your passport renewal in almost two weeks. You mentioned needing it for your January trip. Is this still something you want to handle soon?",
  "suggested_priority": "P1",
  "next_review_days": 3
}
```
