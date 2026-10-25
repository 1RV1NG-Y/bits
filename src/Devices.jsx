import React, { useState } from 'react';
import { Smartphone, Monitor, Laptop, QrCode, ClipboardPaste, Copy, ScanLine } from 'lucide-react';
import Modal from './Modal.jsx';

export const ago = iso => {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
};
const PlatformIcon = ({ platform }) => platform === 'android' ? <Smartphone size={18}/> : platform === 'windows' ? <Laptop size={18}/> : <Monitor size={18}/>;

/** Paired devices, and pairing a new one by showing or pasting a code. */
export default function Devices({ library, status, onClose, notify }) {
  const [invite, setInvite] = useState(null);
  const [pasting, setPasting] = useState(false);
  const [ticket, setTicket] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const others = status.devices.filter(d => !d.isSelf);
  const paired = others.some(d => !d.removed);
  const run = async action => { setError(''); try { return await action(); } catch (e) { setError(e.message || String(e)); } };
  const connect = async () => {
    setBusy(true);
    const result = await run(() => library.useCode(ticket));
    setBusy(false);
    if (result) { notify(result.joined ? `Joined ${result.device}’s library` : `Added ${result.device}`); setPasting(false); setTicket(''); }
  };
  const scan = async () => {
    let text;
    try { text = await library.scan(); }
    catch (e) { if (!/cancel/i.test(String(e))) setError(e?.message || String(e)); return; }
    if (!text) return;
    setBusy(true);
    const result = await run(() => library.useCode(text));
    setBusy(false);
    if (result) notify(result.joined ? `Joined ${result.device}’s library` : `Added ${result.device}`);
  };
  return <Modal title="Devices" onClose={onClose} className="settings devices">
    <p className="muted">Your bits sync directly between your devices over your Wi-Fi network. No account or cloud service is involved.</p>
    <div className="settings-section">
      <h3>This device</h3>
      <div className="device-row"><span className="device-icon"><PlatformIcon platform={status.platform}/></span><div className="device-text"><strong>{status.deviceName}</strong><small>{status.addresses.filter(a => !a.startsWith('[')).join(' · ') || 'No network address yet'}</small></div></div>
    </div>
    <div className="settings-section">
      <h3>Your other devices</h3>
      {!others.length && <p className="muted">None yet.</p>}
      {others.map(d => <div key={d.id} className={`device-row ${d.removed ? 'removed' : ''}`}>
        <span className="device-icon"><PlatformIcon platform={d.platform}/></span>
        <div className="device-text"><strong>{d.name}</strong>
          <small>{d.removed ? 'Removed' : <><span className={`status-dot ${d.connected ? '' : 'offline'}`}/>{d.connected ? 'Connected' : `Last seen ${ago(d.lastSeen)}`}{d.hasAllMyChanges ? ' · has all your changes' : ' · waiting for your latest changes'}</>}</small>
          {!d.connected && !d.removed && d.lastError && <small className="error-text">{d.lastError}</small>}
        </div>
        {!d.removed && <button className="secondary small" onClick={() => { if (confirm(`Remove ${d.name}? It keeps its copy but stops syncing.`)) run(() => library.removeDevice(d.id)); }}>Remove</button>}
      </div>)}
    </div>
    <div className="settings-section">
      <h3>{paired ? 'Add a device' : 'Connect a device'}</h3>
      {invite ? <div className="invite">
        <div className="qr" dangerouslySetInnerHTML={{ __html: invite.qrSvg }}/>
        <p>{invite.kind === 'Add'
          ? <>On your phone, open <strong>Devices → Scan code</strong> and scan this.</>
          : <>On the new device, open <strong>Devices → Scan code</strong> and scan this, or paste the text below.</>} It works once and expires at {new Date(invite.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Both devices need to be on the same Wi-Fi.</p>
        <textarea readOnly className="ticket" value={invite.ticket} onFocus={e => e.target.select()}/>
        <div className="button-group"><button className="secondary" onClick={() => navigator.clipboard.writeText(invite.ticket).then(() => notify('Copied'), () => {})}><Copy size={15}/>Copy text</button><button className="secondary" onClick={() => setInvite(null)}>Done</button></div>
      </div> : pasting ? <>
        <textarea className="ticket" autoFocus placeholder="Paste the code (starts with BITS2)" value={ticket} onChange={e => setTicket(e.target.value)}/>
        <div className="button-group"><button className="secondary" onClick={() => setPasting(false)}>Cancel</button><button className="primary" disabled={busy || !ticket.trim()} onClick={connect}>{busy ? 'Connecting…' : 'Connect'}</button></div>
      </> : <>
        <p>{library.scan
          ? (paired ? 'Scan the code a new device shows, or show this device’s code on it.' : 'Scan the code on a device you already use. Bits already here are kept.')
          : (paired ? 'Show this code on the new device, or paste the code it shows.' : 'Show this device’s code and scan it from your phone, or paste a code from a device you already use. Bits already here are kept.')}</p>
        <div className="button-group">
          {library.scan && <button className="primary" disabled={busy} onClick={scan}><ScanLine size={16}/>{busy ? 'Connecting…' : 'Scan code'}</button>}
          <button className={library.scan ? 'secondary' : 'primary'} onClick={() => run(() => library.createInvite()).then(i => i && setInvite(i))}><QrCode size={16}/>Show this device’s code</button>
          <button className="secondary" onClick={() => setPasting(true)}><ClipboardPaste size={15}/>Paste a code</button>
        </div>
      </>}
    </div>
    {error && <p role="alert" className="error-text">{error}</p>}
  </Modal>;
}
