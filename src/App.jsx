import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, Star, X, Settings, Trash2, Download, Upload, Minus, Square, Check, Sprout, MonitorSmartphone, RotateCcw, GitMerge } from 'lucide-react';
import { selectEntries } from './model.mjs';
import Modal from './Modal.jsx';
import Editor from './BitDialog.jsx';
import Devices from './Devices.jsx';
import Markdown from './Markdown.mjs';
import { openLibrary } from './library.mjs';
import { exportLibrary, readBackup } from './storage.mjs';

const toImported = ({ id, title, body, source, topics, favorite, createdAt, updatedAt }) => ({ id, title, body, source, topics, favorite, createdAt, updatedAt });

export default function App() {
  const library = useMemo(openLibrary, []);
  const [notes, setNotes] = useState(null);
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState('');
  const [view, setView] = useState('all');
  const [sort, setSort] = useState('newest');
  const [editor, setEditor] = useState(undefined);
  const [settings, setSettings] = useState(false);
  const [devices, setDevices] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [notice, setNotice] = useState(null);
  const [operationError, setOperationError] = useState('');
  const searchRef = useRef(); const importRef = useRef(); const noticeTimer = useRef();
  const notify = (text, undo) => { clearTimeout(noticeTimer.current); setNotice({ text, undo }); if (!undo) noticeTimer.current = setTimeout(() => setNotice(null), 4000); };
  // Every change goes straight to the library, which confirms only once it is on disk.
  const run = async action => { setOperationError(''); try { return await action(); } catch (e) { setOperationError(e.message || String(e)); return undefined; } };
  const refresh = () => Promise.all([library.notes().then(setNotes), library.status().then(setStatus)]);

  useEffect(() => {
    let active = true;
    const off = library.onEvent(event => {
      if (event === 'notesChanged') library.notes().then(n => active && setNotes(n)).catch(() => {});
      if (event === 'statusChanged') library.status().then(s => active && setStatus(s)).catch(() => {});
      if (event === 'helperStopped') setLoadError('Sync stopped unexpectedly. Restart bits to continue; your saved bits are safe.');
    });
    (async () => {
      const migration = await library.migrationError();
      if (!active) return;
      if (migration) setLoadError(migration);
      await refresh();
    })().catch(e => active && setLoadError(e.message || String(e)));
    return () => { active = false; off(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const key = e => {
      if (editor !== undefined || settings || devices || confirm || !notes) return;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable;
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing)) { e.preventDefault(); searchRef.current?.focus(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); setEditor(null); }
      if (e.key === 'Escape') { setQuery(''); setTopic(''); }
    }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [editor, settings, devices, confirm, notes]);

  // Android Back: close the open dialog (it runs its own unsaved-changes check), then
  // clear filters, then leave the app.
  const back = useRef(); back.current = () => {
    const open = [...document.querySelectorAll('dialog[open]')];
    if (open.length) open.at(-1).dispatchEvent(new Event('cancel', { cancelable: true }));
    else if (query || topic || view !== 'all') { setQuery(''); setTopic(''); setView('all'); }
    else library.exit();
  };
  useEffect(() => library.onBack?.(() => back.current()), [library]);
  // Back in the foreground: the network may have changed while the app was in the background.
  useEffect(() => {
    if (!library.mobile) return;
    const visible = () => { if (document.visibilityState === 'visible') library.networkChanged().catch(() => {}); };
    document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  }, [library]);

  const live = useMemo(() => (notes || []).filter(n => !n.deleted), [notes]);
  const trash = useMemo(() => (notes || []).filter(n => n.deleted), [notes]);
  const entries = useMemo(() => selectEntries(view === 'trash' ? trash : live, { query, topic, favorites: view === 'favorites', sort }), [live, trash, view, query, topic, sort]);
  const filtered = query.trim() || topic || view !== 'all';
  const deviceName = id => { const d = status?.devices.find(d => d.id === id); return d?.isSelf ? 'This device' : d?.name || 'another device'; };

  const save = async (result, opened) => {
    if (!opened) {
      const created = await run(() => library.create({ title: result.title, body: result.body, topics: result.topics, source: result.source }));
      if (!created) return false;
      setEditor(created); setQuery(''); setTopic(''); setView('all'); notify('Bit added'); return created;
    }
    // Send only what changed since the editor opened, based on the versions it opened.
    // Fields in conflict are always sent, so saving settles them to what's in the editor.
    const patch = { base: opened.revs };
    for (const k of ['title', 'body', 'source']) if (result[k] !== opened[k] || opened.conflicts?.[k]) patch[k] = result[k];
    // Topics change relative to the ones the editor opened with, so topics added elsewhere stay.
    if (JSON.stringify(result.topics) !== JSON.stringify(opened.topics)) { patch.topics = result.topics; patch.baseTopics = opened.topics; }
    const saved = await run(() => library.update(opened.id, patch));
    if (!saved) return false;
    setEditor(saved); notify(Object.keys(saved.conflicts || {}).length ? 'Saved — another device changed this bit too; both versions are kept' : 'Changes saved');
    // The editor continues from the note as saved, including changes from other devices.
    return saved;
  };
  const remove = async entry => {
    if (await run(() => library.setDeleted([entry.id], true)) === undefined) return;
    setEditor(undefined);
    notify('Moved to Trash', () => run(() => library.setDeleted([entry.id], false)).then(r => r !== undefined && notify('Bit restored')));
  };
  const backup = async () => { const data = { version: 1, entries: live.map(toImported) }; if (await run(() => exportLibrary(data))) notify('Backup exported'); };
  const importData = data => {
    if (!data) return;
    const have = new Set((notes || []).map(n => n.id));
    setSettings(false); setConfirm({ type: 'import', data, added: data.entries.filter(e => !have.has(e.id)).length });
  };
  const chooseImport = async () => {
    setOperationError('');
    if (window.bits) { const data = await run(() => window.bits.import()); importData(data); }
    else importRef.current.click();
  };
  const confirmImport = async () => {
    const result = await run(() => library.importEntries(confirm.data.entries.map(toImported)));
    if (!result) return;
    if (loadError) { await library.migrationResolved(); setLoadError(''); await refresh().catch(() => {}); }
    setConfirm(null); setQuery(''); setTopic(''); setView('all');
    notify(`Imported ${result.added} ${result.added === 1 ? 'bit' : 'bits'}${result.skipped ? ` · ${result.skipped} already here` : ''}`);
  };
  const trashAll = async () => {
    const ids = live.map(n => n.id);
    if (await run(() => library.setDeleted(ids, true)) === undefined) return;
    setConfirm(null); setQuery(''); setTopic(''); setView('all');
    notify(`Moved ${ids.length} bits to Trash`, () => run(() => library.setDeleted(ids, false)).then(r => r !== undefined && notify('Bits restored')));
  };
  const others = (status?.devices || []).filter(d => !d.isSelf && !d.removed);
  const missing = others.filter(d => !d.hasAllMyChanges);
  const syncText = status?.unsaved ? 'Not saved to disk — retrying' : !others.length ? 'Saved on this device'
    : missing.length ? `Saved here · not yet received by ${missing.map(d => d.name).join(', ')}` : `Saved here · received by ${others.length === 1 ? others[0].name : 'all your devices'}`;

  return <div className="app">
    <header className="app-header"><div className="brand" aria-label="bits"><span className="brand-mark" aria-hidden="true"><i/><i/><i/><i/></span>bits<span className="brand-dot">.</span></div>
      <div className="header-actions">
        {library.synced && <button className="icon-button" aria-label="Devices" title="Devices" disabled={!status} onClick={() => setDevices(true)}><MonitorSmartphone size={18}/></button>}
        <button className="icon-button" aria-label="Library settings" title="Library settings" onClick={() => { setSettings(true); setOperationError(''); }}><Settings size={18}/></button><button className="primary" disabled={!notes} onClick={() => setEditor(null)}><Plus size={17}/>Add a bit</button>
      {window.bits && <div className="window-controls"><button aria-label="Minimize" onClick={() => window.bits.minimize()}><Minus size={15}/></button><button aria-label="Maximize or restore" onClick={() => window.bits.maximize()}><Square size={12}/></button><button aria-label="Close window" onClick={() => window.bits.close()}><X size={16}/></button></div>}</div>
    </header>
    <main>
      {operationError && !settings && !devices && <div className="error-banner" role="alert">{operationError}<button onClick={() => setOperationError('')}>Dismiss</button></div>}
      {loadError ? <div className="recovery"><h1>Your library couldn’t be opened.</h1><p>Nothing has been changed or deleted. Restore a bits backup to continue.</p><p className="muted">{loadError}</p><button className="primary" onClick={chooseImport}><Upload size={16}/>Restore backup</button></div> : !notes ? <p className="muted">Opening your bits…</p> : <>
      <div className="search-box"><Search size={19}/><input ref={searchRef} type="search" aria-label="Search bits" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search anything you remember…"/>{query ? <button aria-label="Clear search" className="icon-button" onClick={() => { setQuery(''); searchRef.current.focus(); }}><X size={16}/></button> : <kbd>/</kbd>}</div>
      <div className="toolbar"><div className="tabs"><button aria-pressed={view === 'all'} onClick={() => setView('all')}>All bits</button><button aria-pressed={view === 'favorites'} onClick={() => setView('favorites')}><Star size={14}/>Favorites</button><button aria-pressed={view === 'trash'} onClick={() => setView('trash')}><Trash2 size={14}/>Trash{trash.length > 0 && <span className="tab-count">{trash.length}</span>}</button></div><div className="grid-meta"><span className="count" aria-live="polite">{entries.length} {entries.length === 1 ? 'bit' : 'bits'}</span><select aria-label="Sort bits" value={sort} onChange={e => setSort(e.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="updated">Recently edited</option><option value="title">Title A–Z</option></select></div></div>
      {view === 'trash' && trash.length > 0 && <div className="active-filter"><span>Bits in Trash are kept until you delete them for good.</span><button onClick={() => setConfirm({ type: 'empty-trash' })}>Empty Trash<Trash2 size={13}/></button></div>}
      {topic && <div className="active-filter"><span>Topic <strong>{topic}</strong></span><button onClick={() => setTopic('')}>Clear topic<X size={13}/></button></div>}
      <div className="grid">{entries.map(entry => <article className="card" key={entry.id}>
        {view === 'trash'
          ? <button className="favorite icon-button" aria-label={`Restore: ${entry.title || entry.body.slice(0, 40)}`} title="Restore" onClick={() => run(() => library.setDeleted([entry.id], false)).then(r => r !== undefined && notify('Bit restored'))}><RotateCcw size={15}/></button>
          : <button className={`favorite icon-button ${entry.favorite ? 'selected' : ''}`} aria-label={`${entry.favorite ? 'Remove from' : 'Add to'} favorites: ${entry.title || entry.body.slice(0, 40)}`} aria-pressed={entry.favorite} onClick={() => run(() => library.update(entry.id, { favorite: !entry.favorite }))}><Star size={15} fill={entry.favorite ? 'currentColor' : 'none'}/></button>}
        <div className="card-content">{entry.title && <h2>{entry.title}</h2>}<div className={`card-body ${!entry.title ? 'untitled' : ''}`}><Markdown preview>{entry.body}</Markdown></div></div><button className="card-open" aria-label={`Open bit: ${entry.title || entry.body.slice(0, 60)}`} onClick={() => setEditor(entry)}/>
        {(entry.topics.length > 0 || entry.conflicts) && <div className="topics">{entry.conflicts && <span className="conflict-badge"><GitMerge size={12}/>Two versions</span>}{entry.topics.map(t => <button key={t.toLowerCase()} onClick={() => setTopic(t)}>{t}</button>)}</div>}
      </article>)}</div>
      {!entries.length && <div className="empty"><Sprout size={30}/><h1>{view === 'trash' ? 'Trash is empty.' : filtered ? 'Nothing here just yet.' : 'A little worth remembering.'}</h1><p>{view === 'trash' ? 'Deleted bits wait here until you delete them for good.' : filtered ? 'Try a different word, or clear your filters.' : 'Save a paragraph, a list, a command. Anything you want to find again.'}</p>{view === 'trash' ? null : filtered ? <button className="secondary" onClick={() => { setQuery(''); setTopic(''); setView('all'); }}>Clear filters</button> : <button className="primary" onClick={() => setEditor(null)}><Plus size={16}/>Add your first bit</button>}</div>}
      <footer className="library-footer"><button className="sync-status" disabled={!library.synced} onClick={() => setDevices(true)}><span className={`status-dot ${status?.unsaved ? 'failed' : missing.length ? 'waiting' : ''}`}/>{syncText}</button><span>Small pieces. Less rediscovering.</span></footer>
      </>}
    </main>
    <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={async e => { const file = e.target.files[0]; e.target.value = ''; if (file) importData(await run(() => readBackup(file))); }}/>
    {editor !== undefined && <Editor entry={editor} deviceName={deviceName} onClose={() => setEditor(undefined)} onSave={result => save(result, editor)} onDelete={remove} notify={notify}/>}
    {devices && status && <Devices library={library} status={status} notify={notify} onClose={() => setDevices(false)}/>}
    {settings && <Modal title="Your bits" onClose={() => setSettings(false)} className="settings"><p className="muted">A small home for information you don’t want to rediscover. {library.synced ? 'Everything stays on your own devices.' : 'Everything stays on this device.'}</p><div className="settings-section"><h3>Your library</h3><p>{live.length} bits{trash.length ? ` · ${trash.length} in Trash` : ''} · {library.synced ? 'Saved on this device and synced to your paired devices' : 'Browser storage (separate from the desktop app)'}</p>{library.mobile ? <small>Backups are made from a desktop device: everything here syncs to it.</small> : <><div className="button-group"><button className="secondary" disabled={!notes} onClick={backup}><Download size={16}/>Export backup</button><button className="secondary" onClick={chooseImport}><Upload size={16}/>Import backup</button></div><small>JSON backups include all your text, topics, favorites, and sources. Importing adds the bits you don’t have yet; nothing is replaced.</small></>}</div><div className="settings-section"><h3>Start fresh</h3><p>Move every bit to Trash. You can restore them from Trash later.</p><button className="secondary" disabled={!live.length} onClick={() => { setSettings(false); setConfirm({ type: 'clear' }); }}>Move all bits to Trash</button></div>{!library.mobile && <div className="settings-section shortcuts"><h3>Shortcuts</h3><p><span>Search</span><kbd>/ or Ctrl / ⌘ K</kbd></p><p><span>Add a bit</span><kbd>Ctrl / ⌘ N</kbd></p><p><span>Save in editor</span><kbd>Ctrl / ⌘ Enter</kbd></p><p><span>Close / clear filters</span><kbd>Esc</kbd></p></div>}{operationError && <p role="alert" className="error-text">{operationError}</p>}</Modal>}
    {confirm && <Modal title={confirm.type === 'import' ? 'Import bits?' : confirm.type === 'clear' ? 'Move everything to Trash?' : 'Empty Trash?'} onClose={() => setConfirm(null)} className="confirmation">
      <p>{confirm.type === 'import' ? `This backup has ${confirm.data.entries.length} bits. ${confirm.added} will be added; ${confirm.data.entries.length - confirm.added} are already in your library and stay as they are.`
        : confirm.type === 'clear' ? `All ${live.length} bits move to Trash on this and your other devices. You can restore them from Trash.`
        : `This permanently deletes ${trash.length} bits on this and your other devices. It can’t be undone.`}</p>
      {operationError && <p role="alert" className="error-text">{operationError}</p>}
      <div className="button-group"><button className="secondary" onClick={() => setConfirm(null)}>Cancel</button>
        {confirm.type === 'import' && <button className="primary" onClick={confirmImport}>Import {confirm.added} {confirm.added === 1 ? 'bit' : 'bits'}</button>}
        {confirm.type === 'clear' && <button className="primary" onClick={trashAll}>Move to Trash</button>}
        {confirm.type === 'empty-trash' && <button className="primary danger" onClick={async () => { if (await run(() => library.deleteForever(trash.map(n => n.id))) !== undefined) { setConfirm(null); notify('Trash emptied'); } }}>Delete forever</button>}
      </div></Modal>}
    {notice && <div className="toast" role="status"><Check size={16}/><span>{notice.text}</span>{notice.undo && <button onClick={notice.undo}>Undo</button>}<button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice(null)}><X size={14}/></button></div>}
  </div>;
}
