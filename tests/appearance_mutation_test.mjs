// Mutation check of frontend/js/appearance_test.js: each change below to frontend/js/appearance.js (the kind of mistake the test is meant to catch)
// must make that test fail. The copies live in a temporary folder; the real files are never written.
//
// Node only. Run: node tests/appearance_mutation_test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const src = fs.readFileSync('frontend/js/appearance.js', 'utf8').replace(/\r\n/g, '\n');
const test = fs.readFileSync('frontend/js/appearance_test.js', 'utf8').replace(/\r\n/g, '\n');

const MUTATIONS = [
  ['unknown keys are dropped', 'for (const key of Object.keys(raw)) if (FORBIDDEN_KEYS.indexOf(key) < 0) out[key] = raw[key];', ''],
  ['prototype keys are copied', 'FORBIDDEN_KEYS.indexOf(key) < 0', 'true'],
  ['the old general.theme is ignored', 'const fallbackAccent = LEGACY_THEMES.indexOf(legacyTheme) >= 0 ? legacyTheme : DEFAULTS.accent;', 'const fallbackAccent = DEFAULTS.accent;'],
  ['a custom accent without a colour stays custom', "if (accent === 'custom' && !out.accentCustom) accent = fallbackAccent;", ''],
  ['font names may carry quotes', '/[\\u0000-\\u001f\\u007f"\'\\\\;{}()<>:,]/', '/[\\u0000-\\u001f\\u007f\\\\;{}()<>:,]/'],
  ['font names may be long', "if (!s || s.length > 80) return '';", "if (!s) return '';"],
  ['legacyThemeFor returns a new accent for older versions', 'if (LEGACY_THEMES.indexOf(appearance && appearance.accent) >= 0) return appearance.accent;', 'if (appearance && appearance.accent) return appearance.accent;'],
  ['apply always writes the look class', 'if (on === has) return false;', ''],
  ['custom properties are never taken off', 'applied.custom.forEach((n) => body.style.removeProperty(n));\n      applied.custom = [];', 'applied.custom = [];'],
  ['the font property is never taken off', "else root.style.removeProperty('--editor-font-user');", ''],
  ['the tint of a sticky note is never thinned (ink)', "if (tint !== NOTE_TINT_INK) out['--note-tint-a'] = String(tint);", ''],
  ['the tint of a sticky note is set for every colour (ink)', "if (tint !== NOTE_TINT_INK) out['--note-tint-a'] = String(tint);", "out['--note-tint-a'] = String(tint);"],
  ['the tint of a sticky note is thinned by a fixed step', 'if (contrast(INK_MUTED, blend(INK.sheet, accentRgb, a)) >= 4.55) return a;', 'if (a <= 0.1) return a;'],
  ['the label contrast is not tuned (ink)','const label = tune(h, Math.min(s, 0.7), 0.74, (c) => contrast(c, INK.light) >= 4.5, 1);', 'const label = hslToRgb(h, Math.min(s, 0.7), 0.4);'],
  ['the paper fill is not darkened', 'const fill = tune(h, s, hsl[2], (c) => contrast(c, PAPER.page) >= 4.5, -1);', 'const fill = base;'],
  ['the text on the fill is always white', 'return contrast(WHITE, rgb) >= contrast(NEAR_BLACK, rgb) ? WHITE : NEAR_BLACK;', 'return WHITE;'],
  ['the accent channel is the fill on ink', "out['--accent-rgb'] = chan(hover);", "out['--accent-rgb'] = chan(base);"],
  ['the look is not put on <html>', "if (toggleClass(root, 'look-paper', paper)) changed.look = true;", ''],
  ['a custom colour is not lower-cased', 'let h = m[1].toLowerCase();', 'let h = m[1];'],
  ['the signature ignores the colour', "a.accent === 'custom' ? a.accentCustom : ''", "''"],
  ['the marker forgets the look', "return (a.look === 'paper' ? 'paper' : 'ink') + '|' + accent;", "return 'ink|' + accent;"],
  ['the marker is written for the default look', "if (a.look !== 'paper' && !accent) return '';", ''],
  ['the colours are cut instead of rounded', "Math.max(0, Math.min(255, Math.round(v)))", 'Math.max(0, Math.min(255, Math.floor(v)))'],
  ['a bars value that is not one of the three is kept', 'out.bars = BARS.indexOf(out.bars) >= 0 ? out.bars : DEFAULTS.bars;', 'out.bars = out.bars === undefined ? DEFAULTS.bars : out.bars;'],
  ['auto-hide accepts any value', "out.autoHide = typeof out.autoHide === 'boolean' ? out.autoHide : DEFAULTS.autoHide;", 'out.autoHide = out.autoHide === undefined ? DEFAULTS.autoHide : !!out.autoHide;'],
  ['the signature ignores the bars', 'a.bars || DEFAULTS.bars', 'DEFAULTS.bars'],
  ['the signature ignores auto-hide', "a.autoHide === false ? 'manual' : 'auto'", "'auto'"],
  ['apply writes the bars every time', "body.getAttribute('data-bars') !== bars", 'true'],
  ['apply never writes the bars', "body.setAttribute('data-bars', bars);", ''],
  ['apply never says the bars changed', 'changed.bars = true;', ''],
  ['apply trusts the bars value it is handed', 'const bars = BARS.indexOf(ap.bars) >= 0 ? ap.bars : DEFAULTS.bars;', 'const bars = ap.bars || DEFAULTS.bars;'],
  // the divider between two pages (appearance.splitBoundary, <body data-boundary>)
  ['a split boundary that is not one of the three is kept', 'out.splitBoundary = BOUNDARIES.indexOf(out.splitBoundary) >= 0 ? out.splitBoundary : DEFAULTS.splitBoundary;', 'out.splitBoundary = out.splitBoundary === undefined ? DEFAULTS.splitBoundary : out.splitBoundary;'],
  ['the split boundary is not normalized at all', 'out.splitBoundary = BOUNDARIES.indexOf(out.splitBoundary) >= 0 ? out.splitBoundary : DEFAULTS.splitBoundary;', ''],
  ['the default split boundary is the line', "const DEFAULT_BOUNDARY = 'dots';", "const DEFAULT_BOUNDARY = 'line';"],
  ['the signature ignores the split boundary', 'BOUNDARIES.indexOf(a.splitBoundary) >= 0 ? a.splitBoundary : DEFAULT_BOUNDARY].join', "''].join"],
  ['apply sets the boundary attribute every time', "} else if (have !== boundary && typeof body.setAttribute === 'function') {", "} else if (typeof body.setAttribute === 'function') {"],
  ['apply never takes the boundary attribute off', "body.removeAttribute('data-boundary');", ''],
  ['apply writes the default too', 'if (boundary === DEFAULT_BOUNDARY) {', 'if (false) {'],
  ['apply never says the boundary was set', "body.setAttribute('data-boundary', boundary);\n        changed.boundary = true;", "body.setAttribute('data-boundary', boundary);"],
  ['apply never says the boundary was taken off', "body.removeAttribute('data-boundary');\n          changed.boundary = true;", "body.removeAttribute('data-boundary');"],
  ['apply trusts the boundary value it is handed', 'const boundary = BOUNDARIES.indexOf(ap.splitBoundary) >= 0 ? ap.splitBoundary : DEFAULT_BOUNDARY;', 'const boundary = ap.splitBoundary || DEFAULT_BOUNDARY;']
];

