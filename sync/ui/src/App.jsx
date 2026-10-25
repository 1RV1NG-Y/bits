import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, Star, X, Trash2, RotateCcw, Smartphone, Monitor, Laptop, QrCode, ClipboardPaste, Copy, ScanLine, ArrowLeft, Check, CloudOff, RefreshCw } from 'lucide-react';
import Markdown from '../../../src/Markdown.mjs';
import { connect } from './api.js';

const ago = iso => {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
};
const normalize = t => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase();
const PlatformIcon = ({ platform, size = 18 }) => platform === 'android' ? <Smartphone size={size}/> : platform === 'windows' ? <Laptop size={size}/> : <Monitor size={size}/>;

export default function App() {
  const [api, setApi] = useState(null);
  const [fatal, setFatal] = useState('');
  const [notes, setNotes] = useState([]);
  const [status, setStatus] = useState(null);
  const [view, setView] = useState('notes');
  const [editing, setEditing] = useState(undefined); // undefined: closed, null: new, note: existing
  const [query, setQuery] = useState('');
  const [trash, setTrash] = useState(false);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const toastTimer = useRef();

  const notify = text => { clearTimeout(toastTimer.current); setToast(text); toastTimer.current = setTimeout(() => setToast(''), 2600); };
  const refreshNotes = useCallback(async a => setNotes(await (a || api).call('notes')), [api]);
  const refreshStatus = useCallback(async a => setStatus(await (a || api).call('status')), [api]);

  useEffect(() => {
    let off = () => {};
    connect().then(async a => {
      setApi(a);
      off = a.onEvent(event => {
        if (event === 'notesChanged') refreshNotes(a).catch(() => {});
        if (event === 'statusChanged') refreshStatus(a).catch(() => {});
        if (event === 'helperStopped') setFatal('The sync helper stopped. Restart the app to continue.');
      });
      await Promise.all([refreshNotes(a), refreshStatus(a)]);
    }).catch(e => setFatal(e.message || String(e)));
    return () => off();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Android Back closes the editor, then returns to Notes, then leaves the app.
  const back = useRef(null);
  back.current = () => {
    if (editorBack.current) editorBack.current();
    else if (view !== 'notes') setView('notes');
    else api?.exit?.();
  };
  const editorBack = useRef(null);
  useEffect(() => {
    if (!api?.onBack) return;
    const listener = api.onBack(() => back.current());
    return () => { listener.then(l => l.unregister()).catch(() => {}); };
  }, [api]);

  // Coming back to the foreground: the network may have changed while we were away.
  useEffect(() => {
    if (!api) return;
    const visible = () => { if (document.visibilityState === 'visible') api.call('networkChanged').catch(() => {}); };
    document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  }, [api]);

  // "Last seen" labels age while nothing else changes.
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 15000); return () => clearInterval(t); }, []);

  const shown = useMemo(() => {
    const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
    return notes.filter(n => n.deleted === trash && terms.every(t => normalize([n.title, n.body, ...n.topics, n.source].join(' ')).includes(t)));
  }, [notes, query, trash]);

  const call = async (method, params) => {
    setError('');
    try { return await api.call(method, params); }
    catch (e) { setError(e.message || String(e)); throw e; }
  };

  if (fatal) return <div className="app"><div className="center-message"><CloudOff size={28}/><h1>Sync isn’t running</h1><p className="muted">{fatal}</p></div></div>;
  if (!api || !status) return <div className="app"><div className="center-message"><p className="muted">Starting sync…</p></div></div>;

  const others = status.devices.filter(d => !d.isSelf && !d.removed);
  return <div className="app">
    <header className="top">
      <div className="brand"><span className="brand-mark" aria-hidden="true"><i/><i/><i/><i/></span>bits<span className="tag">sync prototype</span></div>
      <nav className="tabs" aria-label="Sections">
        <button aria-pressed={view === 'notes'} onClick={() => setView('notes')}>Notes</button>
        <button aria-pressed={view === 'devices'} onClick={() => setView('devices')}>Devices{others.length > 0 && <span className="badge">{others.filter(d => d.connected).length}/{others.length}</span>}</button>
      </nav>
    </header>
    <main>
      {error && <div className="banner" role="alert"><span>{error}</span><button className="icon-button" aria-label="Dismiss" onClick={() => setError('')}><X size={16}/></button></div>}
      {view === 'notes' ? <>
        <div className="search"><Search size={18}/><input type="search" placeholder="Search notes…" aria-label="Search notes" value={query} onChange={e => setQuery(e.target.value)}/>{query && <button className="icon-button" aria-label="Clear search" onClick={() => setQuery('')}><X size={16}/></button>}</div>
        <div className="toolbar">
          <div className="segmented"><button aria-pressed={!trash} onClick={() => setTrash(false)}>All notes</button><button aria-pressed={trash} onClick={() => setTrash(true)}><Trash2 size={14}/>Trash</button></div>
          {!trash && <button className="primary" onClick={() => setEditing(null)}><Plus size={17}/>New note</button>}
        </div>
        <div className="list">{shown.map(n => <article key={n.id} className="card">
          <button className={`star icon-button ${n.favorite ? 'on' : ''}`} aria-pressed={n.favorite} aria-label={n.favorite ? 'Remove from favorites' : 'Add to favorites'} onClick={() => call('updateNote', { id: n.id, patch: { favorite: !n.favorite } }).catch(() => {})}><Star size={16} fill={n.favorite ? 'currentColor' : 'none'}/></button>
          <button className="card-open" onClick={() => setEditing(n)} aria-label={`Open ${n.title || n.body.slice(0, 40)}`}/>
          {n.title && <h2>{n.title}</h2>}
          <div className="card-body"><Markdown preview>{n.body}</Markdown></div>
          <div className="card-meta">{n.topics.map(t => <span key={t} className="topic">{t}</span>)}<span className="when">edited {ago(n.updatedAt)}</span></div>
        </article>)}</div>
        {!shown.length && <div className="center-message small"><p className="muted">{query ? 'No notes match.' : trash ? 'Trash is empty.' : 'No notes yet. Add one here or on another device.'}</p></div>}
      </> : <Devices api={api} status={status} call={call} notify={notify} setError={setError} onPaired={() => { refreshStatus(); refreshNotes(); }}/>}
    </main>
    <SyncBar status={status} onOpen={() => setView('devices')}/>
    {editing !== undefined && <Editor key={editing?.id || 'new'} note={editing} latest={editing && notes.find(n => n.id === editing.id)} call={call} notify={notify} backRef={editorBack} onClose={() => setEditing(undefined)}/>}
    {toast && <div className="toast" role="status"><Check size={15}/>{toast}</div>}
  </div>;
}

