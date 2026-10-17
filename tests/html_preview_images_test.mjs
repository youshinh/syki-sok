// HTML pages in the preview: (1) a note that is only a fenced page (```html ... ```, what a model returns) is an HTML note, and a fenced page
// that is all a note will hold loses its fence when the answer is put in; (2) <img src="assets/x.png"> next to the page is read in and put
// in the page as a data: URI (the frame has no address of its own), for paths below the note's folder only.
import assert from 'assert';
import fs from 'fs';
import vm from 'vm';

console.log('=== HTML preview: fenced pages and pictures next to a page ===');
const app = fs.readFileSync(new URL('../frontend/js/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const from = app.indexOf("  // What a model returns when it is asked for a page");
const to = app.indexOf('  function renderHtmlPreviewTo(');
assert.ok(from > 0 && to > from, 'the helpers are in app.js');
const helperSource = app.slice(from, to);

// ---- a world with a server for /api/image
function world(files) {
  const calls = { head: 0, get: 0 };
  const ctx = {
    console,
    encodeURIComponent, decodeURIComponent, Map, Number, String, Promise, RegExp,
    FileReader: class {
      readAsDataURL(blob) {
        Promise.resolve(blob.arrayBuffer()).then((buf) => { this.result = 'data:' + (blob.type || 'application/octet-stream') + ';base64,' + Buffer.from(buf).toString('base64'); this.onload(); });
      }
    },
    fetch: async (url, opts) => {
      const q = new URL('http://x' + url).searchParams.get('path');
      const f = files[q];
      const method = (opts && opts.method) || 'GET';
      if (method === 'HEAD') calls.head++; else calls.get++;
      if (!f) return { ok: false, headers: { get: () => null } };
      const body = f.size !== undefined ? Buffer.alloc(f.size, 1) : Buffer.from(f.bytes);
      return {
        ok: true,
        headers: { get: (h) => (h.toLowerCase() === 'content-length' ? String(f.size !== undefined ? f.size : body.length) : (h.toLowerCase() === 'last-modified' ? (f.modified || 'Mon') : null)) },
        blob: async () => new Blob([body], { type: f.type || 'image/png' })
      };
    }
  };
  vm.createContext(ctx);
  vm.runInContext(helperSource + '\n;this.api = { unwrapFencedHtmlDocument, isHtmlDocument, htmlPreviewImagePath, hasHtmlPreviewImages, inlineHtmlPreviewImages };', ctx);
  return { api: ctx.api, calls, files };
}

const page = '<!DOCTYPE html>\n<html><body><h1>Hi</h1></body></html>';

// ---- (1) the fence
{
  const { api } = world({});
  const u = api.unwrapFencedHtmlDocument;
  assert.strictEqual(u('```html\n' + page + '\n```').trim(), page, 'a page in a fence');
  assert.strictEqual(u('\n  ```html  \n' + page + '\n```  \n\n').trim(), page, 'spaces and blank lines around it');
  assert.strictEqual(u('```\n' + page + '\n```').trim(), page, 'a fence with no language');
  assert.strictEqual(u('```htm\n<html lang="ja"><body>x</body></html>\n```').trim(), '<html lang="ja"><body>x</body></html>', '<html> without a doctype');
  assert.strictEqual(u('```html\r\n' + page.replace(/\n/g, '\r\n') + '\r\n```').trim(), page.replace(/\n/g, '\r\n'), 'CRLF');
  assert.strictEqual(u('```html\n<!DOCTYPE html>\n<script>var s = "```";</script>\n```').trim(), '<!DOCTYPE html>\n<script>var s = "```";</script>', 'a fence inside the page does not end it');
  for (const no of ['', null, undefined, 'plain text', '```html\n<div>a fragment</div>\n```', '```js\n' + page + '\n```', '# Title\n\n```html\n' + page + '\n```',
    '```html\n' + page + '\n```\n\nand some words after', page, '```html\n' + page, 'Here it is:\n```html\n' + page + '\n```']) {
    assert.strictEqual(u(no), null, JSON.stringify(no) + ' is not a note that is only a page');
  }
  assert.strictEqual(api.isHtmlDocument('```html\n' + page + '\n```', 'C:\\n\\scrap.md'), true, 'the note is an HTML note (the preview shows a page, the status bar says HTML)');
  assert.strictEqual(api.isHtmlDocument('# Title\n\n```html\n' + page + '\n```', 'a.md'), false, 'a fence among other text is Markdown, as before');
  assert.strictEqual(api.isHtmlDocument('hello', 'a.md'), false);
  assert.strictEqual(api.isHtmlDocument('hello', 'a.html'), true);
  assert.strictEqual(api.isHtmlDocument(page, ''), true);
}

// ---- (2) which paths are pictures of the page
{
  const { api } = world({});
  const p = api.htmlPreviewImagePath;
  const dir = 'C:/notes/deck';
  assert.strictEqual(p('assets/a.png', dir), 'C:/notes/deck/assets/a.png');
  assert.strictEqual(p('./a.png', dir), 'C:/notes/deck/a.png');
  assert.strictEqual(p('img/../a.jpg', dir), 'C:/notes/deck/a.jpg', 'a way up that stays below the folder');
  assert.strictEqual(p('my%20pics/%E5%86%99%E7%9C%9F.png?v=2#x', dir), 'C:/notes/deck/my pics/写真.png', 'escapes are decoded, the query and the hash are dropped');
  assert.strictEqual(p('assets\\a.svg', 'C:\\notes\\deck\\'), 'C:\\notes\\deck/assets/a.svg'.replace('C:\\notes\\deck/', 'C:\\notes\\deck/'), 'a backslash path and a folder with a trailing separator');
  for (const no of ['../secret.png', 'a/../../secret.png', '/etc/x.png', '\\\\host\\share\\x.png', '//host/share/x.png', 'C:\\x.png', 'C:/x.png', 'file:///C:/x.png',
    'http://example.com/a.png', 'https://example.com/a.png', 'data:image/png;base64,AAAA', 'blob:abc', 'javascript:alert(1).png', 'a.txt', 'a.html', 'noext', 'dir/', '', null, '%00.png', 'a\0.png']) {
    assert.strictEqual(p(no, dir), null, JSON.stringify(no) + ' is not inlined');
  }
  assert.strictEqual(p('a.png', ''), null, 'no folder (a note with no file, no workspace): nothing is guessed');
  assert.strictEqual(api.hasHtmlPreviewImages('<img src="a.png">'), true);
  assert.strictEqual(api.hasHtmlPreviewImages("<IMG class='x' SRC = 'a/b.webp' >"), true);
  assert.strictEqual(api.hasHtmlPreviewImages('<img src="https://x/a.png"><img src="data:image/png;base64,AA">'), false);
  assert.strictEqual(api.hasHtmlPreviewImages('<img data-src="a.png"><p>src="a.png"</p>'), false, 'only the src of an img tag');
}

// ---- (3) reading the pictures in
{
  const png = [0x89, 0x50, 0x4e, 0x47, 1, 2, 3];
  const w = world({ 'C:/notes/deck/assets/a.png': { bytes: png }, 'C:/notes/deck/b.png': { bytes: png, type: 'image/png' } });
  const out = await w.api.inlineHtmlPreviewImages('<p><img src="assets/a.png" width=3><img src=\'assets/a.png\'><img src="b.png"><img src="https://x/y.png"><img src="../x.png"><img src="missing.png"></p>', 'C:/notes/deck');
  const b64 = 'data:image/png;base64,' + Buffer.from(png).toString('base64');
  assert.strictEqual(out, '<p><img src="' + b64 + '" width=3><img src=\'' + b64 + '\'><img src="' + b64 + '"><img src="https://x/y.png"><img src="../x.png"><img src="missing.png"></p>',
    'both ways of writing the same picture, another picture; web, a way out and a missing file stay as written');
  assert.strictEqual(w.calls.get, 2, 'one read per picture, not per use');
  // the same page again: the pictures are not read again (the file's size and date say they did not change)
  await w.api.inlineHtmlPreviewImages('<img src="b.png">', 'C:/notes/deck');
  assert.strictEqual(w.calls.get, 2, 'cached');
  w.files['C:/notes/deck/b.png'].modified = 'Tue';
  w.files['C:/notes/deck/b.png'].bytes = [0x89, 0x50, 0x4e, 0x47, 9, 9];
  const again = await w.api.inlineHtmlPreviewImages('<img src="b.png">', 'C:/notes/deck');
  assert.strictEqual(w.calls.get, 3, 'a picture that changed is read again');
  assert.ok(again.includes(Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9]).toString('base64')));
  // no folder: untouched
  const h = '<img src="a.png">';
  assert.strictEqual(await w.api.inlineHtmlPreviewImages(h, ''), h);
  // limits: one picture over 8 MB, the total over 24 MB, more than 12 pictures
  const big = world({ 'D/x.png': { bytes: [1], size: 9 * 1024 * 1024 }, 'D/y.png': { bytes: [1] } });
  const lim = await big.api.inlineHtmlPreviewImages('<img src="x.png"><img src="y.png">', 'D');
  assert.ok(lim.startsWith('<img src="x.png">') && lim.includes('base64'), 'a picture over 8 MB stays as written, the next one is read');
  assert.strictEqual(big.calls.get, 1, 'and the big one is not even downloaded (its size is asked first)');
  const files = {};
  for (let i = 0; i < 20; i++) files['D/p' + i + '.png'] = { bytes: [i], size: 5 * 1024 * 1024 };
  const many = world(files);
  const html = Array.from({ length: 20 }, (_, i) => '<img src="p' + i + '.png">').join('');
  const res = await many.api.inlineHtmlPreviewImages(html, 'D');
  const inlined = (res.match(/data:image/g) || []).length;
  assert.ok(inlined <= 4, 'at most 24 MB in all (4 of 5 MB): ' + inlined);
  const names = {};
  for (let i = 0; i < 20; i++) names['D/q' + i + '.png'] = { bytes: [i], size: 10 };
  const many2 = world(names);
  const res2 = await many2.api.inlineHtmlPreviewImages(Array.from({ length: 20 }, (_, i) => '<img src="q' + i + '.png">').join(''), 'D');
  assert.strictEqual((res2.match(/data:image/g) || []).length, 12, 'at most 12 pictures');
}

