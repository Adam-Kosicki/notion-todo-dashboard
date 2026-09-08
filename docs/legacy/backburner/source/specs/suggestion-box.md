> LEGACY DOCUMENTATION — archived 2026-09-07 from Backburner/specs/suggestion-box.md. Historical context only; original claims and instructions below are not current Burner Board requirements. Read the archive README and the active roadmap before using.

# Technical Specification: In-App Suggestion Box & Feedback Pipeline

---

## 1. Overview
Allows users to suggest features, log bug reports, or submit ideas directly inside the Backburner app. Suggestions are synchronized to cloud storage / database for easy review and prioritization.

## 2. Data Contract
```json
{
  "id": "sug_uuid",
  "title": "Short summary of feature",
  "description": "Detailed explanation of proposed feature or workflow",
  "category": "FEATURE_REQUEST | BUG_REPORT | GENERAL_FEEDBACK",
  "client_info": {
    "app_version": "0.1.0",
    "os": "windows | macos | linux | web"
  },
  "created_at": "ISO-8601-timestamp",
  "status": "SUBMITTED | IN_REVIEW | PLANNED | COMPLETED"
}
```

## 3. Storage & Synchronization
- Local caching if offline; automatic sync when network is restored.
- Ingestion endpoint persists suggestions to the cloud backend.
- Simple dashboard/viewer for triaging user suggestions.
