> LEGACY DOCUMENTATION — archived 2026-09-07 from Backburner/docs/adr/0003-structured-llm-and-evals.md. Historical context only; original claims and instructions below are not current Burner Board requirements. Read the archive README and the active roadmap before using.

# ADR-0003: Structured LLM Generation and Scenario-Based Evaluation

## Status
Accepted

## Date
2026-08-31

## Context
Relying on unconstrained free-form LLM outputs introduces parsing fragility, hallucinations, and non-deterministic schema validation errors. Furthermore, changing prompts without an automated evaluation dataset can introduce silent regression in classification accuracy.

## Decision
1. **Strict Structured Schema Enforcement**: All LLM interactions (classification, goal decomposition, priority advice, and conversational prompts) must use strictly validated JSON schemas via Pydantic/Zod and Gemini `response_format`.
2. **Scenario-Based Evaluation Suite (`tests/evals/`)**: Maintain version-controlled `.jsonl` benchmark datasets (`captures.jsonl`, `decomposition.jsonl`, `priority_scenarios.jsonl`, `reminder_scenarios.jsonl`) executed in CI to enforce $\ge 95\%$ accuracy before deploying prompt modifications.

## Consequences
- Guaranteed type safety between AI responses and the persistence layer.
- Prevents prompt regressions and establishes objective evaluation metrics for LLM engineering.
- Requires building and maintaining golden test evaluation fixtures.
