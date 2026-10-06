// Mutation check of frontend/js/chrome_overlay_test.js: each change below to frontend/js/chrome_overlay.js (the kind of mistake the test is
// meant to catch: Zen mode's way back, the hot zone, the timers, the pins, the listeners) must make that test fail. The copies live in a
// temporary folder; the real files are never written.
//
// Node only. Run: node tests/chrome_overlay_mutation_test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const lf = (s) => s.replace(/\r\n/g, '\n');
const src = lf(fs.readFileSync('frontend/js/chrome_overlay.js', 'utf8'));
const test = lf(fs.readFileSync('frontend/js/chrome_overlay_test.js', 'utf8'));

const MUTATIONS = [
  // ---- Zen mode: the way back
  ['the mouse brings the bars back in Zen mode (goShown ignores Zen)', 'if (!away || zen) return; // Zen mode is left with setZen(false), not by the mouse or by show()', 'if (!away) return;'],
  ['the dwell is not waited for', 'dwellTimer = later(() => revealEdge(zone), HOT_DWELL_MS);', 'revealEdge(zone);'],
  ['the band is wider than 6px', "if (y < z) return 'top';", "if (y < z + 40) return 'top';"],
  ['the bottom band is not the bottom', "if (height > 0 && y >= height - z && y <= height) return 'bottom';", "if (height > 0 && y >= height - z - 100 && y <= height) return 'bottom';"],
  ['the top edge calls both bars', 'peek[zone] = true;\n      cancelLeave();', 'peek.top = true; peek.bottom = true;\n      cancelLeave();'],
  ['the bar goes while the pointer is still on it', 'if (onBar) cancelLeave(); else startLeave();', 'startLeave();'],
  ['the bar never goes', 'if (onBar) cancelLeave(); else startLeave();', 'if (onBar) cancelLeave();'],
  ['the goodbye does nothing', 'leaveTimer = later(() => { leaveTimer = null; if (zen) peekAway(); }, HOT_LEAVE_MS);', 'leaveTimer = later(() => { leaveTimer = null; }, HOT_LEAVE_MS);'],
  ['a pass through the band still calls the bar', 'cancelDwell();\n        dwellZone = zone;', 'dwellZone = zone;'],
  ['the pointer leaving the window changes nothing', 'if (peek.top || peek.bottom) startLeave();\n    }\n\n    function setZen', 'if (false) startLeave();\n    }\n\n    function setZen'],
  ['an element-to-element move counts as leaving the window', 'if (e.relatedTarget) return;', ''],
  ['a pointer made by script moves the Zen bars', 'function zenMove(e) {\n      if (!trusted(e)) return;', 'function zenMove(e) {'],
  ['the dwell is 0 ms', 'const HOT_DWELL_MS = 150;', 'const HOT_DWELL_MS = 0;'],
  ['the goodbye is 100 ms', 'const HOT_LEAVE_MS = 700;', 'const HOT_LEAVE_MS = 100;'],
  ['the hot zone is 20px', 'const HOT_ZONE = 6;', 'const HOT_ZONE = 20;'],
  // ---- Zen mode: the pins
  ['Zen uses the ordinary pins (a task or a message calls the status bar)', 'anyMatch(footer, zen ? zenFooterPins : footerPins)', 'anyMatch(footer, footerPins)'],
  ['a recording does not call the status bar in Zen', "'#stat-message[data-important]:not(:empty)',\n    '#stat-recording:not(.hidden)',", "'#stat-message[data-important]:not(:empty)',"],
  ['a failure does not call the status bar in Zen', "'#stat-message[data-important]:not(:empty)',\n    '#stat-recording:not(.hidden)',", "'#stat-recording:not(.hidden)',"],
  ['the failure mark is not watched', "'class', 'aria-expanded', 'data-quiet', 'data-important'", "'class', 'aria-expanded', 'data-quiet'"],
  ['a hot header is pinned as the status bar', 'setPin(header, (zen && peek.top) || anyMatch(header, headerPins));', 'setPin(header, (zen && peek.bottom) || anyMatch(header, headerPins));'],
  // ---- Zen mode: entering and leaving
  ['entering Zen does not put the bars away', 'body.classList.add(AWAY_CLASS);\n        }\n        unwatchPins();', '}\n        unwatchPins();'],
  ['entering Zen from the shown state keeps the typing listeners', 'unlisten(shownSet);\n          away = true;', 'away = true;'],
  ['entering Zen from the away state keeps the mouse listeners', 'if (away) {\n          unlisten(awaySet);\n        } else {', 'if (away) {\n        } else {'],
  ['leaving Zen leaves the bars away', 'unlisten(zenSet);\n        unwatchPins();\n        away = false;\n        body.classList.remove(AWAY_CLASS);', 'unlisten(zenSet);\n        unwatchPins();\n        away = true;\n        body.classList.remove(AWAY_CLASS);'],
  ['leaving Zen keeps the class', 'unlisten(zenSet);\n        unwatchPins();\n        away = false;\n        body.classList.remove(AWAY_CLASS);', 'unlisten(zenSet);\n        unwatchPins();\n        away = false;'],
  ['leaving Zen does not listen to typing again', 'intentAt = -Infinity;\n        if (enabled) attachShown();\n      }\n    }', 'intentAt = -Infinity;\n      }\n    }'],
  ['leaving Zen keeps the Zen listeners', 'unlisten(zenSet);\n        unwatchPins();\n        away = false;', 'unwatchPins();\n        away = false;'],
  ['the timers survive Zen mode', 'zen = want;\n      cancelDwell();\n      cancelLeave();', 'zen = want;'],
  ['the pins survive Zen mode', 'dwellZone = null;\n      peek.top = false;\n      peek.bottom = false;\n      if (zen) {', 'dwellZone = null;\n      if (zen) {'],
  ['Zen mode can be set without a body', 'if (want === zen || !body) return;', 'if (want === zen) return;'],
  ['show() leaves Zen mode', 'if (!away || zen) return; // Zen mode is left with setZen(false), not by the mouse or by show()', 'if (!away) return;'],
  ['isZen always says no', 'isZen: () => zen,', 'isZen: () => false,'],
  ['setZen is not exported', 'setZen: setZen,', ''],
  ['the Zen pins are not exported', 'ZEN_FOOTER_PINS: ZEN_FOOTER_PINS,', ''],
  // ---- F6 stops at the divider between two pages
  ['F6 cannot focus a stop that is itself the tab stop (the divider)', "if (bar && typeof bar.getAttribute === 'function' && bar.getAttribute('tabindex') === '0' && visible(bar) && typeof bar.focus === 'function') {", 'if (false) {'],
  ['F6 stops at a divider that is not on screen', "bar.getAttribute('tabindex') === '0' && visible(bar) &&", "bar.getAttribute('tabindex') === '0' &&"],
  ['the divider has no name in the round', "return side ? 'strip-' + side : get('data-stop') || 'strip';", "return side ? 'strip-' + side : 'strip';"],
  ['a stop is called divider whatever it is', "return side ? 'strip-' + side : get('data-stop') || 'strip';", "return side ? 'strip-' + side : 'divider';"]
];

