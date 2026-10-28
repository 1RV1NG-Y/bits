import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { arrangeLines } from '../electron/ocr-layout.cjs';
import { parseResult } from '../electron/ocr.cjs';

const at = (text, x0, y0, x1, y1) => ({ text, box: [x0, y0, x1, y1] });
const positions = (text, words) => words.map(w => { const i = text.indexOf(w); assert.ok(i >= 0, `missing ${w}`); return i; });
const inOrder = (text, words) => { const p = positions(text, words); assert.deepEqual(p, [...p].sort((a, b) => a - b), `out of order: ${words.join(' → ')}`); };

test('columns under headings read column by column (real OCR output of a cover grid)', () => {
  const { items } = JSON.parse(readFileSync(new URL('./fixtures/ocr-book-covers.json', import.meta.url), 'utf8'));
  const text = arrangeLines(items);
  // Each phase's covers come after its heading and before the next phase. (The image
  // doesn't say whether a phase's two-by-two covers read across or down.)
  const [one, two, three] = positions(text, ['PHASE ONE', 'PHASE TWO', 'PHASE THREE']);
  assert.ok(one < two && two < three);
  const phase = title => { const p = text.indexOf(title); return p > three ? 3 : p > two ? 2 : p > one ? 1 : 0; };
  for (const title of ['HUMAN, ALL', 'The Gay', 'History for Life', 'BEYOND']) assert.equal(phase(title), 1, title);
  for (const title of ['TWILIGHT OF THE IDOLS', 'ECCE HOMO', 'GENEALOGY OF MORALS', 'DAYBREAK']) assert.equal(phase(title), 2, title);
  for (const title of ['ZARATHUSTRA', 'Birth of Tragedy', 'POWER']) assert.equal(phase(title), 3, title);
  assert.match(text, /HUMAN, ALL\nTOO HUMAN/, 'a cover stays together');
});

test('a chat reads in message order, not one side then the other', () => {
  const text = arrangeLines([
    at('hey, are you around?', 20, 100, 300, 130),
    at('yes, what is up', 700, 160, 980, 190),
    at('did you push the fix', 20, 220, 320, 250),
    at('just now', 820, 280, 980, 310),
  ]);
  assert.equal(text.split('\n\n').join(' | '), 'hey, are you around? | yes, what is up | did you push the fix | just now');
});

test('a two-column article reads the title, then the left column, then the right', () => {
  const text = arrangeLines([
    at('A full-width title', 50, 20, 950, 70),
    at('Left one', 50, 100, 450, 120), at('Left two', 50, 124, 450, 144), at('Left three', 50, 148, 450, 168),
    at('Left after a gap', 50, 220, 450, 240),
    at('Right one', 550, 100, 950, 120), at('Right two', 550, 124, 950, 144),
  ]);
  inOrder(text, ['A full-width title', 'Left one', 'Left three', 'Left after a gap', 'Right one', 'Right two']);
  assert.match(text, /Left one\nLeft two\nLeft three/, 'a paragraph stays one block');
});

test('a table with single-line cells reads row by row', () => {
  const text = arrangeLines([
    at('Input', 20, 10, 120, 30), at('Model', 400, 10, 500, 30), at('Why', 800, 10, 860, 30),
    at('Screenshots', 20, 50, 200, 70), at('Small', 400, 50, 480, 70), at('Fast', 800, 50, 870, 70),
    at('Photos of pages', 20, 90, 260, 110), at('Medium', 400, 90, 500, 110), at('Accurate', 800, 90, 920, 110),
  ]);
  inOrder(text, ['Input', 'Model', 'Why', 'Screenshots', 'Small', 'Fast', 'Photos of pages', 'Medium', 'Accurate']);
});

test('pieces of one line are joined left to right, and junk input is ignored', () => {
  assert.equal(arrangeLines([at('world', 130, 10, 200, 30), at('hello', 50, 10, 120, 30), { text: 'no box' }, at('  ', 0, 0, 1, 1)]), 'hello world');
  assert.equal(arrangeLines([]), '');
});

test('the OCR service uses positions when the worker provides them', () => {
  const base = { ok: true, engine: 'PP-OCRv6 Small', lines: 4, confidence: 0.9 };
  const items = [at('Right', 600, 10, 700, 30), at('Left', 10, 10, 100, 30), at('Left below', 10, 40, 150, 60), at('Right below', 600, 40, 760, 60)];
  assert.equal(parseResult(JSON.stringify({ ...base, text: 'Right\nLeft\nLeft below\nRight below', items })).text, 'Left\nLeft below\n\nRight\nRight below');
  assert.equal(parseResult(JSON.stringify({ ...base, text: 'plain' })).text, 'plain', 'older workers without positions still work');
});
