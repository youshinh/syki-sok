import fs from 'fs';
import assert from 'assert';
import { createRequire } from 'module';

console.log('=== Settings v1.2.0 UX tests ===');

const require = createRequire(import.meta.url);
const SC = require('../frontend/js/settings_compact.js');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

const html = read('frontend/index.html');
const css = read('frontend/css/style.css');
const i18nSrc = read('frontend/js/i18n.js');
const appJs = read('frontend/js/app.js') + '\n' + read('frontend/js/settings_modal.js');

// 1. Markup & styling contracts for v1.2.0 UX
{
  assert.ok(/id="cfg-settings-search"/.test(html), 'Cross-tab settings search input exists in index.html');
  const overrideCount = (html.match(/<details class="ai-override-box">/g) || []).length;
  assert.strictEqual(overrideCount, 5, 'All 5 secondary AI sections wrap URL/Model/Key in details.ai-override-box');
  for (const id of ['cfg-auto-base-url', 'cfg-vision-base-url', 'cfg-image-api-key', 'cfg-semantic-base-url', 'cfg-action-base-url']) {
    const idx = html.indexOf(`id="${id}"`);
    const prevOverride = html.lastIndexOf('<details class="ai-override-box">', idx);
    const prevClose = html.lastIndexOf('</details>', idx);
    assert.ok(prevOverride !== -1 && prevOverride > prevClose, `${id} sits inside an ai-override-box`);
  }
  assert.ok(/\.settings-search-bar\b/.test(css) && /\.section-status-badge\b/.test(css) && /details\.ai-override-box\b/.test(css), 'v1.2.0 CSS classes exist in style.css');
  assert.ok(/SettingsCompact\.refresh\((document|doc)\)/.test(appJs), 'app.js / settings_modal.js calls SettingsCompact.refresh in openSettings');

  const I18N = new Function(i18nSrc + '\nreturn I18N;')();
  for (const k of ['settingsSearchPlaceholder', 'settingsSearchNoMatch', 'aiOverrideSummary', 'badgeOn', 'badgeOff', 'badgeInherited', 'badgeCustom']) {
    assert.ok(I18N.en[k] && I18N.ja[k], `i18n key ${k} exists in both EN and JA`);
  }
  console.log('PASS: HTML markup, CSS classes, i18n keys, and app.js refresh wiring are all in place.');
}

// 2. Pure logic tests: matchesTerms & isOverrideCustomized
{
  assert.strictEqual(SC.matchesTerms('Inline Autocomplete (Ghost Text)', ['ghost', 'auto']), true);
  assert.strictEqual(SC.matchesTerms('Inline Autocomplete (Ghost Text)', ['ghost', 'sync']), false);
  assert.strictEqual(SC.matchesTerms('Anything', []), true);

  const makeBox = (inputs) => ({
    querySelectorAll: () => inputs
  });
  assert.strictEqual(SC.isOverrideCustomized(makeBox([{ type: 'text', value: 'http://localhost:11434' }, { type: 'password', value: '' }])), false, 'default localhost URL is not treated as custom override');
  assert.strictEqual(SC.isOverrideCustomized(makeBox([{ type: 'text', value: 'gemini-decision-1' }, { type: 'password', value: '' }])), false, 'default decision model is not treated as custom override');
  assert.strictEqual(SC.isOverrideCustomized(makeBox([{ type: 'text', value: '' }, { type: 'password', value: 'sk-custom-key' }])), true, 'non-empty API key marks override as customized');
  assert.strictEqual(SC.isOverrideCustomized(makeBox([{ type: 'text', value: 'https://my-proxy.internal/v1' }, { type: 'password', value: '' }])), true, 'custom base URL marks override as customized');
  console.log('PASS: matchesTerms and isOverrideCustomized behave accurately.');
}

