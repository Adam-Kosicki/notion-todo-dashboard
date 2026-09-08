> LEGACY DOCUMENTATION — archived 2026-09-07 from Backburner/specs/evaluations.md. Historical context only; original claims and instructions below are not current Burner Board requirements. Read the archive README and the active roadmap before using.

# Technical Specification: LLM Evaluation Suite & Scenarios

---

## 1. Objective
Establish an automated evaluation framework to test and benchmark Gemini structured output quality, prompt changes, and classification accuracy across realistic user inputs.

## 2. Benchmark Datasets (`tests/evals/`)

### 2.1 `captures.jsonl` (Classification & Entity Extraction)
Evaluates whether raw text inputs are correctly classified as `TASK`, `GOAL`, `PROJECT`, or `NOTE`, with accurate inferred deadlines and estimated durations.

**Example Scenarios**:
- Input: `"I should probably renew my passport because I'm flying internationally in January."`  
  $\rightarrow$ `item_type: TASK`, `priority >= P2`, `implied_deadline: true`, `needs_decomposition: false`
- Input: `"Gain 15 pounds this year."`  
  $\rightarrow$ `item_type: GOAL`, `needs_decomposition: true`, `target_metric: "+15 lb"`
- Input: `"Gemini API rate limit is 15 RPM on free tier"`  
  $\rightarrow$ `item_type: NOTE`, `actionable: false`

### 2.2 `decomposition.jsonl` (Goal Breakdown Quality)
Evaluates whether complex goals are broken down into actionable, discrete child tasks and measurable milestones rather than vague sub-goals.

### 2.3 `priority_scenarios.jsonl` (Urgency & Dual-Priority Alignment)
Evaluates whether suggested AI priorities align with realistic scheduling constraints and user deadlines.

### 2.4 `reminder_scenarios.jsonl` (Tone & Context Quality)
Evaluates generated nudge messages for empathy, clarity, brevity, and context preservation (avoiding generic robot alarms).

## 3. Evaluation Metrics & CI Gates
- **Classification Accuracy**: $\ge 95\%$ on golden test set.
- **JSON Schema Conformance**: $100\%$ valid output against Pydantic schema.
- **Inference Latency & Token Budget**: Monitored and reported on each run.
