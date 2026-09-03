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

export type BoardPayload = {
  items: BoardItem[];
  connections: { notion: boolean; todoist: boolean };
  relations: { areas: RelationOption[]; projects: RelationOption[]; goals: RelationOption[] };
  collections: string[];
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
  | "lastInteraction"
  | "completedAt"
  | "starred"
  | "showInTodoist"
  | "collection"
>>;
