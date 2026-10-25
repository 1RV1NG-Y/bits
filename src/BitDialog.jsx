import React, { useEffect, useRef, useState } from 'react';
import { Eye, Pencil, Copy, Trash2, GitMerge } from 'lucide-react';
import ImageImport from './ImageImport.jsx';
import Modal from './Modal.jsx';
import Markdown from './Markdown.mjs';
import { makeEntry, parseTopics, validateLibrary } from './model.mjs';

function fields(entry) {
  return { title: entry?.title || '', body: entry?.body || '', topics: entry?.topics.join(', ') || '', source: entry?.source || '' };
}
const FIELD_NAMES = { title: 'title', body: 'information', source: 'source' };
export default function BitDialog({ entry, onClose, onSave, onDelete, notify, deviceName = () => 'another device' }) {
  const [baseline, setBaseline] = useState(() => fields(entry));
  const [draft, setDraft] = useState(baseline);
  const [mode, setMode] = useState(entry ? 'read' : 'edit');
  const [discard, setDiscard] = useState(false);
  const [error, setError] = useState('');
  const [ocrBusy, setOcrBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const conflicts = Object.entries(entry?.conflicts || {});
  const textarea = useRef();
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  useEffect(() => { if (mode === 'edit') textarea.current?.focus(); }, [mode]);
  const close = () => dirty ? setDiscard(true) : onClose();
  const update = e => { setDiscard(false); setDraft(d => ({ ...d, [e.target.name]: e.target.value })); };
  const save = async e => {
    e.preventDefault();
    if (ocrBusy || saving) return;
    let result;
    try {
      if (!draft.body.trim()) throw new Error('Write or paste some information to save.');
      result = { ...(entry || makeEntry({})), title: draft.title.trim(), body: draft.body.trim(), topics: parseTopics(draft.topics), source: draft.source.trim(), updatedAt: new Date().toISOString() };
      validateLibrary({ version: 1, entries: [result] });
    } catch (e) { setError(e.message); return; }
    setSaving(true);
    try {
      // The library confirms only once the change is on disk; until then the draft stays.
      // Afterwards the editor continues from the note as saved, which can include fields
      // changed on another device meanwhile; continuing from the draft would send those
      // fields' old values back with the next save.
      const stored = await onSave(result);
      if (stored) { const saved = fields(stored === true ? result : stored); setDraft(saved); setBaseline(saved); setDiscard(false); setError(''); setMode('read'); }
    } finally { setSaving(false); }
  };
  const pickVersion = (field, value) => { setDiscard(false); setDraft(d => ({ ...d, [field]: value })); setMode('edit'); };
  const copy = async () => {
    try { await navigator.clipboard.writeText(draft.body); notify('Text copied'); }
    catch { setError('Could not copy. Select the text and copy it manually.'); }
  };
  const modes = <div className="mode-switch" role="group" aria-label="Bit view">
    <button type="button" disabled={ocrBusy} aria-pressed={mode === 'read'} onClick={() => setMode('read')}><Eye size={16}/>Read</button>
    <button type="button" aria-pressed={mode === 'edit'} onClick={() => setMode('edit')}><Pencil size={15}/>Edit</button>
  </div>;
  return <Modal title={mode === 'read' ? 'Read bit' : entry ? 'Edit bit' : 'Add a bit'} onClose={close} className="bit-dialog" actions={modes}>
    <form onSubmit={save} className="bit-form" onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); save(e); } }}>
      <div className="bit-scroll">
        {conflicts.length > 0 && <section className="conflict" aria-label="Versions from different devices">
          <h3><GitMerge size={15}/>This bit was changed on two devices at the same time</h3>
          <p>Both versions are kept. Pick one, or combine them in the editor. Saving keeps what’s in the editor and settles it on every device.</p>
          {conflicts.map(([field, versions]) => <div key={field} className="conflict-field"><strong>{FIELD_NAMES[field]}</strong>
            {versions.map((v, i) => <div key={i} className="conflict-version"><div className="conflict-meta">{deviceName(v.by)} · {new Date(v.at).toLocaleString()}{draft[field] === v.value && <span className="in-editor">in editor</span>}</div>
              <div className="conflict-value">{v.value || <em>empty</em>}</div>
              <button type="button" className="secondary small" onClick={() => pickVersion(field, v.value)}>Use this version</button></div>)}
          </div>)}
        </section>}
        {entry?.deleted && <p className="draft-notice">This bit is in Trash.</p>}
        {mode === 'read' ? <section className="reader" aria-label="Bit content">
          {dirty && <p className="draft-notice">Previewing unsaved changes</p>}
          {draft.title && <h1 className="reader-title">{draft.title}</h1>}
          {draft.body.trim() ? <Markdown>{draft.body}</Markdown> : <p className="muted">Switch to Edit to write your bit.</p>}
          {parseTopics(draft.topics).length > 0 && <div className="reader-topics">{parseTopics(draft.topics).map(topic => <span key={topic.toLowerCase()}>{topic}</span>)}</div>}
          {draft.source && <div className="reader-source"><span>Source</span><p>{draft.source}</p></div>}
        </section> : <div className="editor-fields">
          <ImageImport onBusyChange={setOcrBusy} onText={text => {
            const combined = draft.body.trim() ? `${draft.body}\n\n${text}` : text;
            if (combined.length > 100000) throw new Error('There is not enough room in this bit. Shorten the text or import into a new bit.');
            setDraft(d => ({ ...d, body: d.body.trim() ? `${d.body}\n\n${text}` : text }));
            setDiscard(false); textarea.current?.focus();
          }}/>

          <label>Title <span>optional</span><input name="title" value={draft.title} onChange={update} maxLength={200} placeholder="A few words to recognize it"/></label>
          <label>Information<textarea ref={textarea} name="body" value={draft.body} onChange={update} maxLength={100000} rows={11} placeholder="Paste or write what you want to remember…" required/><small>Markdown supported: tables, headings, **bold**, lists, and fenced code blocks. Switch to Read to preview.</small></label>
          <label>Topics <span>optional · separated by commas</span><input name="topics" value={draft.topics} onChange={update} placeholder="Rust, coding agents"/><small>Up to 30 topics, 80 characters each.</small></label>
          <details open={draft.source ? true : undefined}><summary>Source <span>optional</span></summary><input name="source" aria-label="Source" value={draft.source} onChange={update} maxLength={2000} placeholder="A URL or a short note about where this came from"/></details>
        </div>}
        {entry && <p className="entry-date">Added {new Date(entry.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</p>}
        {error && <p role="alert" className="error-text">{error}</p>}
        {discard && <div className="discard" role="alert"><span>Discard your unsaved changes?</span><button type="button" onClick={() => setDiscard(false)}>Keep editing</button><button type="button" className="danger" onClick={onClose}>Discard</button></div>}
      </div>
      <footer className="editor-footer"><div className="button-group">
        {entry && !entry.deleted && <button type="button" className="icon-button danger" disabled={ocrBusy} aria-label="Delete bit" title="Delete bit" onClick={() => onDelete(entry)}><Trash2 size={17}/></button>}
        <button type="button" className="secondary" disabled={!draft.body.trim()} onClick={copy}><Copy size={15}/>Copy text</button>
      </div><div className="reader-footer-actions"><span className="resize-hint">Drag corner to resize</span>{(mode === 'edit' || dirty || !entry || conflicts.length > 0) && <button className="primary" type="submit" disabled={ocrBusy || saving}>{saving ? 'Saving…' : conflicts.length && !dirty ? 'Keep this version' : entry ? 'Save changes' : 'Save bit'}</button>}</div></footer>
    </form>
  </Modal>;
}
