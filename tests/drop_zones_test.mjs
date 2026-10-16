// The two drop zones (open / insert link) shown while a file is dragged over the window: which zone a drop reports, that they go away
// when the drag stops, that app.js routes a drop by the zone, and that they are frosted glass like the other panels.
import assert from 'assert';
import fs from 'fs';
import { createRequire } from 'module';

console.log('=== drop zones tests ===');
const require = createRequire(import.meta.url);
const DZ = require('../frontend/js/drop_zones.js');
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

assert.ok(DZ.hasFiles({ types: ['text/plain', 'Files'] }) && !DZ.hasFiles({ types: ['text/plain'] }) && !DZ.hasFiles(null), 'only a drag with files shows the zones');

// A small fake page: enough of the DOM for create().
function el(tag) {
  const cls = new Set();
  const e = {
    tag, children: [], attrs: {}, _html: '', textContent: '',
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c), toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)) },
    set className(v) { cls.clear(); String(v).split(' ').filter(Boolean).forEach((c) => cls.add(c)); },
    get className() { return [...cls].join(' '); },
    setAttribute(k, v) { e.attrs[k] = v; }, getAttribute(k) { return e.attrs[k]; },
    appendChild(c) { c.parent = e; e.children.push(c); return c; },
    set innerHTML(v) { e._html = v; e.sub = { textContent: '' }; }, get innerHTML() { return e._html; },
    querySelector() { return e.sub; },
    closest(sel) { for (let n = e; n; n = n.parent) if (n.attrs && n.attrs['data-drop-zone'] && sel === '[data-drop-zone]') return n; return null; },
  };
  return e;
}
const doc = { createElement: el, body: el('body') };
let timer = null;
let linkable = true;
const zones = DZ.create({
  document: doc, tr: (k, p) => (p ? k + JSON.stringify(p) : k), canLink: () => linkable,
  setTimeout: (f) => { timer = f; return 1; }, clearTimeout: () => { timer = null; },
});
const drag = (n) => ({ target: doc.body, dataTransfer: { items: { length: n } } });

zones.onDragOver(drag(1));
const overlay = doc.body.children[0];
assert.ok(overlay.classList.contains('is-on'), 'shown on dragover');
const [open, link] = overlay.children;
assert.ok(open.classList.contains('drop-zone-open') && link.classList.contains('drop-zone-link'), 'an open zone and a link zone');
assert.ok(!link.classList.contains('is-gone'), 'the link zone is there when an editor is');
assert.equal(zones.zoneOf({ target: open }), 'open');
assert.equal(zones.zoneOf({ target: link }), 'link');
assert.equal(zones.zoneOf({ target: doc.body }), '', 'outside the zones nothing is chosen');

zones.onDragOver({ target: link, dataTransfer: { items: { length: 1 } } });
assert.ok(link.classList.contains('is-hot') && !open.classList.contains('is-hot'), 'the zone under the pointer lights up');

assert.equal(typeof timer, 'function', 'a timer takes the zones away when the drag stops');
timer();
assert.ok(!overlay.classList.contains('is-on') && !link.classList.contains('is-hot'), 'gone when the drag stops');

linkable = false;
zones.onDragOver(drag(3));
assert.ok(link.classList.contains('is-gone'), 'without an editor there is nothing to put a link in: the zone is gone');
assert.ok(/dropZoneOpenSubMany.*"n":3/.test(open.sub.textContent), 'several files are counted');
zones.hide();

const app = read('frontend/js/app.js');
assert.ok(/const zone = dropZones \? dropZones\.zoneOf\(e\) : '';/.test(app), 'a drop asks which zone it landed on');
assert.ok(/zone === 'link' \? dropLinkEditor\(\) : \(zone === 'open' \? null : editorUnderPointer\(e\)\)/.test(app), 'link zone: link; open zone: open; no zones: the old rule');
assert.ok(/dropZones\.onDragOver\(e\)/.test(app) && /if \(dropZones\) dropZones\.hide\(\);/.test(app), 'dragover shows them, dragend and drop hide them');
assert.ok(/js\/drop_zones\.js/.test(read('frontend/index.html')), 'the page loads the module');

const css = read('frontend/css/style.css');
const block = css.slice(css.indexOf('/* ---- Drop zones'));
assert.ok(/\.drop-zone \{[\s\S]*?backdrop-filter: blur\(16px\)/.test(block) && /-webkit-backdrop-filter: blur\(16px\)/.test(block), 'frosted glass, with the -webkit- prefix for macOS');
assert.ok(/prefers-reduced-transparency: reduce[\s\S]*backdrop-filter: none/.test(block), 'solid for a person who asked for less transparency');
assert.ok(!/flex-grow: [2-9]/.test(block) && /\.drop-zone \{[\s\S]*?flex: 1 1 0;/.test(block), 'the two zones are halves of the window');

const i18n = read('frontend/js/i18n.js');
for (const key of ['dropZoneOpenTitle', 'dropZoneOpenSub', 'dropZoneOpenSubMany', 'dropZoneLinkTitle', 'dropZoneLinkSub']) {
  assert.strictEqual((i18n.match(new RegExp('\n    ' + key + ': ', 'g')) || []).length, 2, key + ' exists in both languages');
}
console.log('drop zones tests passed');