// the premise: the unmutated pair passes (otherwise every mutation would "be caught" by a test that fails for another reason)
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appmut-'));
  try {
    fs.writeFileSync(path.join(dir, 'appearance.js'), src);
    fs.writeFileSync(path.join(dir, 'appearance_test.js'), test);
    const r = spawnSync(process.execPath, [path.join(dir, 'appearance_test.js')], { encoding: 'utf8' });
    assert.equal(r.status, 0, 'appearance_test.js passes on the real appearance.js: ' + r.stdout + r.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const bad = [];
for (const [name, find, replace] of MUTATIONS) {
  if (!src.includes(find)) { bad.push('target missing (the mutation no longer applies): ' + name); continue; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appmut-'));
  try {
    fs.writeFileSync(path.join(dir, 'appearance.js'), src.replace(find, replace));
    fs.writeFileSync(path.join(dir, 'appearance_test.js'), test);
    const r = spawnSync(process.execPath, [path.join(dir, 'appearance_test.js')], { encoding: 'utf8' });
    if (r.status === 0) bad.push('SURVIVED: ' + name);
    else console.log('caught: ' + name);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
assert.deepEqual(bad, [], 'appearance_test.js does not catch:\n  ' + bad.join('\n  '));
console.log('\nAll ' + MUTATIONS.length + ' mutations of appearance.js are caught by appearance_test.js');
