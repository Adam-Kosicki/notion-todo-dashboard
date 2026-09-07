import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../lib/list-behavior.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { belongsToList, listMoveChanges, compareListItems, reorderedListIds, plannedDate } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

const baseItem = {
  id: 'a', title: 'Task', status: 'Not started', itemType: 'Task', priority: null,
  collection: null, due: null, scheduledFor: null, updatedAt: '2026-01-01T00:00:00Z', attentionScore: 0,
};
const baseList = { id: 'l1', name: 'Grocery', sortOrder: 0 };
const NOW = new Date('2026-09-07T12:00:00'); // a Monday

test('belongsToList: explicit collection match always wins, regardless of item type', () => {
  const list = { ...baseList, rule: 'manual' };
  assert.equal(belongsToList({ ...baseItem, collection: 'Grocery' }, list, [list], NOW), true);
  assert.equal(belongsToList({ ...baseItem, collection: 'Grocery', itemType: 'Event' }, list, [list], NOW), true, 'Events can now belong to a list (phase 2: Calendar is a projection, not exclusive)');
});

test('belongsToList: manual-rule lists never auto-include based on date', () => {
  const list = { ...baseList, rule: 'manual' };
  assert.equal(belongsToList({ ...baseItem, scheduledFor: '2026-09-07' }, list, [list], NOW), false);
});

test('belongsToList: inbox rule matches only unfiled items', () => {
  const list = { ...baseList, name: 'Inbox', rule: 'inbox' };
  assert.equal(belongsToList({ ...baseItem, collection: null }, list, [list], NOW), true);
  assert.equal(belongsToList({ ...baseItem, collection: 'Elsewhere' }, list, [{ ...list }, { id: 'l2', name: 'Elsewhere', sortOrder: 1, rule: 'manual' }], NOW), false);
});

test('belongsToList: today/week/longer rules bucket by planned date relative to now', () => {
  const today = { ...baseList, id: 'today', name: 'Today', rule: 'today' };
  const week = { ...baseList, id: 'week', name: 'This week', rule: 'week' };
  const longer = { ...baseList, id: 'longer', name: 'Longer', rule: 'longer' };
  const lists = [today, week, longer];
  const overdue = { ...baseItem, scheduledFor: '2026-09-01' };
  const dueToday = { ...baseItem, scheduledFor: '2026-09-07' };
  const laterThisWeek = { ...baseItem, scheduledFor: '2026-09-10' }; // Thursday, same week
  const nextWeek = { ...baseItem, scheduledFor: '2026-09-15' };
  const undated = { ...baseItem, priority: 5 };

  assert.equal(belongsToList(overdue, today, lists, NOW), true, 'overdue counts as today');
  assert.equal(belongsToList(dueToday, today, lists, NOW), true);
  assert.equal(belongsToList(laterThisWeek, today, lists, NOW), false);

  assert.equal(belongsToList(laterThisWeek, week, lists, NOW), true);
  assert.equal(belongsToList(dueToday, week, lists, NOW), false, 'already counted under today');
  assert.equal(belongsToList(nextWeek, week, lists, NOW), false);

  assert.equal(belongsToList(nextWeek, longer, lists, NOW), true);
  assert.equal(belongsToList(undated, longer, lists, NOW), true, 'undated-but-prioritized work falls into longer');
  assert.equal(belongsToList({ ...baseItem }, longer, lists, NOW), false, 'undated AND unprioritized does not');
});

test('belongsToList: an explicit move to a different date-rule list wins over automatic date-based inclusion', () => {
  const today = { ...baseList, id: 'today', name: 'Today', rule: 'today' };
  const longer = { ...baseList, id: 'longer', name: 'Longer', rule: 'longer' };
  const lists = [today, longer];
  // Overdue (would auto-match Today), but explicitly filed into Longer instead.
  const item = { ...baseItem, collection: 'Longer', scheduledFor: '2026-09-01' };
  assert.equal(belongsToList(item, today, lists, NOW), false);
  assert.equal(belongsToList(item, longer, lists, NOW), true);
});

test('listMoveChanges: sets collection and, for date-rule lists, a scheduled date - never itemType', () => {
  const manual = listMoveChanges({ ...baseList, rule: 'manual' }, NOW);
  assert.deepEqual(manual, { collection: 'Grocery' });

  const today = listMoveChanges({ ...baseList, name: 'Today', rule: 'today' }, NOW);
  assert.equal(today.collection, 'Today');
  assert.equal(today.scheduledFor, '2026-09-07');
  assert.ok(!('itemType' in today), 'phase 2: defaultItemType no longer auto-applies on list assignment');

  const withDefaultType = listMoveChanges({ ...baseList, rule: 'manual', defaultItemType: 'Purchase' }, NOW);
  assert.ok(!('itemType' in withDefaultType), 'defaultItemType is inert on the move path now, even when set');
});

test('compareListItems: completed items always sort after open ones, regardless of chosen sort', () => {
  const open = { ...baseItem, id: 'open', status: 'Not started', priority: 1 };
  const done = { ...baseItem, id: 'done', status: 'Done', priority: 10 };
  assert.ok(compareListItems(done, open, 'priority') > 0, 'done sorts after open even with higher priority');
});

test('compareListItems: priority sort falls back to attention, then title, then id', () => {
  const a = { ...baseItem, id: 'a', title: 'B', priority: 5 };
  const b = { ...baseItem, id: 'b', title: 'A', priority: 5 };
  assert.ok(compareListItems(a, b, 'priority') > 0, 'same priority falls back to title A-Z');
});

test('compareListItems: due sort treats undated items as sorting last', () => {
  const dated = { ...baseItem, id: 'dated', due: '2026-09-08' };
  const undated = { ...baseItem, id: 'undated' };
  assert.ok(compareListItems(dated, undated, 'due') < 0, 'a dated item sorts before an undated one');
});

test('reorderedListIds: moving a dragged list to a target position shifts others, preserves the rest', () => {
  const lists = [
    { id: '1', name: 'A', sortOrder: 0 },
    { id: '2', name: 'B', sortOrder: 1 },
    { id: '3', name: 'C', sortOrder: 2 },
  ];
  assert.deepEqual(reorderedListIds(lists, '1', '3'), ['2', '3', '1']);
});

test('reorderedListIds: dropping a list onto itself is a no-op', () => {
  const lists = [{ id: '1', name: 'A', sortOrder: 0 }, { id: '2', name: 'B', sortOrder: 1 }];
  assert.deepEqual(reorderedListIds(lists, '1', '1'), ['1', '2']);
});

test('plannedDate prefers scheduledFor over due, and truncates to a plain date', () => {
  assert.equal(plannedDate({ ...baseItem, due: '2026-09-01', scheduledFor: '2026-09-05T10:00:00Z' }), '2026-09-05');
  assert.equal(plannedDate({ ...baseItem, due: '2026-09-01' }), '2026-09-01');
  assert.equal(plannedDate({ ...baseItem }), '');
});