// ---- the wiring
assert.ok(/const fencedPage = unwrapFencedHtmlDocument\(text\);\n\s*renderHtmlPreviewTo\(fencedPage !== null \? fencedPage : text, targetPane, tabObj\);/.test(app), 'the preview shows the page inside the fence, for the note it belongs to');
assert.ok(/function renderHtmlPreviewTo\(rawHtml, targetPane, tabObj\) \{\s*targetPane\.classList\.add\('html-mode'\);\s*trackOwnInput\(\);/.test(app), 'the input tracking still starts first');
assert.ok(/const seq = \(targetPane\.__htmlPreviewSeq = \(targetPane\.__htmlPreviewSeq \|\| 0\) \+ 1\);\n\s*if \(!hasHtmlPreviewImages\(fullDoc\)\) \{\n\s*frame\.srcdoc = fullDoc;\n\s*return;\n\s*\}/.test(app), 'a page with no picture of its own is shown at once, as before');
assert.ok(/getNoteDir\(tabObj\)\.then\(\(dir\) => inlineHtmlPreviewImages\(fullDoc, dir\)\)\.then\(\(doc\) => \{\n\s*if \(targetPane\.__htmlPreviewSeq === seq\) frame\.srcdoc = doc;/.test(app), 'the frame is filled when the pictures are in, unless a newer render came');
assert.ok(/\.catch\(\(\) => \{\n\s*if \(targetPane\.__htmlPreviewSeq === seq\) frame\.srcdoc = fullDoc;/.test(app), 'and if reading them fails, the page is shown without');
assert.ok(/const sandbox = /.test('') || /frame\.setAttribute\('sandbox', 'allow-scripts allow-modals allow-forms'\)/.test(app), 'the sandbox is as tight as it was');
// the answer: the fence comes off only when the page is all the note will hold
assert.ok(/if \(reqInfo\.isTask && !errorText && !reqInfo\.isCorrection && !reqInfo\.isRewrite\) \{\n\s*const page = unwrapFencedHtmlDocument\(cleanedResult\);\n\s*const live = page !== null \? getTabText\(reqInfo\.tabId\) : null;\n\s*if \(live !== null && live\.split\(reqInfo\.anchorId\)\.join\(''\)\.trim\(\) === ''\) cleanedResult = page\.trim\(\);/.test(app), 'the fence comes off an answer that is a whole page and lands in an otherwise empty note');
assert.ok(app.indexOf('cleanedResult = page.trim();') < app.indexOf('const emptyAnswer = !errorText && !cleanedResult'), 'before the answer is turned into what is written');
console.log('HTML preview: fenced pages and pictures next to a page tests passed');
