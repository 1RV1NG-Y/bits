import { validateLibrary, MAX_BACKUP_BYTES } from './model.mjs';
const key = 'bits.library.v1';
export async function loadLibrary() {
  if (window.bits) return window.bits.load();
  const data = localStorage.getItem(key);
  return data === null ? null : validateLibrary(JSON.parse(data));
}
export async function saveLibrary(data) {
  const valid = validateLibrary(data);
  if (window.bits) return window.bits.save(valid);
  localStorage.setItem(key, JSON.stringify(valid));
}
export async function exportLibrary(data) {
  if (window.bits) return window.bits.export(data);
  const url = URL.createObjectURL(new Blob([JSON.stringify(validateLibrary(data), null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `bits-${new Date().toISOString().slice(0, 10)}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); return true;
}
export async function readBackup(file) {
  if (file.size > MAX_BACKUP_BYTES) throw new Error('Backup files must be smaller than 25 MB.');
  return validateLibrary(JSON.parse(await file.text()));
}
