// The library the UI works with. In the desktop app it is the sync helper (durable,
// change-by-change, shared with paired devices); on Android, the same sync core linked
// into the app (Tauri). In the browser preview it is a single localStorage copy with the
// same operations and no sync.
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

function android() {
  const tauri = import('@tauri-apps/api/core');
  const call = (method, params = null) => tauri.then(({ invoke }) => invoke('call', { method, params }));
  return {
    synced: true,
    mobile: true,
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
    onEvent: cb => {
      const off = import('@tauri-apps/api/event').then(({ listen }) => listen('sync-event', e => cb(e.payload)));
      return () => { off.then(f => f()); };
    },
    migrationError: async () => null,
    migrationResolved: async () => {},
    scan: async () => {
      const { scan, Format, checkPermissions, requestPermissions } = await import('@tauri-apps/plugin-barcode-scanner');
      let permission = await checkPermissions();
      if (permission !== 'granted') permission = await requestPermissions();
      if (permission !== 'granted') throw new Error('Camera access is needed to scan a code. You can paste the code instead.');
      return (await scan({ formats: [Format.QRCode], windowed: false })).content;
    },
    // Android Back: the handler decides what to close; exit() finishes the activity.
    onBack: handler => {
      const listener = import('@tauri-apps/api/app').then(({ onBackButtonPress }) => onBackButtonPress(handler));
      return () => { listener.then(l => l.unregister()); };
    },
    exit: () => import('@tauri-apps/api/app').then(({ exit }) => exit(0)),
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
  if (window.bits?.sync) return desktop();
  if (window.__TAURI_INTERNALS__) return android();
  return browser();
}
