import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from '../src/Markdown.mjs';
import { webUrl } from '../src/model.mjs';
const render = (body, preview = false) => renderToStaticMarkup(React.createElement(Markdown, { preview }, body));
test('pasted GFM table renders cells, emphasis, and presentational line breaks', () => {
  const html = render('| Input | Tool | Why |\n|---|---|---|\n| **Screenshots** | `OCR` | Fast<br>Local |');
  assert.match(html, /<table>/); assert.equal((html.match(/<th>/g) || []).length, 3);
  assert.match(html, /<strong>Screenshots<\/strong>/); assert.match(html, /<code>OCR<\/code>/);
  assert.match(html, /Fast<br\/>\s*Local/);
});
test('code fences preserve literal Markdown and lists render structurally', () => {
  const html = render('## Steps\n\n- one\n- two\n\n```sh\necho "**literal**"\n```');
  assert.match(html, /<h2>Steps<\/h2>/); assert.match(html, /<ul>/);
  assert.match(html, /<pre><code class="language-sh">/); assert.match(html, /\*\*literal\*\*/);
});
test('untrusted markup and links cannot execute or fetch remote images', () => {
  const html = render('<script>alert(1)</script>\n\n[x](javascript:alert%281%29)\n\n![remote](https://example.com/tracker.png)');
  assert.doesNotMatch(html, /<script|<img|href="javascript:/); assert.match(html, /\[Image: remote\]/);
  assert.equal(webUrl('file:///etc/passwd'), null); assert.equal(webUrl('javascript:alert(1)'), null);
  assert.equal(webUrl('https://user:password@example.com'), null); assert.equal(webUrl('//example.com'), null);
  assert.equal(webUrl('https://example.com/docs'), 'https://example.com/docs');
});
test('card previews have formatted tables but no nested interactive controls', () => {
  const html = render('| A | B |\n|---|---|\n| a | b |\n\n[Link](https://example.com)\n\n- [x] done', true);
  assert.match(html, /<table>/); assert.doesNotMatch(html, /<a |<input|tabindex=/);
});
