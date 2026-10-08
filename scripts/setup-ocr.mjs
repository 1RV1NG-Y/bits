import { spawn, spawnSync } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const index = process.argv.indexOf('--home');
const dataHome = process.env.XDG_DATA_HOME && path.isAbsolute(process.env.XDG_DATA_HOME) ? process.env.XDG_DATA_HOME : path.join(homedir(), '.local/share');
const home = index >= 0 ? path.resolve(process.argv[index + 1]) : process.env.BITS_OCR_HOME || path.join(dataHome, 'bits/ocr');
const python = path.join(home, 'venv/bin/python');
let running;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { running?.kill('SIGTERM'); process.exit(1); });
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env: process.env }); running = child;
    child.once('error', reject);
    child.once('close', code => { running = null; code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited with code ${code}.`)); });
  });
}
await mkdir(home, { recursive: true });
try { await access(python); }
catch {
  const candidates = [process.env.BITS_OCR_PYTHON, 'python3.12', 'python3.11', path.join(homedir(), '.local/share/uv/python/cpython-3.12-linux-x86_64-gnu/bin/python3.12'), 'python3'].filter(Boolean);
  const base = candidates.find(p => spawnSync(p, ['-c', 'import sys; sys.exit(0 if (3,10) <= sys.version_info[:2] <= (3,13) else 1)'], { stdio: 'ignore' }).status === 0);
  if (!base) throw new Error('Image import needs Python 3.10–3.13. Install Python 3.12 and retry.');
  await run(base, ['-m', 'venv', path.join(home, 'venv')]);
}
console.log('Installing the local OCR runtime…');
if (spawnSync('uv', ['--version'], { stdio: 'ignore' }).status === 0)
  await run('uv', ['pip', 'install', '--python', python, '-r', path.join(root, 'ocr/requirements.txt')]);
else
  await run(python, ['-m', 'pip', 'install', '-r', path.join(root, 'ocr/requirements.txt')]);
await run(python, [path.join(root, 'ocr/worker.py'), '--home', home, '--prepare']);
console.log('PP-OCRv6 Small is ready for local image import.');
