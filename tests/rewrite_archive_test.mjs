// Where the Ctrl+K rewrite keeps the replaced text and the link to it (FileAnchor.archivePaths in frontend/js/file_anchor.js),
// and that the link it writes is one a click can open again.
import assert from 'assert';
import { createRequire } from 'module';

console.log('=== rewrite archive tests ===');
const require = createRequire(import.meta.url);
const F = require('../frontend/js/file_anchor.js');
const BS = String.fromCharCode(92);
const win = (...parts) => parts.join(BS);

// 1. a saved note (Windows path with a space in its name): the file sits in <note folder>/history, the link is relative to the note's folder
{
  const a = F.archivePaths({ tabPath: win('C:', 'Users', 'a', 'notes', '2026-10-08 21-54.md'), tabTitle: 'x', dirName: 'history', stamp: 'S' });
  assert.strictEqual(a.fullPath, win('C:', 'Users', 'a', 'notes', 'history', '2026-10-08 21-54_history_S.md'));
  assert.strictEqual(a.linkTarget, 'history/2026-10-08%2021-54_history_S.md');
  // the link must be one the editor finds and reads back to the same target
  const md = `[label](${a.linkTarget})`;
  const found = F.findLinkAt(md, 3);
  assert.ok(found, 'the written link is a link');
  assert.strictEqual(found.target, a.linkTarget);
  assert.ok(!found.remote);
}

// 2. a saved note on macOS / Linux, with parentheses in the name
{
  const a = F.archivePaths({ tabPath: '/home/a/notes/memo (1).md', tabTitle: 'x', dirName: 'history', stamp: 'S' });
  assert.strictEqual(a.fullPath, '/home/a/notes/history/memo (1)_history_S.md');
  assert.strictEqual(a.linkTarget, 'history/memo%20%281%29_history_S.md');
}

// 3. a note with no file: the original goes to the scrap folder and the link is the full path (a click has no scrap folder to resolve against)
{
  const a = F.archivePaths({ tabPath: '', tabTitle: 'Untitled 1', scrapDir: win('C:', 'Users', 'a', 'scraps'), dirName: 'history', stamp: 'S' });
  assert.strictEqual(a.fullPath, win('C:', 'Users', 'a', 'scraps', 'history', 'Untitled 1_history_S.md'));
  assert.strictEqual(a.linkTarget, 'C:/Users/a/scraps/history/Untitled%201_history_S.md');
}

// 4. nowhere to write: null, never a path relative to wherever the app runs (the old code wrote to "[object Promise]/history/...")
assert.strictEqual(F.archivePaths({ tabPath: '', tabTitle: 'x', scrapDir: '', stamp: 'S' }), null);
assert.strictEqual(F.archivePaths({ tabPath: 'nofolder.md', tabTitle: 'x', stamp: 'S' }), null);

// 5. names: forbidden characters, a long name, an empty name, a custom folder name
{
  const a = F.archivePaths({ tabPath: '/n/a:b*c.md', tabTitle: 'x', dirName: ' old ', stamp: 'S' });
  assert.strictEqual(a.fileName, 'a_b_c_history_S.md');
  assert.strictEqual(a.fullPath, '/n/ old /a_b_c_history_S.md'.replace('/ old /', '/old/'));
  const long = F.archivePaths({ tabPath: '/n/' + 'x'.repeat(80) + '.md', tabTitle: 'x', stamp: 'S' });
  assert.strictEqual(long.fileName, 'x'.repeat(50) + '_history_S.md');
  assert.strictEqual(F.archivePaths({ tabPath: '/n/.md', tabTitle: 'x', stamp: 'S' }).fileName, 'note_history_S.md');
}

// 6. the link goes in after every rewrite that was archived, not only after a block: under a block, at the end of a single line
{
  const fs = await import('fs');
  const app = fs.readFileSync(new URL('../frontend/js/app.js', import.meta.url), 'utf8');
  assert.ok(/if \(shouldInsertLink\) \{\s*if \(isMultiLineBlock\) \{/.test(app), 'the link no longer depends on the rewrite having several lines');
  assert.ok(/cleanedResult \+= ` \[\$\{shortTitle\}\]\(\$\{archive\.linkTarget\}\)`;/.test(app), 'a single line gets the link at its end');
  const i18n = fs.readFileSync(new URL('../frontend/js/i18n.js', import.meta.url), 'utf8');
  assert.strictEqual((i18n.match(/historyArchiveLinkShort:/g) || []).length, 2, 'the short link text exists in both languages');
}

console.log('rewrite archive tests passed');
