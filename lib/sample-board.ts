import type { BoardItem, BoardPayload } from "./board-types";

/** Explicitly selected, temporary examples. Never persisted or sent to providers. */
export function sampleBoard(): BoardPayload {
  const base: BoardItem = {
    id: "", title: "", status: "Not started", itemType: "Task", source: "Sample",
    burner: null, priority: null, priorityLevel: null, collection: null, due: null,
    scheduledFor: null, dateMode: null, recurrence: null, reminderTime: null, energy: null,
    context: null, area: null, project: null, goal: null, originalNotes: null, tags: null,
    groupId: null, lastInteraction: null, lastNudge: null, completedAt: null,
    attentionScore: 0, stalenessDays: 0, starred: false, todoistId: null,
    showInTodoist: false, dirty: false, updatedAt: new Date().toISOString(),
  };
  const tasks = [
    { title: "Buy milk and eggs tomorrow" },
    { title: "Update my resume" },
    { title: "Book a dentist appointment" },
    { title: "Fix the website search bug" },
    { title: "Think about a weekend adventure" },
    { title: "Prepare resume for a backend role", collection: "Career", tags: "job search", status: "Done" },
    { title: "Fix website loading bug", collection: "Projects", tags: "coding", status: "Done" },
  ];
  return {
    items: tasks.map((task, index) => ({ ...base, ...task, id: `sample-${index}` })),
    lists: [
      { name: "Grocery", type: "shopping", defaultItemType: "Purchase" },
      { name: "Career", type: "general", defaultItemType: "Task" },
      { name: "Health", type: "general", defaultItemType: "Task" },
      { name: "Projects", type: "general", defaultItemType: "Task" },
      { name: "Someday", type: "reference", defaultItemType: "Someday" },
    ].map((list, index) => ({ ...list, type: list.type as BoardPayload["lists"][number]["type"], id: `sample-list-${index}`, showPriority: null, showLongTermGoals: null, reminderDefault: null, sortOrder: index })),
    connections: { notion: false, notionManaged: false, todoist: false },
    relations: { areas: [], projects: [], goals: [] },
    collections: ["Grocery", "Career", "Health", "Projects", "Someday"], importedCount: tasks.length,
  };
}
