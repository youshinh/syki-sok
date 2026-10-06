import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer, REPO } from './server.mjs';
import { launchEdge, shutdownEdge, Page, sleep } from './cdp.mjs';
import { SETUPS } from './setups.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const POSTPROCESS = path.join(HERE, 'postprocess.py');

// Mappings from docshot setup to root img/ file
const TARGETS = [
  { setup: 'splitPreview', out: 'img/screen_diagram.png', lang: 'ja' },
  { setup: 'splitPreview', out: 'img/screen_split.png', lang: 'ja' },
  { setup: 'splitPreview', out: 'img/screen.png', lang: 'ja' },
  { setup: 'cliBar', out: 'img/screen_cli_filter.png', lang: 'ja' },
  { setup: 'scrapsSearch', out: 'img/screen_scraps_search.png', lang: 'ja' },
  { setup: 'settingsGeneral', out: 'img/setting.png', lang: 'ja' },
  { setup: 'settingsAgent', out: 'img/screen_settings_agent.png', lang: 'ja' },
  { setup: 'commandPalette', out: 'img/screen_palette.png', lang: 'ja' },
  { setup: 'inlineAi', out: 'img/screen_prompt.png', lang: 'ja' },
];

async function main() {
  const title = 'SHOWCASE-' + Math.random().toString(16).slice(2, 6);
  const { server, port } = await startServer({ title });
  const base = `http://127.0.0.1:${port}`;
  const viewport = [1120, 720];

  const edge = await launchEdge({ url: `${base}/?lang=ja`, width: viewport[0] + 16, height: viewport[1] + 39 });
  let page = null;

  try {
    page = await Page.attach(edge.debugPort, title, []);
    await page.setInnerSize(viewport[0], viewport[1]);

    for (const t of TARGETS) {
      console.log(`Generating ${t.out} via setup: ${t.setup}...`);
      await page.navigate(`${base}/?lang=${t.lang}`);
      await page.waitFor('window.__docshot && window.__docshot.isReady()', { timeout: 20000 });
      await sleep(200);

      const ctx = {
        page,
        key: (k, opts) => page.key(k, opts),
        type: (str, opts) => page.type(str, opts),
        ev: (expr) => page.eval(expr),
        waitFor: (expr, opts) => page.waitFor(expr, opts),
        clickSel: (sel) => page.eval(`document.querySelector(${JSON.stringify(sel)}).click()`),
        pick: (en, ja) => (t.lang === 'ja' ? ja : en),
        sleep: (ms) => sleep(ms),
        move: (x, y) => page.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }),
      };

      const setupFn = SETUPS[t.setup];
      if (!setupFn) throw new Error('Unknown setup: ' + t.setup);
      await setupFn(ctx);
      await sleep(400);

      // Make sure chrome bars are shown cleanly
      await page.eval("(function () { var c = window.ChromeOverlay && window.ChromeOverlay.current; if (c) c.show(); document.body.classList.remove('chrome-faded'); })()");
      await sleep(500);

      const shotBytes = await page.screenshot();
      const tmpRef = path.join(REPO, 'tmp_showcase_ref.png');
      const tmpSpec = path.join(REPO, 'tmp_showcase_spec.json');
      fs.writeFileSync(tmpRef, shotBytes);

      const spec = {
        viewport,
        ref: tmpRef,
        raw: tmpRef,
        out: path.join(REPO, t.out),
        method: 'cdp',
        scale: 1,
        markers: [], // No orange number markers for showcase / hero images
      };
      fs.writeFileSync(tmpSpec, JSON.stringify(spec));

      const py = spawnSync('python', [POSTPROCESS, tmpSpec], { encoding: 'utf8' });
      try { fs.unlinkSync(tmpRef); } catch {}
      try { fs.unlinkSync(tmpSpec); } catch {}

      if (py.status !== 0) {
        console.error('Postprocess error:', py.stderr || py.stdout);
      } else {
        console.log(`  -> ${t.out} OK`);
      }
    }
  } finally {
    if (page) page.close();
    await shutdownEdge(edge);
    server.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
