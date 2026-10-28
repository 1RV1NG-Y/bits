const fs = require('node:fs/promises');
const path = require('node:path');
const { arrangeLines } = require('./ocr-layout.cjs');
const { spawn } = require('node:child_process');
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

function runProcess(command, args, { signal, timeoutMs = 120000, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Image import canceled.'));
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '', failure;
    let killTimer;
    const stop = message => {
      if (failure) return;
      failure = new Error(message);
      child.kill('SIGTERM');
      killTimer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 1000);
      killTimer.unref();
    };
    const abort = () => stop('Image import canceled.');
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => stop('Image import took too long. Try a smaller image.'), timeoutMs);
    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
      if (Buffer.byteLength(stdout) > 2 * 1024 * 1024) stop('OCR returned too much output.');
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8000); });
    const cleanup = () => { clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', abort); };
    child.once('error', error => { cleanup(); reject(new Error(`Could not start image import: ${error.message}`)); });
    child.once('close', code => {
      cleanup();
      if (failure) return reject(failure);
      if (code !== 0) {
        try { const result = JSON.parse(stdout.trim().split('\n').at(-1)); if (result.error) return reject(new Error(result.error)); } catch {}
        return reject(new Error(`OCR could not finish. ${stderr.trim().slice(-800) || `Process exited with code ${code}.`}`));
      }
      resolve(stdout);
    });
  });
}

async function validateImage(filename) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename) || !/\.(png|jpe?g|webp|bmp|tiff?)$/i.test(filename))
    throw new Error('Choose a PNG, JPEG, WebP, BMP, or TIFF image.');
  const info = await fs.stat(filename);
  if (!info.isFile() || info.size === 0 || info.size > MAX_IMAGE_BYTES) throw new Error('Choose a non-empty image smaller than 25 MB.');
}

function parseResult(stdout) {
  let result;
  try { result = JSON.parse(stdout.trim().split('\n').at(-1)); } catch { throw new Error('OCR returned an unreadable result. Try the image again.'); }
  if (!result.ok) throw new Error(result.error || 'OCR could not read this image.');
  if (typeof result.text !== 'string' || result.text.length > 100000 || result.engine !== 'PP-OCRv6 Small')
    throw new Error('OCR returned an invalid result.');
  // With line positions, rebuild reading order (columns, blocks); otherwise keep the plain text.
  const items = Array.isArray(result.items) && result.items.length <= 20000 ? result.items : null;
  const text = items?.length ? arrangeLines(items) || result.text : result.text;
  return { text, engine: result.engine, lines: result.lines, confidence: result.confidence };
}

function createOcrService({ home, worker, setupScript, node = process.execPath, run = runProcess }) {
  const python = path.join(home, 'venv', 'bin', 'python');
  let job;
  async function status() {
    try {
      await fs.access(python);
      const ready = JSON.parse(await fs.readFile(path.join(home, 'ready.json'), 'utf8'));
      for (const model of ['PP-OCRv6_small_det', 'PP-OCRv6_small_rec']) {
        for (const file of ['inference.yml', 'inference.json', 'inference.pdiparams']) await fs.access(path.join(home, 'models', model, file));
      }
      return { ready: ready.version === 1, engine: 'PP-OCRv6 Small' };
    } catch { return { ready: false, engine: 'PP-OCRv6 Small' }; }
  }
  async function exclusive(work) {
    if (job) throw new Error('Image import is already running.');
    const controller = new AbortController(); job = controller;
    try { return await work(controller.signal); }
    finally { if (job === controller) job = null; }
  }
  return {
    status,
    cancel() { job?.abort(); },
    extract(filename) {
      return exclusive(async signal => {
        await validateImage(filename);
        if (!(await status()).ready) throw new Error('Set up image import first.');
        const stdout = await run(python, [worker, '--home', home, '--image', filename], { signal, env: { ...process.env, PYTHONUNBUFFERED: '1' } });
        return { ...parseResult(stdout), filename: path.basename(filename) };
      });
    },
    setup() {
      return exclusive(async signal => {
        await run(node, [setupScript, '--home', home], { signal, timeoutMs: 20 * 60 * 1000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
        const result = await status();
        if (!result.ready) throw new Error('OCR setup did not complete. Please try again.');
        return result;
      });
    },
  };
}
module.exports = { createOcrService, runProcess, validateImage, parseResult };
