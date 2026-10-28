// Rebuilds reading order from OCR line boxes. The recognizer returns lines roughly top to
// bottom across the whole image, which interleaves columns. Here lines are grouped into
// blocks (a paragraph, a heading, a book cover), and blocks are ordered by recursively
// splitting the page at its widest empty gap (XY-cut). Blocks are separated by a blank line.

/** @typedef {{ text: string, x0: number, y0: number, x1: number, y1: number }} Box */

const overlap = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);

/** Lines that belong to the same block: words on one row, or stacked lines of a paragraph. */
function related(a, b) {
  const h = Math.min(a.y1 - a.y0, b.y1 - b.y0);
  const vertical = overlap(a.y0, a.y1, b.y0, b.y1);
  const horizontal = overlap(a.x0, a.x1, b.x0, b.x1);
  if (vertical > 0.5 * h && -horizontal < 1.2 * h) return true; // same row, nearby
  return horizontal > 0 && -vertical < 0.8 * h; // stacked, small gap
}

function blocksOf(lines) {
  const parent = lines.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++)
      if (related(lines[i], lines[j])) parent[find(i)] = find(j);
  const groups = new Map();
  lines.forEach((line, i) => { const root = find(i); groups.set(root, [...(groups.get(root) || []), line]); });
  return [...groups.values()].map(members => ({
    members,
    x0: Math.min(...members.map(m => m.x0)), y0: Math.min(...members.map(m => m.y0)),
    x1: Math.max(...members.map(m => m.x1)), y1: Math.max(...members.map(m => m.y1)),
  }));
}

/** Widest empty band between the blocks' projections on one axis, or null. */
function widestGap(blocks, axis) {
  const [lo, hi] = axis === 'x' ? ['x0', 'x1'] : ['y0', 'y1'];
  const spans = blocks.map(b => [b[lo], b[hi]]).sort((a, b) => a[0] - b[0]);
  let best = null;
  let end = spans[0][1];
  for (const [start, stop] of spans.slice(1)) {
    if (start > end && (!best || start - end > best.size)) best = { size: start - end, at: (start + end) / 2 };
    end = Math.max(end, stop);
  }
  return best;
}

/**
 * Columns are only real when blocks on the two sides sit next to each other. Chat
 * screenshots have left and right bubbles that never share a row; splitting those into
 * columns would read all of one person's messages before the other's.
 */
const sameRow = (a, b) => overlap(a.y0, a.y1, b.y0, b.y1) > 0.5 * Math.min(a.y1 - a.y0, b.y1 - b.y0);
function sideBySide(left, right) {
  return left.some(a => right.some(b => sameRow(a, b)));
}

const singleLine = block => block.members.every(m => sameRow(m, block.members[0]));

/**
 * A data table reads row by row: its cells are mostly single lines, and nearly every cell
 * has a neighbour on the same row across the split. Anything else side by side (article
 * columns, a grid of cards or covers under column headings) reads column by column, even
 * when a wide empty band crosses it.
 */
function looksLikeTable(left, right) {
  const all = [...left, ...right];
  const paired = [...left.filter(a => right.some(b => sameRow(a, b))), ...right.filter(b => left.some(a => sameRow(a, b)))];
  return paired.length >= 0.6 * all.length && all.filter(singleLine).length >= 0.7 * all.length;
}

/**
 * A block spanning the columns (a title or banner above them) hides the gap between them.
 * Find the gap among the other blocks, then cut the page into bands at the spanning blocks:
 * what's above, the spanning block, what's below. Each band then splits into columns.
 */
function bandsAroundSpanning(blocks) {
  const x0 = Math.min(...blocks.map(b => b.x0));
  const width = Math.max(...blocks.map(b => b.x1)) - x0;
  const narrow = blocks.filter(b => b.x1 - b.x0 < 0.6 * width);
  if (narrow.length < 2 || narrow.length === blocks.length) return null;
  const gap = widestGap(narrow, 'x');
  if (!gap || !sideBySide(narrow.filter(b => b.x1 <= gap.at), narrow.filter(b => b.x1 > gap.at))) return null;
  const spanning = blocks.filter(b => b.x0 < gap.at && b.x1 > gap.at).sort((a, b) => a.y0 - b.y0);
  if (!spanning.length) return null;
  const bands = [];
  let rest = blocks.filter(b => !spanning.includes(b));
  for (const span of spanning) {
    bands.push(rest.filter(b => b.y1 <= span.y0), [span]);
    rest = rest.filter(b => b.y1 > span.y0);
  }
  bands.push(rest);
  const nonEmpty = bands.filter(band => band.length);
  return nonEmpty.length > 1 && nonEmpty.reduce((n, band) => n + band.length, 0) === blocks.length ? nonEmpty : null;
}

function order(blocks) {
  if (blocks.length <= 1) return blocks;
  const split = (axis, gap) => {
    const key = axis === 'x' ? 'x1' : 'y1';
    return [blocks.filter(b => b[key] <= gap.at), blocks.filter(b => b[key] > gap.at)];
  };
  const column = widestGap(blocks, 'x');
  const columns = column && split('x', column);
  const validColumn = columns && sideBySide(...columns);
  const row = widestGap(blocks, 'y');
  if (validColumn && !(row && looksLikeTable(...columns))) return columns.flatMap(order);
  const bands = !column && bandsAroundSpanning(blocks);
  if (bands) return bands.flatMap(order);
  if (row) return split('y', row).flatMap(order);
  if (validColumn) return columns.flatMap(order);
  return [...blocks].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
}

/** A block's text: visual rows top to bottom, words in a row left to right. */
function blockText(block) {
  const rows = [];
  for (const line of [...block.members].sort((a, b) => a.y0 - b.y0)) {
    const row = rows.find(r => overlap(r.y0, r.y1, line.y0, line.y1) > 0.5 * Math.min(r.y1 - r.y0, line.y1 - line.y0));
    if (row) { row.lines.push(line); row.y0 = Math.min(row.y0, line.y0); row.y1 = Math.max(row.y1, line.y1); }
    else rows.push({ y0: line.y0, y1: line.y1, lines: [line] });
  }
  return rows.map(r => r.lines.sort((a, b) => a.x0 - b.x0).map(l => l.text).join(' ')).join('\n');
}

/** @param {{ text: string, box: number[] }[]} items OCR lines with [x0, y0, x1, y1] boxes. */
function arrangeLines(items) {
  const lines = items
    .filter(i => typeof i.text === 'string' && i.text.trim() && Array.isArray(i.box) && i.box.length === 4 && i.box.every(Number.isFinite))
    .map(({ text, box: [x0, y0, x1, y1] }) => ({ text: text.trim(), x0, y0, x1: Math.max(x1, x0 + 1), y1: Math.max(y1, y0 + 1) }));
  return order(blocksOf(lines)).map(blockText).join('\n\n');
}

module.exports = { arrangeLines };
