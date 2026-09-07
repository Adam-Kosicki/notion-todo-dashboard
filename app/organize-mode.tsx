"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Check, CheckCheck, FolderOpen, ListFilter, RotateCcw, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ITEM_TYPES, type BoardItem, type BoardList, type EditableChanges } from "@/lib/board-types";
import { localDate, suggestLists, suggestedDate, suggestedType } from "@/lib/organizing";

type Props = {
  items: BoardItem[];
  lists: BoardList[];
  onSave: (id: string, changes: EditableChanges) => Promise<boolean>;
  onHome: () => void;
};

export default function OrganizeMode({ items, lists, onSave, onHome }: Props) {
  const [scope, setScope] = useState("unfiled");
  const [handled, setHandled] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ item: BoardItem; applied: EditableChanges }>>([]);
  const [busy, setBusy] = useState(false);
  const eligible = items.filter(item => !["Done", "Archived"].includes(item.status) && (scope === "all" || !item.collection));
  const remaining = eligible.filter(item => !handled.has(item.id));
  const current = remaining.find(item => item.id === selectedId) || remaining[0];
  const finish = (id: string) => { setHandled(previous => new Set([...previous, id])); setSelectedId(null); };
  const apply = async (item: BoardItem, changes: EditableChanges) => {
    setBusy(true);
    try {
      if (await onSave(item.id, changes)) {
        setHistory(previous => [...previous, { item, applied: changes }]);
        finish(item.id);
      }
    } finally { setBusy(false); }
  };
  const undo = async () => {
    const last = history.at(-1);
    if (!last) return;
    setBusy(true);
    const restore: EditableChanges = {};
    for (const key of Object.keys(last.applied) as Array<keyof EditableChanges>) Object.assign(restore, { [key]: last.item[key] });
    // Restore fields the backend may derive from a list/type/date change as well.
    Object.assign(restore, { itemType: last.item.itemType, priority: last.item.priority, dateMode: last.item.dateMode, showInTodoist: last.item.showInTodoist });
    try {
      if (await onSave(last.item.id, restore)) {
        setHistory(previous => previous.slice(0, -1));
        setHandled(previous => { const next = new Set(previous); next.delete(last.item.id); return next; });
        setSelectedId(last.item.id);
      }
    } finally { setBusy(false); }
  };

  return <section className="organize-mode" aria-label="Organize tasks">
    <header className="organize-heading">
      <div><span className="organize-eyebrow"><ListFilter size={15} />Organize</span><h1>Organize your tasks.</h1><p>Choose a list. Add a date if it matters. Keep going.</p></div>
      <div className="organize-session"><span>{history.length} saved this session</span><Button variant="outline" disabled={!history.length || busy} onClick={() => void undo()}><RotateCcw />Undo last</Button></div>
    </header>
    <div className="organize-layout">
      <aside className="organize-queue">
        <div className="organize-queue-heading"><strong>To organize <span>{remaining.length}</span></strong><select aria-label="Organizing scope" value={scope} disabled={busy} onChange={event => { setScope(event.target.value); setHandled(new Set()); setSelectedId(null); }}><option value="unfiled">Without a list</option><option value="all">All open tasks</option></select></div>
        <div className="organize-queue-items">{remaining.map(item => <button type="button" disabled={busy} key={item.id} aria-current={current?.id === item.id ? "true" : undefined} className={current?.id === item.id ? "selected" : ""} onClick={() => setSelectedId(item.id)}><span>{item.title}</span><small>{item.collection || "No list yet"}</small></button>)}</div>
        {!!handled.size && <button className="organize-revisit" disabled={busy} onClick={() => setHandled(new Set(history.map(entry => entry.item.id)))}>Revisit skipped tasks</button>}
      </aside>
      {current ? <OrganizerCard key={current.id} item={current} lists={lists} items={items} busy={busy} onApply={changes => apply(current, changes)} onSkip={() => finish(current.id)} onHome={onHome} /> : <div className="organize-complete"><CheckCheck /><h2>{handled.size ? "A little less to carry." : "Nothing waiting here."}</h2><p>{handled.size ? `${history.length} saved this session. Skipped tasks are still on your board.` : "Capture a thought or choose All open tasks to organize existing work."}</p><Button onClick={onHome}>Back to Home <ArrowRight /></Button></div>}
    </div>
    <p className="organize-footnote">Free suggestions use keywords and similar tasks already in your lists. Nothing moves until you save.</p>
  </section>;
}

