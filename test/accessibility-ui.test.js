const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const rootDir = join(__dirname, '..');
const indexHtml = readFileSync(join(rootDir, 'index.html'), 'utf8');
const rendererJs = readFileSync(join(rootDir, 'renderer.js'), 'utf8');
const styleCss = readFileSync(join(rootDir, 'style.css'), 'utf8');

test('primary command inputs have persistent accessible labels', () => {
  assert.match(indexHtml, /id="cmd-input"[\s\S]*aria-label="Search commands"/);
  assert.match(indexHtml, /id="prompt-input"[\s\S]*aria-label="Message"/);
});

test('overlays isolate background content and restore opener focus', () => {
  assert.match(rendererJs, /function openOverlay\(/);
  assert.match(rendererJs, /function closeOverlay\(/);
  assert.match(rendererJs, /\.inert = isModal/);
  assert.match(rendererJs, /setModalBackgroundState\(false\)/);
  assert.match(rendererJs, /target\?\.focus\(\)/);
});

test('command palette exposes active option semantics', () => {
  assert.match(rendererJs, /cmdInput\.setAttribute\("aria-activedescendant"/);
  assert.match(rendererJs, /button\.setAttribute\("role", "option"\)/);
  assert.match(rendererJs, /button\.setAttribute\("aria-selected"/);
  assert.match(indexHtml, /id="cmd-results"[\s\S]*role="listbox"/);
});

test('status surfaces are announced to assistive technology', () => {
  assert.match(indexHtml, /id="status-text"[\s\S]*aria-live="polite"/);
  assert.match(rendererJs, /toast\.setAttribute\("role",/);
  assert.match(rendererJs, /toast\.setAttribute\("aria-live",/);
});

test('single-character prompt focus shortcut is gated behind slash', () => {
  assert.ok(rendererJs.includes('event.key === "/"'));
  assert.doesNotMatch(rendererJs, /event\.key\.length === 1[\s\S]*promptInput\.focus\(\)/);
});

test('meaningful non-text contrast and reduced motion are covered', () => {
  assert.match(styleCss, /--border-ui:/);
  assert.match(styleCss, /--accent-border-strong:/);
  assert.match(styleCss, /\.cmd-item\.selected[\s\S]*border:/);
  assert.match(styleCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*transition: none/);
});
