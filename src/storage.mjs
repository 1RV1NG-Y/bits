// JSON backups. The library itself lives in ./library.mjs.
import { validateLibrary, MAX_BACKUP_BYTES } from './model.mjs';
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
