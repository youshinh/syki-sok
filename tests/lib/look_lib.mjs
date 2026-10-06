// Shared by the tests that look at the two looks of the window (frontend/css/tokens.css): resolves the tokens a look and an accent end
// up with, the way the cascade does, and does the colour arithmetic (contrast of a text on a surface, alpha laid over a surface).
//
// The cascade of tokens.css, for <body class="dark-theme [look-paper] theme-X">:
//   a rule applies when every class of its selector is on <body>; the heavier selector (more classes) wins, the later one wins a tie.
// A value can be var(--other) (resolved on the same element), rgb(var(--x-rgb) / a) (a channel token) or a colour.
import fs from 'node:fs';

const lf = (s) => s.replace(/\r\n/g, '\n');
export const readTokens = () => lf(fs.readFileSync('frontend/css/tokens.css', 'utf8'));

export const LOOKS = ['ink', 'paper'];
export const ACCENTS = ['olive', 'blue', 'forest', 'charcoal', 'vermilion'];

export function parseRules(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let order = 0;
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = [];
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) decls.push([d[1].slice(2), d[2].trim()]);
    rules.push({ selectors: m[1].split(',').map((s) => s.trim()), decls, order: order++ });
  }
  return rules;
}

// "body.look-paper.theme-blue" -> ['look-paper', 'theme-blue'] (null when the selector is not a body class selector)
function bodyClasses(selector) {
  const m = /^body((?:\.[\w-]+)+)$/.exec(selector);
  return m ? m[1].slice(1).split('.') : null;
}

// The tokens of <body> for a look ('ink' | 'paper') and an accent: Map name -> raw value (var() not yet resolved).
export function tokensFor(look, accent, rules = parseRules(readTokens())) {
  const on = new Set(['dark-theme', 'theme-' + accent]);
  if (look === 'paper') on.add('look-paper');
  const winner = new Map(); // name -> { weight, order, value }
  for (const rule of rules) {
    for (const sel of rule.selectors) {
      const cls = bodyClasses(sel);
      if (!cls || !cls.every((c) => on.has(c))) continue;
      for (const [name, value] of rule.decls) {
        const w = winner.get(name);
        if (!w || cls.length > w.weight || (cls.length === w.weight && rule.order > w.order)) winner.set(name, { weight: cls.length, order: rule.order, value });
      }
    }
  }
  const out = new Map();
  for (const [name, w] of winner) out.set(name, w.value);
  return out;
}

// :root tokens (the canvas) for a look
export function rootTokensFor(look, rules = parseRules(readTokens())) {
  const out = new Map();
  for (const rule of rules) {
    const hit = rule.selectors.some((s) => s === ':root' || (look === 'paper' && s === ':root.look-paper'));
    if (hit) for (const [name, value] of rule.decls) out.set(name, value);
  }
  return out;
}

// Replaces every var(--x) by x's value (recursively), within one token map.
export function resolveValue(value, map, depth = 0) {
  if (depth > 10) throw new Error('var() loop in ' + value);
  return String(value).replace(/var\(--([\w-]+)\)/g, (whole, name) => {
    if (!map.has(name)) throw new Error('var(--' + name + ') is not defined');
    return resolveValue(map.get(name), map, depth + 1);
  });
}

// A colour: { r, g, b, a } from #hex, rgb(r g b / a), rgb(r, g, b), rgba(r, g, b, a) (after var() is resolved); null when it is not one.
export function parseColour(text) {
  const t = String(text).trim();
  let m = /^#([0-9a-f]{6})$/i.exec(t);
  if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: 1 };
  m = /^#([0-9a-f]{3})$/i.exec(t);
  if (m) return { r: parseInt(m[1][0] + m[1][0], 16), g: parseInt(m[1][1] + m[1][1], 16), b: parseInt(m[1][2] + m[1][2], 16), a: 1 };
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(t);
  if (m) {
    let a = 1;
    if (m[4] !== undefined) a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: +m[1], g: +m[2], b: +m[3], a };
  }
  return null;
}

export function colourOf(map, name) {
  if (!map.has(name)) throw new Error('--' + name + ' is not defined');
  const c = parseColour(resolveValue(map.get(name), map));
  if (!c) throw new Error('--' + name + ' is not a colour: ' + resolveValue(map.get(name), map));
  return c;
}

// `over` laid on `under` (both { r, g, b, a }; the result is opaque when `under` is)
export function composite(over, under) {
  const a = over.a;
  return { r: over.r * a + under.r * (1 - a), g: over.g * a + under.g * (1 - a), b: over.b * a + under.b * (1 - a), a: a + under.a * (1 - a) };
}

const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
export const luminance = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
export const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => ('0' + Math.round(v).toString(16)).slice(-2)).join('');