function SyncBar({ status, onOpen }) {
  const others = status.devices.filter(d => !d.isSelf && !d.removed);
  let text = 'Saved on this device';
  let tone = 'ok';
  if (status.unsaved) { text = 'Not saved to disk — retrying with your next change'; tone = 'bad'; }
  else if (others.length) {
    const missing = others.filter(d => !d.hasAllMyChanges);
    if (!missing.length) text = others.length === 1 ? `Saved here · received by ${others[0].name}` : 'Saved here · received by all your devices';
    else { text = `Saved here · not yet received by ${missing.map(d => d.name).join(', ')}`; tone = 'wait'; }
  }
  return <footer className="syncbar"><button onClick={onOpen}><span className={`dot ${tone}`}/>{text}</button></footer>;
}

function Editor({ note, latest, call, notify, backRef, onClose }) {
  const fields = n => ({ title: n?.title || '', body: n?.body || '', topics: (n?.topics || []).join(', '), source: n?.source || '' });
  const [base, setBase] = useState(() => fields(note));
  const [draft, setDraft] = useState(() => fields(note));
  // The versions this editor is based on; a save replaces only these.
  const [revs, setRevs] = useState(() => note?.revs || {});
  const [busy, setBusy] = useState(false);
  const dirty = Object.keys(draft).some(k => draft[k] !== base[k]);
  const current = latest ? fields(latest) : null;
  // Another device changed a field this draft hasn't touched: take theirs quietly.
  // If the user is editing the same field, keep the draft and show a notice.
  const remoteChanged = current && Object.keys(base).filter(k => current[k] !== base[k]);
  const conflicts = remoteChanged ? remoteChanged.filter(k => draft[k] !== base[k] && draft[k] !== current[k]) : [];
  useEffect(() => {
    if (!remoteChanged?.length) return;
    const quiet = remoteChanged.filter(k => draft[k] === base[k]);
    if (quiet.length) {
      setDraft(d => ({ ...d, ...Object.fromEntries(quiet.map(k => [k, current[k]])) }));
      setBase(b => ({ ...b, ...Object.fromEntries(quiet.map(k => [k, current[k]])) }));
      setRevs(r => ({ ...r, ...Object.fromEntries(quiet.filter(k => latest.revs?.[k]).map(k => [k, latest.revs[k]])) }));
    }
  }, [latest]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!draft.body.trim()) return;
    setBusy(true);
    try {
      const topics = draft.topics.split(',');
      if (!note) await call('createNote', { title: draft.title, body: draft.body, source: draft.source, topics });
      else {
        // Send only the fields changed since the version this editor opened.
        // Fields with versions from two devices are always sent, settling them to the draft.
        const stored = latest?.conflicts || {};
        const patch = {};
        for (const k of Object.keys(draft)) if (draft[k] !== base[k] || stored[k]) patch[k] = k === 'topics' ? topics : draft[k];
        if (Object.keys(patch).length) await call('updateNote', { id: note.id, patch: { ...patch, base: { ...revs, ...Object.fromEntries(Object.keys(stored).map(k => [k, latest.revs[k]])) } } });
      }
      notify(note ? 'Saved' : 'Note added');
      onClose();
    } catch { setBusy(false); }
  };
  const setDeleted = async deleted => {
    try { await call('updateNote', { id: note.id, patch: { deleted } }); notify(deleted ? 'Moved to Trash' : 'Restored'); onClose(); } catch { /* shown in banner */ }
  };
  const close = () => { if (!dirty || confirm('Discard your changes?')) onClose(); };
  backRef.current = close;
  useEffect(() => () => { backRef.current = null; }, [backRef]);
  useEffect(() => {
    const key = e => { if (e.key === 'Escape') close(); if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') save(); };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });
  return <div className="sheet-backdrop"><section className="sheet" role="dialog" aria-modal="true" aria-label={note ? 'Edit note' : 'New note'}>
    <header className="sheet-header"><button className="icon-button" aria-label="Close" onClick={close}><ArrowLeft size={19}/></button><h2>{note ? 'Edit note' : 'New note'}</h2>
      {note && (note.deleted ? <button className="secondary" onClick={() => setDeleted(false)}><RotateCcw size={15}/>Restore</button> : <button className="icon-button danger" aria-label="Move to Trash" onClick={() => setDeleted(true)}><Trash2 size={17}/></button>)}
    </header>
    {latest?.conflicts && Object.entries(latest.conflicts).map(([field, versions]) => <div key={field} className="banner warn versions">
      <span>The {field === 'body' ? 'information' : field} was changed on two devices at once. Both versions are kept; pick one or combine them, then save.</span>
      {versions.map((v, i) => <button key={i} className="secondary small" onClick={() => setDraft(d => ({ ...d, [field]: v.value }))}>Use: {v.value.slice(0, 40) || '(empty)'}{v.value.length > 40 ? '…' : ''}</button>)}
    </div>)}
    {conflicts.length > 0 && <div className="banner warn">Another device changed {conflicts.join(', ')} while you were editing. Saving keeps your version.</div>}
    <label>Title<input value={draft.title} maxLength={200} placeholder="Optional" onChange={e => setDraft({ ...draft, title: e.target.value })}/></label>
    <label className="grow">Information<textarea value={draft.body} autoFocus={!note} placeholder="Write or paste something worth keeping" onChange={e => setDraft({ ...draft, body: e.target.value })}/></label>
    <label>Topics<input value={draft.topics} placeholder="Comma separated" onChange={e => setDraft({ ...draft, topics: e.target.value })}/></label>
    <label>Source<input value={draft.source} placeholder="Optional" onChange={e => setDraft({ ...draft, source: e.target.value })}/></label>
    <div className="sheet-actions"><button className="secondary" onClick={close}>Cancel</button><button className="primary" disabled={busy || !draft.body.trim() || (note && !dirty && !latest?.conflicts)} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></div>
  </section></div>;
}

function Devices({ api, status, call, notify, setError, onPaired }) {
  const [invite, setInvite] = useState(null);
  const [joining, setJoining] = useState(false);
  const [ticket, setTicket] = useState('');
  const [busy, setBusy] = useState(false);
  const others = status.devices.filter(d => !d.isSelf);
  const paired = others.some(d => !d.removed);

  const join = async text => {
    setBusy(true);
    try { const r = await call('join', { ticket: text }); notify(r.joined ? `Joined ${r.device}’s library` : `Added ${r.device}`); setJoining(false); setTicket(''); onPaired(); }
    catch { /* banner */ } finally { setBusy(false); }
  };
  const scan = async () => {
    let text;
    try { text = await api.scan(); }
    catch (e) { if (!/cancel/i.test(String(e))) setError(e?.message || String(e)); return; }
    if (text) await join(text);
  };

  return <div className="devices">
    <section className="panel">
      <div className="device-row self"><span className="device-icon"><PlatformIcon platform={status.platform}/></span><div><h2>{status.deviceName}</h2><small>This device · {status.deviceId.slice(0, 10)}…</small><small>{status.addresses.filter(a => !a.startsWith('[')).join(' · ') || 'No network address yet'}</small></div></div>
    </section>

    <section className="panel">
      <div className="panel-head"><h3>Your devices</h3></div>
      {!others.length && <p className="muted">No other devices yet.</p>}
      {others.map(d => <div key={d.id} className={`device-row ${d.removed ? 'removed' : ''}`}>
        <span className="device-icon"><PlatformIcon platform={d.platform}/></span>
        <div className="device-text"><h2>{d.name}</h2>
          <small>{d.removed ? 'Removed' : d.connected ? <><span className="dot ok"/>Connected</> : <><span className="dot off"/>Last seen {ago(d.lastSeen)}</>}{!d.removed && (d.hasAllMyChanges ? ' · has all your changes' : ' · waiting for your latest changes')}</small>
          {!d.connected && !d.removed && d.lastError && <small className="error-text">{d.lastError}</small>}
        </div>
        {!d.removed && <button className="secondary small" onClick={() => { if (confirm(`Remove ${d.name}? It will stop receiving changes.`)) call('removeDevice', { id: d.id }).catch(() => {}); }}>Remove</button>}
      </div>)}
    </section>

    <section className="panel">
      <div className="panel-head"><h3>{paired ? 'Add a device' : 'Connect to your other devices'}</h3></div>
      <p className="muted">{paired
        ? 'Scan the code a new device shows, or show this device’s code on a new phone. Both need to be on the same Wi-Fi.'
        : 'Scan the code on a device you already use. If this device can’t scan (like a PC), show its code and scan it from your phone. Notes already here are kept and shared.'}</p>
      {invite ? <div className="invite">
        <div className="qr" dangerouslySetInnerHTML={{ __html: invite.qrSvg }}/>
        <p>{invite.kind === 'Add'
          ? <>On a device you already use, open <strong>Devices → Scan code</strong> and scan this.</>
          : <>On the new device, open <strong>Devices → Scan code</strong> and scan this.</>} You can also paste the text below. It works once and expires at {new Date(invite.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.</p>
        <textarea readOnly className="ticket" value={invite.ticket} onFocus={e => e.target.select()}/>
        <div className="button-row"><button className="secondary" onClick={() => api.copy(invite.ticket).then(() => notify('Copied')).catch(() => {})}><Copy size={15}/>Copy text</button><button className="secondary" onClick={() => setInvite(null)}>Done</button></div>
      </div> : joining ? <>
        <textarea className="ticket" placeholder="Paste the code (starts with BITS2)" value={ticket} onChange={e => setTicket(e.target.value)}/>
        <div className="button-row"><button className="secondary" onClick={() => setJoining(false)}>Cancel</button><button className="primary" disabled={busy || !ticket.trim()} onClick={() => join(ticket)}>{busy ? 'Connecting…' : 'Connect'}</button></div>
      </> : <div className="button-row">
        {api.scan && <button className="primary" disabled={busy} onClick={scan}><ScanLine size={16}/>{busy ? 'Connecting…' : 'Scan code'}</button>}
        <button className={api.scan ? 'secondary' : 'primary'} onClick={() => call('createInvite').then(setInvite).catch(() => {})}><QrCode size={16}/>Show this device’s code</button>
        <button className="secondary" onClick={() => setJoining(true)}><ClipboardPaste size={15}/>Paste code</button>
      </div>}
    </section>
    <p className="footnote">Library {status.libraryId.slice(0, 8)} · sync over the local network only <RefreshCw size={11}/></p>
  </div>;
}
