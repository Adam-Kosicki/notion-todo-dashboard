"use client";

// Phase 2 (docs/plans/burner-board-roadmap.md): batch move/type/review actions with a
// before/after preview. "Review" here means the existing organize/triage fields (list,
// priority) - there's no stored review_state wired into the live app yet (that column exists
// only in Phase 1's not-yet-connected d1_primary command layer), so "mark reviewed" is
// expressed as bulk-assigning a list or priority, the same fields that already remove an item
// from the Needs-review filter. No new backend endpoint: this calls the existing single-item
// update once per selected id (there is no bulk update route), and reports partial failure
// honestly rather than pretending it's all-or-nothing.
import { useState } from "react";
import { CheckCheck, X } from "lucide-react";
import { ITEM_TYPES, type EditableChanges } from "@/lib/board-types";

type Action = "move" | "type" | "priority";

export function BulkActionBar({
  count,
  collections,
  onApply,
  onClear,
}: {
  count: number;
  collections: string[];
  onApply: (changes: EditableChanges) => Promise<{ applied: number; failed: number }>;
  onClear: () => void;
}) {
  const [action, setAction] = useState<Action | "">("");
  const [listValue, setListValue] = useState("");
  const [typeValue, setTypeValue] = useState("Task");
  const [priorityValue, setPriorityValue] = useState(5);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ applied: number; failed: number } | null>(null);

  const changes: EditableChanges | null = action === "move"
    ? { collection: listValue || null }
    : action === "type"
      ? { itemType: typeValue, ...(typeValue !== "Task" ? { priority: 0 } : {}) }
      : action === "priority"
        ? { priority: priorityValue }
        : null;

  const previewText = action === "move"
    ? `Move ${count} item${count === 1 ? "" : "s"} to ${listValue || "no list"}`
    : action === "type"
      ? `Set ${count} item${count === 1 ? "" : "s"} to type "${typeValue}"`
      : action === "priority"
        ? `Set ${count} item${count === 1 ? "" : "s"}' importance to ${priorityValue}`
        : null;

  const apply = async () => {
    if (!changes) return;
    setBusy(true);
    setResult(null);
    try {
      const outcome = await onApply(changes);
      setResult(outcome);
      if (outcome.failed === 0) {
        setAction("");
        onClear();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bulk-action-bar" role="region" aria-label="Bulk actions">
      <div className="bulk-action-summary">
        <CheckCheck />
        <strong>{count} selected</strong>
        <button type="button" onClick={onClear} aria-label="Clear selection"><X /></button>
      </div>
      <div className="bulk-action-controls">
        <select value={action} onChange={(event) => { setAction(event.target.value as Action | ""); setResult(null); }} aria-label="Choose bulk action">
          <option value="">Choose an action...</option>
          <option value="move">Move to list</option>
          <option value="type">Set item type</option>
          <option value="priority">Set importance</option>
        </select>
        {action === "move" && (
          <select value={listValue} onChange={(event) => setListValue(event.target.value)} aria-label="Target list">
            <option value="">No list / Unfiled</option>
            {collections.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        )}
        {action === "type" && (
          <select value={typeValue} onChange={(event) => setTypeValue(event.target.value)} aria-label="Target item type">
            {ITEM_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        )}
        {action === "priority" && (
          <input type="range" min={0} max={10} value={priorityValue} aria-label="Target importance" onChange={(event) => setPriorityValue(Number(event.target.value))} />
        )}
      </div>
      {previewText && (
        <div className="bulk-action-preview">
          <span>{previewText}</span>
          <button type="button" disabled={busy} onClick={() => void apply()}>{busy ? "Applying..." : "Apply"}</button>
        </div>
      )}
      {result && (
        <p className="bulk-action-result">
          {result.failed === 0 ? `Applied to all ${result.applied}.` : `Applied to ${result.applied}, ${result.failed} failed - selection kept so you can retry.`}
        </p>
      )}
    </div>
  );
}
