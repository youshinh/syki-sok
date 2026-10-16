// A file dropped on the window has no path in the webview; the drop looks the file up on disk (app_drop.go) and opens the note as that
// file, so that Ctrl+S overwrites it instead of asking "Save as" every time.
import assert from 'assert';
import fs from 'fs';

console.log('=== dropped file link tests ===');
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const app = read('frontend/js/app.js');

assert.ok(/async function resolveDroppedFilePath\(file\)/.test(app), 'the lookup exists');
assert.ok(/window\.backend\.resolveDroppedFile\(file\.name, file\.size, file\.lastModified,/.test(app), 'it sends name, size and modification time');
const drop = app.slice(app.indexOf("window.addEventListener('drop'"));
assert.ok(/const linked = await resolveDroppedFilePath\(file\);/.test(drop), 'the drop asks for the path first');
assert.ok(/readFileByPath\(linked\)/.test(drop) && /createTab\(res\.title \|\| file\.name, res\.content, res\.path \|\| linked, res\.encoding\)/.test(drop), 'a found file opens with its path and its own encoding');
assert.ok(/createTab\(file\.name, text, file\.path \|\| ''\)/.test(drop), 'a file that is not found still opens as a note');
for (const [f, re] of [['bind_common.go', /backend_resolveDroppedFile", app\.ResolveDroppedFile/], ['window_windows.go', /resolveDroppedFile: \(name, size, modifiedMs, hintDirs\)/], ['window_darwin.go', /resolveDroppedFile: \(name, size, modifiedMs, hintDirs\)/]]) {
  assert.ok(re.test(read(f)), f + ' exposes it');
}
console.log('dropped file link tests passed');
