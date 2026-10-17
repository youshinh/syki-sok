// syki::sok Mermaid repair. The AI that draws a diagram from a text makes the same few mistakes again and again, and Mermaid is strict:
// one wrong character and the whole diagram is a red error. Every mistake here is one that can be put right by rule, without asking the AI
// again and without changing what the diagram says:
//   - the code fence is tagged with the diagram type (```timeline) instead of ```mermaid, or the type line is missing / buried in prose;
//   - a flowchart label with brackets or parentheses that is not in quotes, a quote inside a quoted label, `end` as a node, "→" as an arrow;
//   - a sequence message with a ";" in it, `=>` as an arrow, an unclosed alt/loop, a deactivate of a participant that is not active;
//   - a state written `state Draft as "Label"` (Mermaid wants the label first), a second ":" in a transition's text;
//   - an ER diagram with Japanese entity / attribute names, an unquoted Japanese relationship label;
//   - a mindmap with two roots, or parentheses in a plain node's text; a quadrant chart with unquoted text or points outside 0..1;
//   - a pie chart with "45%" or labels without quotes.
// Each rule only touches text that Mermaid cannot read (a diagram that is fine comes back unchanged, byte for byte).
//
// Pure functions, no DOM and no Mermaid: app.js calls repairAnswer() on the AI's answer, and repair() again on a diagram that fails to draw.
(function (global) {
  'use strict';

  const HEADERS = ['flowchart', 'graph', 'sequenceDiagram', 'classDiagram-v2', 'classDiagram', 'stateDiagram-v2', 'stateDiagram', 'erDiagram',
    'gantt', 'pie', 'journey', 'mindmap', 'timeline', 'quadrantChart', 'gitGraph', 'requirementDiagram', 'C4Context', 'C4Container',
    'C4Component', 'C4Dynamic', 'C4Deployment', 'sankey-beta', 'xychart-beta', 'block-beta', 'packet-beta', 'architecture-beta', 'kanban'];
  const CANONICAL = {};
  HEADERS.forEach((h) => { CANONICAL[h.toLowerCase()] = h; });
  CANONICAL.sankey = 'sankey-beta'; // the short names a model may use as a fence tag

  const HEADER_RE = new RegExp('^\\s*(' + HEADERS.join('|') + ')(?![A-Za-z0-9_-])');
  const NON_ASCII = /[^\x00-\x7F]/;
  const ASCII_WORD = /^[A-Za-z_][A-Za-z0-9_-]*$/;

  function isMeta(line) {
    const s = line.trim();
    return s === '' || s.indexOf('%%') === 0;
  }

  // Index of the first line after a front matter block (---) and comments / directives; the header is expected there.
  function firstContentIndex(lines) {
    let i = 0;
    while (i < lines.length && lines[i].trim() === '') i++;
    if (i < lines.length && lines[i].trim() === '---') {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== '---') j++;
      i = j < lines.length ? j + 1 : i;
    }
    while (i < lines.length && isMeta(lines[i])) i++;
    return i;
  }

  function headerWord(line) {
    const m = HEADER_RE.exec(line);
    return m ? m[1] : '';
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // flowchart

  const FLOW_OPENERS = [['((', '))'], ['([', '])'], ['[(', ')]'], ['[[', ']]'], ['{{', '}}'], ['[/', '/]'], ['[\\', '\\]'], ['(', ')'], ['[', ']'], ['{', '}']];
  const AFTER_NODE = /^\s*(?:$|;|&|:::|<?[-=.ox~]{2,}|[-=]+>|~~~|[→⇒⟶➔➡—－ー])/;
  const ID_CHAR = /[\p{L}\p{N}_]/u;
  const FW_ARROW = /\s*(?:→|⇒|⟶|➔|➡️?|—>|－＞|ー>)\s*/g;

  function quoteFlowLabel(content) {
    return '"' + content.replace(/"/g, "'").replace(/\\n/g, '<br/>') + '"';
  }

  // The label of one node, between its opening and closing brackets.
  function fixFlowLabel(content) {
    const t = content.trim();
    if (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') {
      const inner = t.slice(1, -1);
      return /"/.test(inner) || /\\n/.test(inner) ? quoteFlowLabel(inner) : content;
    }
    if (t[0] === '"') return content; // unfinished quote: nothing sure to do
    if (/[()\[\]{}|"]/.test(t) || t === 'end') return quoteFlowLabel(t);
    return content;
  }

  function closerIndex(line, from, closer, quoted) {
    let last = -1;
    for (let k = line.indexOf(closer, from); k !== -1; k = line.indexOf(closer, k + 1)) {
      last = k;
      if (quoted && line[k - 1] !== '"') continue;
      if (AFTER_NODE.test(line.slice(k + closer.length))) return k;
    }
    return last;
  }

  function fixFlowLine(line) {
    const t = line.trim();
    if (t === 'end' || /^(subgraph|classDef|class|style|linkStyle|click|direction|accTitle|accDescr|flowchart|graph)\b/.test(t) || t.indexOf('%%') === 0) return line;
    let out = '';
    let plain = '';
    const flush = () => { out += plain.replace(FW_ARROW, ' --> '); plain = ''; };
    let i = 0;
    const n = line.length;
    while (i < n) {
      const ch = line[i];
      if (ch === '"') { // a quoted string outside a node (an edge label)
        const e = line.indexOf('"', i + 1);
        const stop = e === -1 ? n : e + 1;
        flush();
        out += line.slice(i, stop);
        i = stop;
      } else if (ch === '|') { // an edge label  -->|text|
        const e = line.indexOf('|', i + 1);
        if (e === -1) { plain += ch; i++; continue; }
        const inner = line.slice(i + 1, e);
        const it = inner.trim();
        flush();
        out += '|' + (it && it[0] !== '"' && /[()\[\]{}]/.test(it) ? quoteFlowLabel(it) : inner) + '|';
        i = e + 1;
      } else if (ID_CHAR.test(ch)) {
        let j = i;
        while (j < n && ID_CHAR.test(line[j])) j++;
        let id = line.slice(i, j);
        let opener = null;
        for (let k = 0; k < FLOW_OPENERS.length && !opener; k++) {
          if (line.startsWith(FLOW_OPENERS[k][0], j)) opener = FLOW_OPENERS[k];
        }
        // `end` closes a subgraph; as a node (at the start of the line, or right after an arrow) it breaks the diagram
        if (id === 'end' && /(^\s*|[>&|]\s*)$/.test(out + plain)) id = 'endNode';
        if (!opener) {
          const rest = line.slice(j);
          plain += id === 'endNode' && !/^\s*[:;]/.test(rest) ? 'endNode["end"]' : id;
          i = j;
          continue;
        }
        const contentFrom = j + opener[0].length;
        const quoted = line[contentFrom] === '"';
        const c = closerIndex(line, contentFrom, opener[1], quoted);
        if (c === -1) { plain += line.slice(i); i = n; break; }
        const content = line.slice(contentFrom, c);
        flush();
        const slashShape = opener[0] === '[/' || opener[0] === '[\\';
        out += id + opener[0] + (slashShape ? content : fixFlowLabel(content)) + opener[1];
        i = c + opener[1].length;
      } else {
        plain += ch;
        i++;
      }
    }
    flush();
    return out;
  }

  function repairFlowchart(lines, fixes) {
    let changed = false;
    const out = lines.map((l, idx) => {
      if (idx === 0) return l;
      const f = fixFlowLine(l);
      if (f !== l) changed = true;
      return f;
    });
    if (changed) fixes.push('flowchart-labels');
    const subgraphs = out.filter((l) => /^\s*subgraph\b/.test(l)).length;
    const ends = out.filter((l) => l.trim() === 'end').length;
    for (let k = ends; k < subgraphs; k++) { out.push('end'); fixes.push('flowchart-unclosed-subgraph'); }
    return out;
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // sequence diagram

  const SEQ_MESSAGE = /^(\s*)([^\s:]+?)\s*(<<-->>|<<->>|-->>|->>|-->|->|--x|-x|--\)|-\)|==>|=>|⇒|→)\s*([+-])?\s*([^\s:]+)\s*:(.*)$/;

  // A ; ends a statement in a sequence diagram; #59; is the escape for the character (one that already is an entity, #59; or #35;, stays).
  function escapeSemicolons(text) {
    return text.replace(/(#[A-Za-z0-9]+)?;/g, (m, entity) => (entity ? m : '#59;'));
  }

  function repairSequence(lines, fixes) {
    const active = {};
    const out = [];
    const opens = /^\s*(alt|opt|loop|par|critical|break|rect|box)\b/;
    const stack = []; // the indent of each block that is open
    const note = (name) => { if (fixes.indexOf(name) === -1) fixes.push(name); };
    lines.forEach((line, idx) => {
      if (idx === 0) { out.push(line); return; }
      let l = line;
      const part = /^(\s*)(participant|actor)\s+([^\s]+)(.*)$/.exec(l);
      if (part) {
        if (part[3] === 'end') { l = part[1] + part[2] + ' endP' + (part[4].trim() ? part[4] : ' as end'); note('sequence-end-name'); }
        out.push(l);
        return;
      }
      const act = /^(\s*)(activate|deactivate)\s+(\S+)\s*$/.exec(l);
      if (act) {
        const who = act[3] === 'end' ? 'endP' : act[3];
        if (act[2] === 'activate') { active[who] = (active[who] || 0) + 1; } else if (!active[who]) { note('sequence-bad-deactivate'); return; } else { active[who]--; }
        out.push(who === act[3] ? l : act[1] + act[2] + ' ' + who);
        return;
      }
      const msg = SEQ_MESSAGE.exec(l);
      if (msg) {
        let changed = false; // a message that is fine is kept as it was written (spacing and all)
        let arrow = msg[3];
        if (arrow === '=>' || arrow === '==>' || arrow === '⇒' || arrow === '→') { arrow = '->>'; changed = true; note('sequence-arrow'); }
        let from = msg[2];
        let to = msg[5];
        let mark = msg[4] || '';
        if (from === 'end') { from = 'endP'; changed = true; note('sequence-end-name'); }
        if (to === 'end') { to = 'endP'; changed = true; note('sequence-end-name'); }
        if (mark === '+') active[to] = (active[to] || 0) + 1;
        if (mark === '-') { if (active[from]) active[from]--; else { mark = ''; changed = true; note('sequence-bad-deactivate'); } }
        let text = msg[6];
        const escaped = escapeSemicolons(text);
        if (escaped !== text) { text = escaped; changed = true; note('sequence-semicolon'); }
        out.push(changed ? msg[1] + from + arrow + mark + to + ':' + text : l);
        return;
      }
      const c = l.indexOf(':');
      if (c !== -1 && l.indexOf(';', c) !== -1 && !/^\s*(participant|actor|autonumber|title)\b/.test(l)) {
        const escaped = escapeSemicolons(l.slice(c + 1));
        if (escaped !== l.slice(c + 1)) { l = l.slice(0, c + 1) + escaped; note('sequence-semicolon'); }
      }
      if (opens.test(l)) stack.push(/^\s*/.exec(l)[0]);
      else if (l.trim() === 'end' && stack.length) stack.pop();
      out.push(l);
    });
    while (stack.length) { out.push(stack.pop() + 'end'); note('sequence-unclosed-block'); }
    return out;
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // state diagram

  function repairState(lines, fixes) {
    const note = (name) => { if (fixes.indexOf(name) === -1) fixes.push(name); };
    let braces = 0;
    const out = lines.map((line, idx) => {
      if (idx === 0) return line;
      let l = line;
      const sw = /^(\s*)state\s+([^\s"{]+)\s+as\s+(?:"([^"]*)"|(\S.*?))\s*$/.exec(l);
      if (sw) {
        l = sw[1] + 'state "' + (sw[3] !== undefined ? sw[3] : sw[4]).replace(/"/g, "'") + '" as ' + sw[2];
        note('state-as-order');
      } else if (!/^\s*(state|note|title|%%|end note|direction|classDef|class|style|accTitle|accDescr)\b/.test(l)) {
        const c = l.indexOf(':');
        if (c !== -1 && l.indexOf(':', c + 1) !== -1 && !/:::/.test(l)) {
          l = l.slice(0, c + 1) + l.slice(c + 1).replace(/:/g, '：');
          note('state-colon');
        }
      }
      if (/\{\s*$/.test(l)) braces++;
      else if (l.trim() === '}') braces--;
      return l;
    });
    for (; braces > 0; braces--) { out.push('}'); note('state-unclosed'); }
    return out;
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // ER diagram: entity names can be quoted ("顧客"), attribute names cannot be Japanese (the name goes to the comment).

  const ER_NAME = '"[^"]*"|[^\\s"]+';
  const ER_REL = '[|o}{]{1,2}(?:--|\\.\\.)[|o}{]{1,2}';
  const ER_RELATION = new RegExp('^(\\s*)(' + ER_NAME + ')(\\s+)(' + ER_REL + ')(\\s+)(' + ER_NAME + ')\\s*(?::\\s*(.*?))?\\s*$');
  const ER_PLAIN_ARROW = new RegExp('^(\\s*)(' + ER_NAME + ')(\\s+)(?:<-->|-->|<--|->|---|--|==>)\\s+(' + ER_NAME + ')\\s*(?::\\s*(.*?))?\\s*$');
  const ER_BLOCK =new RegExp('^(\\s*)(' + ER_NAME + ')\\s*\\{\\s*$');
  const ER_ATTR = /^(\s*)(\S+)\s+(\S+)((?:\s+(?:PK|FK|UK)(?:\s*,\s*(?:PK|FK|UK))*)?)(?:\s+"([^"]*)")?\s*$/;

  function erName(name, note) {
    if (name[0] !== '"' && NON_ASCII.test(name)) { note('er-quoted-name'); return '"' + name + '"'; }
    return name;
  }

  function repairEr(lines, fixes) {
    const note = (name) => { if (fixes.indexOf(name) === -1) fixes.push(name); };
    let inBlock = false;
    let counter = 0;
    return lines.map((line, idx) => {
      if (idx === 0) return line;
      if (inBlock) {
        if (line.trim() === '}') { inBlock = false; return line; }
        const a = ER_ATTR.exec(line);
        if (!a || line.trim().indexOf('%%') === 0) return line;
        let type = a[2];
        let name = a[3];
        let comment = a[5];
        let changed = false;
        if (!ASCII_WORD.test(name.replace(/\([^)]*\)|\[[^\]]*\]/g, ''))) {
          counter++;
          comment = comment ? name + ' ' + comment : name;
          name = 'attr' + counter;
          changed = true;
        }
        if (NON_ASCII.test(type)) { type = 'string'; changed = true; }
        if (!changed) return line;
        note('er-attribute-name');
        return a[1] + type + ' ' + name + (a[4] || '') + (comment ? ' "' + comment.replace(/"/g, "'") + '"' : '');
      }
      // "A --> B : text" is not an ER relationship; the weakest claim that is one is many-to-many (optional on both sides)
      const plain = ER_PLAIN_ARROW.exec(line);
      const r = plain ? null : ER_RELATION.exec(line);
      if (plain || r) {
        const m = plain || r;
        const rel = plain ? '}o--o{' : r[4];
        const first = plain ? plain[2] : r[2];
        const second = plain ? plain[4] : r[6];
        let label = plain ? plain[5] : r[7];
        if (label !== undefined && label !== '' && label[0] !== '"' && !/^[A-Za-z0-9_]+$/.test(label)) {
          label = '"' + label.replace(/"/g, "'") + '"';
          note('er-label');
        }
        if (plain) note('er-relationship');
        const rebuilt = m[1] + erName(first, note) + ' ' + rel + ' ' + erName(second, note) + (label !== undefined ? ' : ' + label : '');
        return rebuilt.replace(/\s+/g, '') === line.replace(/\s+/g, '') ? line : rebuilt;
      }
      const b = ER_BLOCK.exec(line);
      if (b) {
        inBlock = true;
        return b[1] + erName(b[2], note) + ' {';
      }
      return line;
    });
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // mindmap

  function indentOf(line) {
    return /^[ \t]*/.exec(line)[0].replace(/\t/g, '    ').length;
  }

  function repairMindmap(lines, fixes) {
    const note = (name) => { if (fixes.indexOf(name) === -1) fixes.push(name); };
    const body = lines.slice(1);
    const nodes = body.filter((l) => l.trim() !== '' && !/^\s*(::|%%)/.test(l));
    let out = lines.slice();
    if (nodes.length > 1) {
      const min = Math.min.apply(null, nodes.map(indentOf));
      const roots = nodes.filter((l) => indentOf(l) === min);
      if (roots.length > 1) {
        // a second root: it and everything after it go one level down, under the first root
        let seen = 0;
        out = out.map((l, idx) => {
          if (idx === 0 || l.trim() === '') return l;
          if (/^\s*(::|%%)/.test(l)) return seen > 1 ? '  ' + l : l;
          if (indentOf(l) === min) seen++;
          return seen > 1 ? '  ' + l : l;
        });
        note('mindmap-one-root');
      }
    }
    out = out.map((l, idx) => {
      if (idx === 0) return l;
      const m = /^(\s*)(\S.*)$/.exec(l);
      if (!m) return l;
      const text = m[2];
      if (/^(::|%%|["'])/.test(text)) return l;
      if (/^[A-Za-z0-9_]+(\(\(|\(|\[|\{\{|\)\)|\)|\{)/.test(text)) return l; // id + shape: real Mermaid syntax
      if (!/[()\[\]{}]/.test(text)) return l;
      note('mindmap-brackets');
      return m[1] + text.replace(/\(/g, '（').replace(/\)/g, '）').replace(/\[/g, '［').replace(/\]/g, '］').replace(/\{/g, '｛').replace(/\}/g, '｝');
    });
    return out;
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // quadrant chart

  function quoteText(text) {
    const t = text.trim();
    if (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') return t;
    return '"' + t.replace(/"/g, "'") + '"';
  }

  function repairQuadrant(lines, fixes) {
    const note = (name) => { if (fixes.indexOf(name) === -1) fixes.push(name); };
    const points = [];
    const out = lines.map((line, idx) => {
      if (idx === 0) return line;
      // a line that is fine is kept as it was written (spacing and all)
      const keep = (l) => {
        if (l.replace(/\s+/g, '') === line.replace(/\s+/g, '')) return line;
        note('quadrant-quotes');
        return l;
      };
      let m = /^(\s*)(x-axis|y-axis)\s+(.+?)(?:\s*-->\s*(.+?))?\s*$/.exec(line);
      if (m) return keep(m[1] + m[2] + ' ' + quoteText(m[3]) + (m[4] !== undefined ? ' --> ' + quoteText(m[4]) : ''));
      m = /^(\s*)(quadrant-[1-4])\s+(.+?)\s*$/.exec(line);
      if (m) return keep(m[1] + m[2] + ' ' + quoteText(m[3]));
      m = /^(\s*)(.+?)\s*:\s*\[\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*\](.*)$/.exec(line);
      if (m && !/^\s*title\b/.test(line)) {
        const pt = { indent: m[1], name: m[2], rawX: m[3], rawY: m[4], x: parseFloat(m[3]), y: parseFloat(m[4]), rest: m[5], line: line };
        points.push(pt);
        return pt;
      }
      return line;
    });
    // points outside 0..1 (0..100 scores are common): one scale for all, so they keep their places relative to each other
    const max = points.reduce((a, p) => Math.max(a, p.x, p.y), 0);
    const scale = max > 1 ? (max <= 10 ? 10 : max <= 100 ? 100 : max) : 1;
    const num = (v) => String(Math.round(Math.min(1, Math.max(0, v / scale)) * 100) / 100);
    if (scale !== 1) note('quadrant-scale');
    return out.map((l) => {
      if (typeof l === 'string') return l;
      const x = scale === 1 && l.x >= 0 ? l.rawX : num(l.x);
      const y = scale === 1 && l.y >= 0 ? l.rawY : num(l.y);
      const nl = l.indent + quoteText(l.name) + ': [' + x + ', ' + y + ']' + l.rest;
      if (nl.replace(/\s+/g, '') === l.line.replace(/\s+/g, '')) return l.line;
      note('quadrant-quotes');
      return nl;
    });
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // pie chart

  function repairPie(lines, fixes) {
    const note = (name) => { if (fixes.indexOf(name) === -1) fixes.push(name); };
    return lines.map((line, idx) => {
      if (idx === 0) return line;
      if (/^\s*(title|showData|accTitle|accDescr|%%)/.test(line)) return line;
      const m = /^(\s*)(.+?)\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*%?\s*$/.exec(line);
      if (!m) return line;
      const l = m[1] + quoteText(m[2]) + ' : ' + m[3];
      if (l.replace(/\s+/g, '') === line.replace(/\s+/g, '')) return line;
      note('pie-labels');
      return l;
    });
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // gantt: "after <task name>" has to name a task id, and a task that is waited for has to have one

  const GANTT_SETTING = /^\s*(title|dateFormat|axisFormat|tickInterval|excludes|includes|todayMarker|weekday|weekend|section|accTitle|accDescr|%%)\b/;
  const GANTT_TAG = /^(crit|done|active|milestone)$/;
  const GANTT_ID = /^[A-Za-z_][A-Za-z0-9_-]*$/;

  function repairGantt(lines, fixes) {
    const tasks = [];
    lines.forEach((line, idx) => {
      if (idx === 0 || GANTT_SETTING.test(line)) return;
      const c = line.lastIndexOf(':');
      if (c === -1) return;
      const name = line.slice(0, c).trim();
      const parts = line.slice(c + 1).split(',').map((p) => p.trim());
      let k = 0;
      while (k < parts.length && GANTT_TAG.test(parts[k])) k++;
      const rest = parts.slice(k);
      const hasId = rest.length >= 3 && GANTT_ID.test(rest[0]) && !/^(after|until)\b/.test(rest[0]);
      tasks.push({ idx: idx, name: name, parts: parts, tagCount: k, id: hasId ? rest[0] : '' });
    });
    const byName = {};
    const ids = {};
    tasks.forEach((t) => { if (t.id) ids[t.id] = true; });
    let n = 0;
    tasks.forEach((t) => { if (t.name && !byName[t.name]) byName[t.name] = t; });
    const out = lines.slice();
    let changed = false;
    tasks.forEach((t) => {
      let touched = false;
      const parts = t.parts.slice();
      for (let k = t.tagCount; k < parts.length; k++) {
        const m = /^(after|until)\s+(.+)$/.exec(parts[k]);
        if (!m) continue;
        const names = m[2].split(/\s+/);
        const fixed = names.map((nm) => {
          if (ids[nm] || !byName[nm]) return nm;
          const target = byName[nm];
          if (!target.id) {
            do { n++; } while (ids['t' + n]);
            target.id = 't' + n;
            ids[target.id] = true;
            target.newId = true;
          }
          return target.id;
        });
        if (fixed.join(' ') !== m[2]) { parts[k] = m[1] + ' ' + fixed.join(' '); touched = true; }
      }
      if (touched) { t.parts = parts; t.touched = true; }
    });
    tasks.forEach((t) => {
      if (!t.touched && !t.newId) return;
      const parts = t.parts.slice();
      if (t.newId && !(parts.slice(t.tagCount).length >= 3 && parts[t.tagCount] === t.id)) parts.splice(t.tagCount, 0, t.id);
      const line = lines[t.idx];
      out[t.idx] = line.slice(0, line.lastIndexOf(':') + 1) + ' ' + parts.join(', ');
      changed = true;
    });
    if (changed) fixes.push('gantt-after-name');
    return out;
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // timeline: a literal \n in an entry is not a line break

  function repairTimeline(lines, fixes) {
    let changed = false;
    const out = lines.map((l, idx) => {
      if (idx === 0 || l.indexOf('\\n') === -1) return l;
      changed = true;
      return l.replace(/\\n/g, '<br>');
    });
    if (changed) fixes.push('timeline-newline');
    return out;
  }

  // ---------------------------------------------------------------------------------------------------------------------------------

  // One diagram's source (without the fence). `info` is the fence's tag when the diagram came out of one: it supplies the type when the
  // body has no type line (```timeline ... ```).
  function repair(code, info) {
    const fixes = [];
    const source = String(code === undefined || code === null ? '' : code);
    let lines = source.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '').split('\n');
    const original = lines.join('\n');
    // a closing fence or a lone "mermaid" left inside
    while (lines.length && /^\s*`{3,}\s*$/.test(lines[lines.length - 1])) { lines.pop(); fixes.push('stray-fence'); }
    const first = firstContentIndex(lines);
    let header = -1;
    for (let i = first; i < Math.min(lines.length, first + 4); i++) {
      if (headerWord(lines[i])) { header = i; break; }
    }
    if (header > first) {
      lines = lines.slice(0, first).concat(lines.slice(header));
      fixes.push('text-before-diagram');
    } else if (header === -1) {
      const w = String(info || '').trim().split(/\s+/)[0];
      const canon = CANONICAL[w.toLowerCase()];
      if (canon) {
        lines.splice(first, 0, String(info).trim());
        fixes.push('type-line-added');
      }
    }
    const h = firstContentIndex(lines);
    const type = headerWord(lines[h] || '');
    if (!type) return { code: lines.join('\n') === original ? source : lines.join('\n'), fixes: fixes, type: '' };
    // the rules work on the lines from the type line on; what stands before it (front matter, directives) is kept
    const head = lines.slice(0, h);
    let body = lines.slice(h);
    if (type === 'flowchart' || type === 'graph') body = repairFlowchart(body, fixes);
    else if (type === 'sequenceDiagram') body = repairSequence(body, fixes);
    else if (type === 'stateDiagram' || type === 'stateDiagram-v2') body = repairState(body, fixes);
    else if (type === 'erDiagram') body = repairEr(body, fixes);
    else if (type === 'mindmap') body = repairMindmap(body, fixes);
    else if (type === 'quadrantChart') body = repairQuadrant(body, fixes);
    else if (type === 'pie') body = repairPie(body, fixes);
    else if (type === 'timeline') body = repairTimeline(body, fixes);
    else if (type === 'gantt') body = repairGantt(body, fixes);
    const result = head.concat(body).join('\n');
    return { code: result === original ? source : result, fixes: fixes, type: type };
  }

  // The whole answer of the AI: every fenced block that is a diagram (tagged mermaid, tagged with a diagram type, or untagged and
  // starting with a type line) becomes a ```mermaid block and is repaired; all other text is left exactly as it is.
  function repairAnswer(text) {
    const src = String(text === undefined || text === null ? '' : text);
    const fixes = [];
    const lines = src.split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const open = /^(\s*)(`{3,})([^`]*)$/.exec(lines[i].replace(/\r$/, ''));
      if (!open) { out.push(lines[i]); i++; continue; }
      const closeRe = new RegExp('^\\s*`{' + open[2].length + ',}\\s*$');
      let j = i + 1;
      while (j < lines.length && !closeRe.test(lines[j].replace(/\r$/, ''))) j++;
      if (j >= lines.length) { out.push(lines[i]); i++; continue; } // never closed: not touched
      const info = open[3].trim();
      const word = info.split(/\s+/)[0] || '';
      const lower = word.toLowerCase();
      const body = lines.slice(i + 1, j);
      const bodyFirst = body.length ? body[firstContentIndex(body)] || '' : '';
      const isMermaid = lower === 'mermaid';
      const isTypeTag = !isMermaid && !!CANONICAL[lower];
      const isUntagged = info === '' && !!headerWord(bodyFirst);
      if (!(isMermaid || isTypeTag || isUntagged)) {
        for (let k = i; k <= j; k++) out.push(lines[k]);
        i = j + 1;
        continue;
      }
      if (!isMermaid) fixes.push(isTypeTag ? 'fence-tag' : 'fence-untagged');
      const eol = /\r$/.test(lines[i]) ? '\r' : '';
      const r = repair(body.map((l) => l.replace(/\r$/, '')).join('\n'), isTypeTag ? info : '');
      r.fixes.forEach((f) => fixes.push(f));
      if (isMermaid && !r.fixes.length) { // a diagram with nothing to put right stays as it was
        for (let k = i; k <= j; k++) out.push(lines[k]);
        i = j + 1;
        continue;
      }
      out.push(open[1] + open[2] + 'mermaid' + eol);
      r.code.split('\n').forEach((l) => out.push(l + eol));
      out.push(lines[j]);
      i = j + 1;
    }
    const result = out.join('\n');
    return { text: result === src ? src : result, fixes: fixes.filter((f, k) => fixes.indexOf(f) === k) };
  }

  global.MermaidRepair = { repair: repair, repairAnswer: repairAnswer };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.MermaidRepair;
  }
})(typeof window !== 'undefined' ? window : globalThis);
