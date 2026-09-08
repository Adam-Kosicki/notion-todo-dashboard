"use client";

// Phase 3 completion (docs/plans/phase-3-completion-batch.md): the small persisted owner
// timezone setting the roadmap's statistics contract requires ("the known preference or a setup
// choice"). Purely presentational plus the one mutation callback it's handed, same pattern as
// weekly-progress.tsx/period-progress.tsx - the actual persistence, validation, and "only new
// periods use this" semantics live server-side (lib/server/commands.ts's
// settingsSetPlanningTimezone, lib/server/queries.ts's getOwnerTimezone).
import { useState } from "react";
import { Globe } from "lucide-react";

/** A short curated fallback for browsers without Intl.supportedValuesOf (older WebKit/Firefox) -
 * enough for personal use, not an exhaustive zone list. */
const FALLBACK_TIMEZONES = [
  "America/Chicago",
  "America/New_York",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "UTC",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Australia/Sydney",
];

function listTimezones(current: string): string[] {
  let zones: string[];
  try {
    zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : FALLBACK_TIMEZONES;
  } catch {
    zones = FALLBACK_TIMEZONES;
  }
  return zones.includes(current) ? zones : [current, ...zones];
}

export function PlanningTimezone({
  timezone,
  onChange,
}: {
  timezone: string;
  onChange: (timezone: string) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);

  const handleChange = async (next: string) => {
    if (!next || next === timezone) return;
    setSaving(true);
    try {
      await onChange(next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm">
      <Globe className="size-4 shrink-0 text-muted-foreground" />
      <span className="text-muted-foreground">Planning timezone</span>
      <select
        className="rounded-md border border-input bg-transparent px-2 py-1 text-sm disabled:opacity-50"
        value={timezone}
        disabled={saving}
        onChange={(event) => void handleChange(event.target.value)}
        aria-label="Planning timezone"
      >
        {listTimezones(timezone).map((zone) => <option key={zone} value={zone}>{zone}</option>)}
      </select>
      <span className="text-xs text-muted-foreground">
        Applies to new weeks and periods going forward - existing ones keep the timezone they were created with.
      </span>
    </div>
  );
}
