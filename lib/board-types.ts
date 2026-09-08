export type Burner = "Unsorted" | "Front Burner" | "Simmering" | "Back Burner" | "Someday";

export type BoardItem = {
  id: string;
  title: string;
  status: string;
  burner: string | null;
  priority: number | null;
  priorityLevel: string | null;
  itemType: string;
  source: string | null;
  collection: string | null;
  due: string | null;
  scheduledFor: string | null;
  dateMode: string | null;
  recurrence: string | null;
  reminderTime: string | null;
  energy: string | null;
  context: string | null;
  area: string | null;
  project: string | null;
  goal: string | null;
  originalNotes: string | null;
  tags: string | null;
  groupId: string | null;
  lastInteraction: string | null;
  lastNudge: string | null;
  completedAt: string | null;
  attentionScore: number;
  stalenessDays: number;
  starred: boolean;
  dirty: boolean;
  updatedAt: string;
};

export type RelationOption = { id: string; label: string; value: string };

export const ITEM_TYPES = ["Task", "Goal", "Reminder", "Event", "Purchase", "List item", "Someday", "Reference"];

export type ListType = "general" | "goal" | "shopping" | "recurring_payment" | "reference";

export type ListRule = "manual" | "today" | "week" | "longer" | "inbox";
export type ListItemSort = "priority" | "attention" | "due" | "title" | "updated";

export type BoardList = {
  id: string;
  name: string;
  type: ListType;
  showPriority: boolean | null;
  showLongTermGoals: boolean | null;
  reminderDefault: string | null;
  defaultItemType: string | null;
  sortOrder: number;
  pinned?: boolean;
  rule?: ListRule;
  itemSort?: ListItemSort;
  showPurchases?: boolean | null;
};

export const LIST_TYPES: Array<{
  value: ListType;
  label: string;
  showPriority: boolean;
  showLongTermGoals: boolean;
  hasReminderDefault?: boolean;
}> = [
  { value: "general", label: "General list", showPriority: true, showLongTermGoals: true },
  { value: "goal", label: "Goals", showPriority: true, showLongTermGoals: false },
  { value: "shopping", label: "Shopping / things to buy", showPriority: false, showLongTermGoals: false },
  { value: "recurring_payment", label: "Recurring payments", showPriority: false, showLongTermGoals: false, hasReminderDefault: true },
  { value: "reference", label: "Reference / someday", showPriority: false, showLongTermGoals: false },
];

export function listTypeDefaults(type: string) {
  return LIST_TYPES.find((entry) => entry.value === type) || LIST_TYPES[0];
}

export type EditableList = Partial<Pick<BoardList, "name" | "type" | "showPriority" | "showLongTermGoals" | "reminderDefault" | "defaultItemType" | "pinned" | "rule" | "itemSort" | "showPurchases">>;

export type HomeVisibility = { goals: boolean; purchases: boolean };

// Phase 3 slice 2: type-only imports from the server modules that own these shapes
// (lib/server/queries.ts, lib/domain/progress.ts) - erased at build time, so importing them here
// doesn't pull server code into the client bundle. Kept as re-exports so board-app.tsx and the
// new focus/weekly-progress components have one place to import board-shaped types from.
export type { FocusItemDisplay, WeekProgress, WeekCommitmentDisplay, PeriodProgress, PeriodCommitmentDisplay } from "@/lib/server/queries";

export type BoardPayload = {
  items: BoardItem[];
  connections: { notion: boolean; notionManaged: boolean };
  relations: { areas: RelationOption[]; projects: RelationOption[]; goals: RelationOption[] };
  collections: string[];
  lists: BoardList[];
  visibility: HomeVisibility;
  importedCount: number;
  // Optional: getBoard() itself doesn't produce these (app/api/board/route.ts's GET handler
  // merges them in separately from lib/server/queries.ts) - and sample/demo mode has neither.
  focus?: import("@/lib/server/queries").FocusItemDisplay[];
  weekProgress?: import("@/lib/server/queries").WeekProgress;
  // Today/Month/Year extension (docs/adr/local/time-horizon-quick-actions.md) - same optionality
  // rationale as weekProgress above.
  todayProgress?: import("@/lib/server/queries").PeriodProgress;
  monthProgress?: import("@/lib/server/queries").PeriodProgress;
  yearProgress?: import("@/lib/server/queries").PeriodProgress;
};

export type EditableChanges = Partial<Pick<BoardItem,
  | "title"
  | "status"
  | "itemType"
  | "burner"
  | "priority"
  | "priorityLevel"
  | "due"
  | "scheduledFor"
  | "dateMode"
  | "recurrence"
  | "reminderTime"
  | "energy"
  | "context"
  | "area"
  | "project"
  | "goal"
  | "originalNotes"
  | "tags"
  | "groupId"
  | "lastInteraction"
  | "completedAt"
  | "starred"
  | "collection"
>>;