function run(dir) {
  return spawnSync(process.execPath, [path.join(dir, 'chrome_overlay_test.js')], { encoding: 'utf8' });
}

// the premise: the unmutated pair passes (otherwise every mutation would "be caught" by a test that fails for another reason)
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comut-'));
  try {
    fs.writeFileSync(path.join(dir, 'chrome_overlay.js'), src);
    fs.writeFileSync(path.join(dir, 'chrome_overlay_test.js'), test);
    const r = run(dir);
    assert.equal(r.status, 0, 'chrome_overlay_test.js passes on the real chrome_overlay.js: ' + r.stdout + r.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const bad = [];
for (const [name, find, replace] of MUTATIONS) {
  if (!src.includes(find)) { bad.push('target missing (the mutation no longer applies): ' + name); continue; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comut-'));
  try {
    fs.writeFileSync(path.join(dir, 'chrome_overlay.js'), src.replace(find, replace));
    fs.writeFileSync(path.join(dir, 'chrome_overlay_test.js'), test);
    const r = run(dir);
    if (r.status === 0) bad.push('SURVIVED: ' + name);
    else console.log('caught: ' + name);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
assert.deepEqual(bad, [], 'chrome_overlay_test.js does not catch:\n  ' + bad.join('\n  '));
console.log('\nAll ' + MUTATIONS.length + ' mutations of chrome_overlay.js are caught by chrome_overlay_test.js');
