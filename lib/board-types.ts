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
  lastInteraction: string | null;
  lastNudge: string | null;
  completedAt: string | null;
  attentionScore: number;
  stalenessDays: number;
  starred: boolean;
  todoistId: string | null;
  showInTodoist: boolean;
  dirty: boolean;
  updatedAt: string;
};

export type RelationOption = { id: string; label: string; value: string };

export type ListType = "general" | "goal" | "shopping" | "recurring_payment" | "reference";

export type BoardList = {
  id: string;
  name: string;
  type: ListType;
  showPriority: boolean | null;
  showLongTermGoals: boolean | null;
  reminderDefault: string | null;
  sortOrder: number;
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

export type EditableList = Partial<Pick<BoardList, "name" | "type" | "showPriority" | "showLongTermGoals" | "reminderDefault">>;

export type BoardPayload = {
  items: BoardItem[];
  connections: { notion: boolean; todoist: boolean };
  relations: { areas: RelationOption[]; projects: RelationOption[]; goals: RelationOption[] };
  collections: string[];
  lists: BoardList[];
  importedCount: number;
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
  | "lastInteraction"
  | "completedAt"
  | "starred"
  | "showInTodoist"
  | "collection"
>>;
