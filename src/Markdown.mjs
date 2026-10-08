import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { webUrl } from './model.mjs';

// Pasted tables often contain <br>. Accept this one presentational token;
// all other HTML remains escaped text, without enabling raw HTML execution.
function remarkLineBreaks() {
  return tree => {
    function visit(node) {
      if (!node.children) return;
      node.children = node.children.map(child => {
        if (child.type === 'html' && /^<br\s*\/?>$/i.test(child.value.trim())) return { type: 'break' };
        visit(child);
        return child;
      });
    }
    visit(tree);
  };
}
const h = React.createElement;
function Markdown({ children, preview = false }) {
  return h('div', { className: `markdown${preview ? ' markdown-preview' : ''}` },
    h(ReactMarkdown, {
      remarkPlugins: [remarkGfm, remarkLineBreaks],
      components: {
        table: ({ children }) => h('div', { className: 'table-scroll', ...(preview ? {} : { tabIndex: 0, role: 'region', 'aria-label': 'Scrollable table' }) }, h('table', null, children)),
        a: ({ href, children }) => {
          const url = webUrl(href);
          if (preview || !url) return h('span', { className: 'markdown-link' }, children);
          return h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', onClick: e => {
            if (window.bits) { e.preventDefault(); window.bits.openExternal(url).catch(() => {}); }
          } }, children);
        },
        // Notes remain local; displaying Markdown never requests a remote image.
        img: ({ alt }) => h('span', { className: 'image-description' }, alt ? `[Image: ${alt}]` : '[Image]'),
        input: ({ checked }) => h('span', { className: 'task-check', role: 'img', 'aria-label': checked ? 'Completed' : 'Not completed' }, checked ? '☑' : '☐'),
      },
    }, children));
}
export default memo(Markdown);