function OrganizerCard({ item, lists, items, busy, onApply, onSkip, onHome }: {
  item: BoardItem; lists: BoardList[]; items: BoardItem[]; busy: boolean;
  onApply: (changes: EditableChanges) => Promise<void>; onSkip: () => void; onHome: () => void;
}) {
  const suggestions = useMemo(() => suggestLists(item, lists, items), [item, lists, items]);
  const initialList = item.collection || suggestions[0]?.list.name || "";
  const [collection, setCollection] = useState(initialList);
  const [due, setDue] = useState(item.due?.slice(0, 10) || "");
  const [type, setType] = useState(item.collection ? item.itemType : suggestions[0] ? suggestedType(suggestions[0].list) : item.itemType);
  const [priority, setPriority] = useState<number | null>(item.priority);
  const [tags, setTags] = useState(item.tags || "");
  const [query, setQuery] = useState("");
  const [more, setMore] = useState(false);
  const dateHint = suggestedDate(item.title);
  const selectedSuggestion = suggestions.find(suggestion => suggestion.list.name === collection);
  const tagHints = selectedSuggestion?.tags.filter(tag => !tags.split(",").map(t => t.trim()).includes(tag)) || [];
  const selectedList = lists.find(list => list.name === collection);
  const choose = (list: BoardList) => { setCollection(list.name); setType(suggestedType(list)); };
  const shownLists = lists.filter(list => list.name.toLowerCase().includes(query.toLowerCase()));
  const changes: EditableChanges = { collection: collection || null, itemType: type, due: due || null, dateMode: due ? "date_set" : item.dateMode === "date_set" ? "unspecified" : item.dateMode, tags: tags.trim() || null, priority: type === "Task" ? priority : 0 };
  const changed = Object.entries(changes).some(([key, value]) => item[key as keyof BoardItem] !== value);

  return <form className="organizer-card" onSubmit={event => { event.preventDefault(); if (!busy && changed) void onApply(changes); }}>
    <fieldset disabled={busy}>
      <div className="organizer-task"><span className="organize-eyebrow">{item.itemType} · {item.collection || "Unfiled"}</span><h2>{item.title}</h2>{item.originalNotes && <p>{item.originalNotes}</p>}</div>
      <section className="organize-section"><div className="organize-section-label"><h3>Where does it belong?</h3><span>Choose one list</span></div>
        {!!suggestions.length && <div className="organize-suggestions">{suggestions.map(suggestion => <button type="button" key={suggestion.list.id} className={collection === suggestion.list.name ? "selected" : ""} onClick={() => choose(suggestion.list)}><span><FolderOpen size={17} /><strong>{suggestion.list.name}</strong>{collection === suggestion.list.name && <Check size={17} />}</span><small>{suggestion.reason}</small></button>)}</div>}
        {!suggestions.length && <p className="organize-no-match">No clear match yet. Choose a list; tasks you file become examples for future suggestions.</p>}
        <input className="organize-list-search" aria-label="Find a list" placeholder="Find a list..." value={query} onChange={event => setQuery(event.target.value)} />
        <div className="organize-list-chips"><button type="button" aria-pressed={!collection} onClick={() => { setCollection(""); setType(item.itemType); }}>No list</button>{shownLists.map(list => <button type="button" aria-pressed={collection === list.name} key={list.id} onClick={() => choose(list)}>{list.name}</button>)}</div>
        {!lists.length && <Button type="button" variant="outline" onClick={onHome}>Create a list on Home <ArrowRight /></Button>}
      </section>
      <section className="organize-section"><div className="organize-section-label"><h3>When?</h3><span>Optional</span></div><div className="organize-date-row"><input type="date" aria-label="Organize due date" value={due} onChange={event => setDue(event.target.value)} /><button type="button" onClick={() => setDue(localDate())}>Today</button><button type="button" onClick={() => { const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); setDue(localDate(tomorrow)); }}>Tomorrow</button><button type="button" onClick={() => setDue("")}>Clear due date</button></div>{dateHint && !due && <button className="organize-date-hint" type="button" onClick={() => setDue(dateHint.date)}>{dateHint.reason}. Use {dateHint.date}?</button>}</section>
      <Collapsible open={more} onOpenChange={setMore}><CollapsibleTrigger className="organize-more" type="button">{more ? "Fewer details" : "Type, tags & importance"}<span>{more ? "−" : "+"}</span></CollapsibleTrigger><CollapsibleContent><div className="organize-details"><label>Item type<select value={type} onChange={event => setType(event.target.value)}>{ITEM_TYPES.map(value => <option key={value}>{value}</option>)}</select></label><label>Tags<input value={tags} onChange={event => setTags(event.target.value)} placeholder="Separate tags with commas" /></label>{!!tagHints.length && <div className="organize-tag-hints"><span>From a similar task</span>{tagHints.map(tag => <button key={tag} type="button" onClick={() => setTags(previous => [previous, tag].filter(Boolean).join(", "))}>+ {tag}</button>)}</div>}{type === "Task" && <label className="organize-priority">Importance <strong>{priority === null ? "Unrated" : `${priority} / 10`}</strong><input type="range" min="0" max="10" aria-label="Organize importance" value={priority ?? 0} onChange={event => setPriority(Number(event.target.value))} /><button type="button" onClick={() => setPriority(null)}>Leave unrated</button></label>}</div></CollapsibleContent></Collapsible>
      <div className="organize-receipt"><span>After saving</span><strong>{collection || "No list"} <span>·</span> {type} <span>·</span> {due || "No due date"}</strong>{selectedList && type !== item.itemType && <small>Item type suggested from this list. You can change it above.</small>}</div>
      <footer className="organize-actions"><Button type="button" variant="ghost" onClick={onSkip}><SkipForward />Skip for now</Button><Button type="submit" disabled={busy || !changed}>{busy ? "Saving..." : "Save & next"}<ArrowRight /></Button></footer>
    </fieldset>
  </form>;
}
