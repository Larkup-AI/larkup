import assert from 'node:assert/strict';
import test from 'node:test';
import { renderMarkdown } from '../src/lib/chat/render-markdown.ts';

test('headings render at their own levels', () => {
  const html = renderMarkdown('# One\n\n## Two\n\n### Three\n\n#### Four');
  assert.match(html, /<h1 class="msg-h1">One<\/h1>/);
  assert.match(html, /<h2 class="msg-h2">Two<\/h2>/);
  assert.match(html, /<h3 class="msg-h3">Three<\/h3>/);
  assert.match(html, /<h4 class="msg-h4">Four<\/h4>/);
});

test('inline emphasis renders bold, italic, and strikethrough', () => {
  const html = renderMarkdown('**bold** and *italic* and ~~gone~~');
  assert.match(html, /<strong class="msg-bold">bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<del>gone<\/del>/);
});

test('a line of dashes renders a horizontal rule', () => {
  const html = renderMarkdown('above\n\n---\n\nbelow');
  assert.match(html, /<hr class="msg-hr"\/>/);
});

test('consecutive quote lines collapse into one blockquote', () => {
  const html = renderMarkdown('> first line\n> second line');
  const openCount = (html.match(/<blockquote class="msg-quote">/g) ?? []).length;
  assert.equal(openCount, 1);
  assert.match(html, /first line/);
  assert.match(html, /second line/);
  // The angle bracket must not leak through as literal text.
  assert.doesNotMatch(html, /&gt;\s?first line/);
});

test('unordered and ordered lists still wrap correctly', () => {
  const ul = renderMarkdown('- a\n- b');
  assert.match(ul, /<ul class="msg-ul"><li class="msg-li">a<\/li><li class="msg-li">b<\/li><\/ul>/);
  const ol = renderMarkdown('1. a\n2. b');
  assert.match(ol, /<ol class="msg-ol" start="1">/);
});

test('asterisk and plus bullets render as a list, not literal markers', () => {
  const star = renderMarkdown('* ORR: 7.97%\n* DCR: 65.22%');
  assert.match(star, /<ul class="msg-ul"><li class="msg-li">ORR: 7.97%<\/li>/);
  assert.doesNotMatch(star, /(^|>)\* ORR/);
  const plus = renderMarkdown('+ one\n+ two');
  assert.match(
    plus,
    /<ul class="msg-ul"><li class="msg-li">one<\/li><li class="msg-li">two<\/li><\/ul>/,
  );
});

test('inline italic between words is untouched by bullet handling', () => {
  const html = renderMarkdown('this is *very* important');
  assert.match(html, /<em>very<\/em>/);
});

test('display and inline math render as KaTeX, not raw delimiters', () => {
  const html = renderMarkdown('Inline $a^2$ and block:\n\n$$b^2$$');
  assert.match(html, /class="katex"/);
  assert.doesNotMatch(html, /\$\$b\^2\$\$/);
});
