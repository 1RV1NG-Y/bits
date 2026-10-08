import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, Star, X, Settings, Copy, Trash2, Download, Upload, Minus, Square, Check, Sprout } from 'lucide-react';
import { exampleLibrary, selectEntries, validateLibrary } from './model.mjs';
import Modal from './Modal.jsx';
import Editor from './BitDialog.jsx';
import Markdown from './Markdown.mjs';
import { loadLibrary, saveLibrary, exportLibrary, readBackup } from './storage.mjs';

export default function App() {
  const [library, setLibrary] = useState(null);
  const current = useRef(null);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const revision = useRef(0);
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState('');
  const [favorites, setFavorites] = useState(false);
  const [sort, setSort] = useState('newest');
  const [editor, setEditor] = useState(undefined);
  const [settings, setSettings] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [notice, setNotice] = useState(null);
  const [operationError, setOperationError] = useState('');
  const searchRef = useRef(); const importRef = useRef(); const noticeTimer = useRef();
  const notify = (text, undo) => { clearTimeout(noticeTimer.current); setNotice({ text, undo }); if (!undo) noticeTimer.current = setTimeout(() => setNotice(null), 4000); };
  const persist = async data => {
    const rev = ++revision.current; setSaving(true);
    try { await saveLibrary(data); if (rev === revision.current) { setSaveError(''); setSaving(false); } }
    catch (e) { if (rev === revision.current) { setSaveError(e.message); setSaving(false); } }
  };
  const commit = data => {
    try { const valid = validateLibrary(data); current.current = valid; setLibrary(valid); persist(valid); return true; }
    catch (e) { setOperationError(e.message); return false; }
  };
  useEffect(() => { let active = true; loadLibrary().then(data => { if (!active) return; const initial = data || exampleLibrary(); current.current = initial; setLibrary(initial); if (!data) persist(initial); }).catch(e => { if (active) setLoadError(e.message); }); return () => { active = false; }; }, []);
  useEffect(() => { const fn = e => { if (saveError || saving) { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', fn); return () => window.removeEventListener('beforeunload', fn); }, [saveError, saving]);
  useEffect(() => {
    const key = e => {
      if (editor !== undefined || settings || confirm || !library) return;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable;
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing)) { e.preventDefault(); searchRef.current?.focus(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); setEditor(null); }
      if (e.key === 'Escape') { setQuery(''); setTopic(''); }
    }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [editor, settings, confirm, library]);
  const entries = useMemo(() => selectEntries(library?.entries || [], { query, topic, favorites, sort }), [library, query, topic, favorites, sort]);
  const filtered = query.trim() || topic || favorites;
  const remove = entry => {
    if (!commit({ ...current.current, entries: current.current.entries.filter(e => e.id !== entry.id) })) return;
    setEditor(undefined);
    notify('Bit deleted', () => { if (current.current.entries.some(e => e.id === entry.id)) return; if (commit({ ...current.current, entries: [...current.current.entries, entry] })) notify('Bit restored'); });
  };
  const backup = async () => { try { if (await exportLibrary(current.current)) notify('Backup exported'); } catch (e) { setOperationError(e.message); } };
  const importData = data => { if (data) { setSettings(false); setConfirm({ type: 'import', data }); } };
  const chooseImport = async () => {
    setOperationError('');
    if (window.bits) { try { importData(await window.bits.import()); } catch (e) { setOperationError(e.message); } }
    else importRef.current.click();
  };
  return <div className="app">
    <header className="app-header"><div className="brand" aria-label="bits"><span className="brand-mark" aria-hidden="true"><i/><i/><i/><i/></span>bits<span className="brand-dot">.</span></div>
      <div className="header-actions"><button className="icon-button" aria-label="Library settings" title="Library settings" onClick={() => { setSettings(true); setOperationError(''); }}><Settings size={18}/></button><button className="primary" disabled={!library} onClick={() => setEditor(null)}><Plus size={17}/>Add a bit</button>
      {window.bits && <div className="window-controls"><button aria-label="Minimize" onClick={() => window.bits.minimize()}><Minus size={15}/></button><button aria-label="Maximize or restore" onClick={() => window.bits.maximize()}><Square size={12}/></button><button aria-label="Close window" onClick={() => window.bits.close()}><X size={16}/></button></div>}</div>
    </header>
    <main>
      {saveError && <div className="error-banner" role="alert"><span>Changes haven’t been saved: {saveError}</span><button onClick={() => persist(current.current)}>Retry</button><button onClick={backup}>Export backup</button></div>}
      {operationError && !settings && <div className="error-banner" role="alert">{operationError}<button onClick={() => setOperationError('')}>Dismiss</button></div>}
      {loadError ? <div className="recovery"><h1>Your library couldn’t be opened.</h1><p>The original file has been kept intact. Restore a bits backup to continue.</p><p className="muted">{loadError}</p><button className="primary" onClick={chooseImport}><Upload size={16}/>Restore backup</button></div> : !library ? <p className="muted">Opening your bits…</p> : <>
      <div className="search-box"><Search size={19}/><input ref={searchRef} type="search" aria-label="Search bits" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search anything you remember…"/>{query ? <button aria-label="Clear search" className="icon-button" onClick={() => { setQuery(''); searchRef.current.focus(); }}><X size={16}/></button> : <kbd>/</kbd>}</div>
      <div className="toolbar"><div className="tabs"><button aria-pressed={!favorites} onClick={() => setFavorites(false)}>All bits</button><button aria-pressed={favorites} onClick={() => setFavorites(true)}><Star size={14}/>Favorites</button></div><div className="grid-meta"><span className="count" aria-live="polite">{entries.length} {entries.length === 1 ? 'bit' : 'bits'}</span><select aria-label="Sort bits" value={sort} onChange={e => setSort(e.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="updated">Recently edited</option><option value="title">Title A–Z</option></select></div></div>
      {topic && <div className="active-filter"><span>Topic <strong>{topic}</strong></span><button onClick={() => setTopic('')}>Clear topic<X size={13}/></button></div>}
      <div className="grid">{entries.map(entry => <article className="card" key={entry.id}>
        <button className={`favorite icon-button ${entry.favorite ? 'selected' : ''}`} aria-label={`${entry.favorite ? 'Remove from' : 'Add to'} favorites: ${entry.title || entry.body.slice(0, 40)}`} aria-pressed={entry.favorite} onClick={() => commit({ ...current.current, entries: current.current.entries.map(e => e.id === entry.id ? { ...e, favorite: !e.favorite } : e) })}><Star size={15} fill={entry.favorite ? 'currentColor' : 'none'}/></button>
        <div className="card-content">{entry.title && <h2>{entry.title}</h2>}<div className={`card-body ${!entry.title ? 'untitled' : ''}`}><Markdown preview>{entry.body}</Markdown></div></div><button className="card-open" aria-label={`Open bit: ${entry.title || entry.body.slice(0, 60)}`} onClick={() => setEditor(entry)}/>
        {entry.topics.length > 0 && <div className="topics">{entry.topics.map(t => <button key={t.toLowerCase()} onClick={() => setTopic(t)}>{t}</button>)}</div>}
      </article>)}</div>
      {!entries.length && <div className="empty"><Sprout size={30}/><h1>{filtered ? 'Nothing here just yet.' : 'A little worth remembering.'}</h1><p>{filtered ? 'Try a different word, or clear your filters.' : 'Save a paragraph, a list, a command. Anything you want to find again.'}</p>{filtered ? <button className="secondary" onClick={() => { setQuery(''); setTopic(''); setFavorites(false); }}>Clear filters</button> : <button className="primary" onClick={() => setEditor(null)}><Plus size={16}/>Add your first bit</button>}</div>}
      <footer className="library-footer"><span><span className={`status-dot ${saveError ? 'failed' : ''}`}/>{saveError ? 'Unsaved changes' : saving ? 'Saving…' : 'Saved on this device'}</span><span>Small pieces. Less rediscovering.</span></footer>
      </>}
    </main>
    <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={async e => { const file = e.target.files[0]; e.target.value = ''; if (file) { try { importData(await readBackup(file)); } catch (e) { setOperationError(e.message); } } }}/>
    {editor !== undefined && <Editor entry={editor} onClose={() => setEditor(undefined)} onSave={entry => { const exists = current.current.entries.some(e => e.id === entry.id); if (commit({ ...current.current, entries: exists ? current.current.entries.map(e => e.id === entry.id ? entry : e) : [entry, ...current.current.entries] })) { setEditor(entry); if (!exists) { setQuery(''); setTopic(''); setFavorites(false); } notify(exists ? 'Changes saved' : 'Bit added'); return true; } return false; }} onDelete={remove} notify={notify}/>}
    {settings && <Modal title="Your bits" onClose={() => setSettings(false)} className="settings"><p className="muted">A small home for information you don’t want to rediscover. Everything stays on this device.</p><div className="settings-section"><h3>Your library</h3><p>{library?.entries.length ?? '—'} bits · {window.bits ? 'Local file storage' : 'Browser storage (separate from the desktop app)'}</p><div className="button-group"><button className="secondary" disabled={!library} onClick={backup}><Download size={16}/>Export backup</button><button className="secondary" onClick={chooseImport}><Upload size={16}/>Import backup</button></div><small>JSON backups include all your text, topics, favorites, and sources. Import replaces the current library after confirmation.</small></div><div className="settings-section"><h3>Make it yours</h3><p>The first six bits are examples from the concept. Start fresh whenever you’re ready.</p><button className="secondary" disabled={!library} onClick={() => { setSettings(false); setConfirm({ type: 'clear' }); }}>Start with an empty library</button></div><div className="settings-section shortcuts"><h3>Shortcuts</h3><p><span>Search</span><kbd>/ or Ctrl / ⌘ K</kbd></p><p><span>Add a bit</span><kbd>Ctrl / ⌘ N</kbd></p><p><span>Save in editor</span><kbd>Ctrl / ⌘ Enter</kbd></p><p><span>Close / clear filters</span><kbd>Esc</kbd></p></div>{operationError && <p role="alert" className="error-text">{operationError}</p>}</Modal>}
    {confirm && <Modal title={confirm.type === 'import' ? 'Replace your library?' : 'Start fresh?'} onClose={() => setConfirm(null)} className="confirmation"><p>{confirm.type === 'import' ? `This backup contains ${confirm.data.entries.length} bits. It will replace the current library.` : `This removes all ${library?.entries.length || 0} bits, including any you’ve added.`} You can undo this until another notification appears, you dismiss the message, or close the app.</p><div className="button-group"><button className="secondary" onClick={() => setConfirm(null)}>Cancel</button><button className="primary" onClick={() => { const before = current.current; const replacement = confirm.type === 'import' ? confirm.data : { version: 1, entries: [] }; if (commit(replacement)) { setLoadError(''); setConfirm(null); setQuery(''); setTopic(''); setFavorites(false); notify('Library replaced', before ? () => { if (commit(before)) notify('Previous library restored'); } : undefined); } }}> {confirm.type === 'import' ? 'Replace library' : 'Start empty'}</button></div></Modal>}
    {notice && <div className="toast" role="status"><Check size={16}/><span>{notice.text}</span>{notice.undo && <button onClick={notice.undo}>Undo</button>}<button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice(null)}><X size={14}/></button></div>}
  </div>;
}
