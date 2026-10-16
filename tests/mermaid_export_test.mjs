// Copy / save of a diagram as PNG: the webview marks a canvas tainted when an SVG with a <foreignObject> (Mermaid's HTML labels) is drawn on it,
// so the export draws the diagram again from its source with plain SVG labels (app.js: mermaidExportSvg).
import assert from 'assert';
import fs from 'fs';

console.log('=== mermaid export tests ===');
const app = fs.readFileSync(new URL('../frontend/js/app.js', import.meta.url), 'utf8');

const fn = /async function mermaidExportSvg\(container\) \{[\s\S]*?\r?\n  \}\r?\n/.exec(app);
assert.ok(fn, 'mermaidExportSvg exists');
assert.ok(/"htmlLabels": false/.test(fn[0]) && /"flowchart": \{"htmlLabels": false\}/.test(fn[0]), 'the directive turns the HTML labels off');
assert.ok(/foreignObject/.test(fn[0]), 'a result that still has a foreignObject is not used');
assert.ok(/dataset\.mermaidSrc/.test(fn[0]), 'it draws from the source kept on the card');
assert.ok(/const svgEl = await mermaidExportSvg\(container\);/.test(app), 'the rasterizer uses it');

// Run it: the source is drawn with the directive in front, and after the front matter when there is one.
const body = fn[0].replace('async function mermaidExportSvg', 'return async function mermaidExportSvg');
const make = new Function('window', 'document', 'console', body);
async function run(src) {
  let seen = '';
  const plain = { querySelector: (s) => (s === 'foreignObject' ? null : {}) };
  const win = { mermaid: { render: async (id, code) => { seen = code; return { svg: '<svg></svg>' }; } } };
  const doc = { createElement: () => ({ set innerHTML(v) {}, querySelector: () => plain }) };
  const shown = {};
  const container = { dataset: { mermaidSrc: src }, querySelector: () => shown };
  const out = await make(win, doc, console)(container);
  return { seen, out, shown };
}
let r = await run('flowchart TD\n A-->B');
assert.ok(r.seen.startsWith('%%{init:') && r.seen.endsWith('flowchart TD\n A-->B'), 'the directive is in front of the source');
assert.notStrictEqual(r.out, r.shown, 'the plain-label diagram is what is returned');
r = await run('---\ntitle: T\n---\nflowchart TD\n A-->B');
assert.ok(r.seen.startsWith('---\ntitle: T\n---\n%%{init:'), 'front matter stays first');

console.log('mermaid export tests passed');