// 3. Mini-DOM behavioral test: init, status badges, override auto-open, and cross-tab search auto-switch
{
  class MiniClassList {
    constructor(el) { this.el = el; this.set = new Set(); }
    add(...cls) { cls.forEach(c => this.set.add(c)); }
    remove(...cls) { cls.forEach(c => this.set.delete(c)); }
    toggle(c, force) {
      if (force === undefined) {
        if (this.set.has(c)) { this.set.delete(c); return false; }
        this.set.add(c); return true;
      }
      if (force) { this.set.add(c); return true; }
      this.set.delete(c); return false;
    }
    contains(c) { return this.set.has(c); }
  }

  class MiniEl {
    constructor(tag, attrs = {}) {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.parentElement = null;
      this.attributes = {};
      this.dataset = {};
      this.listeners = {};
      this.classList = new MiniClassList(this);
      this._text = '';
      this.id = attrs.id || '';
      this.type = attrs.type || '';
      this.value = attrs.value || '';
      this.placeholder = attrs.placeholder || '';
      this.checked = !!attrs.checked;
      this.open = false;
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') v.split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c));
        else if (k.startsWith('data-')) this.setAttribute(k, v);
      }
    }
    setAttribute(k, v) {
      this.attributes[k] = String(v);
      if (k === 'class') {
        this.classList.set.clear();
        String(v).split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c));
      }
    }
    getAttribute(k) { return this.attributes[k] ?? null; }
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k); }
    removeAttribute(k) { delete this.attributes[k]; }
    set className(v) { this.setAttribute('class', v); }
    get className() { return Array.from(this.classList.set).join(' '); }
    set textContent(v) { this._text = String(v); this.children = []; }
    get textContent() {
      if (this.children.length === 0) return this._text;
      return this._text + this.children.map(c => c.textContent).join(' ');
    }
    appendChild(child) {
      if (child.parentElement) {
        const idx = child.parentElement.children.indexOf(child);
        if (idx !== -1) child.parentElement.children.splice(idx, 1);
      }
      child.parentElement = this;
      this.children.push(child);
      return child;
    }
    insertBefore(newNode, refNode) {
      if (newNode.parentElement) {
        const idx = newNode.parentElement.children.indexOf(newNode);
        if (idx !== -1) newNode.parentElement.children.splice(idx, 1);
      }
      newNode.parentElement = this;
      const i = this.children.indexOf(refNode);
      if (i === -1) this.children.push(newNode);
      else this.children.splice(i, 0, newNode);
      return newNode;
    }
    addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
    dispatchEvent(ev) {
      (this.listeners[ev.type] || []).forEach(fn => fn(ev));
      if (this.parentElement) this.parentElement.dispatchEvent(ev);
    }
    click() {
      if (this._onClick) this._onClick();
    }
    closest(sel) {
      let cur = this;
      while (cur) {
        if (cur._matches(sel)) return cur;
        cur = cur.parentElement;
      }
      return null;
    }
    _matches(sel) {
      const parts = sel.trim().split(/\s*,\s*/);
      return parts.some(part => {
        // support simple selectors like tag.class, .class, details.settings-section, h4[data-i18n], input[type="text"], #id
        const sub = part.trim();
        if (sub.startsWith('#')) return this.id === sub.slice(1);
        let tagMatch = true;
        let rest = sub;
        const tagM = /^([a-zA-Z0-9]+)/.exec(rest);
        if (tagM) {
          tagMatch = this.tagName === tagM[1].toUpperCase();
          rest = rest.slice(tagM[0].length);
        }
        if (!tagMatch) return false;
        const attrMatches = [...rest.matchAll(/\[([a-zA-Z0-9-]+)(?:="([^"]*)")?\]/g)];
        for (const am of attrMatches) {
          if (am[2] !== undefined) {
            if (am[1] === 'type' && this.type !== am[2]) return false;
            else if (am[1] !== 'type' && this.getAttribute(am[1]) !== am[2]) return false;
          } else if (!this.hasAttribute(am[1])) {
            return false;
          }
          rest = rest.replace(am[0], '');
        }
        const clsMatches = [...rest.matchAll(/\.([a-zA-Z0-9_-]+)/g)];
        for (const cm of clsMatches) {
          if (!this.classList.contains(cm[1])) return false;
        }
        return true;
      });
    }
    querySelectorAll(sel) {
      const out = [];
      const walk = (node, isDirectChildOnly) => {
        for (const ch of node.children) {
          if (ch._matches(sel)) out.push(ch);
          if (!isDirectChildOnly) walk(ch, false);
        }
      };
      if (sel.includes('>')) {
        // handle `.settings-section-body > .form-group, ...`
        const parts = sel.split(/\s*,\s*/);
        const matchSet = new Set();
        const walkAll = (node) => {
          for (const ch of node.children) {
            for (const p of parts) {
              const [parentSel, childSel] = p.split(/\s*>\s*/);
              if (ch._matches(childSel) && ch.parentElement && ch.parentElement._matches(parentSel)) {
                matchSet.add(ch);
              }
            }
            walkAll(ch);
          }
        };
        walkAll(this);
        return Array.from(matchSet);
      }
      walk(this, false);
      return out;
    }
    querySelector(sel) {
      return this.querySelectorAll(sel)[0] || null;
    }
  }

  const card = new MiniEl('div', { class: 'modal-card' });
  const searchEl = new MiniEl('input', { id: 'cfg-settings-search', type: 'search' });
  const advToggle = new MiniEl('input', { id: 'cfg-show-advanced', type: 'checkbox' });
  const tabGen = new MiniEl('button', { id: 'tab-btn-general', class: 'settings-tab-btn active' });
  const tabMod = new MiniEl('button', { id: 'tab-btn-model', class: 'settings-tab-btn' });
  let switchedTo = '';
  tabGen._onClick = () => { tabGen.classList.add('active'); tabMod.classList.remove('active'); switchedTo = 'general'; };
  tabMod._onClick = () => { tabMod.classList.add('active'); tabGen.classList.remove('active'); switchedTo = 'model'; };

  const paneGen = new MiniEl('div', { id: 'pane-general', class: 'settings-pane' });
  const hGen = new MiniEl('div', { class: 'settings-section-header', 'data-basic': '' });
  const hGenTitle = new MiniEl('h4', { 'data-i18n': 'sectionAppearance' });
  hGenTitle.textContent = 'Appearance';
  hGen.appendChild(hGenTitle);
  const gFont = new MiniEl('div', { class: 'form-group' });
  const lblFont = new MiniEl('label'); lblFont.textContent = 'Editor Font';
  gFont.appendChild(lblFont);
  paneGen.appendChild(hGen);
  paneGen.appendChild(gFont);

  const paneMod = new MiniEl('div', { id: 'pane-model', class: 'settings-pane hidden' });
  const hAuto = new MiniEl('div', { class: 'settings-section-header' });
  const hAutoTitle = new MiniEl('h4', { 'data-i18n': 'sectionAutocomplete' });
  hAutoTitle.textContent = 'Inline Autocomplete';
  hAuto.appendChild(hAutoTitle);
  const gAutoToggle = new MiniEl('div', { class: 'form-group inline-group' });
  const cbAuto = new MiniEl('input', { id: 'cfg-auto-enabled', type: 'checkbox', checked: true });
  gAutoToggle.appendChild(cbAuto);
  const overrideBox = new MiniEl('details', { class: 'ai-override-box' });
  const overrideSum = new MiniEl('summary');
  const overrideBadge = new MiniEl('span', { class: 'ai-override-badge' });
  overrideSum.appendChild(overrideBadge);
  const overrideBody = new MiniEl('div', { class: 'ai-override-body' });
  const gOverrideKey = new MiniEl('div', { class: 'form-group' });
  const inpAutoKey = new MiniEl('input', { id: 'cfg-auto-api-key', type: 'password', value: '' });
  gOverrideKey.appendChild(inpAutoKey);
  overrideBody.appendChild(gOverrideKey);
  overrideBox.appendChild(overrideSum);
  overrideBox.appendChild(overrideBody);
  paneMod.appendChild(hAuto);
  paneMod.appendChild(gAutoToggle);
  paneMod.appendChild(overrideBox);

  card.appendChild(searchEl);
  card.appendChild(advToggle);
  card.appendChild(tabGen);
  card.appendChild(tabMod);
  card.appendChild(paneGen);
  card.appendChild(paneMod);

  const doc = {
    documentElement: { lang: 'en' },
    createElement: (tag) => new MiniEl(tag),
    getElementById: (id) => card.querySelector('#' + id)
  };

  SC.init(doc);

  // Verify status badge on sectionAutocomplete shows ON
  const autoBadge = hAuto.querySelector('.section-status-badge');
  assert.ok(autoBadge && autoBadge.textContent.trim() === 'ON' && autoBadge.classList.contains('is-on'), 'section badge shows ON when enabled');

  // Verify override box starts closed & Inherited when empty/default
  assert.strictEqual(overrideBox.open, false, 'override box starts closed when inherited');
  assert.strictEqual(overrideBadge.textContent.trim(), 'Inherited');

  // Set custom API key and refresh -> auto-opens and shows Custom badge
  inpAutoKey.value = 'sk-user-override';
  SC.refresh(doc);
  assert.strictEqual(overrideBox.open, true, 'override box auto-opens when customized');
  assert.strictEqual(overrideBadge.textContent.trim(), 'Custom');

  // Search for "Autocomplete" while General tab is active -> switches to Model tab and opens section
  searchEl.value = 'Autocomplete';
  searchEl.dispatchEvent({ type: 'input', target: searchEl });
  assert.strictEqual(switchedTo, 'model', 'cross-tab search auto-switches to matching tab when active tab has 0 hits');
  assert.strictEqual(tabMod.getAttribute('data-match-count'), '2', 'matching tab shows match count badge');

  // Clear search -> restores tabs & clears match counts
  searchEl.value = '';
  searchEl.dispatchEvent({ type: 'input', target: searchEl });
  assert.strictEqual(tabMod.getAttribute('data-match-count'), null, 'clearing search removes tab match badges');

  console.log('PASS: status badges, override auto-open, and cross-tab search auto-switch work end-to-end.');
}

console.log('\nAll Settings v1.2.0 UX tests PASSED!');
