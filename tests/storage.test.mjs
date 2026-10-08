import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStorage } from '../electron/storage.cjs';
import { validateLibrary, makeEntry } from '../src/model.mjs';
async function setup(t) { const dir = await mkdtemp(path.join(tmpdir(), 'bits-test-')); t.after(() => rm(dir, { recursive: true, force: true })); return { dir, store: createStorage(dir, validateLibrary) }; }
test('concurrent saves are serialized; the last write and previous backup survive reopening', async t => {
  const { dir, store } = await setup(t); assert.equal(await store.load(), null);
  const data = Array.from({ length: 12 }, (_, i) => ({ version: 1, entries: [makeEntry({ body: `bit ${i}` })] }));
  await Promise.all(data.map(d => store.save(d))); await store.flush();
  assert.deepEqual(await createStorage(dir, validateLibrary).load(), data[11]);
  assert.deepEqual(JSON.parse(await readFile(store.filename + '.bak', 'utf8')), data[10]);
});
test('load failure preserves corrupt file; explicit restore retains corrupt original in backup', async t => {
  const { store } = await setup(t); await writeFile(store.filename, '{broken');
  await assert.rejects(store.load(), /kept intact/);
  assert.equal(await readFile(store.filename, 'utf8'), '{broken');
  await store.save({ version: 1, entries: [] });
  assert.equal(await readFile(store.filename + '.bak', 'utf8'), '{broken');
});
test('invalid save cannot overwrite a good library', async t => {
  const { store } = await setup(t); const data = { version: 1, entries: [makeEntry({ body: 'keep this' })] };
  await store.save(data); assert.throws(() => store.save({ version: 5, entries: [] }));
  assert.deepEqual(await store.load(), data);
});
