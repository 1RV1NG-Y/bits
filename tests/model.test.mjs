import test from 'node:test';
import assert from 'node:assert/strict';
import { exampleLibrary, validateLibrary, selectEntries, makeEntry, parseTopics } from '../src/model.mjs';
test('examples round-trip without losing multiline content or optional metadata', () => {
  const sample = exampleLibrary(); assert.equal(sample.entries.length, 6);
  assert.deepEqual(validateLibrary(JSON.parse(JSON.stringify(sample))), sample);
  assert.match(sample.entries[3].body, /\n\n/);
});
test('word search spans content, topics, title and source in any order', () => {
  const entries = exampleLibrary().entries;
  assert.equal(selectEntries(entries, { query: 'AGENTS Rust' }).length, 1);
  assert.equal(selectEntries(entries, { query: 'working nonexistent' }).length, 0);
  assert.equal(selectEntries(entries, { query: 'DHH illustrative' }).length, 1);
  assert.equal(selectEntries([makeEntry({ body: 'Café notes' })], { query: 'cafe' }).length, 1);
});
test('favorites, topics, and words combine; sorting is stable and does not mutate input', () => {
  const entries = exampleLibrary().entries; const original = [...entries];
  assert.equal(selectEntries(entries, { topic: 'rust', favorites: true, query: 'cost' }).length, 1);
  assert.equal(selectEntries(entries, { topic: 'Git', favorites: true }).length, 0);
  assert.equal(selectEntries(entries, { sort: 'oldest' })[0].id, entries.at(-1).id);
  assert.deepEqual(entries, original);
});
test('topics deduplicate and trim; title and source can be empty', () => {
  assert.deepEqual(parseTopics(' Rust, rust, AI agents, , Rust '), ['Rust', 'AI agents']);
  assert.equal(validateLibrary({ version: 1, entries: [makeEntry({ body: 'a command' })] }).entries[0].title, '');
});
test('malformed and duplicate backups are rejected', () => {
  const data = exampleLibrary();
  for (const bad of [null, {}, { ...data, version: 2 }, { ...data, entries: [data.entries[0], data.entries[0]] }, { version: 1, entries: [{ ...data.entries[0], body: ' ' }] }, { version: 1, entries: [{ ...data.entries[0], topics: [null] }] }, { version: 1, entries: [{ ...data.entries[0], createdAt: 'bad' }] }]) assert.throws(() => validateLibrary(bad));
});
