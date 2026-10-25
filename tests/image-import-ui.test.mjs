import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import React from 'react';
import { build } from 'rolldown';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
const { render, fireEvent, screen, waitFor, cleanup, act } = await import('@testing-library/react');
await mkdir('node_modules/.cache/bits-tests', { recursive: true });
// Bare package names stay external; local files (including Windows paths like D:\…) are bundled.
await build({ input: 'src/BitDialog.jsx', platform: 'node', external: id => !id.startsWith('.') && !path.isAbsolute(id), output: { file: 'node_modules/.cache/bits-tests/dialog.mjs', format: 'esm' } });
const { default: BitDialog } = await import('../node_modules/.cache/bits-tests/dialog.mjs');
afterEach(cleanup);
const extracted = { text: 'Image text', filename: 'note.png', engine: 'PP-OCRv6 Small' };
function mount(importer) {
  let saves = 0, cancels = 0;
  window.bits = { ocrStatus: async () => ({ ready: true }), ocrImport: importer, ocrCancel: async () => { cancels++; } };
  const view = render(React.createElement(BitDialog, { onSave: () => { saves++; return true; }, onClose: () => {}, notify: () => {} }));
  return { ...view, saves: () => saves, cancels: () => cancels };
}
test('extraction appends to the latest draft, keeps editing available and never autosaves', async () => {
  let finish; const view = mount(() => new Promise(resolve => { finish = resolve; }));
  await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Import from image' }).disabled, false));
  const body = screen.getByPlaceholderText('Paste or write what you want to remember…');
  fireEvent.change(body, { target: { value: 'Original draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Import from image' }));
  fireEvent.change(body, { target: { value: 'Draft edited during extraction' } });
  assert.equal(screen.getByRole('button', { name: 'Save bit' }).disabled, true);
  await act(async () => finish(extracted));
  assert.equal(body.value, 'Draft edited during extraction\n\nImage text');
  assert.equal(view.saves(), 0);
  assert.match(screen.getByRole('status').textContent, /Review and edit/);
  assert.equal(screen.getByRole('button', { name: 'Save bit' }).disabled, false);
});
test('cancel ignores a late worker response and leaves draft intact', async () => {
  let finish; const view = mount(() => new Promise(resolve => { finish = resolve; }));
  await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Import from image' }).disabled, false));
  const body = screen.getByPlaceholderText('Paste or write what you want to remember…');
  fireEvent.change(body, { target: { value: 'Keep this' } });
  fireEvent.click(screen.getByRole('button', { name: 'Import from image' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
  await act(async () => finish(extracted));
  assert.equal(body.value, 'Keep this'); assert.equal(view.cancels(), 1); assert.equal(view.saves(), 0);
});
test('no text and extraction errors preserve the draft and allow retry', async () => {
  let fail = false; mount(async () => { if (fail) throw new Error('Image cannot be decoded.'); return { ...extracted, text: '' }; });
  await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Import from image' }).disabled, false));
  fireEvent.click(screen.getByRole('button', { name: 'Import from image' }));
  await waitFor(() => assert.match(screen.getByRole('status').textContent, /No text found/));
  fail = true; fireEvent.click(screen.getByRole('button', { name: 'Import from image' }));
  await waitFor(() => assert.match(screen.getByRole('alert').textContent, /cannot be decoded/));
  assert.equal(screen.getByPlaceholderText('Paste or write what you want to remember…').value, '');
});
