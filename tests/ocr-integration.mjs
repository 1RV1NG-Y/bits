// Opt-in: exercises the real, installed PP-OCRv6 Small CPU models offline.
import assert from 'node:assert/strict';
import path from 'node:path';
import { homedir } from 'node:os';
import { createOcrService } from '../electron/ocr.cjs';
const home = process.env.BITS_OCR_HOME || path.join(process.env.XDG_DATA_HOME || path.join(homedir(), '.local/share'), 'bits/ocr');
const image = process.argv[2];
if (!image) throw new Error('Pass the path to an image containing text.');
const service = createOcrService({ home, worker: path.resolve('ocr/worker.py') });
assert.equal((await service.status()).ready, true);
const started = performance.now();
const result = await service.extract(path.resolve(image));
assert.equal(result.engine, 'PP-OCRv6 Small');
assert.ok(result.text.trim().length > 0);
console.log(JSON.stringify({ engine: result.engine, lines: result.lines, characters: result.text.length, seconds: Number(((performance.now() - started) / 1000).toFixed(2)) }));
