> LEGACY DOCUMENTATION — archived 2026-09-07 from Backburner/specs/capture-pipeline.md. Historical context only; original claims and instructions below are not current Burner Board requirements. Read the archive README and the active roadmap before using.

# Technical Specification: Zero-Friction Capture Pipeline

---

## 1. The Two Friction Problems

Traditional task managers fail due to two distinct friction barriers:

1. **Capture Friction**: "*Ugh, I'll add it later.*"
   - Caused by prompting the user for project, list, priority, due date, tags, and recurrence before letting them save a thought.
   - **Backburner Solution**: Single-box capture taking **under 2 seconds** with a global shortcut (`Ctrl+Shift+Space`) or voice input. Zero mandatory dropdowns.
2. **Organization Friction**: "*I captured 97 things and now this list is a useless graveyard.*"
   - Caused by dumping all inputs into flat lists where goals, notes, and tasks decay together.
   - **Backburner Solution**: Asynchronous AI classification into **Tasks**, **Goals**, **Projects**, and **Notes**, paired with deterministic attention scoring.

---

## 2. Ingestion & Asynchronous Parsing Flow

```text
User enters raw thought: "Renew passport before my January trip"
        ↓
[ Instant Local Write ] (<50ms, returns immediate ACK, closes UI overlay)
        ↓
[ Async Background Job ]
        ↓
[ Gemini Structured Classification (Pydantic / Zod) ]
        ↓
Parsed Result:
{
  "item_type": "TASK",
  "title": "Renew passport",
  "inferred_deadline": "2027-01-01",
  "deadline_type": "IMPLIED",
  "context_notes": "Needed for upcoming international trip in January",
  "estimated_duration_minutes": 45,
  "suggested_priority": "P1",
  "needs_decomposition": false
}
```

---

## 3. Classification Taxonomy

- **Task**: Actionable item that can be checked off (e.g. "Get car inspected").
- **Goal**: Long-term outcome requiring decomposition into milestones and recurring/daily child tasks (e.g. "Gain 15 pounds in 2026").
- **Project**: Complex multi-task initiative with a defined scope (e.g. "Launch Backburner v1.0").
- **Note**: Passive reference information with no action required (e.g. "Gemini API has a free tier with 15 RPM").
