// One interface over the two hosts: Tauri (Android, core linked in) and the Electron
// prototype window (core in the bundled helper process).
const tauri = typeof window !== 'undefined' && window.__TAURI_INTERNALS__;

async function tauriApi() {
  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');
  return {
    host: 'tauri',
    call: (method, params = null) => invoke('call', { method, params }),
    onEvent: cb => { const off = listen('sync-event', e => cb(e.payload)); return () => off.then(f => f()); },
    copy: text => navigator.clipboard.writeText(text),
    // Android Back: the handler decides what to close; `exit` finishes the activity.
    onBack: async handler => { const { onBackButtonPress } = await import('@tauri-apps/api/app'); return onBackButtonPress(handler); },
    exit: async () => { const { exit } = await import('@tauri-apps/api/app'); await exit(0); },
    scan: async () => {
      const { scan, Format, checkPermissions, requestPermissions } = await import('@tauri-apps/plugin-barcode-scanner');
      let permission = await checkPermissions();
      if (permission !== 'granted') permission = await requestPermissions();
      if (permission !== 'granted') throw new Error('Camera access is needed to scan the code. You can paste the invitation instead.');
      return (await scan({ formats: [Format.QRCode], windowed: false })).content;
    },
  };
}

function electronApi() {
  const bridge = window.bitsSync;
  return { host: 'electron', call: bridge.call, onEvent: bridge.onEvent, copy: bridge.copy, scan: null, onBack: null, exit: null };
}

export async function connect() {
  if (tauri) return tauriApi();
  if (window.bitsSync) return electronApi();
  throw new Error('Open this page from the bits sync prototype (desktop or Android).');
}
