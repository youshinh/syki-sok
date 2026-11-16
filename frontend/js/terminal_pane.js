// Embedded PTY agent pane controller (lazy-loads vendor/xterm on first open; zero startup cost).
(function (global) {
  'use strict';

  const RECENT_DIRS_KEY = 'syki.pty.recentDirs.v1';
  const MAX_RECENT_DIRS = 6;
  const DEFAULT_PRESETS = [
    { id: 'cc', label: 'Claude Code', short: 'cc' },
    { id: 'codex', label: 'Codex', short: 'codex' },
    { id: 'agy', label: 'Agy', short: 'agy' },
    { id: 'shell', label: 'Shell', short: 'shell' }
  ];

  function bracketedPaste(text) {
    const s = text == null ? '' : String(text);
    return '\x1b[200~' + s + '\x1b[201~';
  }

  function encodeUtf8Base64(str) {
    const bytes = typeof TextEncoder !== 'undefined'
      ? new TextEncoder().encode(str)
      : Buffer.from(str, 'utf8');
    if (typeof Buffer !== 'undefined' && typeof btoa !== 'function') {
      return Buffer.from(bytes).toString('base64');
    }
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function decodeUtf8Base64ToBytes(b64) {
    if (!b64) return new Uint8Array(0);
    if (typeof Buffer !== 'undefined' && typeof atob !== 'function') {
      return new Uint8Array(Buffer.from(b64, 'base64'));
    }
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function extractRecentOutput(lines, maxLines) {
    if (!Array.isArray(lines) || lines.length === 0) return '';
    const limit = maxLines > 0 ? maxLines : 60;
    let end = lines.length - 1;
    while (end >= 0 && !String(lines[end] || '').trim()) end--;
    if (end < 0) return '';
    const start = Math.max(0, end - limit + 1);
    return lines.slice(start, end + 1).join('\n').trim();
  }

  function isTerminalElement(el) {
    if (!el || typeof el.closest !== 'function') return false;
    return !!el.closest('#secondary-agent-pane');
  }

  function mergeRecentDirs(existing, newDir) {
    const list = Array.isArray(existing) ? existing.filter(Boolean) : [];
    const dir = String(newDir || '').trim();
    if (!dir) return list.slice(0, MAX_RECENT_DIRS);
    const out = [dir];
    for (let i = 0; i < list.length; i++) {
      if (list[i] !== dir) out.push(list[i]);
      if (out.length >= MAX_RECENT_DIRS) break;
    }
    return out;
  }

  function normalizeMermaidTuiArrows(code) {
    // Some agent TUIs (e.g. Antigravity CLI) render `--` / `-->` / `==>` using Unicode box-drawing dashes (`─`, `━`, `═`).
    // Restore them to ASCII outside quoted labels so mermaid.render() parses them.
    return String(code || '').replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[\u2500\u2501]+|[\u2550]+/g, (tok) => {
      if (tok[0] === '"' || tok[0] === "'") return tok;
      if (tok[0] === '\u2550') return '='.repeat(tok.length);
      return '-'.repeat(tok.length);
    });
  }

  function extractMermaidBlocks(text) {
    if (!text) return [];
    const src = String(text);
    const re = /```mermaid[ \t]*\r?\n([\s\S]*?)```/gi;
    const fenced = [];
    let m;
    while ((m = re.exec(src)) !== null) {
      if (m[1] && m[1].trim()) fenced.push(normalizeMermaidTuiArrows(m[1].trim()));
    }
    if (fenced.length > 0) return fenced;

    // Fallback for TUIs that strip ```mermaid fences and display the diagram code block indented.
    const headerRe = /^[ \t]*((?:flowchart|graph)\s+(?:TB|TD|BT|RL|LR)\b|sequenceDiagram\b|classDiagram(?:-v2)?\b|stateDiagram(?:-v2)?\b|erDiagram\b|gantt\b|pie(?:\s+showData)?\b|journey\b|gitGraph\b|mindmap\b|timeline\b|quadrantChart\b|requirementDiagram\b|C4Context\b)/;
    const tuiChromeRe = /^[ \t]*(?:[─━═]{4,}|>\s|\?\s+for\s+shortcuts\b|```)/;
    const bodyContRe = /^(?:subgraph\b|end\b|classDef\b|class\b|style\b|linkStyle\b|click\b|participant\b|actor\b|note\b|loop\b|alt\b|else\b|opt\b|par\b|section\b|direction\b|title\b|dateFormat\b|%%|\[\*\]|[A-Za-z0-9_]+\s*(?:--|\.\.|==|->|──|━|═|\[|\(|\{|\|\|))/;
    const lines = src.replace(/\r\n/g, '\n').split('\n');
    const blocks = [];
    for (let startIdx = 0; startIdx < lines.length; startIdx++) {
      if (!headerRe.test(lines[startIdx])) continue;
      const baseIndent = (lines[startIdx].match(/^[ \t]*/) || [''])[0].length;
      const collected = [lines[startIdx].slice(baseIndent)];
      let i = startIdx + 1;
      for (; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) break;
        if (tuiChromeRe.test(line)) break;
        const indent = (line.match(/^[ \t]*/) || [''])[0].length;
        if (indent < baseIndent) break;
        if (indent === baseIndent && !bodyContRe.test(line.slice(baseIndent))) break;
        collected.push(line.slice(baseIndent));
      }
      if (collected.length >= 2) {
        blocks.push(normalizeMermaidTuiArrows(collected.join('\n').trim()));
      }
      startIdx = i;
    }
    return blocks;
  }

  function extractLastMermaidBlock(text) {
    const blocks = extractMermaidBlocks(text);
    return blocks.length > 0 ? blocks[blocks.length - 1] : '';
  }

  function parsePtyLink(href) {
    const s = String(href || '').trim();
    const m = /^syki-pty:\/\/([a-zA-Z0-9_-]+)/i.exec(s);
    return m ? m[1] : '';
  }

  function formatSessionBadge(s) {
    if (!s || !s.id) return '';
    return s.label ? `#${s.id} @${s.label}` : `#${s.id}`;
  }

  function formatNoteAnchor(s) {
    if (!s || !s.id) return '';
    const badge = formatSessionBadge(s);
    const dirName = s.dir ? String(s.dir).split(/[\\/]/).pop() : '';
    const suffix = dirName ? ` (${dirName})` : '';
    return `- [ ] [${badge}${suffix}](syki-pty://${s.id}) `;
  }

  function formatDoneNextBlock(s, output, loopMeta) {
    if (!s || !s.id) return '';
    const badge = formatSessionBadge(s);
    const lines = [
      `### [x] [${badge}](syki-pty://${s.id})`,
      s.dir ? `- dir: \`${s.dir}\`` : ''
    ];
    if (loopMeta && Array.isArray(loopMeta.failedMemory) && loopMeta.failedMemory.length > 0) {
      lines.push('- 失敗記憶:');
      for (let i = 0; i < loopMeta.failedMemory.length; i++) {
        lines.push(`  - ${loopMeta.failedMemory[i]}`);
      }
    }
    if (loopMeta && loopMeta.statusText) {
      lines.push(`- 進捗: ${loopMeta.statusText}`);
    }
    lines.push('- [ ] Next: ');
    const filtered = lines.filter(Boolean);
    const excerpt = String(output || '').trim();
    if (excerpt) {
      filtered.push('', '```', excerpt, '```');
    }
    return filtered.join('\n');
  }

  function stripAnsi(str) {
    if (!str) return '';
    return String(str)
      .replace(/\x1b\[(?:\d+(?:;\d+)?)?[HfEB]/g, '\n')
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g, '');
  }

  function decodeUtf8Base64ToString(b64) {
    if (!b64) return '';
    if (typeof Buffer !== 'undefined' && typeof TextDecoder === 'undefined') {
      return Buffer.from(b64, 'base64').toString('utf8');
    }
    const bytes = decodeUtf8Base64ToBytes(b64);
    if (typeof TextDecoder !== 'undefined') {
      return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    }
    return Buffer.from(bytes).toString('utf8');
  }

  function pickCrossModelPreset(preset, available) {
    const p = String(preset || '').toLowerCase();
    const isCC = p === 'cc' || p === 'claude' || p === 'claude-code';
    const isCodex = p === 'codex';
    const isAgy = p === 'agy' || p === 'antigravity' || p === 'gemini';
    const candidates = isCC
      ? ['codex', 'agy']
      : isCodex
        ? ['cc', 'agy']
        : isAgy
          ? ['codex', 'cc']
          : ['codex', 'cc', 'agy'];
    if (Array.isArray(available) && available.length > 0) {
      for (let i = 0; i < candidates.length; i++) {
        if (available.indexOf(candidates[i]) >= 0) return candidates[i];
      }
      const normP = isCC ? 'cc' : (isCodex ? 'codex' : (isAgy ? 'agy' : p));
      const other = available.find((x) => {
        const nx = (x === 'claude' || x === 'claude-code') ? 'cc' : ((x === 'antigravity' || x === 'gemini') ? 'agy' : x);
        return x !== 'shell' && nx !== normP;
      });
      if (other) return other;
      return available.find((x) => x !== 'shell') || preset || available[0] || 'shell';
    }
    if (isCC) return 'codex';
    if (isCodex) return 'cc';
    if (isAgy) return 'cc';
    return 'codex';
  }

  function formatHarnessTemplate(lang) {
    if (lang === 'en') {
      return [
        '## [ ] Write what you want to accomplish here',
        '- Criteria:',
        '  - Keep existing behavior working',
        '- Gate: auto',
        '- Setup: Maker[auto] ⇄ Checker[cross-model auto] / Env: worktree isolated / Max: 3 rounds',
        '- Failed Memory: none',
        '- Status: pending',
        '---',
        ''
      ].join('\n');
    }
    return [
      '## [ ] ここにやりたいことを書く',
      '- 条件・評価軸:',
      '  - 既存の動作を壊さないこと',
      '- ゲート(検証): 自動',
      '- 体制: 実装[自動] ⇄ 検収[別モデル自動] / 環境: worktree隔離 / 上限: 3回',
      '- 失敗記憶: なし',
      '- 進捗: 未着手',
      '---',
      ''
    ].join('\n');
  }

  function splitNoteLines(text) {
    const s = String(text || '');
    const out = [];
    let pos = 0;
    while (pos <= s.length) {
      const nlIdx = s.indexOf('\n', pos);
      if (nlIdx < 0) {
        const raw = s.slice(pos);
        const cr = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
        out.push({ start: pos, end: s.length, endWithNL: s.length, text: cr });
        break;
      }
      let end = nlIdx;
      if (end > pos && s[end - 1] === '\r') end--;
      out.push({ start: pos, end, endWithNL: nlIdx + 1, text: s.slice(pos, end) });
      pos = nlIdx + 1;
      if (pos === s.length) break;
    }
    return out;
  }

  function stripPtyBadgeFromTitle(title) {
    return String(title || '')
      .replace(/\s*\[#[^\]]+\]\(syki-pty:\/\/[^)]+\)/gi, '')
      .trim();
  }

  function parseHarnessBlock(noteText, cursorOffset, hint) {
    const text = String(noteText || '');
    if (!text) return null;
    const lines = splitNoteLines(text);
    const headingRe = /^(#{2,3})\s+\[([ xX])\]\s+(.+)$/;
    const taskBulletRe = /^[-*]\s+\[([ xX])\]\s+(.+)$/;
    const separatorRe = /^---+\s*$/;
    const anyHeadingRe = /^#{1,3}\s+/;
    const statusLineRe = /^[-*]\s*(?:進捗|Status)\s*[:：]\s*(.*)$/i;
    const gateLineRe = /^[-*]\s*(?:ゲート(?:\(検証\))?|Gate)\s*[:：]\s*(.*)$/i;
    const setupLineRe = /^[-*]\s*(?:体制|Setup)\s*[:：]\s*(.*)$/i;
    const failedLineRe = /^[-*]\s*(?:失敗記憶|Failed(?:\s+Memory)?)\s*[:：]\s*(.*)$/i;
    const criteriaLineRe = /^[-*]\s*(?:条件[・･]?評価軸|Criteria)\s*[:：]\s*(.*)$/i;

    function buildBlockFromStart(startIdx, kind) {
      const first = lines[startIdx];
      const hm = kind === 'heading' ? headingRe.exec(first.text) : taskBulletRe.exec(first.text);
      if (!hm) return null;

      const checked = hm[kind === 'heading' ? 2 : 1].toLowerCase() === 'x';
      const title = stripPtyBadgeFromTitle(hm[kind === 'heading' ? 3 : 2]);
      const bracketRel = first.text.indexOf('[');
      const headingCheckOffset = bracketRel >= 0 ? first.start + bracketRel + 1 : -1;

      let endIdx = startIdx;
      if (kind === 'heading') {
        for (let j = startIdx + 1; j < lines.length; j++) {
          const lt = lines[j].text;
          if (separatorRe.test(lt) || anyHeadingRe.test(lt)) {
            break;
          }
          endIdx = j;
          if (statusLineRe.test(lt)) {
            break;
          }
        }
        // Trim trailing blank lines inside block before separator if no status line ended it.
        if (!statusLineRe.test(lines[endIdx].text)) {
          while (endIdx > startIdx && !lines[endIdx].text.trim()) endIdx--;
        }
      }

      const blockStart = first.start;
      const blockEnd = lines[endIdx].end;
      const blockRaw = text.slice(blockStart, blockEnd);

      const criteria = [];
      const failedMemory = [];
      let gate = 'auto';
      let makerId = '';
      let checkerId = '';
      let worktree = true;
      let maxRounds = 3;
      let statusText = '';
      let metaStart = -1;
      let activeListSection = '';
      let isEnglish = false;

      const firstLinkM = /syki-pty:\/\/([a-zA-Z0-9_-]+)/i.exec(first.text);
      if (firstLinkM) makerId = firstLinkM[1];

      for (let k = startIdx + 1; k <= endIdx; k++) {
        const line = lines[k];
        const lt = line.text;
        const sm = statusLineRe.exec(lt);
        if (sm) {
          if (metaStart < 0) metaStart = line.start;
          if (/^-*\s*Status/i.test(lt)) isEnglish = true;
          activeListSection = '';
          statusText = sm[1].trim();
          continue;
        }
        const gm = gateLineRe.exec(lt);
        if (gm) {
          if (metaStart < 0) metaStart = line.start;
          if (/^[-*]\s*Gate/i.test(lt)) isEnglish = true;
          activeListSection = '';
          const gRaw = gm[1].trim();
          const autoWrap = /^(?:自動|auto)\s*[（(]`([^`]+)`[）)]$/i.exec(gRaw);
          if (autoWrap) {
            gate = 'auto';
          } else if (!gRaw || /^(?:自動|auto)$/i.test(gRaw)) {
            gate = 'auto';
          } else {
            gate = gRaw.replace(/^`|`$/g, '');
          }
          continue;
        }
        const tm = setupLineRe.exec(lt);
        if (tm) {
          if (metaStart < 0) metaStart = line.start;
          if (/^[-*]\s*Setup/i.test(lt)) isEnglish = true;
          activeListSection = '';
          const sRaw = tm[1].trim();
          const links = [];
          const linkRe = /syki-pty:\/\/([a-zA-Z0-9_-]+)/gi;
          let lm;
          while ((lm = linkRe.exec(sRaw)) !== null) {
            links.push(lm[1]);
          }
          if (links.length >= 1) makerId = links[0];
          if (links.length >= 2) checkerId = links[1];
          if (/worktree\s*なし|no\s*worktree|isolated:\s*false/i.test(sRaw)) {
            worktree = false;
          } else if (/worktree/i.test(sRaw)) {
            worktree = true;
          }
          const maxM = /(?:上限|Max)\s*[:：]?\s*(?:\d+\/)?(\d+)/i.exec(sRaw);
          if (maxM) {
            const parsedMax = parseInt(maxM[1], 10);
            if (isFinite(parsedMax) && parsedMax > 0) maxRounds = Math.min(10, parsedMax);
          }
          continue;
        }
        const fm = failedLineRe.exec(lt);
        if (fm) {
          if (metaStart < 0) metaStart = line.start;
          if (/^[-*]\s*Failed/i.test(lt)) isEnglish = true;
          activeListSection = 'failed';
          const fv = fm[1].trim();
          if (fv && fv !== 'なし' && fv.toLowerCase() !== 'none' && fv !== '（ループ中に自動記録）') {
            failedMemory.push(fv);
          }
          continue;
        }
        const cm = criteriaLineRe.exec(lt);
        if (cm) {
          if (/^[-*]\s*Criteria/i.test(lt)) isEnglish = true;
          activeListSection = 'criteria';
          const cv = cm[1].trim();
          if (cv) criteria.push(cv);
          continue;
        }
        if (activeListSection === 'failed') {
          const bm = /^\s+[-*]?\s*(.+)$/.exec(lt);
          if (bm && bm[1].trim()) failedMemory.push(bm[1].trim());
          continue;
        }
        if (activeListSection === 'criteria') {
          const bm = /^\s+[-*]?\s*(.+)$/.exec(lt);
          if (bm && bm[1].trim()) criteria.push(bm[1].trim());
          continue;
        }
        if (metaStart < 0 && lt.trim()) {
          const cleanLine = lt.replace(/^\s*[-*]\s*/, '').trim();
          if (cleanLine) criteria.push(cleanLine);
        }
      }

      if (metaStart < 0) metaStart = blockEnd;

      return {
        kind,
        title,
        checked,
        criteria,
        gate,
        makerId,
        checkerId,
        worktree,
        maxRounds,
        failedMemory,
        statusText,
        isEnglish,
        blockStart,
        blockEnd,
        headingCheckOffset,
        metaStart,
        raw: blockRaw
      };
    }

    const blocks = [];
    for (let i = 0; i < lines.length; i++) {
      if (headingRe.test(lines[i].text)) {
        const b = buildBlockFromStart(i, 'heading');
        if (b) blocks.push(b);
      }
    }

    if (hint && (hint.makerId || hint.title)) {
      if (hint.makerId) {
        const byMaker = blocks.find((b) => b.makerId === hint.makerId || b.raw.indexOf('syki-pty://' + hint.makerId) >= 0);
        if (byMaker) return byMaker;
      }
      if (hint.title) {
        const cleanHint = stripPtyBadgeFromTitle(hint.title);
        const byTitle = blocks.find((b) => !b.checked && b.title === cleanHint) || blocks.find((b) => b.title === cleanHint);
        if (byTitle) return byTitle;
      }
    }

    if (typeof cursorOffset === 'number' && cursorOffset >= 0) {
      for (let i = 0; i < blocks.length; i++) {
        if (cursorOffset >= blocks[i].blockStart && cursorOffset <= blocks[i].blockEnd) {
          return blocks[i];
        }
      }
      for (let i = 0; i < lines.length; i++) {
        if (cursorOffset >= lines[i].start && cursorOffset <= lines[i].end && taskBulletRe.test(lines[i].text)) {
          return buildBlockFromStart(i, 'task');
        }
      }
    }

    return null;
  }

  function applyHarnessMetadataUpdate(noteText, hint, updates) {
    const orig = String(noteText || '');
    const u = updates || {};
    const nl = orig.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
    const foundBlock = parseHarnessBlock(orig, -1, hint);

    const isEn = foundBlock ? foundBlock.isEnglish : !!u.isEnglish;
    const gateVal = u.gateCmd || (foundBlock && foundBlock.gate !== 'auto' ? foundBlock.gate : '');
    const gateLine = isEn
      ? `- Gate: ${gateVal ? 'auto (`' + gateVal + '`)' : 'auto'}`
      : `- ゲート(検証): ${gateVal ? '自動（`' + gateVal + '`）' : '自動'}`;

    const makerId = u.makerId || (foundBlock && foundBlock.makerId) || '';
    const checkerId = u.checkerId || (foundBlock && foundBlock.checkerId) || '';
    const makerLink = makerId ? `[#${makerId}](syki-pty://${makerId})` : (isEn ? '[auto]' : '[自動]');
    const checkerLink = checkerId ? `[#${checkerId}](syki-pty://${checkerId})` : (isEn ? '[cross-model auto]' : '[別モデル自動]');
    const envLabel = u.envLabel || (u.isolated ? (makerId ? `.worktrees/${makerId}` : '.worktrees') : (isEn ? 'workspace' : '作業フォルダ'));
    const round = u.round > 0 ? u.round : 1;
    const maxRounds = u.maxRounds > 0 ? u.maxRounds : ((foundBlock && foundBlock.maxRounds) || 3);
    const setupLine = isEn
      ? `- Setup: Maker${makerLink} ⇄ Checker${checkerLink} / Env: \`${envLabel}\` / Max: ${round}/${maxRounds} rounds`
      : `- 体制: 実装${makerLink} ⇄ 検収${checkerLink} / 環境: \`${envLabel}\` / 上限: ${round}/${maxRounds}回`;

    const failures = Array.isArray(u.failedMemory) ? u.failedMemory.filter(Boolean) : ((foundBlock && foundBlock.failedMemory) || []);
    const failedLines = [];
    if (failures.length === 0) {
      failedLines.push(isEn ? '- Failed Memory: none' : '- 失敗記憶: なし');
    } else {
      failedLines.push(isEn ? '- Failed Memory:' : '- 失敗記憶:');
      for (let i = 0; i < failures.length; i++) {
        failedLines.push(`  - ${failures[i]}`);
      }
    }

    const statusLine = isEn
      ? `- Status: ${u.statusText || (foundBlock && foundBlock.statusText) || 'running'}`
      : `- 進捗: ${u.statusText || (foundBlock && foundBlock.statusText) || '実行中'}`;

    const metaBlock = [gateLine, setupLine].concat(failedLines).concat([statusLine]).join(nl);

    if (foundBlock) {
      let working = orig;
      if (typeof u.checked === 'boolean' && foundBlock.headingCheckOffset >= 0) {
        const ch = u.checked ? 'x' : ' ';
        working = working.slice(0, foundBlock.headingCheckOffset) + ch + working.slice(foundBlock.headingCheckOffset + 1);
      }
      const needLeadingNL = foundBlock.metaStart === foundBlock.blockEnd && foundBlock.metaStart > 0 && working[foundBlock.metaStart - 1] !== '\n';
      const insertion = (needLeadingNL ? nl : '') + metaBlock;
      const nextText = working.slice(0, foundBlock.metaStart) + insertion + working.slice(foundBlock.blockEnd);
      return {
        text: nextText,
        found: true,
        appended: false,
        replaceStart: foundBlock.metaStart,
        replaceEnd: foundBlock.blockEnd,
        delta: nextText.length - orig.length
      };
    }

    if (!u.appendIfMissing) {
      return { text: orig, found: false, appended: false, replaceStart: 0, replaceEnd: 0, delta: 0 };
    }

    const checkMark = u.checked ? 'x' : ' ';
    const fallbackTitle = (u.title || (hint && hint.title) || 'Loop Task').trim();
    const prefix = orig.length === 0 ? '' : (orig.endsWith('\n\n') ? '' : (orig.endsWith('\n') ? nl : nl + nl));
    const reconstructed = `## [${checkMark}] ${fallbackTitle}${nl}${metaBlock}${nl}---${nl}`;
    const nextText = orig + prefix + reconstructed;
    return {
      text: nextText,
      found: false,
      appended: true,
      replaceStart: orig.length,
      replaceEnd: orig.length,
      delta: nextText.length - orig.length
    };
  }

  function buildMakerPrompt(block, gateCmd, round, maxRounds) {
    const title = (block && block.title) || 'Task';
    const criteria = (block && Array.isArray(block.criteria) && block.criteria.length > 0)
      ? block.criteria
      : ['既存の動作を壊さず要件を満たすこと'];
    const failures = (block && Array.isArray(block.failedMemory)) ? block.failedMemory.filter(Boolean) : [];
    const lines = [
      `[自律ループ ${round || 1}/${maxRounds || 3}周目 - 実装担当]`,
      `目標: ${title}`,
      '条件・評価軸:'
    ];
    for (let i = 0; i < criteria.length; i++) lines.push(`- ${criteria[i]}`);
    if (failures.length > 0) {
      lines.push('過去の失敗記憶（同じ原因を繰り返さないこと）:');
      for (let i = 0; i < failures.length; i++) lines.push(`- ${failures[i]}`);
    }
    lines.push(
      `検証コマンド: ${gateCmd || 'git status --short'}`,
      '手順:',
      '1. 上記条件を満たす最小かつ正確な変更を実装し、必要に応じて自動テストを追加する。',
      `2. 検証コマンド \`${gateCmd || 'git status --short'}\` を自分で実行し、Exit Code 0 を確認する（-run 等で通るテストだけに絞って成功扱いにしないこと）。`,
      '3. 環境制約等で検証を通せない場合は終了マーカーを出さず、失敗したテスト名と原因をそのまま報告する。作業と検証の成功を確認したら、最後の1行として単独で「STAGE_DONE」の直後に「: READY」を繋げた文字列のみを出力して報告する。'
    );
    return lines.join('\n');
  }

  function buildCheckerPrompt(block, gateCmd, makerOutput, round, maxRounds) {
    const title = (block && block.title) || 'Task';
    const criteria = (block && Array.isArray(block.criteria) && block.criteria.length > 0)
      ? block.criteria
      : ['既存の動作を壊さず要件を満たすこと'];
    const failures = (block && Array.isArray(block.failedMemory)) ? block.failedMemory.filter(Boolean) : [];
    const lines = [
      `[自律ループ ${round || 1}/${maxRounds || 3}周目 - 独立検収担当]`,
      `目標: ${title}`,
      '厳守する評価軸:'
    ];
    for (let i = 0; i < criteria.length; i++) lines.push(`- ${criteria[i]}`);
    if (failures.length > 0) {
      lines.push('過去の失敗記憶（再発していないか重点確認）:');
      for (let i = 0; i < failures.length; i++) lines.push(`- ${failures[i]}`);
    }
    const cleanExcerpt = String(makerOutput || '')
      .replace(/[─━═┄┅┈┉│┌┐└┘├┤┬┴┼╭╮╰╯]{4,}/g, '')
      .split(/\r?\n/)
      .map((l) => l.trimEnd())
      .filter((l) => {
        const t = l.trim();
        return t.length > 0 && !/^\?\s*for shortcuts/i.test(t) && !/^esc to cancel/i.test(t);
      })
      .join('\n')
      .trim();
    const tailLines = [
      '検収手順（実装者の主張を鵜呑みにせず自ら確認すること）:',
      '1. git diff を確認し、仕様・評価軸の漏れや副作用がないか点検する。',
      `2. 必ずあなた自身で検証コマンド \`${gateCmd || 'git status --short'}\` を実行し、Exit Code 0 になるか確認する。`,
      '3. 判定結果として、最終行に「VERDICT」に続けて「: PASS」（合格時）または「VERDICT」に続けて「: FAIL」（不合格時）を単独行で出力する。',
      '4. FAIL の場合は、その次の行に「REASON」に続けて「: <失敗したテスト名/ファイル名と原因の1行要約>」を省略せず出力する（例: REASON: TestFoo (app_slot.go) が exitCode=130 で不一致）。'
    ];
    const baseLen = lines.join('\n').length + tailLines.join('\n').length + 40;
    const maxExcerptLen = Math.max(0, Math.min(320, 880 - baseLen));
    const excerpt = maxExcerptLen > 0 ? cleanExcerpt.slice(-maxExcerptLen) : '';
    if (excerpt) {
      lines.push('実装側の直近出力(抜粋):', '```', excerpt, '```');
    }
    lines.push.apply(lines, tailLines);
    return lines.join('\n');
  }

  function buildContinuationPrompt(block, isNewSession) {
    const title = (block && block.title) || 'Task';
    const criteria = (block && Array.isArray(block.criteria)) ? block.criteria.filter(Boolean) : [];
    const failures = (block && Array.isArray(block.failedMemory)) ? block.failedMemory.filter(Boolean) : [];
    const header = isNewSession ? '[新規セッションへの引き継ぎ継続]' : '[既存セッションでの継続]';
    const lines = [header, `タスク: ${title}`];
    if (criteria.length > 0) {
      lines.push('条件・評価軸:');
      for (let i = 0; i < criteria.length; i++) lines.push(`- ${criteria[i]}`);
    }
    if (failures.length > 0) {
      lines.push('これまでの失敗記憶（再試行禁止事項）:');
      for (let i = 0; i < failures.length; i++) lines.push(`- ${failures[i]}`);
    }
    if (block && block.statusText) {
      lines.push(`直前の進捗: ${block.statusText}`);
    }
    lines.push('上記を踏まえて続きを実装し、テストが通る状態にしてください。');
    return lines.join('\n');
  }

  function parseLoopSignal(cleanText) {
    const s = String(cleanText || '');
    if (!s) return null;
    const verdictRe = /(?:^|\r?\n)\s*(?:[-*>#`]+\s*)?VERDICT:\s*(PASS|FAIL)\b[^\r\n]*/gi;
    let lastVerdict = null;
    let m;
    while ((m = verdictRe.exec(s)) !== null) {
      lastVerdict = { verdict: m[1].toUpperCase(), index: m.index + m[0].length };
    }
    if (lastVerdict) {
      let reason = '';
      if (lastVerdict.verdict === 'FAIL') {
        const tail = s.slice(lastVerdict.index);
        const rm = /(?:^|\r?\n)\s*(?:[-*>#`]+\s*)?REASON:\s*([^\r\n]+)/i.exec(tail);
        if (rm && rm[1]) {
          reason = rm[1].trim();
        } else {
          const firstLine = tail.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !/^```/.test(l));
          reason = firstLine ? firstLine.slice(0, 160) : '検収テストまたは評価軸が未達成';
        }
      }
      return { type: 'verdict', verdict: lastVerdict.verdict, reason };
    }
    const doneRe = /(?:^|\r?\n)\s*(?:[-*>#`]+\s*)?STAGE_DONE:\s*READY\b/i;
    if (doneRe.test(s)) {
      return { type: 'maker_done' };
    }
    return null;
  }

  function readXtermTheme(doc, win) {
    const theme = {};
    try {
      if (!doc || !win || typeof win.getComputedStyle !== 'function') return theme;
      const target = doc.body || doc.documentElement;
      if (!target) return theme;
      const cs = win.getComputedStyle(target);
      const bg = (cs.getPropertyValue('--bg-editor') || cs.getPropertyValue('--bg-main') || '').trim();
      const fg = (cs.getPropertyValue('--text-main') || cs.getPropertyValue('--canvas-fg') || '').trim();
      const cur = (cs.getPropertyValue('--accent-color') || cs.getPropertyValue('--pane-focus') || '').trim();
      const sel = (cs.getPropertyValue('--selection-bg') || '').trim();
      if (bg) theme.background = bg;
      if (fg) theme.foreground = fg;
      if (cur) theme.cursor = cur;
      if (sel) theme.selectionBackground = sel;
      return theme;
    } catch (_) {
      return theme;
    }
  }

  function createController(deps) {
    const d = deps || {};
    const doc = d.doc || (typeof document !== 'undefined' ? document : null);
    const win = d.win || (typeof window !== 'undefined' ? window : null);

    let xtermPromise = null;
    let sessions = [];
    let activeId = null;
    let rootEl = null;
    let stageEl = null;
    let launcherEl = null;
    let resizeObserver = null;
    let selectedPreset = 'cc';
    let userPickedPreset = false;
    let selectedDir = '';
    let hooksRegistered = false;
    let availablePresetsCache = null;
    const loops = new Map();
    let loopsSeq = 0;

    async function copyText(text) {
      if (!text) return false;
      if (typeof d.copyTextToClipboard === 'function') return !!(await d.copyTextToClipboard(text));
      if (win && win.navigator && win.navigator.clipboard && typeof win.navigator.clipboard.writeText === 'function') {
        try {
          await win.navigator.clipboard.writeText(text);
          return true;
        } catch (_) {}
      }
      return false;
    }

    async function readClipboardText() {
      if (typeof d.readTextFromClipboard === 'function') return String((await d.readTextFromClipboard()) || '');
      if (win && win.navigator && win.navigator.clipboard && typeof win.navigator.clipboard.readText === 'function') {
        try { return String((await win.navigator.clipboard.readText()) || ''); } catch (_) {}
      }
      return '';
    }

    function normalizeAgentPreset(raw) {
      const p = String(raw || '').trim().toLowerCase();
      if (p === 'cc' || p === 'claude' || p === 'claude-code') return 'cc';
      if (p === 'codex') return 'codex';
      if (p === 'agy' || p === 'antigravity' || p === 'gemini') return 'agy';
      return '';
    }

    async function ensureAvailablePresets() {
      if (Array.isArray(availablePresetsCache)) return availablePresetsCache;
      const backend = d.backend || (win && win.backend);
      if (backend && typeof backend.ptyAvailablePresets === 'function') {
        try {
          const raw = await backend.ptyAvailablePresets();
          const parsed = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
          if (Array.isArray(parsed) && parsed.length > 0) {
            availablePresetsCache = parsed;
            if (!userPickedPreset) {
              const cfgPreset = normalizeAgentPreset(typeof d.getDefaultAgent === 'function' ? d.getDefaultAgent() : '');
              if (cfgPreset && parsed.indexOf(cfgPreset) >= 0) {
                selectedPreset = cfgPreset;
              } else if (parsed.indexOf(selectedPreset) < 0) {
                selectedPreset = parsed.find((p) => p !== 'shell') || parsed[0];
              }
            }
            return availablePresetsCache;
          }
        } catch (_) {}
      }
      return null;
    }

    async function resolvePreferredAgentPreset(explicit) {
      if (explicit) return explicit;
      const avail = await ensureAvailablePresets();
      const cfgPreset = normalizeAgentPreset(typeof d.getDefaultAgent === 'function' ? d.getDefaultAgent() : '');
      if (userPickedPreset && selectedPreset && selectedPreset !== 'shell') {
        if (!avail || avail.indexOf(selectedPreset) >= 0) return selectedPreset;
      }
      if (cfgPreset && (!avail || avail.indexOf(cfgPreset) >= 0)) {
        return cfgPreset;
      }
      if (Array.isArray(avail) && avail.length > 0) {
        if (avail.indexOf(selectedPreset) >= 0 && selectedPreset !== 'shell') return selectedPreset;
        return avail.find((p) => p !== 'shell') || avail[0];
      }
      return cfgPreset || selectedPreset || 'cc';
    }

    function loadRecentDirs() {
      try {
        if (!win || !win.localStorage) return [];
        const raw = win.localStorage.getItem(RECENT_DIRS_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch (_) {
        return [];
      }
    }

    function saveRecentDir(dir) {
      try {
        if (!win || !win.localStorage || !dir) return;
        const next = mergeRecentDirs(loadRecentDirs(), dir);
        win.localStorage.setItem(RECENT_DIRS_KEY, JSON.stringify(next));
      } catch (_) {}
    }

    function t(key, fallback) {
      if (typeof d.t === 'function') return d.t(key) || fallback || key;
      return fallback || key;
    }

    function notifyChange() {
      if (typeof d.onSessionsChanged === 'function') d.onSessionsChanged(getSessionsMeta());
    }

    function clearLoopTimers(loop) {
      if (!loop) return;
      if (loop.verdictTimer) {
        clearTimeout(loop.verdictTimer);
        loop.verdictTimer = null;
      }
      if (loop.submitTimer) {
        clearTimeout(loop.submitTimer);
        loop.submitTimer = null;
      }
      if (loop.submitRetryTimer) {
        clearTimeout(loop.submitRetryTimer);
        loop.submitRetryTimer = null;
      }
      if (loop.idleTimer) {
        clearTimeout(loop.idleTimer);
        loop.idleTimer = null;
      }
    }

    function serializeLoop(loop) {
      if (!loop) return null;
      return {
        id: loop.id,
        notePath: loop.notePath || '',
        noteTabId: loop.noteTabId || '',
        heading: loop.heading || '',
        title: loop.title || '',
        criteria: Array.isArray(loop.criteria) ? loop.criteria.slice() : [],
        failedMemory: Array.isArray(loop.failedMemory) ? loop.failedMemory.slice() : [],
        phase: loop.phase,
        round: loop.round,
        maxRounds: loop.maxRounds,
        makerSessionId: loop.makerSessionId || '',
        checkerSessionId: loop.checkerSessionId || '',
        makerPreset: loop.makerPreset || 'cc',
        checkerPreset: loop.checkerPreset || 'codex',
        workDir: loop.workDir || '',
        worktreePath: loop.worktreePath || '',
        isolated: !!loop.worktreePath,
        baseDir: loop.baseDir || '',
        gateCmd: loop.gateCmd || '',
        statusText: loop.statusText || '',
        isEnglish: !!loop.isEnglish,
        stopRequested: !!loop.stopRequested,
        pendingInstructionUpdate: !!loop.pendingInstructionUpdate,
        checked: loop.phase === 'done'
      };
    }

    function getLoopsMeta() {
      const out = [];
      loops.forEach((loop) => out.push(serializeLoop(loop)));
      return out;
    }

    function getLoopForSession(sessionId) {
      if (!sessionId) return null;
      let fallback = null;
      for (const loop of loops.values()) {
        if (loop.makerSessionId === sessionId || loop.checkerSessionId === sessionId) {
          if (loop.phase === 'maker' || loop.phase === 'checker') return serializeLoop(loop);
          fallback = serializeLoop(loop);
        }
      }
      return fallback;
    }

    function notifyLoopChange(loop) {
      if (typeof d.onLoopStateChanged === 'function') {
        d.onLoopStateChanged(serializeLoop(loop), getLoopsMeta());
      }
    }

    function findActiveLoopBySession(sessionId, phase) {
      if (!sessionId) return null;
      for (const loop of loops.values()) {
        if (loop.phase !== phase) continue;
        if (phase === 'maker' && loop.makerSessionId === sessionId) return loop;
        if (phase === 'checker' && loop.checkerSessionId === sessionId) return loop;
      }
      return null;
    }

    function hasExplicitReasonAfterFail(cleanText) {
      return /(?:^|\r?\n)\s*(?:[-*>#`]+\s*)?VERDICT:\s*FAIL[^\r\n]*\r?\n\s*(?:[-*>#`]+\s*)?REASON:\s*\S[^\r\n]*\r?\n/i.test(cleanText || '');
    }

    function hasInteractivePromptTail(cleanText) {
      const text = String(cleanText || '').trimEnd();
      if (text.length < 80) return false;
      const tail = text.slice(-400);
      if (/Working\.\.\.|esc to (?:cancel|interrupt)|Thought for\s+\d/i.test(tail)) return false;
      if (/\?\s*for shortcuts/i.test(tail)) return true;
      return /(?:^|\r?\n)\s*[>›❯]\s*(?:Auto mode:[^\r\n]*)?$/i.test(tail);
    }

    function scheduleLoopIdleCheck(loop, s, role) {
      if (!loop || !s || loop.transitioning || loop.submitTimer) return;
      if (!hasInteractivePromptTail(s.stepBuffer)) {
        if (loop.idleTimer) {
          clearTimeout(loop.idleTimer);
          loop.idleTimer = null;
        }
        return;
      }
      if (loop.idleTimer) clearTimeout(loop.idleTimer);
      const idleMs = typeof loop.idleTurnMs === 'number'
        ? loop.idleTurnMs
        : (typeof d.idleTurnMs === 'number' ? d.idleTurnMs : 2500);
      if (idleMs <= 0) return;
      loop.idleTimer = setTimeout(() => {
        loop.idleTimer = null;
        if (loop.transitioning || loop.phase !== role) return;
        const latest = parseLoopSignal(s.stepBuffer);
        if (latest) return;
        if (!loop.idleNudged) {
          loop.idleNudged = true;
          const nudge = role === 'maker'
            ? 'まだ終了マーカーがありません。タスクを完了して最後に「STAGE_DONE」の直後に「: READY」を繋げた文字列のみを1行で出力してください。仕様不足等で続行不能な場合も理由を述べた上で同じ終了マーカーを出力して報告してください。'
            : 'まだ判定マーカーがありません。検証を完了し「VERDICT」の直後に「: PASS」または「: FAIL」と「REASON: ...」を出力してください。';
          sendToSession(s.id, nudge, {
            submit: true,
            preserveFocus: true,
            submitDelayMs: loop.submitDelayMs,
            loopRef: loop
          });
          return;
        }
        if (role === 'maker') {
          loop.lastMakerOutput = s.stepBuffer || '';
          s.stepRaw = '';
          s.stepBuffer = '';
          onMakerCompleted(loop, 'idle');
          return;
        }
        s.stepRaw = '';
        s.stepBuffer = '';
        onCheckerVerdict(loop, 'FAIL', 'CheckerがVERDICTを出力せず待機状態に戻りました');
      }, idleMs);
    }

    function handleLoopSessionData(s) {
      if (!s) return;
      const makerLoop = findActiveLoopBySession(s.id, 'maker');
      if (makerLoop && !makerLoop.transitioning) {
        const sig = parseLoopSignal(s.stepBuffer);
        if (sig && sig.type === 'maker_done') {
          if (makerLoop.idleTimer) {
            clearTimeout(makerLoop.idleTimer);
            makerLoop.idleTimer = null;
          }
          makerLoop.idleNudged = false;
          makerLoop.lastMakerOutput = s.stepBuffer || '';
          s.stepRaw = '';
          s.stepBuffer = '';
          onMakerCompleted(makerLoop, 'signal');
          return;
        }
        scheduleLoopIdleCheck(makerLoop, s, 'maker');
        return;
      }
      const checkerLoop = findActiveLoopBySession(s.id, 'checker');
      if (checkerLoop && !checkerLoop.transitioning) {
        const sig = parseLoopSignal(s.stepBuffer);
        if (!sig || sig.type !== 'verdict') {
          scheduleLoopIdleCheck(checkerLoop, s, 'checker');
          return;
        }
        if (checkerLoop.idleTimer) {
          clearTimeout(checkerLoop.idleTimer);
          checkerLoop.idleTimer = null;
        }
        checkerLoop.idleNudged = false;
        if (sig.verdict === 'PASS') {
          s.stepRaw = '';
          s.stepBuffer = '';
          if (checkerLoop.verdictTimer) {
            clearTimeout(checkerLoop.verdictTimer);
            checkerLoop.verdictTimer = null;
          }
          onCheckerVerdict(checkerLoop, 'PASS', '');
          return;
        }
        if (sig.verdict === 'FAIL') {
          const delay = typeof checkerLoop.verdictDebounceMs === 'number'
            ? checkerLoop.verdictDebounceMs
            : (typeof d.verdictDebounceMs === 'number' ? d.verdictDebounceMs : 1500);
          if (delay <= 0) {
            s.stepRaw = '';
            s.stepBuffer = '';
            if (checkerLoop.verdictTimer) {
              clearTimeout(checkerLoop.verdictTimer);
              checkerLoop.verdictTimer = null;
            }
            onCheckerVerdict(checkerLoop, 'FAIL', sig.reason);
            return;
          }
          if (checkerLoop.verdictTimer) clearTimeout(checkerLoop.verdictTimer);
          checkerLoop.verdictTimer = setTimeout(() => {
            checkerLoop.verdictTimer = null;
            if (checkerLoop.phase !== 'checker' || checkerLoop.transitioning) return;
            const latest = parseLoopSignal(s.stepBuffer);
            s.stepRaw = '';
            s.stepBuffer = '';
            onCheckerVerdict(checkerLoop, 'FAIL', (latest && latest.reason) || sig.reason);
          }, delay);
        }
      }
    }

    function getSessionsMeta() {
      return sessions.map((s) => ({
        id: s.id,
        title: s.title,
        label: s.label || '',
        preset: s.preset,
        dir: s.dir,
        running: s.running,
        active: s.id === activeId
      }));
    }

    function hasRunningSession() {
      return sessions.some((s) => s.running);
    }

    function getActiveSession() {
      for (let i = 0; i < sessions.length; i++) {
        if (sessions[i].id === activeId) return sessions[i];
      }
      return null;
    }

    function ensureXtermLoaded() {
      if (xtermPromise) return xtermPromise;
      if (win && win.Terminal && win.FitAddon) {
        xtermPromise = Promise.resolve();
        return xtermPromise;
      }
      if (!doc || !doc.head) {
        return Promise.reject(new Error('Document unavailable'));
      }
      xtermPromise = new Promise((resolve, reject) => {
        const css = doc.createElement('link');
        css.rel = 'stylesheet';
        css.href = 'vendor/xterm/xterm.css';
        doc.head.appendChild(css);

        const s1 = doc.createElement('script');
        s1.src = 'vendor/xterm/xterm.js';
        s1.onload = () => {
          const s2 = doc.createElement('script');
          s2.src = 'vendor/xterm/addon-fit.js';
          s2.onload = () => resolve();
          s2.onerror = () => reject(new Error('Failed to load xterm-addon-fit'));
          doc.head.appendChild(s2);
        };
        s1.onerror = () => reject(new Error('Failed to load xterm.js'));
        doc.head.appendChild(s1);
      });
      return xtermPromise;
    }

    function ensureHooks() {
      if (hooksRegistered || !win) return;
      hooksRegistered = true;
      win.__onPtyData = (id, b64) => {
        const s = sessions.find((item) => item.id === id);
        if (!s || !s.term) return;
        const bytes = decodeUtf8Base64ToBytes(b64);
        if (bytes.length > 0) {
          s.term.write(bytes);
          s.hasOutput = true;
          if (!s.readySettled) {
            if (s.readySettleTimer) clearTimeout(s.readySettleTimer);
            const probeText = stripAnsi(decodeUtf8Base64ToString(b64));
            if (!s.trustAccepted && /Yes,\s*I\s*trust\s*this\s*folder|Do\s*you\s*trust\s*the\s*contents\s*of\s*this|Trust\s*this\s*folder|Trust\s*and\s*continue/i.test(probeText)) {
              s.trustAccepted = true;
              const backend = d.backend || (win && win.backend);
              if (backend && typeof backend.ptyWrite === 'function') {
                setTimeout(() => {
                  if (s.running) backend.ptyWrite(s.id, encodeUtf8Base64('\r'));
                }, 150);
              }
            } else {
              const settleMs = typeof d.startupReadyDelayMs === 'number'
                ? d.startupReadyDelayMs
                : (d.submitDelayMs === 0 ? 0 : 650);
              if (settleMs <= 0) {
                flushSessionReady(s);
              } else {
                s.readySettleTimer = setTimeout(() => flushSessionReady(s), settleMs);
              }
            }
          }
        }
        if (loops.size === 0 || (!findActiveLoopBySession(s.id, 'maker') && !findActiveLoopBySession(s.id, 'checker'))) {
          return;
        }
        const text = decodeUtf8Base64ToString(b64);
        if (text) {
          s.stepRaw = (s.stepRaw || '') + text;
          if (s.stepRaw.length > 32768) s.stepRaw = s.stepRaw.slice(-32768);
          const clean = stripAnsi(s.stepRaw);
          s.stepBuffer = clean.length > 16384 ? clean.slice(-16384) : clean;
          handleLoopSessionData(s);
        }
      };
      win.__onPtyExit = (id, code, errMsg) => {
        const s = sessions.find((item) => item.id === id);
        if (!s) return;
        s.running = false;
        if (s.term) {
          const msg = errMsg ? ` (${errMsg})` : '';
          s.term.write(`\r\n\x1b[2m[process exited with code ${code}${msg}]\x1b[0m\r\n`);
        }
        const makerLoop = findActiveLoopBySession(s.id, 'maker');
        if (makerLoop && !makerLoop.transitioning) {
          if (makerLoop.stopRequested || Number(code) === 0) {
            makerLoop.lastMakerOutput = s.stepBuffer || '';
            onMakerCompleted(makerLoop, 'exit');
          } else {
            makerLoop.phase = 'failed';
            makerLoop.statusText = `Maker異常終了 (exit ${code})`;
            clearLoopTimers(makerLoop);
            releaseLoopBuffers(makerLoop);
            notifyLoopChange(makerLoop);
          }
        } else {
          const checkerLoop = findActiveLoopBySession(s.id, 'checker');
          if (checkerLoop && !checkerLoop.transitioning) {
            if (checkerLoop.stopRequested) {
              checkerLoop.phase = 'stopped';
              checkerLoop.statusText = `ユーザーにより安全中断 (${checkerLoop.round}/${checkerLoop.maxRounds})`;
            } else {
              checkerLoop.phase = 'failed';
              checkerLoop.statusText = `Checker判定前に終了 (exit ${code})`;
            }
            clearLoopTimers(checkerLoop);
            releaseLoopBuffers(checkerLoop);
            notifyLoopChange(checkerLoop);
          }
        }
        s.stepRaw = '';
        s.stepBuffer = '';
        notifyChange();
      };
    }

    function ensureDOM(container) {
      rootEl = container;
      if (!rootEl || !doc) return;
      if (!stageEl) {
        stageEl = doc.createElement('div');
        stageEl.className = 'agent-terminal-stage';
        rootEl.appendChild(stageEl);
      }
      if (!launcherEl) {
        launcherEl = doc.createElement('div');
        launcherEl.className = 'agent-launcher hidden';
        rootEl.appendChild(launcherEl);
      }
      if (!resizeObserver && typeof ResizeObserver === 'function') {
        resizeObserver = new ResizeObserver(() => fitActive());
        resizeObserver.observe(stageEl);
      }
    }

    function fitActive() {
      const s = getActiveSession();
      if (!s || !s.fitAddon || !s.term) return;
      if (!rootEl || rootEl.classList.contains('hidden')) return;
      try {
        s.fitAddon.fit();
        const backend = d.backend || (win && win.backend);
        if (backend && typeof backend.ptyResize === 'function' && s.running) {
          backend.ptyResize(s.id, s.term.cols, s.term.rows);
        }
      } catch (_) {}
    }

    async function showLauncher(container) {
      if (container) ensureDOM(container);
      if (!launcherEl) return;
      const avail = await ensureAvailablePresets();
      if (!userPickedPreset) {
        const cfgPreset = normalizeAgentPreset(typeof d.getDefaultAgent === 'function' ? d.getDefaultAgent() : '');
        if (cfgPreset && (!avail || avail.indexOf(cfgPreset) >= 0)) selectedPreset = cfgPreset;
      }
      const backend = d.backend || (win && win.backend);
      const activePath = typeof d.getActiveFilePath === 'function' ? d.getActiveFilePath() : '';
      let suggested = [];
      try {
        if (backend && typeof backend.ptySuggestDirs === 'function') {
          const raw = await backend.ptySuggestDirs(activePath || '');
          suggested = JSON.parse(raw || '[]');
        }
      } catch (_) {}

      const recent = loadRecentDirs();
      const merged = [];
      const seen = {};
      for (const item of suggested) {
        if (item && item.path && !seen[item.path]) {
          seen[item.path] = true;
          merged.push(item);
        }
      }
      for (const p of recent) {
        if (p && !seen[p]) {
          seen[p] = true;
          merged.push({ path: p, label: p.split(/[\\/]/).pop() || p, reason: 'recent' });
        }
      }
      if (!selectedDir && merged.length > 0) selectedDir = merged[0].path;

      launcherEl.innerHTML = '';
      const card = doc.createElement('div');
      card.className = 'agent-launcher-card';

      const heading = doc.createElement('div');
      heading.className = 'agent-launcher-title';
      heading.textContent = t('agentNewTabTitle', 'New Agent Terminal');
      card.appendChild(heading);

      const cliLabel = doc.createElement('div');
      cliLabel.className = 'agent-launcher-label';
      cliLabel.textContent = 'CLI';
      card.appendChild(cliLabel);

      const cliRow = doc.createElement('div');
      cliRow.className = 'agent-preset-grid';
      DEFAULT_PRESETS.forEach((p) => {
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = 'agent-preset-btn' + (selectedPreset === p.id ? ' active' : '');
        btn.textContent = p.label;
        btn.onclick = () => {
          selectedPreset = p.id;
          userPickedPreset = true;
          const all = cliRow.querySelectorAll('.agent-preset-btn');
          for (let i = 0; i < all.length; i++) all[i].classList.remove('active');
          btn.classList.add('active');
        };
        cliRow.appendChild(btn);
      });
      card.appendChild(cliRow);

      const dirLabel = doc.createElement('div');
      dirLabel.className = 'agent-launcher-label';
      dirLabel.textContent = t('agentWorkingFolder', 'Working Folder');
      card.appendChild(dirLabel);

      const dirList = doc.createElement('div');
      dirList.className = 'agent-dir-list';
      const renderDirs = () => {
        dirList.innerHTML = '';
        merged.forEach((item) => {
          const row = doc.createElement('button');
          row.type = 'button';
          row.className = 'agent-dir-option' + (selectedDir === item.path ? ' active' : '');
          const nameSpan = doc.createElement('span');
          nameSpan.className = 'agent-dir-name';
          nameSpan.textContent = item.path;
          const tagSpan = doc.createElement('span');
          tagSpan.className = 'agent-dir-reason';
          tagSpan.textContent = item.reason || '';
          row.appendChild(nameSpan);
          row.appendChild(tagSpan);
          row.onclick = () => {
            selectedDir = item.path;
            renderDirs();
          };
          dirList.appendChild(row);
        });
      };
      renderDirs();
      card.appendChild(dirList);

      let history = [];
      try {
        if (backend && typeof backend.ptyHistory === 'function') {
          const rawHist = await backend.ptyHistory();
          history = JSON.parse(rawHist || '[]');
        }
      } catch (_) {}

      if (Array.isArray(history) && history.length > 0) {
        const histLabel = doc.createElement('div');
        histLabel.className = 'agent-launcher-label';
        histLabel.textContent = t('agentResumeHistory', 'Resume / Reopen Recent');
        card.appendChild(histLabel);

        const histList = doc.createElement('div');
        histList.className = 'agent-history-list';
        history.slice(0, 6).forEach((entry) => {
          const hRow = doc.createElement('div');
          hRow.className = 'agent-history-row';

          const hInfo = doc.createElement('span');
          hInfo.className = 'agent-history-info';
          const badge = formatSessionBadge(entry);
          const dirBase = entry.dir ? String(entry.dir).split(/[\\/]/).pop() : '';
          hInfo.textContent = dirBase ? `${badge} (${dirBase})` : badge;
          hInfo.title = entry.dir || badge;
          hRow.appendChild(hInfo);

          const hState = doc.createElement('span');
          hState.className = 'agent-history-badge';
          hState.textContent = entry.status === 'dormant'
            ? t('agentDormantBadge', 'dormant')
            : t('agentClosedBadge', 'closed');
          hRow.appendChild(hState);

          const hBtn = doc.createElement('button');
          hBtn.type = 'button';
          hBtn.className = 'btn-secondary agent-launcher-btn';
          hBtn.textContent = t('agentResumeBtn', 'Resume');
          hBtn.onclick = async () => {
            hideLauncher();
            await startSession(entry.preset, entry.dir, {
              explicitId: entry.id,
              label: entry.label || '',
              cliSessionId: entry.cliSessionId || '',
              resume: true
            });
          };
          hRow.appendChild(hBtn);
          histList.appendChild(hRow);
        });
        card.appendChild(histList);
      }

      const actions = doc.createElement('div');
      actions.className = 'agent-launcher-actions';

      const browseBtn = doc.createElement('button');
      browseBtn.type = 'button';
      browseBtn.className = 'btn-secondary agent-launcher-btn';
      browseBtn.textContent = t('agentBrowseFolder', 'Browse...');
      browseBtn.onclick = async () => {
        if (!backend || typeof backend.ptyPickFolder !== 'function') return;
        try {
          const picked = await backend.ptyPickFolder();
          if (picked) {
            selectedDir = picked;
            if (!seen[picked]) {
              seen[picked] = true;
              merged.unshift({ path: picked, label: picked.split(/[\\/]/).pop() || picked, reason: 'picked' });
            }
            renderDirs();
          }
        } catch (_) {}
      };
      actions.appendChild(browseBtn);

      if (sessions.length > 0) {
        const cancelBtn = doc.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'btn-secondary agent-launcher-btn';
        cancelBtn.textContent = t('btnCancel', 'Cancel');
        cancelBtn.onclick = () => hideLauncher();
        actions.appendChild(cancelBtn);
      }

      const startBtn = doc.createElement('button');
      startBtn.type = 'button';
      startBtn.className = 'btn-primary agent-launcher-btn primary';
      startBtn.textContent = t('agentLaunch', 'Start');
      startBtn.onclick = async () => {
        hideLauncher();
        await startSession(selectedPreset, selectedDir);
      };
      actions.appendChild(startBtn);

      card.appendChild(actions);
      launcherEl.appendChild(card);
      launcherEl.classList.remove('hidden');
    }

    function hideLauncher() {
      if (launcherEl) launcherEl.classList.add('hidden');
    }

    function flushSessionReady(s) {
      if (!s) return;
      if (s.readySettleTimer) {
        clearTimeout(s.readySettleTimer);
        s.readySettleTimer = null;
      }
      s.readySettled = true;
      const list = Array.isArray(s.readyResolvers) ? s.readyResolvers.splice(0) : [];
      for (let i = 0; i < list.length; i++) list[i](true);
    }

    function waitForSessionReady(sessionId, maxWaitMs) {
      const s = sessions.find((item) => item.id === sessionId);
      if (!s || !s.running || s.readySettled) return Promise.resolve(true);
      const limit = typeof maxWaitMs === 'number'
        ? maxWaitMs
        : (typeof d.startupReadyTimeoutMs === 'number'
            ? d.startupReadyTimeoutMs
            : (d.submitDelayMs === 0 ? 0 : 3500));
      if (limit <= 0) {
        flushSessionReady(s);
        return Promise.resolve(true);
      }
      return new Promise((resolve) => {
        let done = false;
        const finish = (ok) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(ok);
        };
        const timer = setTimeout(() => {
          flushSessionReady(s);
          finish(true);
        }, limit);
        s.readyResolvers = s.readyResolvers || [];
        s.readyResolvers.push(finish);
      });
    }

    function disposeSessionView(s) {
      if (!s) return;
      if (s.readySettleTimer) {
        clearTimeout(s.readySettleTimer);
        s.readySettleTimer = null;
      }
      flushSessionReady(s);
      s.stepRaw = '';
      s.stepBuffer = '';
      try { if (s.term && typeof s.term.dispose === 'function') s.term.dispose(); } catch (_) {}
      if (s.wrapEl && s.wrapEl.parentElement) s.wrapEl.parentElement.removeChild(s.wrapEl);
    }

    async function startSession(preset, dir, opts) {
      const o = opts || {};
      ensureHooks();
      await ensureXtermLoaded();
      if (!stageEl) return null;

      const backend = d.backend || (win && win.backend);
      if (!backend || (typeof backend.ptyStart !== 'function' && typeof backend.ptyStartWithOptions !== 'function')) {
        throw new Error('PTY backend unavailable');
      }

      if (o.explicitId) {
        const deadIdx = sessions.findIndex((s) => s.id === o.explicitId && !s.running);
        if (deadIdx >= 0) {
          disposeSessionView(sessions[deadIdx]);
          sessions.splice(deadIdx, 1);
        }
      }

      const wrap = doc.createElement('div');
      wrap.className = 'agent-term-instance';
      stageEl.appendChild(wrap);

      const term = new win.Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: 'Cascadia Code, Consolas, SF Mono, Menlo, monospace',
        scrollback: 2000,
        theme: readXtermTheme(doc, win)
      });
      const FitCtor = win.FitAddon && (win.FitAddon.FitAddon || win.FitAddon);
      const fitAddon = typeof FitCtor === 'function' ? new FitCtor() : null;
      if (fitAddon) term.loadAddon(fitAddon);
      term.open(wrap);
      if (fitAddon) {
        try { fitAddon.fit(); } catch (_) {}
      }

      let rawInfo;
      try {
        rawInfo = typeof backend.ptyStartWithOptions === 'function'
          ? await backend.ptyStartWithOptions(
              o.explicitId || '',
              preset || 'shell',
              dir || '',
              o.label || '',
              o.cliSessionId || '',
              !!o.resume,
              term.cols || 80,
              term.rows || 24
            )
          : await backend.ptyStart(preset || 'shell', dir || '', term.cols || 80, term.rows || 24);
      } catch (err) {
        disposeSessionView({ term, wrapEl: wrap });
        throw err;
      }
      const info = typeof rawInfo === 'string' ? JSON.parse(rawInfo) : rawInfo;
      if (info.dir) saveRecentDir(info.dir);

      const session = {
        id: info.id,
        title: info.title || preset || 'shell',
        label: info.label || o.label || '',
        preset: info.preset || preset,
        dir: info.dir || dir || '',
        cliSessionId: info.cliSessionId || o.cliSessionId || '',
        running: true,
        hasOutput: false,
        readySettled: preset === 'shell' || !preset,
        readyResolvers: [],
        readySettleTimer: null,
        stepRaw: '',
        stepBuffer: '',
        term,
        fitAddon,
        wrapEl: wrap
      };
      sessions.push(session);

      term.onData((str) => {
        if (!session.running) return;
        backend.ptyWrite(session.id, encodeUtf8Base64(str));
      });

      if (typeof term.attachCustomKeyEventHandler === 'function') {
        term.attachCustomKeyEventHandler((e) => {
          if (!e || e.type !== 'keydown') return true;
          const key = String(e.key || '').toLowerCase();
          const isCopyCombo =
            (e.ctrlKey && !e.altKey && !e.metaKey && key === 'c') ||
            (!e.ctrlKey && !e.altKey && e.metaKey && !e.shiftKey && key === 'c');
          if (isCopyCombo) {
            const hasSel = typeof term.hasSelection === 'function' && term.hasSelection();
            if (e.ctrlKey && e.shiftKey) {
              if (hasSel && typeof term.getSelection === 'function') copyText(term.getSelection());
              return false;
            }
            if (hasSel && typeof term.getSelection === 'function') {
              copyText(term.getSelection());
              return false;
            }
            return true;
          }
          const isPasteCombo =
            (e.ctrlKey && !e.altKey && !e.metaKey && key === 'v') ||
            (!e.ctrlKey && !e.altKey && e.metaKey && !e.shiftKey && key === 'v');
          if (isPasteCombo) {
            const hasAsyncRead =
              typeof d.readTextFromClipboard === 'function' ||
              (win && win.navigator && win.navigator.clipboard && typeof win.navigator.clipboard.readText === 'function');
            if (!hasAsyncRead) return true;
            if (typeof e.preventDefault === 'function') e.preventDefault();
            readClipboardText().then((text) => {
              if (text && session.running) {
                backend.ptyWrite(session.id, encodeUtf8Base64(bracketedPaste(text)));
              }
            }).catch(() => {});
            return false;
          }
          return true;
        });
      }

      selectSession(session.id, { preserveFocus: !!o.preserveFocus });
      if (!o.preserveFocus && term && typeof term.focus === 'function') term.focus();
      notifyChange();
      return session;
    }

    function selectSession(id, opts) {
      const o = opts || {};
      activeId = id;
      for (let i = 0; i < sessions.length; i++) {
        const s = sessions[i];
        const on = s.id === id;
        if (s.wrapEl) s.wrapEl.classList.toggle('hidden', !on);
      }
      hideLauncher();
      fitActive();
      const act = getActiveSession();
      if (!o.preserveFocus && act && act.term && typeof act.term.focus === 'function') act.term.focus();
      notifyChange();
    }

    async function teardownSessionView(id, method) {
      const idx = sessions.findIndex((s) => s.id === id);
      if (idx < 0) return;
      const s = sessions[idx];
      for (const loop of loops.values()) {
        if ((loop.phase === 'maker' || loop.phase === 'checker') &&
            (loop.makerSessionId === id || loop.checkerSessionId === id)) {
          loop.stopRequested = true;
          loop.phase = 'stopped';
          loop.statusText = `セッション終了により中断 (${loop.round}/${loop.maxRounds})`;
          clearLoopTimers(loop);
          releaseLoopBuffers(loop);
          notifyLoopChange(loop);
        }
      }
      const backend = d.backend || (win && win.backend);
      if (backend && typeof backend[method] === 'function') {
        try { await backend[method](s.id); } catch (_) {}
      } else if (method !== 'ptyClose' && backend && typeof backend.ptyClose === 'function') {
        try { await backend.ptyClose(s.id); } catch (_) {}
      }
      disposeSessionView(s);
      sessions.splice(idx, 1);
      if (activeId === id) {
        const next = sessions[Math.min(idx, sessions.length - 1)] || null;
        activeId = next ? next.id : null;
        if (next) selectSession(next.id);
        else if (rootEl && !rootEl.classList.contains('hidden')) await showLauncher(rootEl);
      }
      notifyChange();
    }

    async function sleepSession(id) {
      return teardownSessionView(id, 'ptySleep');
    }

    async function renameSession(id, label) {
      const s = sessions.find((item) => item.id === id);
      const clean = String(label || '').trim();
      const backend = d.backend || (win && win.backend);
      if (backend && typeof backend.ptyRename === 'function') {
        try { await backend.ptyRename(id, clean); } catch (_) {}
      }
      if (s) s.label = clean;
      notifyChange();
    }

    function getSessionById(id) {
      const targetId = id || activeId;
      const s = sessions.find((item) => item.id === targetId);
      if (!s) return null;
      return { id: s.id, title: formatSessionBadge(s), preset: s.preset, dir: s.dir, running: s.running, label: s.label || '', cliSessionId: s.cliSessionId || '' };
    }

    async function closeOtherSessions(keepId) {
      const targetId = keepId || activeId;
      const toClose = sessions.filter((s) => s.id !== targetId).map((s) => s.id);
      for (let i = 0; i < toClose.length; i++) {
        await closeSession(toClose[i]);
      }
    }

    function beginRenameSession(id) {
      const targetId = id || activeId;
      const s = sessions.find((item) => item.id === targetId);
      if (!s || !doc) return false;

      if (typeof doc.querySelectorAll === 'function') {
        const prev = doc.querySelectorAll('.agent-rename-floating, .agent-rename-input');
        for (let i = 0; i < prev.length; i++) {
          if (prev[i] && prev[i].parentElement) prev[i].parentElement.removeChild(prev[i]);
        }
      }

      const input = doc.createElement('input');
      input.type = 'text';
      input.className = 'agent-rename-input';
      input.value = s.label || '';
      input.placeholder = s.id;
      if (typeof input.setAttribute === 'function') {
        input.setAttribute('aria-label', t('agentCtxRename', 'Rename Session'));
      }

      let targetTitleEl = null;
      if (typeof doc.querySelectorAll === 'function') {
        const tabItems = doc.querySelectorAll('#tab-index-right .tab-item');
        for (let i = 0; i < tabItems.length; i++) {
          const item = tabItems[i];
          if (item && item.dataset && item.dataset.agentSessionId === s.id) {
            targetTitleEl = item.querySelector ? item.querySelector('.tab-title') : null;
            break;
          }
        }
      }

      let floatingWrap = null;
      let done = false;
      const cleanup = (restore) => {
        if (done) return;
        done = true;
        if (floatingWrap && floatingWrap.parentElement) {
          floatingWrap.parentElement.removeChild(floatingWrap);
        }
        if (restore) notifyChange();
      };
      const commit = async () => {
        if (done) return;
        done = true;
        const val = input.value;
        if (floatingWrap && floatingWrap.parentElement) {
          floatingWrap.parentElement.removeChild(floatingWrap);
        }
        await renameSession(s.id, val);
      };

      input.onmousedown = (e) => { e.stopPropagation(); };
      input.onclick = (e) => { e.stopPropagation(); };
      input.ondblclick = (e) => { e.stopPropagation(); };
      input.onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          if (e.isComposing || e.keyCode === 229) return;
          if (typeof e.preventDefault === 'function') e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          if (typeof e.preventDefault === 'function') e.preventDefault();
          cleanup(true);
        }
      };
      input.onblur = () => {
        commit();
      };

      if (targetTitleEl) {
        targetTitleEl.textContent = '';
        targetTitleEl.appendChild(input);
      } else if (rootEl) {
        floatingWrap = doc.createElement('div');
        floatingWrap.className = 'agent-rename-floating';
        floatingWrap.appendChild(input);
        rootEl.appendChild(floatingWrap);
      } else {
        return false;
      }

      if (typeof input.focus === 'function') input.focus();
      if (typeof input.select === 'function') input.select();
      return true;
    }

    async function openOrReviveById(id, container, opts) {
      const o = opts || {};
      if (!id) return false;
      if (container) ensureDOM(container);
      const live = sessions.find((s) => s.id === id && s.running);
      if (live) {
        selectSession(live.id, { preserveFocus: !!o.preserveFocus });
        return true;
      }
      const backend = d.backend || (win && win.backend);
      if (!backend || typeof backend.ptyHistory !== 'function') return false;
      try {
        const raw = await backend.ptyHistory();
        const list = JSON.parse(raw || '[]');
        const match = Array.isArray(list) ? list.find((e) => e && e.id === id) : null;
        if (!match) return false;
        hideLauncher();
        await startSession(match.preset, match.dir, {
          explicitId: match.id,
          label: match.label || '',
          cliSessionId: match.cliSessionId || '',
          resume: true,
          preserveFocus: !!o.preserveFocus
        });
        return true;
      } catch (_) {
        return false;
      }
    }

    function relayToSession(targetId, text) {
      const target = sessions.find((s) => s.id === targetId && s.running);
      if (!target) return false;
      const src = getActiveSession();
      const prefix = src ? `[From ${formatSessionBadge(src)}]\n` : '';
      return sendToSession(target.id, prefix + text, { select: true });
    }

    function sendToSession(targetId, text, opts) {
      const target = sessions.find((s) => s.id === targetId && s.running);
      if (!target) return false;
      const o = opts || {};
      const backend = d.backend || (win && win.backend);
      if (!backend || typeof backend.ptyWrite !== 'function') return false;
      const payload = o.bracketed === false ? String(text || '') : bracketedPaste(text);
      backend.ptyWrite(target.id, encodeUtf8Base64(payload));
      if (o.submit) {
        const baseDelay = typeof o.submitDelayMs === 'number'
          ? o.submitDelayMs
          : (typeof d.submitDelayMs === 'number' ? d.submitDelayMs : 250);
        const delay = baseDelay > 0 && String(text || '').length > 400
          ? Math.max(baseDelay, 450)
          : baseDelay;
        let timer = null;
        let retryTimer = null;
        const sendEnter = () => {
          if (o.loopRef && timer && o.loopRef.submitTimer === timer) o.loopRef.submitTimer = null;
          if (!target.running) return;
          backend.ptyWrite(target.id, encodeUtf8Base64('\r'));
          if (delay > 0 && target.preset === 'codex' && String(text || '').length > 400) {
            retryTimer = setTimeout(() => {
              if (o.loopRef && retryTimer && o.loopRef.submitRetryTimer === retryTimer) o.loopRef.submitRetryTimer = null;
              if (!target.running) return;
              if (o.loopRef && o.loopRef.transitioning) return;
              const buf = String(target.stepBuffer || '');
              if (!/Working\s*\(/i.test(buf)) {
                backend.ptyWrite(target.id, encodeUtf8Base64('\r'));
              }
            }, 400);
            if (o.loopRef) o.loopRef.submitRetryTimer = retryTimer;
          }
        };
        if (delay <= 0) {
          sendEnter();
        } else {
          timer = setTimeout(sendEnter, delay);
          if (o.loopRef) o.loopRef.submitTimer = timer;
        }
      }
      if (o.select) selectSession(target.id, { preserveFocus: !!o.preserveFocus });
      else if (o.focus && target.term && typeof target.term.focus === 'function') target.term.focus();
      return true;
    }

    async function closeSession(id) {
      return teardownSessionView(id, 'ptyClose');
    }

    async function openPane(container, opts) {
      const o = opts || {};
      ensureDOM(container);
      if (sessions.length === 0) {
        if (!o.skipLauncher) await showLauncher(container);
      } else {
        hideLauncher();
        selectSession(activeId || sessions[0].id, { preserveFocus: !!o.preserveFocus });
      }
    }

    function sendTextToActive(text) {
      const s = getActiveSession();
      if (!s || !s.running) return false;
      const backend = d.backend || (win && win.backend);
      if (!backend || typeof backend.ptyWrite !== 'function') return false;
      backend.ptyWrite(s.id, encodeUtf8Base64(bracketedPaste(text)));
      if (s.term) s.term.focus();
      return true;
    }

    function syncTheme() {
      const theme = readXtermTheme(doc, win);
      for (let i = 0; i < sessions.length; i++) {
        const s = sessions[i];
        if (s && s.term && s.term.options) {
          try { s.term.options.theme = theme; } catch (_) {}
        }
      }
    }

    function readActiveOutput(maxLines) {
      const s = getActiveSession();
      if (!s || !s.term) return '';
      if (typeof s.term.hasSelection === 'function' && s.term.hasSelection()) {
        const sel = s.term.getSelection();
        if (sel && sel.trim()) return sel.trim();
      }
      const buf = s.term.buffer && s.term.buffer.active;
      if (!buf || typeof buf.getLine !== 'function') return '';
      const lines = [];
      for (let i = 0; i < buf.length; i++) {
        const line = buf.getLine(i);
        if (line && typeof line.translateToString === 'function') {
          lines.push(line.translateToString(true));
        }
      }
      return extractRecentOutput(lines, maxLines || 60);
    }

    function getLatestMermaids() {
      const s = getActiveSession();
      if (!s || !s.term) return [];
      const buf = s.term.buffer && s.term.buffer.active;
      if (!buf || typeof buf.getLine !== 'function') return [];
      const lines = [];
      for (let i = 0; i < buf.length; i++) {
        const line = buf.getLine(i);
        if (line && typeof line.translateToString === 'function') {
          lines.push(line.translateToString(true));
        }
      }
      return extractMermaidBlocks(lines.join('\n'));
    }

    function getLatestMermaid() {
      const blocks = getLatestMermaids();
      return blocks.length > 0 ? blocks[blocks.length - 1] : '';
    }

    async function dispatchMakerRound(loop) {
      if (!loop) return;
      if (loop.stopRequested) {
        loop.phase = 'stopped';
        loop.statusText = `ユーザーにより安全中断 (${loop.round}/${loop.maxRounds})`;
        clearLoopTimers(loop);
        releaseLoopBuffers(loop);
        notifyLoopChange(loop);
        notifyChange();
        return;
      }
      const backend = d.backend || (win && win.backend);
      loop.transitioning = true;
      let makerSess = sessions.find((s) => s.id === loop.makerSessionId && s.running);
      try {
        loop.phase = 'maker';
        loop.statusText = `${loop.round}/${loop.maxRounds} Maker実行中 (${loop.makerPreset})`;
        notifyLoopChange(loop);
        notifyChange();

        let newlyStarted = false;
        if (!makerSess) {
          makerSess = await startSession(loop.makerPreset, loop.workDir, {
            label: `Loop ${loop.round}/${loop.maxRounds}`,
            preserveFocus: true
          });
          if (!makerSess) throw new Error('Failed to start Maker session');
          loop.makerSessionId = makerSess.id;
          newlyStarted = true;
          notifyLoopChange(loop);
          notifyChange();
        }
        if (newlyStarted) {
          await waitForSessionReady(makerSess.id);
        }
      } catch (err) {
        loop.phase = 'failed';
        loop.statusText = `Maker起動失敗: ${err && err.message ? err.message : 'unknown'}`;
        clearLoopTimers(loop);
        loop.transitioning = false;
        notifyLoopChange(loop);
        notifyChange();
        return;
      }
      loop.transitioning = false;
      loop.idleNudged = false;
      if (loop.idleTimer) {
        clearTimeout(loop.idleTimer);
        loop.idleTimer = null;
      }
      makerSess.stepRaw = '';
      makerSess.stepBuffer = '';
      loop.pendingInstructionUpdate = false;
      const prompt = buildMakerPrompt(loop, loop.gateCmd, loop.round, loop.maxRounds);
      if (!backend || typeof backend.ptyWrite !== 'function') return;
      sendToSession(makerSess.id, prompt, {
        submit: true,
        preserveFocus: true,
        submitDelayMs: loop.submitDelayMs,
        loopRef: loop
      });
    }

    async function onMakerCompleted(loop, via) {
      if (!loop || loop.phase !== 'maker' || loop.transitioning) return;
      if (loop.stopRequested) {
        loop.phase = 'stopped';
        loop.statusText = `ユーザーにより安全中断 (${loop.round}/${loop.maxRounds})`;
        clearLoopTimers(loop);
        releaseLoopBuffers(loop);
        notifyLoopChange(loop);
        notifyChange();
        return;
      }
      loop.transitioning = true;
      let checkerSess = sessions.find((s) => s.id === loop.checkerSessionId && s.running && s.id !== loop.makerSessionId);
      try {
        loop.phase = 'checker';
        loop.statusText = `${loop.round}/${loop.maxRounds} Checker検証中 (${loop.checkerPreset})`;
        notifyLoopChange(loop);
        notifyChange();

        let newlyStarted = false;
        if (!checkerSess) {
          checkerSess = await startSession(loop.checkerPreset, loop.workDir, {
            label: 'Checker',
            preserveFocus: true
          });
          if (!checkerSess) throw new Error('Failed to start Checker session');
          loop.checkerSessionId = checkerSess.id;
          newlyStarted = true;
          notifyLoopChange(loop);
          notifyChange();
        }
        if (newlyStarted) {
          await waitForSessionReady(checkerSess.id);
        }
      } catch (err) {
        loop.phase = 'failed';
        loop.statusText = `Checker起動失敗: ${err && err.message ? err.message : 'unknown'}`;
        clearLoopTimers(loop);
        loop.transitioning = false;
        notifyLoopChange(loop);
        notifyChange();
        return;
      }
      loop.transitioning = false;
      loop.idleNudged = false;
      if (loop.idleTimer) {
        clearTimeout(loop.idleTimer);
        loop.idleTimer = null;
      }
      checkerSess.stepRaw = '';
      checkerSess.stepBuffer = '';
      const prompt = buildCheckerPrompt(loop, loop.gateCmd, loop.lastMakerOutput || '', loop.round, loop.maxRounds);
      sendToSession(checkerSess.id, prompt, {
        submit: true,
        preserveFocus: true,
        submitDelayMs: loop.submitDelayMs,
        loopRef: loop
      });
    }

    function pruneFinishedLoops(maxTotal) {
      const cap = typeof maxTotal === 'number' ? maxTotal : 16;
      if (loops.size <= cap) return;
      for (const [lid, l] of loops.entries()) {
        if (loops.size <= cap) break;
        if (l.phase !== 'maker' && l.phase !== 'checker') {
          loops.delete(lid);
        }
      }
    }

    function releaseLoopBuffers(loop) {
      if (!loop) return;
      clearLoopTimers(loop);
      loop.lastMakerOutput = '';
      for (let i = 0; i < sessions.length; i++) {
        const s = sessions[i];
        if (s && (s.id === loop.makerSessionId || s.id === loop.checkerSessionId)) {
          s.stepRaw = '';
          s.stepBuffer = '';
        }
      }
      pruneFinishedLoops(16);
    }

    function trimIdleMemory() {
      for (let i = 0; i < sessions.length; i++) {
        const s = sessions[i];
        if (!s) continue;
        if (!findActiveLoopBySession(s.id, 'maker') && !findActiveLoopBySession(s.id, 'checker')) {
          s.stepRaw = '';
          s.stepBuffer = '';
        }
      }
      for (const l of loops.values()) {
        if (l.phase !== 'maker' && l.phase !== 'checker') {
          l.lastMakerOutput = '';
        }
      }
      pruneFinishedLoops(0);
    }

    async function onCheckerVerdict(loop, verdict, reason) {
      if (!loop || loop.phase !== 'checker' || loop.transitioning) return;
      clearLoopTimers(loop);
      if (verdict === 'PASS') {
        loop.phase = 'done';
        loop.statusText = `PASS (${loop.round}/${loop.maxRounds}回目で承認済み)`;
        releaseLoopBuffers(loop);
        notifyLoopChange(loop);
        notifyChange();
        return;
      }
      const cleanReason = String(reason || '').trim() || '検収テストまたは評価軸が未達成';
      loop.failedMemory.push(`[${loop.round}回目NG] ${cleanReason}`);
      if (loop.stopRequested) {
        loop.phase = 'stopped';
        loop.statusText = `ユーザーにより安全中断 (${loop.round}/${loop.maxRounds})`;
        releaseLoopBuffers(loop);
        notifyLoopChange(loop);
        notifyChange();
        return;
      }
      if (loop.round >= loop.maxRounds) {
        loop.phase = 'failed';
        loop.statusText = `上限到達 (${loop.round}/${loop.maxRounds} FAIL)`;
        releaseLoopBuffers(loop);
        notifyLoopChange(loop);
        notifyChange();
        return;
      }
      loop.round += 1;
      await dispatchMakerRound(loop);
    }

    async function startLoop(block, opts) {
      const b = block || {};
      const o = opts || {};
      if (o.container && !stageEl) ensureDOM(o.container);
      const backend = d.backend || (win && win.backend);

      const noteKey = o.noteTabId || o.notePath || '';
      const cleanTitle = stripPtyBadgeFromTitle(b.title || 'Task') || 'Task';
      const heading = b.heading || `## [ ] ${cleanTitle}`;
      for (const existing of loops.values()) {
        if ((existing.phase === 'maker' || existing.phase === 'checker') &&
            (existing.noteTabId || existing.notePath || '') === noteKey &&
            (existing.heading === heading || existing.title === cleanTitle)) {
          return serializeLoop(existing);
        }
      }

      const loopId = `loop-${++loopsSeq}`;
      const explicitMakerId = o.makerSessionId || b.makerId || b.makerSessionId || '';
      const explicitMakerSess = explicitMakerId
        ? sessions.find((s) => s.id === explicitMakerId && s.running)
        : null;
      const availPresets = await ensureAvailablePresets();
      const makerPreset = o.makerPreset
        || (explicitMakerSess && explicitMakerSess.preset)
        || o.preferredPreset
        || await resolvePreferredAgentPreset();
      if ((Array.isArray(availPresets) && !availPresets.some((p) => p !== 'shell')) || makerPreset === 'shell') {
        const failedLoop = {
          id: loopId,
          notePath: o.notePath || '',
          noteTabId: o.noteTabId || '',
          heading,
          title: cleanTitle,
          criteria: Array.isArray(b.criteria) ? b.criteria.filter(Boolean) : [],
          failedMemory: Array.isArray(b.failedMemory) ? b.failedMemory.filter(Boolean) : [],
          isEnglish: !!b.isEnglish,
          phase: 'failed',
          round: 1,
          maxRounds: Math.max(1, Number(b.maxRounds || o.maxRounds || 3)),
          makerSessionId: '',
          checkerSessionId: '',
          makerPreset: makerPreset || 'shell',
          checkerPreset: 'shell',
          statusText: '利用可能な AI エージェント (agy / codex / claude) が見つかりません'
        };
        loops.set(loopId, failedLoop);
        notifyLoopChange(failedLoop);
        return serializeLoop(failedLoop);
      }
      const checkerPreset = o.checkerPreset || pickCrossModelPreset(makerPreset, availPresets);

      let baseDir = o.workDir || selectedDir || (explicitMakerSess && explicitMakerSess.dir) || '';
      if (!baseDir && backend && typeof backend.ptySuggestDirs === 'function') {
        try {
          const raw = await backend.ptySuggestDirs(o.notePath || '');
          const suggested = JSON.parse(raw || '[]');
          if (Array.isArray(suggested) && suggested[0] && suggested[0].path) {
            baseDir = suggested[0].path;
          }
        } catch (_) {}
      }

      const wantWorktree = !o.skipWorktree && b.worktree !== false;
      let workDir = baseDir;
      let worktreePath = '';
      if (baseDir && wantWorktree && backend && typeof backend.ptyPrepareWorktree === 'function') {
        try {
          const rawWt = await backend.ptyPrepareWorktree(baseDir, loopId);
          const wt = typeof rawWt === 'string' ? JSON.parse(rawWt) : rawWt;
          const wtDir = (wt && (wt.dir || wt.worktreePath)) || '';
          const wtIso = !!(wt && (wt.isolated || wt.isWorktree));
          if (wtDir) workDir = wtDir;
          if (wtIso && wtDir) worktreePath = wtDir;
        } catch (_) {}
      }

      let gateCmd = o.gateCmd || (b.gate && b.gate !== 'auto' ? b.gate : '') || '';
      if (!gateCmd && workDir && backend && typeof backend.ptyDetectGate === 'function') {
        try {
          gateCmd = (await backend.ptyDetectGate(workDir)) || '';
        } catch (_) {}
      }

      const canReuseExplicit = !!(explicitMakerSess &&
        o.reuseExistingSession !== false &&
        (!workDir || !explicitMakerSess.dir || workDir === explicitMakerSess.dir));

      const maxRounds = Math.max(1, Number(b.maxRounds || o.maxRounds || 3));
      const startRound = (b.round > 0 && b.round <= maxRounds && /中断/.test(b.statusText || '')) ? b.round : 1;

      const loop = {
        id: loopId,
        notePath: o.notePath || '',
        noteTabId: o.noteTabId || '',
        heading,
        title: cleanTitle,
        criteria: Array.isArray(b.criteria) ? b.criteria.filter(Boolean) : [],
        failedMemory: Array.isArray(b.failedMemory) ? b.failedMemory.filter(Boolean) : [],
        isEnglish: !!b.isEnglish,
        lastMakerOutput: '',
        phase: 'maker',
        round: startRound,
        maxRounds,
        makerSessionId: canReuseExplicit ? explicitMakerSess.id : '',
        checkerSessionId: '',
        makerPreset,
        checkerPreset,
        baseDir,
        workDir,
        worktreePath,
        gateCmd,
        statusText: `${startRound}/${maxRounds} 準備中`,
        stopRequested: false,
        pendingInstructionUpdate: false,
        transitioning: false,
        verdictTimer: null,
        submitTimer: null,
        submitDelayMs: typeof o.submitDelayMs === 'number' ? o.submitDelayMs : undefined,
        verdictDebounceMs: typeof o.verdictDebounceMs === 'number' ? o.verdictDebounceMs : undefined
      };
      loops.set(loop.id, loop);
      await dispatchMakerRound(loop);
      return serializeLoop(loop);
    }

    function stopLoop(loopId, immediateInterrupt) {
      const loop = loops.get(loopId);
      if (!loop) return false;
      if (loop.phase === 'done' || loop.phase === 'stopped' || loop.phase === 'failed') return true;
      loop.stopRequested = true;
      if (!immediateInterrupt) {
        loop.statusText = `停止予約中 (${loop.round}/${loop.maxRounds} 完了後停止)`;
        notifyLoopChange(loop);
        notifyChange();
        return true;
      }
      clearLoopTimers(loop);
      const targetId = loop.phase === 'checker' ? loop.checkerSessionId : loop.makerSessionId;
      const backend = d.backend || (win && win.backend);
      if (targetId && backend && typeof backend.ptyWrite === 'function') {
        const target = sessions.find((s) => s.id === targetId && s.running);
        if (target) {
          backend.ptyWrite(target.id, encodeUtf8Base64('\x1b\x03'));
        }
      }
      loop.phase = 'stopped';
      loop.statusText = `即時中断 (${loop.round}/${loop.maxRounds})`;
      releaseLoopBuffers(loop);
      notifyLoopChange(loop);
      notifyChange();
      return true;
    }

    function updateLoopInstructions(loopId, updatedBlock) {
      const loop = loops.get(loopId);
      if (!loop || !updatedBlock) return false;
      if (updatedBlock.title) loop.title = updatedBlock.title;
      if (Array.isArray(updatedBlock.criteria)) {
        loop.criteria = updatedBlock.criteria.filter(Boolean);
      }
      loop.pendingInstructionUpdate = true;
      notifyLoopChange(loop);
      return true;
    }

    function renderRightTabs(listEl) {
      if (!listEl || !doc) return;
      listEl.innerHTML = '';
      const activeIdx = Math.max(0, sessions.findIndex((x) => x.id === activeId));
      sessions.forEach((s, idx) => {
        const item = doc.createElement('div');
        const isActive = s.id === activeId;
        item.className = 'tab-item' + (isActive ? ' active' : '');
        item.setAttribute('role', 'tab');
        item.setAttribute('aria-selected', isActive ? 'true' : 'false');
        item.setAttribute('tabindex', isActive ? '0' : '-1');
        const d = (typeof window !== 'undefined' && window.TabStrip && typeof window.TabStrip.distanceOf === 'function')
          ? window.TabStrip.distanceOf(idx, activeIdx)
          : Math.abs(idx - activeIdx);
        if (item.style && typeof item.style.setProperty === 'function') {
          item.style.setProperty('--d', String(d));
        }
        if (!item.dataset) item.dataset = {};
        item.dataset.agentSessionId = s.id;
        item.title = s.dir ? `${s.title}\n${s.dir}` : s.title;
        item.onclick = (e) => {
          if (e.target && e.target.closest && e.target.closest('.tab-close')) return;
          selectSession(s.id);
        };

        const dot = doc.createElement('span');
        dot.className = 'agent-tab-dot' + (s.running ? ' running' : '');
        item.appendChild(dot);

        const titleSpan = doc.createElement('span');
        titleSpan.className = 'tab-title';
        titleSpan.textContent = formatSessionBadge(s) || s.title;
        titleSpan.ondblclick = (e) => {
          e.stopPropagation();
          beginRenameSession(s.id);
        };
        item.appendChild(titleSpan);

        const sessionLoop = getLoopForSession(s.id);
        if (sessionLoop && (sessionLoop.phase === 'maker' || sessionLoop.phase === 'checker')) {
          const loopBadge = doc.createElement('span');
          loopBadge.className = 'tab-loop-badge';
          loopBadge.textContent = `[${sessionLoop.round}/${sessionLoop.maxRounds}]`;
          item.appendChild(loopBadge);
        }

        const closeBtn = doc.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'tab-close';
        closeBtn.title = t('closeTabTitle', 'Close');
        closeBtn.textContent = '×';
        closeBtn.onclick = (e) => {
          e.stopPropagation();
          closeSession(s.id);
        };
        item.appendChild(closeBtn);
        listEl.appendChild(item);
      });

      const addBtn = doc.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'tab-item agent-tab-add';
      addBtn.title = t('agentNewTabTitle', 'New Agent Terminal');
      const addLabel = doc.createElement('span');
      addLabel.className = 'tab-title';
      addLabel.textContent = t('agentNewTabShort', '+ New').replace(/^\+\s*/, '') || 'New';
      const addPlus = doc.createElement('span');
      addPlus.className = 'agent-tab-plus';
      addPlus.textContent = '+';
      addBtn.appendChild(addLabel);
      addBtn.appendChild(addPlus);
      addBtn.onclick = () => showLauncher(rootEl);
      listEl.appendChild(addBtn);
    }

    return {
      openPane,
      showLauncher,
      hideLauncher,
      startSession,
      selectSession,
      closeSession,
      closeOtherSessions,
      sleepSession,
      renameSession,
      beginRenameSession,
      openOrReviveById,
      relayToSession,
      sendToSession,
      sendTextToActive,
      readActiveOutput,
      getLatestMermaid,
      getLatestMermaids,
      syncTheme,
      fitActive,
      renderRightTabs,
      getSessionsMeta,
      getSessionById,
      hasRunningSession,
      getActiveSession,
      resolvePreferredAgentPreset,
      ensureAvailablePresets,
      waitForSessionReady,
      startLoop,
      stopLoop,
      updateLoopInstructions,
      getLoopsMeta,
      getLoopForSession,
      trimIdleMemory
    };
  }

  /**
   * Connects the terminal controller and autonomous loop engine to editor tabs,
   * selection tracking, context menus, and header toolbar controls while keeping
   * app.js free of harness orchestration state.
   */
  function createWorkspaceBridge(deps) {
    const cfg = deps || {};
    const doc = cfg.doc || (typeof document !== 'undefined' ? document : null);
    const win = cfg.win || global;
    const t = typeof cfg.t === 'function' ? cfg.t : ((_, fb) => fb || '');

    let lastEditorSelection = { start: 0, end: 0, text: '', tabId: null };
    const pendingLoopNoteSyncs = new Map();
    let liveLoopSyncTimer = null;
    let agentContextMenuTargetId = null;

    function toast(msg, ms) {
      if (msg && typeof cfg.showToast === 'function') cfg.showToast(msg, ms || 3500);
    }

    function getCtrl() {
      return typeof cfg.getController === 'function' ? cfg.getController() : null;
    }

    function ensureCtrl() {
      return typeof cfg.ensureController === 'function' ? cfg.ensureController() : getCtrl();
    }

    function getById(id) {
      return (doc && typeof doc.getElementById === 'function') ? doc.getElementById(id) : null;
    }

    function notifyMessage(msg, ms, opts) {
      if (typeof cfg.showMessage === 'function') {
        cfg.showMessage(msg, ms, opts);
      }
    }

    function captureEditorSelection() {
      const ed = cfg.editorEl;
      if (!ed) return lastEditorSelection;
      const start = typeof ed.selectionStart === 'number' ? ed.selectionStart : 0;
      const end = typeof ed.selectionEnd === 'number' ? ed.selectionEnd : start;
      const tab = typeof cfg.getActiveTab === 'function' ? cfg.getActiveTab() : null;
      const tabId = tab ? tab.id : null;
      // Zero-copy fast path: never read ed.value when there is no selected range.
      if (end <= start) {
        lastEditorSelection = { start, end, text: '', tabId };
        return lastEditorSelection;
      }
      const val = ed.value || '';
      lastEditorSelection = {
        start,
        end,
        text: val.slice(start, end),
        tabId
      };
      return lastEditorSelection;
    }

    function getLeftNoteSelectionOrLine() {
      const ed = cfg.editorEl;
      if (!ed) return '';
      const start = ed.selectionStart || 0;
      const end = ed.selectionEnd || 0;
      const val = ed.value || '';
      if (end > start) return val.slice(start, end);
      const curTab = typeof cfg.getActiveTab === 'function' ? cfg.getActiveTab() : null;
      const curTabId = curTab ? curTab.id : null;
      if (lastEditorSelection && lastEditorSelection.tabId === curTabId && lastEditorSelection.end > lastEditorSelection.start && lastEditorSelection.text) {
        return lastEditorSelection.text;
      }
      const useStart = (lastEditorSelection && lastEditorSelection.tabId === curTabId) ? lastEditorSelection.start : start;
      const lineStart = val.lastIndexOf('\n', Math.max(0, useStart - 1)) + 1;
      let lineEnd = val.indexOf('\n', useStart);
      if (lineEnd < 0) lineEnd = val.length;
      return val.slice(lineStart, lineEnd);
    }

    function insertTextIntoLeftNote(text) {
      const ed = cfg.editorEl;
      if (!ed || !text) return;
      const start = ed.selectionStart || 0;
      const end = ed.selectionEnd || 0;
      const prefix = start > 0 && ed.value[start - 1] !== '\n' ? '\n' : '';
      const payload = prefix + text + '\n';
      if (typeof ed.focus === 'function') ed.focus();
      if (typeof ed.setRangeText === 'function') {
        ed.setRangeText(payload, start, end, 'end');
      } else {
        const v = ed.value || '';
        ed.value = v.slice(0, start) + payload + v.slice(end);
      }
      if (typeof ed.dispatchEvent === 'function' && typeof win.Event === 'function') {
        ed.dispatchEvent(new win.Event('input', { bubbles: true }));
      }
      if (typeof cfg.focusPrimaryEditor === 'function') cfg.focusPrimaryEditor();
    }

    function parseSelectedHarnessBlock() {
      const ed = cfg.editorEl;
      const text = ed ? (ed.value || '') : '';
      const sel = captureEditorSelection();
      const offset = sel && typeof sel.start === 'number' ? sel.start : (ed ? ed.selectionStart || 0 : 0);
      let block = parseHarnessBlock(text, offset);
      if (block && block.kind === 'heading') return block;
      if (block && block.kind === 'task') {
        block.replaceStart = block.blockStart;
        block.replaceEnd = block.blockEnd;
        return block;
      }
      if (sel && sel.end > sel.start && sel.text) {
        const parsedSel = parseHarnessBlock(sel.text, 0);
        if (parsedSel && parsedSel.kind === 'heading') {
          parsedSel.replaceStart = sel.start;
          parsedSel.replaceEnd = sel.end;
          return parsedSel;
        }
        const selLines = sel.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        if (selLines.length > 0) {
          return {
            kind: 'selection',
            title: selLines[0].replace(/^#{1,3}\s+/, '').replace(/^[-*]\s+\[[ xX]\]\s+/, '').trim(),
            criteria: selLines.slice(1).map((l) => l.replace(/^[-*]\s+/, '').trim()).filter(Boolean),
            failedMemory: [],
            replaceStart: sel.start,
            replaceEnd: sel.end
          };
        }
      }
      const lineText = String(getLeftNoteSelectionOrLine() || '').trim();
      if (lineText && !/^<!--/.test(lineText) && !/^---+$/.test(lineText)) {
        const lineStart = text.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
        const nextNl = text.indexOf('\n', offset);
        const lineEnd = nextNl >= 0 ? nextNl : text.length;
        return {
          kind: 'selection',
          title: lineText.replace(/^#{1,3}\s+/, '').replace(/^[-*]\s+\[[ xX]\]\s+/, '').trim(),
          criteria: [],
          failedMemory: [],
          replaceStart: lineStart,
          replaceEnd: lineEnd
        };
      }
      return null;
    }

    function promoteBlockToHarnessInNote(tab, block) {
      if (!block || block.kind === 'heading') return block;
      const ed = cfg.editorEl;
      if (!tab || !ed) return block;
      const src = ed.value || '';
      const nl = src.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
      const lang = typeof cfg.getLanguage === 'function' ? cfg.getLanguage() : 'ja';
      const isEn = !!block.isEnglish || lang === 'en';
      const title = stripPtyBadgeFromTitle(block.title || 'Task') || 'Task';
      const criteria = Array.isArray(block.criteria) ? block.criteria.filter(Boolean) : [];
      const lines = [`## [ ] ${title}`];
      if (criteria.length > 0) {
        lines.push(isEn ? '- Criteria:' : '- 条件・評価軸:');
        for (let i = 0; i < criteria.length; i++) lines.push(`  - ${criteria[i]}`);
      }
      lines.push(
        isEn ? '- Gate: auto' : '- ゲート(検証): 自動',
        isEn ? '- Setup: Maker[auto] ⇄ Checker[cross-model auto] / Env: `workspace` / Max: 1/3 rounds' : '- 体制: 実装[自動] ⇄ 検収[別モデル自動] / 環境: `作業フォルダ` / 上限: 1/3回',
        isEn ? '- Failed Memory: none' : '- 失敗記憶: なし',
        isEn ? '- Status: starting' : '- 進捗: 準備中',
        '---'
      );
      const snippet = lines.join(nl);
      const hasRange = typeof block.replaceStart === 'number' && typeof block.replaceEnd === 'number' &&
        block.replaceStart >= 0 && block.replaceEnd >= block.replaceStart && block.replaceEnd <= src.length;
      const rStart = hasRange ? block.replaceStart : src.length;
      const rEnd = hasRange ? block.replaceEnd : src.length;
      const prefix = (!hasRange && src.length > 0 && !src.endsWith('\n')) ? (nl + nl) : '';
      const suffix = (rEnd < src.length && src[rEnd] !== '\n' && src[rEnd] !== '\r') ? nl : '';
      const nextText = src.slice(0, rStart) + prefix + snippet + suffix + src.slice(rEnd);
      const res = {
        text: nextText,
        replaceStart: rStart,
        replaceEnd: rEnd,
        delta: nextText.length - src.length
      };
      applySurgicalTextareaUpdate(ed, res);
      if (typeof cfg.onTabTextReplaced === 'function') {
        const curActiveId = typeof cfg.getActiveTabId === 'function' ? cfg.getActiveTabId() : null;
        cfg.onTabTextReplaced(tab, res, !curActiveId || tab.id === curActiveId, false);
      }
      return parseHarnessBlock(ed.value || '', rStart + prefix.length, { title }) || Object.assign({}, block, { heading: `## [ ] ${title}`, kind: 'heading' });
    }

    function findMatchingActiveLoop(block, tab) {
      const ctrl = getCtrl();
      if (!ctrl || typeof ctrl.getLoopsMeta !== 'function') return null;
      const all = ctrl.getLoopsMeta().filter((l) => l.phase === 'maker' || l.phase === 'checker');
      if (all.length === 0) return null;
      const targetTab = tab || (typeof cfg.getActiveTab === 'function' ? cfg.getActiveTab() : null);
      const tabId = targetTab ? targetTab.id : null;
      const tabPath = targetTab ? targetTab.path : '';
      if (block) {
        const exact = all.find((l) =>
          ((tabId && l.noteTabId === tabId) || (tabPath && l.notePath === tabPath)) &&
          ((block.title && l.title === block.title) || (block.heading && l.heading === block.heading))
        );
        if (exact) return exact;
        const bMaker = block.makerId || block.makerSessionId;
        if (bMaker) {
          const byMaker = all.find((l) => l.makerSessionId === bMaker || l.checkerSessionId === bMaker);
          if (byMaker) return byMaker;
        }
      }
      return all.find((l) => (tabId && l.noteTabId === tabId) || (tabPath && l.notePath === tabPath)) || null;
    }

    function applySurgicalTextareaUpdate(ta, res) {
      if (!ta || !res) return;
      const prevVal = ta.value || '';
      if (prevVal === res.text) return;
      const prevStart = typeof ta.selectionStart === 'number' ? ta.selectionStart : 0;
      const prevEnd = typeof ta.selectionEnd === 'number' ? ta.selectionEnd : prevStart;
      const prevScrollTop = ta.scrollTop || 0;
      const delta = Number(res.delta || 0);
      const replaceEnd = Number(res.replaceEnd || 0);
      const newStart = prevStart >= replaceEnd ? Math.max(0, prevStart + delta) : prevStart;
      const newEnd = prevEnd >= replaceEnd ? Math.max(0, prevEnd + delta) : prevEnd;
      ta.value = res.text;
      if (typeof ta.setSelectionRange === 'function') {
        ta.setSelectionRange(
          Math.min(res.text.length, newStart),
          Math.min(res.text.length, newEnd)
        );
      }
      ta.scrollTop = prevScrollTop;
    }

    function applyTabMetadataEdit(tab, hint, updates) {
      if (!tab) return false;
      const ed = cfg.editorEl;
      const edSec = cfg.editorSecondary;
      const curActiveId = typeof cfg.getActiveTabId === 'function' ? cfg.getActiveTabId() : null;
      const curSecId = typeof cfg.getSecondaryTabId === 'function' ? cfg.getSecondaryTabId() : null;
      const isPrimary = !!(ed && tab.id === curActiveId);
      const isSecondary = !!(edSec && typeof cfg.isSplitEditor === 'function' && cfg.isSplitEditor() && tab.id === curSecId);
      let srcText = tab.content || '';
      if (isPrimary) srcText = ed.value || '';
      else if (isSecondary) srcText = edSec.value || '';

      const res = applyHarnessMetadataUpdate(srcText, hint, updates);
      if (!res || (!res.found && !res.appended) || res.text === srcText) return false;

      if (isPrimary) applySurgicalTextareaUpdate(ed, res);
      if (isSecondary) applySurgicalTextareaUpdate(edSec, res);
      if (typeof cfg.onTabTextReplaced === 'function') {
        cfg.onTabTextReplaced(tab, res, isPrimary, isSecondary);
      }
      return true;
    }

    async function openNoteForLoopJump(loop) {
      if (!loop) return;
      const allTabs = typeof cfg.getTabs === 'function' ? cfg.getTabs() : [];
      let tab = (loop.noteTabId && typeof cfg.getTab === 'function') ? cfg.getTab(loop.noteTabId) : null;
      if (!tab && loop.notePath && Array.isArray(allTabs)) {
        tab = allTabs.find((tb) => tb.path === loop.notePath) || null;
      }
      if (!tab && loop.notePath && typeof cfg.openPathInTab === 'function') {
        try {
          tab = await cfg.openPathInTab(loop.notePath);
        } catch (_) {}
      }
      if (!tab) return;
      const curActiveId = typeof cfg.getActiveTabId === 'function' ? cfg.getActiveTabId() : null;
      if (tab.id !== curActiveId && typeof cfg.selectTab === 'function') {
        cfg.selectTab(tab.id);
      }
      if (typeof cfg.ensurePrimaryEditorVisible === 'function') {
        await cfg.ensurePrimaryEditorVisible();
      }
      const ed = cfg.editorEl;
      if (!ed) return;
      const block = parseHarnessBlock(ed.value || '', 0, { makerId: loop.makerSessionId, title: loop.title });
      const jumpOffset = block && typeof block.blockStart === 'number' ? block.blockStart : 0;
      if (typeof ed.focus === 'function') ed.focus();
      if (typeof ed.setSelectionRange === 'function') {
        ed.setSelectionRange(jumpOffset, jumpOffset);
      }
      const before = (ed.value || '').slice(0, jumpOffset);
      const lineNum = before.split(/\r?\n/).length - 1;
      const cs = win.getComputedStyle ? win.getComputedStyle(ed) : null;
      const lh = cs ? (parseFloat(cs.lineHeight) || 22) : 22;
      ed.scrollTop = Math.max(0, lineNum * lh - 60);
      if (typeof cfg.focusPrimaryEditor === 'function') cfg.focusPrimaryEditor();
    }

    async function syncHarnessLoopToNote(loop) {
      if (!loop) return;
      if (typeof cfg.getIsComposing === 'function' && cfg.getIsComposing()) {
        pendingLoopNoteSyncs.set(loop.id, loop);
        return;
      }
      const updates = {
        isEnglish: !!loop.isEnglish,
        gateCmd: loop.gateCmd || '',
        makerId: loop.makerSessionId || '',
        checkerId: loop.checkerSessionId || '',
        isolated: !!loop.worktreePath,
        round: loop.round || 1,
        maxRounds: loop.maxRounds || 3,
        failedMemory: Array.isArray(loop.failedMemory) ? loop.failedMemory : [],
        statusText: loop.statusText || '',
        checked: !!loop.checked,
        appendIfMissing: true,
        title: loop.title
      };
      const hint = { makerId: loop.makerSessionId, title: loop.title };

      const allTabs = typeof cfg.getTabs === 'function' ? cfg.getTabs() : [];
      let tab = (loop.noteTabId && typeof cfg.getTab === 'function') ? cfg.getTab(loop.noteTabId) : null;
      if (!tab && loop.notePath && Array.isArray(allTabs)) {
        tab = allTabs.find((tb) => tb.path === loop.notePath) || null;
      }
      if (tab) {
        applyTabMetadataEdit(tab, hint, updates);
        return;
      }

      const be = win.backend;
      if (loop.notePath && be && typeof be.readFileByPath === 'function' && typeof be.saveFile === 'function') {
        try {
          const fileRes = await be.readFileByPath(loop.notePath);
          if (!fileRes || typeof fileRes.content !== 'string') return;
          const res = applyHarnessMetadataUpdate(fileRes.content, hint, updates);
          if (!res || (!res.found && !res.appended) || res.text === fileRes.content) return;
          await be.saveFile(loop.notePath, res.text, fileRes.encoding || 'UTF-8');
        } catch (_) {}
      }
    }

    function flushPendingLoopNoteSyncs() {
      if ((typeof cfg.getIsComposing === 'function' && cfg.getIsComposing()) || pendingLoopNoteSyncs.size === 0) return;
      const queued = Array.from(pendingLoopNoteSyncs.values());
      pendingLoopNoteSyncs.clear();
      for (let i = 0; i < queued.length; i++) {
        syncHarnessLoopToNote(queued[i]);
      }
    }

    function scheduleLiveLoopInstructionSync(tab) {
      const ctrl = getCtrl();
      if (!tab || !ctrl || typeof ctrl.getLoopsMeta !== 'function') return;
      const activeLoops = ctrl.getLoopsMeta().filter((l) =>
        (l.phase === 'maker' || l.phase === 'checker') &&
        ((l.noteTabId && l.noteTabId === tab.id) || (l.notePath && l.notePath === tab.path))
      );
      if (activeLoops.length === 0) return;
      clearTimeout(liveLoopSyncTimer);
      liveLoopSyncTimer = setTimeout(() => {
        const curActiveId = typeof cfg.getActiveTabId === 'function' ? cfg.getActiveTabId() : null;
        const content = (tab.id === curActiveId && cfg.editorEl) ? (cfg.editorEl.value || '') : (tab.content || '');
        const c = ensureCtrl();
        if (!c || typeof c.updateLoopInstructions !== 'function') return;
        for (let i = 0; i < activeLoops.length; i++) {
          const l = activeLoops[i];
          const b = parseHarnessBlock(content, 0, { makerId: l.makerSessionId, title: l.title });
          if (!b || b.kind !== 'heading') continue;
          const nextCrit = (b.criteria || []).join('\n');
          const prevCrit = (l.criteria || []).join('\n');
          if (b.title !== l.title || nextCrit !== prevCrit) {
            c.updateLoopInstructions(l.id, b);
          }
        }
      }, 600);
    }

    function handleLoopStateChanged(loop) {
      if (!loop) return;
      syncHarnessLoopToNote(loop);
      if (win.TaskManager) {
        const taskId = `harness-${loop.id}`;
        const role = loop.phase === 'checker' ? 'Checker' : 'Maker';
        const badgeText = loop.stopRequested && (loop.phase === 'maker' || loop.phase === 'checker')
          ? `Stopping ${loop.round}/${loop.maxRounds}`
          : `Loop ${loop.round}/${loop.maxRounds} · ${role}`;
        const onJumpNote = () => { openNoteForLoopJump(loop); };
        const onOpenPane = async () => {
          if (typeof cfg.openAgentPane === 'function') await cfg.openAgentPane();
          const c = ensureCtrl();
          if (!c) return;
          const targetSid = (loop.phase === 'checker' && loop.checkerSessionId) ? loop.checkerSessionId : loop.makerSessionId;
          if (targetSid && c.openOrReviveById) await c.openOrReviveById(targetSid, cfg.secondaryAgentPane);
        };
        const onCancel = () => {
          const c = ensureCtrl();
          if (c && c.stopLoop) c.stopLoop(loop.id, true);
        };
        const snap = win.TaskManager.snapshot ? win.TaskManager.snapshot() : { running: [] };
        const existing = Array.isArray(snap.running) && snap.running.some((r) => r.id === taskId);
        const ensureAdded = () => {
          win.TaskManager.addTask({
            id: taskId,
            type: 'loop',
            agent: `Loop ${loop.round}/${loop.maxRounds}`,
            instruction: loop.title || 'Autonomous Loop',
            badgeText,
            onJumpNote,
            onOpenPane,
            onCancel
          });
        };
        if (!existing && (loop.phase === 'maker' || loop.phase === 'checker')) {
          ensureAdded();
          win.TaskManager.updateTask(taskId, { lastOutput: loop.statusText || '' });
        } else if (loop.phase === 'done' || loop.phase === 'failed' || loop.phase === 'stopped') {
          if (!existing) ensureAdded();
          const status = loop.phase === 'done' ? 'completed' : (loop.phase === 'stopped' ? 'canceled' : 'failed');
          const patch = {
            status,
            agent: `Loop ${loop.round}/${loop.maxRounds}`,
            instruction: loop.title || '',
            lastOutput: loop.statusText || '',
            badgeText,
            onJumpNote,
            onOpenPane
          };
          if (loop.phase === 'failed') patch.error = loop.statusText || 'Failed';
          win.TaskManager.updateTask(taskId, patch);
        } else if (existing) {
          win.TaskManager.updateTask(taskId, {
            agent: `Loop ${loop.round}/${loop.maxRounds}`,
            instruction: loop.title || '',
            lastOutput: loop.statusText || '',
            badgeText,
            onJumpNote,
            onOpenPane,
            onCancel
          });
        }
      }
      if (typeof cfg.refreshUi === 'function') cfg.refreshUi();
    }

    function findPtyLinkAtOffset(text, offset) {
      const src = String(text || '');
      const re = /\[[^\]]*\]\(syki-pty:\/\/([A-Za-z0-9_.:-]+)\)|syki-pty:\/\/([A-Za-z0-9_.:-]+)/g;
      const lineStart = src.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
      let lineEnd = src.indexOf('\n', offset);
      if (lineEnd < 0) lineEnd = src.length;
      const line = src.slice(lineStart, lineEnd);
      const localPos = offset - lineStart;
      let m;
      while ((m = re.exec(line)) !== null) {
        if (localPos >= m.index && localPos <= m.index + m[0].length) {
          return m[1] || m[2];
        }
      }
      return null;
    }

    function handleEditorClick(ed, e) {
      if (!ed || !e || !(e.ctrlKey || e.metaKey)) return false;
      const pos = typeof ed.selectionStart === 'number' ? ed.selectionStart : 0;
      const sessionId = findPtyLinkAtOffset(ed.value || '', pos);
      if (!sessionId) return false;
      Promise.resolve().then(async () => {
        if (typeof cfg.openAgentPane === 'function') await cfg.openAgentPane();
        const ctrl = ensureCtrl();
        if (ctrl && ctrl.openOrReviveById) {
          await ctrl.openOrReviveById(sessionId, cfg.secondaryAgentPane);
        }
      });
      return true;
    }

    function syncHarnessContextMenuItems() {
      const startEl = getById('ctx-harness-start');
      const stopEl = getById('ctx-harness-stop');
      if (!startEl && !stopEl) return;
      const ctrl = getCtrl();
      const loops = (ctrl && typeof ctrl.getLoopsMeta === 'function') ? ctrl.getLoopsMeta() : [];
      if (!loops.some((l) => l.phase === 'maker' || l.phase === 'checker')) {
        if (startEl) startEl.classList.remove('hidden');
        if (stopEl) stopEl.classList.add('hidden');
        return;
      }
      const block = parseSelectedHarnessBlock();
      const activeLoop = findMatchingActiveLoop(block, typeof cfg.getActiveTab === 'function' ? cfg.getActiveTab() : null);
      if (startEl) startEl.classList.toggle('hidden', !!activeLoop);
      if (stopEl) stopEl.classList.toggle('hidden', !activeLoop);
    }

    function syncAgentContextMenuItems(targetSessionId) {
      const copyEl = getById('agent-ctx-copy');
      const pasteEl = getById('agent-ctx-paste');
      const startEl = getById('agent-ctx-loop-start');
      const stopEl = getById('agent-ctx-loop-stop');
      const ctrl = getCtrl();
      const target = (ctrl && ctrl.getSessionById && targetSessionId)
        ? ctrl.getSessionById(targetSessionId)
        : (ctrl && ctrl.getActiveSession ? ctrl.getActiveSession() : null);
      const act = ctrl && ctrl.getActiveSession ? ctrl.getActiveSession() : null;
      const termSession = (act && (!target || act.id === target.id)) ? act : null;
      const hasSel = !!(termSession && termSession.term && typeof termSession.term.hasSelection === 'function' && termSession.term.hasSelection());
      if (copyEl) copyEl.classList.toggle('disabled', !hasSel);
      if (pasteEl) pasteEl.classList.toggle('disabled', !(target && target.running));
      const loop = (ctrl && ctrl.getLoopForSession && targetSessionId) ? ctrl.getLoopForSession(targetSessionId) : null;
      const running = !!(loop && (loop.phase === 'maker' || loop.phase === 'checker'));
      if (startEl) startEl.classList.toggle('hidden', running);
      if (stopEl) stopEl.classList.toggle('hidden', !running);
    }

    async function resolvePreferredSessionDir(tab) {
      const tTab = tab || (typeof cfg.getActiveTab === 'function' ? cfg.getActiveTab() : null);
      const activePath = tTab ? (tTab.path || '') : '';
      const ctrl = ensureCtrl();
      const act = ctrl && ctrl.getActiveSession ? ctrl.getActiveSession() : null;
      if (act && act.dir) return act.dir;
      const be = win.backend;
      if (be && typeof be.ptySuggestDirs === 'function') {
        try {
          const raw = await be.ptySuggestDirs(activePath);
          const list = JSON.parse(raw || '[]');
          if (Array.isArray(list) && list[0] && list[0].path) return list[0].path;
        } catch (_) {}
      }
      return '';
    }

    async function ensureDefaultLiveSession(ctrl, opts) {
      if (!ctrl) return null;
      const meta = ctrl.getSessionsMeta ? ctrl.getSessionsMeta() : [];
      const live = meta.find((s) => s.running);
      if (live) return { session: live, isNew: false };
      const dir = await resolvePreferredSessionDir(typeof cfg.getActiveTab === 'function' ? cfg.getActiveTab() : null);
      const preset = typeof ctrl.resolvePreferredAgentPreset === 'function'
        ? await ctrl.resolvePreferredAgentPreset()
        : 'cc';
      const created = await ctrl.startSession(preset, dir, { preserveFocus: !!(opts && opts.preserveFocus) });
      return created ? { session: created, isNew: true } : null;
    }

    function updateHeaderUI(isAgentMode) {
      const btnIds = [
        'btn-pty-link-to-left',
        'btn-pty-done-next',
        'btn-pty-sleep',
        'btn-pty-relay',
        'btn-pty-mermaid-preview',
        'btn-pty-copy-to-left',
        'btn-pty-summarize-to-left'
      ];
      for (let i = 0; i < btnIds.length; i++) {
        const b = getById(btnIds[i]);
        if (b) b.classList.toggle('hidden', !isAgentMode);
      }
      const badgeEl = getById('pty-loop-badge');
      const stopBtn = getById('btn-pty-loop-stop');
      if (!isAgentMode) {
        if (badgeEl) badgeEl.classList.add('hidden');
        if (stopBtn) {
          stopBtn.classList.add('hidden');
          stopBtn.classList.remove('stop-pending');
        }
        return;
      }
      const ctrl = getCtrl();
      const act = ctrl && ctrl.getActiveSession ? ctrl.getActiveSession() : null;
      const activeLoop = (ctrl && act && ctrl.getLoopForSession) ? ctrl.getLoopForSession(act.id) : null;
      const runningLoop = activeLoop && (activeLoop.phase === 'maker' || activeLoop.phase === 'checker') ? activeLoop : null;
      if (badgeEl) {
        if (runningLoop) {
          const roleLabel = runningLoop.phase === 'checker' ? 'Checker' : 'Maker';
          badgeEl.textContent = runningLoop.stopRequested
            ? `Stopping ${runningLoop.round}/${runningLoop.maxRounds}`
            : `Loop ${runningLoop.round}/${runningLoop.maxRounds} · ${roleLabel}`;
          badgeEl.title = runningLoop.statusText || badgeEl.textContent;
          badgeEl.classList.remove('hidden');
        } else {
          badgeEl.classList.add('hidden');
          badgeEl.textContent = '';
        }
      }
      if (stopBtn) {
        if (runningLoop) {
          stopBtn.classList.remove('hidden');
          stopBtn.classList.toggle('stop-pending', !!runningLoop.stopRequested);
          stopBtn.title = runningLoop.stopRequested
            ? t('agentLoopStopImmediateTitle', 'Force Interrupt Current Step (ESC + Ctrl+C)')
            : t('agentLoopStopTitle', 'Stop Harness Loop (Click again to interrupt immediately)');
        } else {
          stopBtn.classList.add('hidden');
          stopBtn.classList.remove('stop-pending');
        }
      }
      if (cfg.secondaryPaneTitle) {
        const badge = act ? formatSessionBadge(act) : '';
        cfg.secondaryPaneTitle.textContent = badge || (act ? act.title : t('agentPaneTitle', 'Agent Terminal'));
        cfg.secondaryPaneTitle.title = act && act.dir ? act.dir : cfg.secondaryPaneTitle.textContent;
      }
    }

    function openAgentTabContextMenu(e, positionFn) {
      const menuEl = cfg.agentTabContextMenu;
      if (!menuEl || !e || !e.target || !e.target.closest) return false;
      const inAgentZone = e.target.closest('#tab-index-right, #secondary-pane-header, #secondary-agent-pane');
      if (!inAgentZone) return false;
      const agentTabEl = e.target.closest('.tab-item[data-agent-session-id]');
      const ctrl = ensureCtrl();
      const act = ctrl && ctrl.getActiveSession ? ctrl.getActiveSession() : null;
      agentContextMenuTargetId = (agentTabEl && agentTabEl.dataset.agentSessionId) || (act && act.id) || null;
      syncAgentContextMenuItems(agentContextMenuTargetId);
      if (typeof positionFn === 'function') positionFn(menuEl, e.clientX, e.clientY);
      return true;
    }

    function bindContextMenus() {
      const hideMenus = () => { if (typeof cfg.hideAllContextMenus === 'function') cfg.hideAllContextMenus(); };

      // 1. Agent tab strip context menu
      if (cfg.agentTabContextMenu) {
        const resolveTarget = () => {
          const ctrl = ensureCtrl();
          if (!ctrl) return { ctrl: null, target: null };
          const target = (ctrl.getSessionById && agentContextMenuTargetId)
            ? ctrl.getSessionById(agentContextMenuTargetId)
            : (ctrl.getActiveSession ? ctrl.getActiveSession() : null);
          return { ctrl, target: target || (ctrl.getActiveSession ? ctrl.getActiveSession() : null) };
        };
        const bindAgentCtx = (id, handler) => {
          const el = getById(id);
          if (el) el.onclick = handler;
        };
        bindAgentCtx('agent-ctx-copy', async () => {
          hideMenus();
          const { ctrl, target } = resolveTarget();
          agentContextMenuTargetId = null;
          const act = ctrl && ctrl.getActiveSession ? ctrl.getActiveSession() : null;
          const termSession = (act && (!target || act.id === target.id)) ? act : null;
          if (!termSession || !termSession.term || typeof termSession.term.getSelection !== 'function') return;
          const sel = termSession.term.getSelection();
          if (sel && typeof cfg.copyTextToClipboard === 'function') {
            await cfg.copyTextToClipboard(sel);
          } else if (sel && win && win.navigator && win.navigator.clipboard && typeof win.navigator.clipboard.writeText === 'function') {
            try { await win.navigator.clipboard.writeText(sel); } catch (_) {}
          }
          if (typeof termSession.term.focus === 'function') termSession.term.focus();
        });
        bindAgentCtx('agent-ctx-paste', async () => {
          hideMenus();
          const { ctrl, target } = resolveTarget();
          agentContextMenuTargetId = null;
          if (!ctrl || !target || !target.running) return;
          let text = '';
          if (win && win.navigator && win.navigator.clipboard && typeof win.navigator.clipboard.readText === 'function') {
            try { text = await win.navigator.clipboard.readText(); } catch (_) { text = ''; }
          }
          if (text && typeof ctrl.sendToSession === 'function') {
            ctrl.sendToSession(target.id, text, { submit: false });
          }
          const act = ctrl.getActiveSession ? ctrl.getActiveSession() : null;
          if (act && act.id === target.id && act.term && typeof act.term.focus === 'function') {
            act.term.focus();
          }
        });
        bindAgentCtx('agent-ctx-new', () => {
          hideMenus();
          agentContextMenuTargetId = null;
          const ctrl = ensureCtrl();
          if (ctrl && cfg.secondaryAgentPane) ctrl.showLauncher(cfg.secondaryAgentPane);
        });
        bindAgentCtx('agent-ctx-new-window', () => {
          hideMenus();
          agentContextMenuTargetId = null;
          if (typeof cfg.openNewWindow === 'function') cfg.openNewWindow({ splitAgent: true });
        });
        bindAgentCtx('agent-ctx-rename', () => {
          hideMenus();
          const { ctrl, target } = resolveTarget();
          agentContextMenuTargetId = null;
          if (!ctrl || !target) return;
          if (ctrl.selectSession) ctrl.selectSession(target.id);
          if (ctrl.beginRenameSession) ctrl.beginRenameSession(target.id);
        });
        bindAgentCtx('agent-ctx-link-note', () => {
          hideMenus();
          const { ctrl, target } = resolveTarget();
          agentContextMenuTargetId = null;
          if (!ctrl || !target) return;
          if (ctrl.selectSession) ctrl.selectSession(target.id);
          const btn = getById('btn-pty-link-to-left');
          if (btn) btn.click();
        });
        bindAgentCtx('agent-ctx-done-next', () => {
          hideMenus();
          const { ctrl, target } = resolveTarget();
          agentContextMenuTargetId = null;
          if (!ctrl || !target) return;
          if (ctrl.selectSession) ctrl.selectSession(target.id);
          const btn = getById('btn-pty-done-next');
          if (btn) btn.click();
        });
        bindAgentCtx('agent-ctx-relay', () => {
          hideMenus();
          const { ctrl, target } = resolveTarget();
          agentContextMenuTargetId = null;
          if (!ctrl || !target) return;
          if (ctrl.selectSession) ctrl.selectSession(target.id);
          const btn = getById('btn-pty-relay');
          if (btn) btn.click();
        });
        bindAgentCtx('agent-ctx-loop-start', async () => {
          hideMenus();
          const { ctrl, target } = resolveTarget();
          agentContextMenuTargetId = null;
          if (!ctrl || !ctrl.startLoop) return;
          const tab = typeof cfg.getActiveTab === 'function' ? cfg.getActiveTab() : null;
          let block = parseSelectedHarnessBlock();
          if (!block && cfg.editorEl) {
            block = parseHarnessBlock(cfg.editorEl.value || '', -1);
          }
          if (!block) {
            block = { kind: 'selection', title: getLeftNoteSelectionOrLine() || 'Task', criteria: [] };
          }
          block = promoteBlockToHarnessInNote(tab, block);
          if (typeof cfg.openAgentPane === 'function') await cfg.openAgentPane({ preserveFocus: true, skipLauncher: true });
          await ctrl.startLoop(block, {
            makerSessionId: target ? target.id : '',
            notePath: tab ? tab.path : '',
            noteTabId: tab ? tab.id : '',
            container: cfg.secondaryAgentPane,
            preserveFocus: true
          });
        });
        bindAgentCtx('agent-ctx-loop-stop', () => {
          hideMenus();
          const { ctrl, target } = resolveTarget();
          agentContextMenuTargetId = null;
          if (!ctrl || !target || !ctrl.getLoopForSession || !ctrl.stopLoop) return;
          const loop = ctrl.getLoopForSession(target.id);
          if (loop) ctrl.stopLoop(loop.id, !!loop.stopRequested);
        });
        bindAgentCtx('agent-ctx-review', async () => {
          hideMenus();
          const { ctrl, target } = resolveTarget();
          agentContextMenuTargetId = null;
          if (!ctrl || !target) return;
          const revPreset = pickCrossModelPreset(target.preset);
          const dir = target.dir || await resolvePreferredSessionDir(typeof cfg.getActiveTab === 'function' ? cfg.getActiveTab() : null);
          const be = win.backend;
          const gateCmd = (dir && be && typeof be.ptyDetectGate === 'function')
            ? await be.ptyDetectGate(dir).catch(() => '')
            : '';
          const block = parseSelectedHarnessBlock() || { title: 'Cross-Model Session Review', criteria: [] };
          const sessionsList = ctrl.getSessionsMeta ? ctrl.getSessionsMeta() : [];
          let revSess = sessionsList.find((s) => s.running && s.preset === revPreset && s.id !== target.id);
          if (!revSess) {
            revSess = await ctrl.startSession(revPreset, dir, { label: 'Checker', preserveFocus: true });
          }
          if (!revSess) return;
          const prompt = buildCheckerPrompt(block, gateCmd, '', 1, 1);
          ctrl.sendToSession(revSess.id, prompt, { submit: true, select: true, preserveFocus: true });
        });
        bindAgentCtx('agent-ctx-copy-path', async () => {
          hideMenus();
          const { target } = resolveTarget();
          agentContextMenuTargetId = null;
          if (target && target.dir && typeof cfg.copyTextToClipboard === 'function') {
            await cfg.copyTextToClipboard(target.dir);
            notifyMessage(t('agentPathCopied', 'Working folder path copied'), 3000);
          }
        });
        bindAgentCtx('agent-ctx-reveal-explorer', async () => {
          hideMenus();
          const { target } = resolveTarget();
          agentContextMenuTargetId = null;
          const be = win.backend;
          if (target && target.dir && be && typeof be.showInFileExplorer === 'function') {
            try {
              await be.showInFileExplorer(target.dir);
            } catch (err) {
              notifyMessage((err && err.message) ? err.message : String(err), 3500, { important: true });
            }
          }
        });
        bindAgentCtx('agent-ctx-sleep', async () => {
          hideMenus();
          const { ctrl, target } = resolveTarget();
          agentContextMenuTargetId = null;
          if (!ctrl || !target || !ctrl.sleepSession) return;
          await ctrl.sleepSession(target.id);
          if (typeof cfg.refreshUi === 'function') cfg.refreshUi();
        });
        bindAgentCtx('agent-ctx-close', async () => {
          hideMenus();
          const { ctrl, target } = resolveTarget();
          agentContextMenuTargetId = null;
          if (!ctrl || !target || !ctrl.closeSession) return;
          await ctrl.closeSession(target.id);
          if (typeof cfg.refreshUi === 'function') cfg.refreshUi();
        });
        bindAgentCtx('agent-ctx-close-others', async () => {
          hideMenus();
          const { ctrl, target } = resolveTarget();
          agentContextMenuTargetId = null;
          if (!ctrl || !target || !ctrl.closeOtherSessions) return;
          await ctrl.closeOtherSessions(target.id);
          if (typeof cfg.refreshUi === 'function') cfg.refreshUi();
        });
      }

      // 2. Editor context menu actions
      const bindCtx = (id, handler) => {
        const el = getById(id);
        if (el) el.onclick = handler;
      };
      bindCtx('ctx-harness-template', () => {
        hideMenus();
        const lang = typeof cfg.getLanguage === 'function' ? cfg.getLanguage() : 'en';
        insertTextIntoLeftNote(formatHarnessTemplate(lang));
      });
      bindCtx('ctx-harness-start', async () => {
        hideMenus();
        try {
          const tab = typeof cfg.getActiveTab === 'function' ? cfg.getActiveTab() : null;
          let block = parseSelectedHarnessBlock();
          if (!block) {
            toast(t('agentHarnessNoTask', 'Select a task line or ## [ ] harness block first'));
            return;
          }
          block = promoteBlockToHarnessInNote(tab, block);
          if (typeof cfg.openAgentPane === 'function') await cfg.openAgentPane({ preserveFocus: true, skipLauncher: true });
          const ctrl = ensureCtrl();
          if (!ctrl || !ctrl.startLoop) return;
          const res = await ctrl.startLoop(block, {
            notePath: tab ? tab.path : '',
            noteTabId: tab ? tab.id : '',
            container: cfg.secondaryAgentPane,
            preserveFocus: true
          });
          if (res && res.phase === 'failed' && res.statusText) {
            toast(res.statusText, 5000);
          }
        } catch (err) {
          toast(`Loop start failed: ${err && err.message ? err.message : err}`, 5000);
        }
      });
      bindCtx('ctx-harness-stop', () => {
        hideMenus();
        const block = parseSelectedHarnessBlock();
        const loop = findMatchingActiveLoop(block, typeof cfg.getActiveTab === 'function' ? cfg.getActiveTab() : null);
        const ctrl = ensureCtrl();
        if (loop && ctrl && ctrl.stopLoop) {
          ctrl.stopLoop(loop.id, !!loop.stopRequested);
        }
      });
      bindCtx('ctx-session-dispatch', async () => {
        hideMenus();
        try {
          const text = getLeftNoteSelectionOrLine();
          if (!text || !text.trim()) {
            toast(t('agentDispatchNoText', 'Place cursor on a non-empty line or select text first'));
            return;
          }
          if (typeof cfg.openAgentPane === 'function') await cfg.openAgentPane({ preserveFocus: true, skipLauncher: true });
          const ctrl = ensureCtrl();
          if (!ctrl) return;
          const act = ctrl.getActiveSession ? ctrl.getActiveSession() : null;
          let target = (act && act.running) ? act : null;
          let isNew = false;
          if (!target) {
            const ens = await ensureDefaultLiveSession(ctrl, { preserveFocus: true });
            target = ens ? ens.session : null;
            isNew = !!(ens && ens.isNew);
          }
          if (!target) return;
          if (isNew && typeof ctrl.waitForSessionReady === 'function') {
            await ctrl.waitForSessionReady(target.id);
          }
          ctrl.sendToSession(target.id, text, { submit: true, select: true, preserveFocus: true });
        } catch (err) {
          toast(`Session dispatch failed: ${err && err.message ? err.message : err}`, 5000);
        }
      });
      bindCtx('ctx-session-continue-existing', async () => {
        hideMenus();
        try {
          const block = parseSelectedHarnessBlock() || { title: getLeftNoteSelectionOrLine() || 'Task', criteria: [] };
          const prompt = buildContinuationPrompt(block, false);
          if (typeof cfg.openAgentPane === 'function') await cfg.openAgentPane({ preserveFocus: true, skipLauncher: true });
          const ctrl = ensureCtrl();
          if (!ctrl) return;
          let targetId = block.makerId || block.makerSessionId || '';
          let isNew = false;
          if (targetId && ctrl.openOrReviveById) {
            const ok = await ctrl.openOrReviveById(targetId, cfg.secondaryAgentPane, { preserveFocus: true });
            if (!ok) targetId = '';
          }
          if (!targetId) {
            const act = ctrl.getActiveSession ? ctrl.getActiveSession() : null;
            if (act && act.running) {
              targetId = act.id;
            } else {
              const ens = await ensureDefaultLiveSession(ctrl, { preserveFocus: true });
              targetId = ens && ens.session ? ens.session.id : '';
              isNew = !!(ens && ens.isNew);
            }
          }
          if (targetId) {
            if (isNew && typeof ctrl.waitForSessionReady === 'function') {
              await ctrl.waitForSessionReady(targetId);
            }
            ctrl.sendToSession(targetId, prompt, { submit: true, select: true, preserveFocus: true });
          }
        } catch (err) {
          toast(`Session continue failed: ${err && err.message ? err.message : err}`, 5000);
        }
      });
      bindCtx('ctx-session-continue-new', async () => {
        hideMenus();
        try {
          const tab = typeof cfg.getActiveTab === 'function' ? cfg.getActiveTab() : null;
          const block = parseSelectedHarnessBlock() || { title: getLeftNoteSelectionOrLine() || 'Task', criteria: [] };
          const prompt = buildContinuationPrompt(block, true);
          if (typeof cfg.openAgentPane === 'function') await cfg.openAgentPane({ preserveFocus: true, skipLauncher: true });
          const ctrl = ensureCtrl();
          if (!ctrl) return;
          const act = ctrl.getActiveSession ? ctrl.getActiveSession() : null;
          const preset = (act && act.preset)
            || (typeof ctrl.resolvePreferredAgentPreset === 'function' ? await ctrl.resolvePreferredAgentPreset() : 'cc');
          const dir = (act && act.dir) || await resolvePreferredSessionDir(tab);
          const fresh = await ctrl.startSession(preset, dir, { preserveFocus: true });
          if (!fresh) return;
          if (tab && block && block.kind === 'heading') {
            applyTabMetadataEdit(tab, { makerId: block.makerId, title: block.title }, { makerId: fresh.id });
          }
          if (typeof ctrl.waitForSessionReady === 'function') {
            await ctrl.waitForSessionReady(fresh.id);
          }
          ctrl.sendToSession(fresh.id, prompt, { submit: true, select: true, preserveFocus: true });
        } catch (err) {
          toast(`New session failed: ${err && err.message ? err.message : err}`, 5000);
        }
      });
      bindCtx('ctx-session-review', async () => {
        hideMenus();
        try {
          const tab = typeof cfg.getActiveTab === 'function' ? cfg.getActiveTab() : null;
          const block = parseSelectedHarnessBlock() || { title: getLeftNoteSelectionOrLine() || 'Review Task', criteria: [] };
          if (typeof cfg.openAgentPane === 'function') await cfg.openAgentPane({ preserveFocus: true, skipLauncher: true });
          const ctrl = ensureCtrl();
          if (!ctrl) return;
          const mId = block.makerId || block.makerSessionId;
          const makerSess = (mId && ctrl.getSessionById)
            ? ctrl.getSessionById(mId)
            : (ctrl.getActiveSession ? ctrl.getActiveSession() : null);
          const availPresets = typeof ctrl.ensureAvailablePresets === 'function' ? await ctrl.ensureAvailablePresets() : null;
          const sourcePreset = (makerSess && makerSess.preset)
            || (typeof ctrl.resolvePreferredAgentPreset === 'function' ? await ctrl.resolvePreferredAgentPreset() : 'cc');
          const revPreset = pickCrossModelPreset(sourcePreset, availPresets);
          const dir = (makerSess && makerSess.dir) || await resolvePreferredSessionDir(tab);
          const be = win.backend;
          const gateCmd = (dir && be && typeof be.ptyDetectGate === 'function')
            ? await be.ptyDetectGate(dir).catch(() => '')
            : '';
          const sessionsList = ctrl.getSessionsMeta ? ctrl.getSessionsMeta() : [];
          let revSess = sessionsList.find((s) => s.running && s.preset === revPreset && (!makerSess || s.id !== makerSess.id));
          let isNew = false;
          if (!revSess) {
            revSess = await ctrl.startSession(revPreset, dir, { label: 'Checker', preserveFocus: true });
            isNew = true;
          }
          if (!revSess) return;
          if (tab && block && block.kind === 'heading') {
            applyTabMetadataEdit(tab, { makerId: block.makerId, title: block.title }, {
              makerId: makerSess ? makerSess.id : (block.makerId || ''),
              checkerId: revSess.id
            });
          }
          if (isNew && typeof ctrl.waitForSessionReady === 'function') {
            await ctrl.waitForSessionReady(revSess.id);
          }
          const prompt = buildCheckerPrompt(block, gateCmd, '', 1, 1);
          ctrl.sendToSession(revSess.id, prompt, { submit: true, select: true, preserveFocus: true });
        } catch (err) {
          toast(`Review session failed: ${err && err.message ? err.message : err}`, 5000);
        }
      });
    }

    function bindHeaderAndEditorEvents() {
      const ed = cfg.editorEl;
      if (ed && typeof ed.addEventListener === 'function') {
        const onPassiveSel = () => captureEditorSelection();
        ed.addEventListener('select', onPassiveSel);
        ed.addEventListener('mouseup', onPassiveSel);
        ed.addEventListener('keyup', () => {
          if (typeof cfg.getIsComposing === 'function' && cfg.getIsComposing()) return;
          captureEditorSelection();
        });
      }

      if (doc && typeof doc.addEventListener === 'function') {
        doc.addEventListener('click', async (e) => {
          const a = e.target && e.target.closest ? e.target.closest('a[href^="syki-pty://"]') : null;
          if (!a) return;
          e.preventDefault();
          const id = parsePtyLink(a.getAttribute('href'));
          if (!id) return;
          if (typeof cfg.openAgentPane === 'function') await cfg.openAgentPane();
          const ctrl = ensureCtrl();
          if (ctrl && ctrl.openOrReviveById) {
            await ctrl.openOrReviveById(id, cfg.secondaryAgentPane);
          }
        });
      }

      if (cfg.secondaryPaneTitle && typeof cfg.secondaryPaneTitle.addEventListener === 'function') {
        cfg.secondaryPaneTitle.addEventListener('dblclick', (e) => {
          if (typeof cfg.isSplitAgent === 'function' && !cfg.isSplitAgent()) return;
          const ctrl = ensureCtrl();
          const act = ctrl && ctrl.getActiveSession ? ctrl.getActiveSession() : null;
          if (act && ctrl.beginRenameSession) {
            e.stopPropagation();
            ctrl.beginRenameSession(act.id);
          }
        });
      }

      const keepLeftSelMouseDown = (e) => { if (e && typeof e.preventDefault === 'function') e.preventDefault(); };
      const wireHeaderBtn = (id, keepSel, onClick) => {
        const b = getById(id);
        if (!b) return;
        if (keepSel && typeof b.addEventListener === 'function') {
          b.addEventListener('mousedown', keepLeftSelMouseDown);
        }
        b.onclick = onClick;
      };

      wireHeaderBtn('btn-pty-loop-stop', true, () => {
        const ctrl = ensureCtrl();
        if (!ctrl || !ctrl.getLoopForSession || !ctrl.stopLoop) return;
        const act = ctrl.getActiveSession ? ctrl.getActiveSession() : null;
        const loop = act ? ctrl.getLoopForSession(act.id) : null;
        if (loop && (loop.phase === 'maker' || loop.phase === 'checker')) {
          ctrl.stopLoop(loop.id, !!loop.stopRequested);
        }
      });
      wireHeaderBtn('btn-pty-link-to-left', true, () => {
        const ctrl = ensureCtrl();
        const act = ctrl && ctrl.getActiveSession ? ctrl.getActiveSession() : null;
        if (act) insertTextIntoLeftNote(formatNoteAnchor(act));
      });
      wireHeaderBtn('btn-pty-done-next', true, () => {
        const ctrl = ensureCtrl();
        const act = ctrl && ctrl.getActiveSession ? ctrl.getActiveSession() : null;
        if (act) {
          const out = ctrl.readActiveOutput(40);
          const loopMeta = ctrl.getLoopForSession ? ctrl.getLoopForSession(act.id) : null;
          insertTextIntoLeftNote(formatDoneNextBlock(act, out, loopMeta));
        }
      });
      wireHeaderBtn('btn-pty-sleep', false, () => {
        const ctrl = ensureCtrl();
        const act = ctrl && ctrl.getActiveSession ? ctrl.getActiveSession() : null;
        if (act && ctrl.sleepSession) ctrl.sleepSession(act.id);
      });
      wireHeaderBtn('btn-pty-relay', true, () => {
        const ctrl = ensureCtrl();
        if (!ctrl) return;
        const act = ctrl.getActiveSession ? ctrl.getActiveSession() : null;
        const others = (ctrl.getSessionsMeta ? ctrl.getSessionsMeta() : []).filter((s) => s.running && (!act || s.id !== act.id));
        if (others.length === 0) {
          notifyMessage(t('agentRelayNoTarget', 'Open another agent session to relay output'), 3000);
          return;
        }
        const out = ctrl.readActiveOutput(60);
        if (!out) return;
        const target = others[0];
        if (target) ctrl.relayToSession(target.id, out);
      });
      wireHeaderBtn('btn-pty-mermaid-preview', false, () => {
        if (typeof cfg.renderMermaidOverlay === 'function') cfg.renderMermaidOverlay();
      });
      wireHeaderBtn('btn-pty-copy-to-left', true, () => {
        const ctrl = ensureCtrl();
        const out = ctrl ? ctrl.readActiveOutput(80) : '';
        if (out) insertTextIntoLeftNote(out);
      });
      wireHeaderBtn('btn-pty-summarize-to-left', true, () => {
        const ctrl = ensureCtrl();
        const out = ctrl ? ctrl.readActiveOutput(120) : '';
        if (out) insertTextIntoLeftNote('```\n' + out + '\n```');
      });
    }

    function listLoops() {
      const ctrl = getCtrl();
      return (ctrl && typeof ctrl.getLoopsMeta === 'function') ? ctrl.getLoopsMeta() : [];
    }

    async function startHarnessLoop(opts) {
      const o = opts || {};
      const targetTab = o.tabId
        ? (typeof cfg.getTab === 'function' ? cfg.getTab(o.tabId) : null)
        : (typeof cfg.getActiveTab === 'function' ? cfg.getActiveTab() : null);
      if (!targetTab) {
        throw new Error(o.tabId ? `no such tab: ${o.tabId}` : 'no active tab');
      }
      const curActiveId = typeof cfg.getActiveTabId === 'function' ? cfg.getActiveTabId() : null;
      const isPrimary = !!(cfg.editorEl && targetTab.id === curActiveId);
      const srcText = isPrimary ? (cfg.editorEl.value || '') : (targetTab.content || '');
      let offset = isPrimary ? (cfg.editorEl.selectionStart || 0) : 0;
      if (o.line && Number(o.line) > 0) {
        const targetLine = Number(o.line);
        let curLine = 1;
        offset = 0;
        for (let i = 0; i < srcText.length && curLine < targetLine; i++) {
          if (srcText[i] === '\n') curLine++;
          offset = i + 1;
        }
      }
      const hint = o.title ? { title: String(o.title) } : undefined;
      let block = parseHarnessBlock(srcText, offset, hint);
      if (!block) {
        throw new Error('no harness block found in note');
      }
      if (block.kind !== 'heading' && isPrimary) {
        block = promoteBlockToHarnessInNote(targetTab, block);
      }
      if (typeof cfg.openAgentPane === 'function') {
        await cfg.openAgentPane({ preserveFocus: true, skipLauncher: true });
      }
      const ctrl = ensureCtrl();
      if (!ctrl || typeof ctrl.startLoop !== 'function') {
        throw new Error('terminal controller unavailable');
      }
      return await ctrl.startLoop(block, {
        notePath: targetTab.path || '',
        noteTabId: targetTab.id,
        container: cfg.secondaryAgentPane,
        preserveFocus: true
      });
    }

    function stopHarnessLoop(loopId, force) {
      const ctrl = getCtrl();
      if (!ctrl || typeof ctrl.stopLoop !== 'function') {
        return { ok: false, id: loopId, stopped: false };
      }
      const stopped = ctrl.stopLoop(loopId, !!force);
      return { ok: true, id: loopId, stopped: !!stopped };
    }

    function trimIdleMemory() {
      clearTimeout(liveLoopSyncTimer);
      liveLoopSyncTimer = null;
      pendingLoopNoteSyncs.clear();
      lastEditorSelection = { start: 0, end: 0, text: '', tabId: null };
      const ctrl = getCtrl();
      if (ctrl && typeof ctrl.trimIdleMemory === 'function') {
        ctrl.trimIdleMemory();
      }
    }

    bindContextMenus();
    bindHeaderAndEditorEvents();

    return {
      captureEditorSelection,
      getLeftNoteSelectionOrLine,
      insertTextIntoLeftNote,
      handleLoopStateChanged,
      syncHarnessLoopToNote,
      flushPendingLoopNoteSyncs,
      scheduleLiveLoopInstructionSync,
      handleEditorClick,
      syncHarnessContextMenuItems,
      openAgentTabContextMenu,
      updateHeaderUI,
      listLoops,
      startHarnessLoop,
      stopHarnessLoop,
      trimIdleMemory
    };
  }

  const api = {
    DEFAULT_PRESETS,
    bracketedPaste,
    encodeUtf8Base64,
    decodeUtf8Base64ToBytes,
    decodeUtf8Base64ToString,
    stripAnsi,
    extractRecentOutput,
    extractMermaidBlocks,
    extractLastMermaidBlock,
    readXtermTheme,
    parsePtyLink,
    formatSessionBadge,
    formatNoteAnchor,
    formatDoneNextBlock,
    pickCrossModelPreset,
    formatHarnessTemplate,
    parseHarnessBlock,
    applyHarnessMetadataUpdate,
    buildMakerPrompt,
    buildCheckerPrompt,
    buildContinuationPrompt,
    parseLoopSignal,
    isTerminalElement,
    mergeRecentDirs,
    createController,
    createWorkspaceBridge
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.TerminalPane = api;
})(typeof window !== 'undefined' ? window : globalThis);
