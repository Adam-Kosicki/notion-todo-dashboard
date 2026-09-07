import type { BoardItem, BoardList } from "./board-types";

const stopWords = new Set("a an the and or to for of in on at with my this that some get do buy make need new tomorrow today next week call check update review".split(" "));
export function words(text: string): string[] {
  return [...new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(word => word.length > 2 && !stopWords.has(word)))];
}

// Context and relationships describe work; they must not hide an unfiled task.
export function needsOrganization(item: BoardItem) {
  return item.itemType === "Task" && item.priority === null && !item.collection && !item.due && !item.scheduledFor;
}

const categories = [
  { names: /grocery|groceries|food/, terms: "milk eggs bread banana bananas apple apples rice pasta yogurt cheese coffee vegetables chicken grocery groceries" },
  { names: /career|job|work/, terms: "resume interview recruiter application portfolio linkedin hiring salary employer" },
  { names: /health|fitness|exercise/, terms: "doctor dentist appointment workout treadmill gym prescription medication physical therapy health" },
  { names: /sport|volleyball/, terms: "volleyball tournament league practice beach court sports" },
  { names: /bill|payment|finance/, terms: "rent bill bills invoice insurance subscription payment electricity internet utilities" },
  { names: /wish|shopping/, terms: "headphones monitor keyboard camera wishlist laptop shoes purchase" },
  { names: /project|coding|software/, terms: "code bug database pipeline github deploy script api server website dashboard" },
];

export type ListSuggestion = { list: BoardList; score: number; reason: string; tags: string[] };
export function suggestLists(item: BoardItem, lists: BoardList[], items: BoardItem[]): ListSuggestion[] {
  const tokens = new Set(words(`${item.title} ${item.originalNotes || ""} ${item.tags || ""}`));
  if (!tokens.size) return [];
  return lists.map(list => {
    let score = 0;
    let reason = "";
    let tags: string[] = [];
    const named = words(list.name).filter(word => tokens.has(word));
    if (named.length) { score = 4 + named.length; reason = `Matches the list name: ${named.join(", ")}`; }
    for (const category of categories) {
      const matched = category.terms.split(" ").filter(word => tokens.has(word));
      if (category.names.test(list.name.toLowerCase()) && matched.length && 2 + matched.length > score) {
        score = 2 + matched.length;
        reason = `Keyword match: ${matched.slice(0, 3).join(", ")}`;
      }
    }
    for (const example of items) {
      if (example.id === item.id || example.collection !== list.name || example.status === "Archived") continue;
      const exampleWords = words(`${example.title} ${example.tags || ""}`);
      const shared = exampleWords.filter(word => tokens.has(word));
      const similarity = shared.length / Math.sqrt(Math.max(1, exampleWords.length) * tokens.size);
      const candidate = shared.length >= 2 ? 3 + similarity * 4 : shared.length === 1 ? 1.5 + similarity : 0;
      if (candidate > score) {
        score = candidate;
        reason = `Similar words to “${example.title}” in this list`;
        tags = (example.tags || "").split(",").map(tag => tag.trim()).filter(Boolean);
      }
    }
    return { list, score, reason, tags };
  }).filter(suggestion => suggestion.score >= 2.5)
    .sort((a, b) => b.score - a.score || a.list.sortOrder - b.list.sortOrder).slice(0, 3);
}

export function suggestedType(list: BoardList): string {
  return list.defaultItemType || (list.type === "shopping" ? "Purchase" : list.type === "goal" ? "Goal" : list.type === "reference" ? "Reference" : list.type === "recurring_payment" ? "Reminder" : "Task");
}

export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function suggestedDate(title: string, now = new Date()): { date: string; reason: string } | null {
  const date = new Date(now);
  if (/\btomorrow\b/i.test(title)) { date.setDate(date.getDate() + 1); return { date: localDate(date), reason: 'Mentions “tomorrow”' }; }
  if (/\btoday\b/i.test(title)) return { date: localDate(date), reason: 'Mentions “today”' };
  const exact = title.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (exact && localDate(new Date(`${exact[1]}T12:00:00`)) === exact[1]) return { date: exact[1], reason: "Date written in the task" };
  return null;
}
