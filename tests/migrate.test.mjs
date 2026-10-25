// Moving the pre-sync library.json into the sync store, against a real sync helper.
// Skipped when the helper isn't built (npm run sync:helper).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { validateLibrary, makeEntry } from '../src/model.mjs';

const require = createRequire(import.meta.url);
const { startHelper, helperPath } = require('../electron/sync-helper.cjs');
const { migrateLegacyLibrary } = require('../electron/migrate.cjs');
const skip = !existsSync(helperPath()) && 'sync helper not built (npm run sync:helper)';
const quiet = { write() {} };

function setup(t) {
  const userData = mkdtempSync(path.join(tmpdir(), 'bits-migrate-'));
  t.after(() => rmSync(userData, { recursive: true, force: true }));
  const entries = [
    makeEntry({ title: 'Kept', body: 'With **markdown**\n\n- and a list', topics: ['Rust', 'Sync'], source: 'https://example.com', favorite: true, createdAt: '2026-01-02T03:04:05.000Z', updatedAt: '2026-02-03T04:05:06.000Z' }),
    makeEntry({ body: 'Untitled bit', createdAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-03-01T00:00:00.000Z' }),
  ];
  const start = () => startHelper({ dataDir: path.join(userData, 'sync'), port: 0, mdns: false, log: quiet });
  return { userData, entries, start };
}

test('moves every bit with its id, dates, topics, source and favorite, once', { skip }, async t => {
  const { userData, entries, start } = setup(t);
  writeFileSync(path.join(userData, 'library.json'), JSON.stringify({ version: 1, entries }));
  const helper = start(); t.after(() => helper.stop());
  await helper.ready;
  assert.deepEqual(await migrateLegacyLibrary({ userData, helper, validate: validateLibrary }), { migrated: 2 });
  assert.ok(!existsSync(path.join(userData, 'library.json')), 'old versions no longer find a library to diverge from');
  assert.deepEqual(JSON.parse(readFileSync(path.join(userData, 'library.pre-sync.json'), 'utf8')).entries, entries, 'the original is kept as a backup');
  const notes = await helper.request('notes');
  for (const e of entries) {
    const n = notes.find(n => n.id === e.id);
    assert.deepEqual({ ...e }, { id: n.id, title: n.title, body: n.body, source: n.source, topics: n.topics, favorite: n.favorite, createdAt: n.createdAt, updatedAt: n.updatedAt });
  }
  assert.equal(await migrateLegacyLibrary({ userData, helper, validate: validateLibrary }), null, 'nothing happens a second time');
  assert.equal((await helper.request('notes')).length, 2);
});

test('an interrupted migration resumes from the backup without duplicates', { skip }, async t => {
  const { userData, entries, start } = setup(t);
  // As if the app stopped after renaming the file and importing part of the library.
  writeFileSync(path.join(userData, 'library.pre-sync.json'), JSON.stringify({ version: 1, entries }));
  const helper = start(); t.after(() => helper.stop());
  await helper.ready;
  await helper.request('importNotes', { notes: [entries[0]] });
  assert.deepEqual(await migrateLegacyLibrary({ userData, helper, validate: validateLibrary }), { migrated: 2 });
  assert.equal((await helper.request('notes')).length, 2);
});

test('an unreadable library is left untouched and reported', { skip }, async t => {
  const { userData, start } = setup(t);
  writeFileSync(path.join(userData, 'library.json'), '{ not json');
  const helper = start(); t.after(() => helper.stop());
  await helper.ready;
  await assert.rejects(migrateLegacyLibrary({ userData, helper, validate: validateLibrary }), /could not be read/);
  assert.equal(readFileSync(path.join(userData, 'library.json'), 'utf8'), '{ not json');
  assert.ok(!existsSync(path.join(userData, 'sync', 'migrated.json')), 'it will be offered again after a restore');
});

test('a fresh install starts empty', { skip }, async t => {
  const { userData, start } = setup(t);
  const helper = start(); t.after(() => helper.stop());
  await helper.ready;
  assert.deepEqual(await migrateLegacyLibrary({ userData, helper, validate: validateLibrary }), { migrated: 0 });
  assert.equal((await helper.request('notes')).length, 0);
});
