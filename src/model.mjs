export const MAX_BACKUP_BYTES = 25 * 1024 * 1024;
export function parseTopics(text) {
  const seen = new Set();
  return text.split(',').map(t => t.trim()).filter(t => {
    const key = t.toLocaleLowerCase();
    if (!t || seen.has(key)) return false;
    seen.add(key); return true;
  });
}
export function validateLibrary(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.entries) || value.entries.length > 50000)
    throw new Error('This is not a supported bits backup (version 1).');
  const ids = new Set();
  const text = (v, max) => typeof v === 'string' && v.length <= max;
  const entries = value.entries.map(e => {
    if (!e || !text(e.id, 100) || !e.id || ids.has(e.id) || !text(e.title, 200) ||
        !text(e.body, 100000) || !e.body.trim() || !text(e.source, 2000) ||
        !Array.isArray(e.topics) || e.topics.length > 30 || !e.topics.every(t => text(t, 80) && t.trim()) ||
        typeof e.favorite !== 'boolean' || !text(e.createdAt, 40) || !Number.isFinite(Date.parse(e.createdAt)) ||
        !text(e.updatedAt, 40) || !Number.isFinite(Date.parse(e.updatedAt)))
      throw new Error('The library contains an invalid or duplicate bit. Nothing was imported.');
    ids.add(e.id);
    return { id: e.id, title: e.title, body: e.body, source: e.source, topics: parseTopics(e.topics.join(',')), favorite: e.favorite, createdAt: e.createdAt, updatedAt: e.updatedAt };
  });
  const result = { version: 1, entries };
  if (new TextEncoder().encode(JSON.stringify(result)).length > MAX_BACKUP_BYTES) throw new Error('The library exceeds the 25 MB limit.');
  return result;
}
const normalize = text => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase();
export function selectEntries(entries, { query = '', topic = '', favorites = false, sort = 'newest' } = {}) {
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  return entries.filter(e => (!favorites || e.favorite) && (!topic || e.topics.some(t => normalize(t) === normalize(topic))) &&
    terms.every(term => normalize([e.title, e.body, ...e.topics, e.source].join(' ')).includes(term)))
    .sort((a, b) => sort === 'oldest' ? Date.parse(a.createdAt) - Date.parse(b.createdAt) :
      sort === 'updated' ? Date.parse(b.updatedAt) - Date.parse(a.updatedAt) :
      sort === 'title' ? (a.title || a.body).localeCompare(b.title || b.body) : Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
export function makeEntry(fields) {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), title: '', body: '', topics: [], source: '', favorite: false, createdAt: now, updatedAt: now, ...fields };
}
export function exampleLibrary() {
  const examples = [
    ['Rust + coding agents', 'DHH says coding agents reduce the productivity cost of Rust enough that he now uses it for web apps.', ['Rust', 'AI agents'], true, 'DHH post — illustrative note from the supplied example'],
    ['Remembering through a sequence', 'When I cannot remember a lyric, starting from an earlier part of the song helps me reach it. I notice a similar pattern with other memories.', ['Memory', 'Personal'], false, 'Personal observation from the supplied example'],
    ['Separate branches, same repository', 'Git worktrees let you work on multiple branches in separate directories without cloning the repository again.', ['Git', 'Development'], false, ''],
    ['My Qwen context notes', 'Escha W2 on my 16 GB GPU:\n• Model: about 10.15 GB on disk\n• Reached about 33k context\n\nA record of my setup, not a general limit.', ['Local AI', 'Hardware'], true, 'Illustrative setup notes from the supplied example'],
    ['Start Termux X11 + XFCE', 'termux-x11 :1 -xstartup "dbus-launch --exit-with-session xfce4-session"', ['Android', 'Linux'], false, 'Command from the supplied example'],
    ['Source → distilled information', 'Keep the smallest piece I would want to retrieve on its own. It can be a sentence, paragraph, short list, or command.', ['Knowledge', 'Design'], false, 'Project notes'],
  ];
  return { version: 1, entries: examples.map(([title, body, topics, favorite, source], i) => makeEntry({ title, body, topics, favorite, source, createdAt: new Date(Date.now() - i * 1000).toISOString() })) };
}

export function webUrl(value) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
