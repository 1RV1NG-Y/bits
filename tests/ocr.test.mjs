import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createOcrService, parseResult, runProcess, validateImage } from '../electron/ocr.cjs';
const result = { ok: true, text: 'Recognized text', engine: 'PP-OCRv6 Small', lines: 1, confidence: .9 };
async function fixture(t) {
  const home = await mkdtemp(path.join(tmpdir(), 'bits-ocr-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(path.join(home, 'venv/bin'), { recursive: true });
  await writeFile(path.join(home, 'venv/bin/python'), '');
  for (const model of ['PP-OCRv6_small_det', 'PP-OCRv6_small_rec']) {
    const directory = path.join(home, 'models', model); await mkdir(directory, { recursive: true });
    for (const file of ['inference.yml', 'inference.json', 'inference.pdiparams']) await writeFile(path.join(directory, file), 'test');
  }
  await writeFile(path.join(home, 'ready.json'), '{"version":1}');
  const image = path.join(home, 'image with spaces.png'); await writeFile(image, 'fixture');
  return { home, image };
}
test('OCR protocol accepts empty detection and rejects invalid/oversized results', () => {
  assert.equal(parseResult(JSON.stringify({ ...result, text: '' })).text, '');
  for (const input of ['garbage', JSON.stringify({ ok: false, error: 'bad image' }), JSON.stringify({ ...result, text: 'x'.repeat(100001) }), JSON.stringify({ ...result, engine: 'unknown' })]) assert.throws(() => parseResult(input));
});
test('image selection rejects unsupported extensions and empty files', async t => {
  const { home, image } = await fixture(t); await validateImage(image);
  await assert.rejects(validateImage('https://example.com/test.png'));
  await assert.rejects(validateImage(path.join(home, 'commands.sh')));
  await writeFile(image, ''); await assert.rejects(validateImage(image), /non-empty/);
});
test('service uses explicit PP-OCR runtime, preserves paths, and rejects concurrent jobs', async t => {
  const { home, image } = await fixture(t); let finish, invocation;
  const service = createOcrService({ home, worker: '/worker.py', run: (...args) => { invocation = args; return new Promise(resolve => { finish = resolve; }); } });
  assert.equal((await service.status()).ready, true);
  const pending = service.extract(image);
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(service.extract(image), /already running/);
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  finish(JSON.stringify(result));
  assert.equal((await pending).filename, 'image with spaces.png');
  assert.equal(invocation[0], path.join(home, 'venv/bin/python'));
  assert.equal(invocation[1].at(-1), image);
});
test('cancel terminates a worker and timeout errors are actionable', async () => {
  const controller = new AbortController();
  const work = runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: controller.signal });
  controller.abort(); await assert.rejects(work, /canceled/);
  await assert.rejects(runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 20 }), /too long/);
});
test('missing model weights disables readiness without changing library data', async t => {
  const { home } = await fixture(t); const service = createOcrService({ home });
  await rm(path.join(home, 'models/PP-OCRv6_small_rec/inference.pdiparams'));
  assert.equal((await service.status()).ready, false);
});
