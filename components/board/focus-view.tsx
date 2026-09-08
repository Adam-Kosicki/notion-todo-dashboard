"use client";

// Phase 3 slice 2 (docs/plans/burner-board-roadmap.md): explicit Focus controls over the
// focus.set command (lib/server/commands.ts). Kept independent of List membership, importance,
// and Last Interaction, and independent of weekly commitments (roadmap: "Focus and AI selection
// are independent" - the same principle extends to Focus vs. weekly commitment, both of which
// are separate, explicit, user-driven selections over the same underlying items).
import { useState } from "react";
import { Star, X } from "lucide-react";
import type { BoardItem, FocusItemDisplay } from "@/lib/board-types";

export function FocusView({
  focusItems,
  items,
  onToggleFocus,
}: {
  focusItems: FocusItemDisplay[];
  items: BoardItem[];
  onToggleFocus: (itemId: string, focused: boolean) => Promise<void>;
}) {
  const [addValue, setAddValue] = useState("");
  const [busyItemId, setBusyItemId] = useState<string | null>(null);

  const focusedIds = new Set(focusItems.map((item) => item.itemId));
  const addableItems = items
    .filter((item) => !["Done", "Archived"].includes(item.status) && !focusedIds.has(item.id))
    .sort((a, b) => a.title.localeCompare(b.title));

  const add = async (itemId: string) => {
    if (!itemId) return;
    setBusyItemId(itemId);
    try {
      await onToggleFocus(itemId, true);
      setAddValue("");
    } finally {
      setBusyItemId(null);
    }
  };

  const remove = async (itemId: string) => {
    setBusyItemId(itemId);
    try {
      await onToggleFocus(itemId, false);
    } finally {
      setBusyItemId(null);
    }
  };

  return (
    <div className="focus-view flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
      <div>
        <h2 className="flex items-center gap-1.5 text-lg font-semibold text-foreground"><Star className="size-4 text-amber-400" />Focus</h2>
        <p className="text-sm text-muted-foreground">Your current priorities, independent of lists and dates.</p>
      </div>

      <ul className="flex flex-col gap-1">
        {focusItems.map((item) => (
          <li key={item.itemId} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
            <span className={`truncate text-sm ${item.status === "Done" ? "text-muted-foreground line-through" : "text-foreground"}`}>{item.title}</span>
            <button
              type="button"
              className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
              disabled={busyItemId === item.itemId}
              onClick={() => void remove(item.itemId)}
              aria-label={`Remove ${item.title} from Focus`}
              title="Remove from Focus"
            >
              <X className="size-4" />
            </button>
          </li>
        ))}
        {focusItems.length === 0 && <li className="text-sm text-muted-foreground">Nothing in Focus yet.</li>}
      </ul>

      <div className="flex items-center gap-2 border-t border-border pt-3">
        <select
          className="flex-1 rounded-md border border-input bg-transparent px-2 py-1.5 text-sm"
          value={addValue}
          onChange={(event) => setAddValue(event.target.value)}
          aria-label="Add a task to Focus"
        >
          <option value="">Add to Focus...</option>
          {addableItems.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
        <button
          type="button"
          className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
          disabled={!addValue || busyItemId === addValue}
          onClick={() => void add(addValue)}
        >
          <Star className="size-4" />Add
        </button>
      </div>
    </div>
  );
}
