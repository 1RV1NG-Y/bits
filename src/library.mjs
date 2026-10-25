// The library the UI works with. In the desktop app it is the sync helper (durable,
// change-by-change, shared with paired devices). In the browser preview it is a single
// localStorage copy with the same operations and no sync.
import { parseTopics } from './model.mjs';

function desktop() {
  const call = (method, params) => window.bits.sync(method, params);
  return {
    synced: true,
    notes: () => call('notes'),
    status: () => call('status'),
    create: fields => call('createNote', fields),
    update: (id, patch) => call('updateNote', { id, patch }),
    setDeleted: (ids, deleted) => call('setDeleted', { ids, deleted }),
    deleteForever: ids => call('deleteForever', { ids }),
    importEntries: entries => call('importNotes', { notes: entries }),
    createInvite: () => call('createInvite'),
    useCode: ticket => call('join', { ticket }),
    removeDevice: id => call('removeDevice', { id }),
    networkChanged: () => call('networkChanged'),
    onEvent: cb => window.bits.onSyncEvent(cb),
    migrationError: () => window.bits.migrationError(),
    migrationResolved: () => window.bits.migrationResolved(),
  };
}

const KEY = 'bits.library.v2';
const LEGACY_KEY = 'bits.library.v1';

function browser() {
  const listeners = new Set();
  const read = () => {
    const stored = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
    return stored === null ? [] : JSON.parse(stored).entries.map(e => ({ deleted: false, ...e }));
  };
  const write = entries => {
    localStorage.setItem(KEY, JSON.stringify({ version: 2, entries }));
    for (const cb of listeners) cb('notesChanged');
  };
  const view = e => ({ ...e, revs: {}, conflicts: undefined });
  const now = () => new Date().toISOString();
  const change = (id, patch) => {
    const entries = read();
    const i = entries.findIndex(e => e.id === id);
    if (i < 0) throw new Error('That bit no longer exists.');
    const { base: _base, ...fields } = patch;
    if (fields.topics) fields.topics = parseTopics(fields.topics.join(','));
    entries[i] = { ...entries[i], ...fields, updatedAt: now() };
    write(entries);
    return view(entries[i]);
  };
  return {
    synced: false,
    notes: async () => read().map(view),
    status: async () => ({ devices: [], unsaved: false }),
    create: async fields => {
      const entry = { id: crypto.randomUUID(), title: '', source: '', topics: [], favorite: false, deleted: false, createdAt: now(), updatedAt: now(), ...fields, topics: parseTopics((fields.topics || []).join(',')) };
      write([entry, ...read()]);
      return view(entry);
    },
    update: async (id, patch) => change(id, patch),
    setDeleted: async (ids, deleted) => { const set = new Set(ids); write(read().map(e => set.has(e.id) ? { ...e, deleted } : e)); return ids.length; },
    deleteForever: async ids => { const set = new Set(ids); write(read().filter(e => !(set.has(e.id) && e.deleted))); return ids.length; },
    importEntries: async incoming => {
      const entries = read(); const have = new Set(entries.map(e => e.id));
      const added = incoming.filter(e => !have.has(e.id)).map(e => ({ ...e, deleted: false }));
      write([...added, ...entries]);
      return { added: added.length, skipped: incoming.length - added.length };
    },
    onEvent: cb => { listeners.add(cb); return () => listeners.delete(cb); },
    migrationError: async () => null,
    migrationResolved: async () => {},
  };
}

export function openLibrary() {
  return window.bits?.sync ? desktop() : browser();
}
