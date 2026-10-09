// The two Settings switches for the memory of the WebView2 processes (Windows): they are loaded and saved like the others, the trim is on and the GPU merge is
// off by default, and the Go side reads the same keys (webview_trim.go).
import assert from 'assert';
import fs from 'fs';

console.log('=== webview memory settings tests ===');
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const html = read('frontend/index.html');
const app = read('frontend/js/app.js');
const i18n = read('frontend/js/i18n.js');
const go = read('webview_trim.go');

assert.ok(/id="cfg-trim-webview" checked/.test(html), 'the trim switch is on by default');
assert.ok(/id="cfg-webview-inproc-gpu">/.test(html) && !/id="cfg-webview-inproc-gpu" checked/.test(html), 'the GPU merge switch is off by default');
assert.ok(/trimWebViewWhenHidden: true,/.test(app) && /webViewInProcessGpu: false,/.test(app), 'the defaults of the settings object');
assert.ok(/config\.general\.trimWebViewWhenHidden !== false/.test(app) && /config\.general\.webViewInProcessGpu === true/.test(app), 'loaded into the switches');
assert.ok(/config\.general\.trimWebViewWhenHidden = trimWebViewSaveEl\.checked/.test(app) && /config\.general\.webViewInProcessGpu = webViewGpuSaveEl\.checked/.test(app), 'saved from the switches');
assert.ok(/json:"trimWebViewWhenHidden"/.test(go) && /json:"webViewInProcessGpu"/.test(go), 'the Go side reads the same keys');
for (const key of ['trimWebViewLabel', 'trimWebViewHint', 'webViewInProcGpuLabel', 'webViewInProcGpuHint']) {
  assert.strictEqual((i18n.match(new RegExp('\n    ' + key + ': ', 'g')) || []).length, 2, key + ' exists in both languages');
}
console.log('webview memory settings tests passed');
