// The round button that leaves Zen mode and full screen: called by the pointer at the top edge near the middle, kept while the pointer
// travels to it, put away after a moment, only there while one of the two states is on; wired in app.js; glass; in both languages.
import assert from 'assert';
import fs from 'fs';
import { createRequire } from 'module';

console.log('=== immersive exit tests ===');
const require = createRequire(import.meta.url);
const IE = require('../frontend/js/immersive_exit.js');
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// The place that calls it: the top edge, near the middle, and a wider place once it is down.
assert.ok(IE.inZone(512, 0, 1024, false), 'the very top edge, in the middle');
assert.ok(IE.inZone(512 + 140, 30, 1024, false), 'a little to the side of the middle');
assert.ok(!IE.inZone(100, 5, 1024, false), 'not at the left end of the top edge');
assert.ok(!IE.inZone(512, 80, 1024, false), 'not 80 px down while it is up');
assert.ok(IE.inZone(512, 80, 1024, true), 'but 80 px down while it is down: the pointer can travel to it');
assert.ok(!IE.inZone(512, -1, 1024, true), 'outside the window is not a call');

// A fake page for create().
function el() {
  const cls = new Set();
  const listeners = {};
  return {
    attrs: {}, listeners, title: '', innerHTML: '',
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c), toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)) },
    set className(v) { cls.clear(); String(v).split(' ').filter(Boolean).forEach((c) => cls.add(c)); },
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(type, fn) { listeners[type] = fn; },
  };
}
let timer = null;
let immersive = false;
let exited = 0;
const body = { children: [], appendChild(c) { this.children.push(c); return c; } };
const doc = { createElement: el, body, activeElement: null, addEventListener() {} };
const win = { innerWidth: 1000, addEventListener() {} };
const ie = IE.create({
  document: doc, window: win, label: 'Leave', isImmersive: () => immersive, onExit: () => { exited++; },
  setTimeout: (f) => { timer = f; return 1; }, clearTimeout: () => { timer = null; }, MutationObserver: null,
});
const move = (x, y) => ie.onMove({ clientX: x, clientY: y });

move(500, 2);
assert.equal(body.children.length, 0, 'nothing is built while neither Zen mode nor full screen is on');
immersive = true;
move(500, 2);
const btn = body.children[0];
assert.ok(btn.classList.contains('immersive-exit') && btn.classList.contains('is-available') && btn.classList.contains('is-down'), 'built, available and lowered');
assert.equal(btn.attrs['aria-label'], 'Leave', 'it has a name');
move(500, 300);
assert.ok(btn.classList.contains('is-down'), 'it does not go away at once');
assert.equal(typeof timer, 'function', 'it goes away after a moment');
timer();
assert.ok(!btn.classList.contains('is-down'), 'put away');
move(500, 2);
btn.listeners.click({ preventDefault() {}, stopPropagation() {} });
assert.equal(exited, 1, 'a click leaves');
assert.ok(!btn.classList.contains('is-down'), 'and puts the button away');
immersive = false;
ie.sync();
assert.ok(!btn.classList.contains('is-available'), 'gone when neither state is on');

const app = read('frontend/js/app.js');
assert.ok(/window\.ImmersiveExit\.create\(/.test(app) && /immersiveExit\.ensure\(\)/.test(app), 'app.js creates it');
assert.ok(/classList\.contains\('zen-mode'\) \|\| document\.body\.classList\.contains\('is-fullscreen'\)/.test(app), 'it is for Zen mode and full screen');
assert.ok(/if \(document\.body\.classList\.contains\('is-fullscreen'\)\) toggleFullscreen\(\);\s*if \(document\.body\.classList\.contains\('zen-mode'\)\) toggleZenMode\(\);/.test(app), 'it leaves whichever is on');
assert.ok(/js\/immersive_exit\.js/.test(read('frontend/index.html')), 'the page loads it');

const css = read('frontend/css/style.css');
const block = css.slice(css.indexOf('/* ---- Immersive exit'));
assert.ok(/transform: translate\(-50%, -64px\)/.test(block) && /translate\(-50%, 12px\)/.test(block) && /cubic-bezier/.test(block), 'it lowers from above the top edge');
assert.ok(/-webkit-backdrop-filter: blur\(12px\)/.test(block) && /prefers-reduced-transparency/.test(block) && /prefers-reduced-motion/.test(block), 'glass, with the fallbacks');
const i18n = read('frontend/js/i18n.js');
assert.strictEqual((i18n.match(/\n    immersiveExitTitle: /g) || []).length, 2, 'named in both languages');
console.log('immersive exit tests passed');
