import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../lib/organizing.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { needsOrganization, suggestLists, suggestedType, suggestedDate } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const item = { id: 'a', title: 'Buy milk and eggs tomorrow', itemType: 'Task', priority: null, collection: null, due: null, scheduledFor: null, tags: null, context: null };
const lists = [{ id: 'g', name: 'Grocery', type: 'shopping', sortOrder: 0 }, { id: 'c', name: 'Career', type: 'general', sortOrder: 1 }];

test('context and relationships do not make an unfiled task disappear', () => {
  assert.equal(needsOrganization({ ...item, context: 'Computer', area: 'Personal', project: 'Website' }), true);
  assert.equal(needsOrganization({ ...item, collection: 'Grocery' }), false);
  assert.equal(needsOrganization({ ...item, scheduledFor: '2026-10-01' }), false);
});
test('suggestions select only existing lists and explain keyword matches', () => {
  const [suggestion] = suggestLists(item, lists, []);
  assert.equal(suggestion.list.name, 'Grocery');
  assert.match(suggestion.reason, /milk/);
  assert.deepEqual(suggestLists(item, [], []), []);
  assert.deepEqual(suggestLists({ ...item, title: 'Think about things' }, lists, []), []);
});
test('user-filed examples support custom list names and tag suggestions', () => {
  const custom = { id: 'x', name: 'My next chapter', type: 'general', sortOrder: 0 };
  const examples = [{ ...item, id: 'b', title: 'Prepare backend interview', collection: custom.name, tags: 'job search', status: 'Done' }];
  const [suggestion] = suggestLists({ ...item, title: 'Backend interview prep' }, [custom], examples);
  assert.equal(suggestion.list.id, 'x');
  assert.deepEqual(suggestion.tags, ['job search']);
  assert.deepEqual(suggestLists({ ...item, title: 'Backend interview prep' }, [custom], examples.map(e => ({ ...e, status: 'Archived' }))), []);
});
test('list defaults are suggestions and respect explicit default item types', () => {
  assert.equal(suggestedType(lists[0]), 'Purchase');
  assert.equal(suggestedType({ ...lists[0], defaultItemType: 'List item' }), 'List item');
  assert.equal(suggestedType({ ...lists[0], type: 'recurring_payment' }), 'Reminder');
});
test('date hints use local calendar days and reject invalid explicit dates', () => {
  const now = new Date(2026, 11, 31, 23, 30);
  assert.equal(suggestedDate('Do this tomorrow', now).date, '2027-01-01');
  assert.equal(suggestedDate('Do this today', now).date, '2026-12-31');
  assert.equal(suggestedDate('Sometime next week', now), null);
  assert.equal(suggestedDate('Task 2026-02-31', now), null);
});
