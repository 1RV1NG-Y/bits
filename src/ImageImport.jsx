import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, Download, LoaderCircle, X } from 'lucide-react';

export default function ImageImport({ onText, onBusyChange }) {
  const api = window.bits;
  const [ready, setReady] = useState(null);
  const [phase, setPhase] = useState('idle');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const generation = useRef(0);
  const busy = useRef(false);
  const onTextRef = useRef(onText); onTextRef.current = onText;
  useEffect(() => {
    let active = true;
    if (api?.ocrStatus) api.ocrStatus().then(result => { if (active) setReady(result.ready); }).catch(() => { if (active) setError('Could not check image import. Close this bit and try again.'); });
    return () => { active = false; generation.current++; if (busy.current) api?.ocrCancel?.().catch(() => {}); onBusyChange(false); };
  }, [api, onBusyChange]);
  const cancel = () => {
    generation.current++; busy.current = false; onBusyChange(false); setPhase('idle'); setMessage('Image import canceled. Your draft is unchanged.');
    api.ocrCancel().catch(() => {});
  };
  const start = async setup => {
    const ticket = ++generation.current;
    busy.current = true; onBusyChange(true); setPhase(setup ? 'setup' : 'extract'); setError(''); setMessage('');
    try {
      if (setup) {
        await api.ocrSetup();
        if (ticket !== generation.current) return;
        setReady(true); setMessage('Image import is ready. Choose an image to extract its text.');
      } else {
        const result = await api.ocrImport();
        if (ticket !== generation.current || result === null) return;
        if (!result.text?.trim()) { setMessage('No text found. Try a clearer image or crop closer to the text.'); return; }
        onTextRef.current(result.text);
        setMessage(`Text extracted from ${result.filename}. Review and edit it below, then save when ready.`);
      }
    } catch (e) { if (ticket === generation.current) setError(e.message); }
    finally { if (ticket === generation.current) { busy.current = false; onBusyChange(false); setPhase('idle'); } }
  };
  if (!api?.ocrImport) return <div className="image-import"><span className="muted"><ImagePlus size={16}/> Image import is available in the desktop app.</span></div>;
  return <div className="image-import">
    <div className="image-import-row">
      {phase === 'idle' ? <button type="button" className="secondary" disabled={ready === null} onClick={() => start(!ready)}>
        {ready === false ? <Download size={16}/> : <ImagePlus size={16}/>}{ready === false ? 'Set up image import' : 'Import from image'}
      </button> : <><span role="status" className="ocr-progress"><LoaderCircle size={16} className="spinner"/>{phase === 'setup' ? 'Downloading and preparing OCR…' : 'Reading image…'}</span><button type="button" className="secondary" onClick={cancel}><X size={14}/>Cancel</button></>}
      <small>{ready === false ? 'One-time download · about 1.3 GB disk space · runs locally' : 'Local OCR · PP-OCRv6 Small'}</small>
    </div>
    {message && <p role="status" className="ocr-message">{message}</p>}
    {error && <p role="alert" className="error-text">{error}</p>}
  </div>;
}
