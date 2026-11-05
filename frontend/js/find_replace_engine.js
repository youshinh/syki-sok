// Pure find, regex building, unicode boundary matching, and replacement expansion engine.
(function (global) {
  'use strict';

  function buildFindRegex(query, useRegex, caseSensitive) {
    const pattern = useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const flags = 'gm' + (caseSensitive ? '' : 'i');
    try {
      return new RegExp(pattern, flags + 'u');
    } catch (e) {
      return new RegExp(pattern, flags);
    }
  }

  function isWholeWordMatch(text, start, end) {
    if (end <= start) return false;
    const isWord = (cp) => {
      if (cp === undefined) return false;
      if (cp < 128) return (cp >= 97 && cp <= 122) || (cp >= 65 && cp <= 90) || (cp >= 48 && cp <= 57) || cp === 95;
      return /[\p{L}\p{N}\p{M}_]/u.test(String.fromCodePoint(cp));
    };
    const endingAt = (i) => {
      if (i <= 0) return undefined;
      const unit = text.charCodeAt(i - 1);
      return (unit & 0xFC00) === 0xDC00 && i >= 2 && (text.charCodeAt(i - 2) & 0xFC00) === 0xD800 ? text.codePointAt(i - 2) : unit;
    };
    return !(isWord(endingAt(start)) && isWord(text.codePointAt(start))) && !(isWord(endingAt(end)) && isWord(text.codePointAt(end)));
  }

  function scanFindMatches(text, regex, wholeWord, onMatch) {
    const stepPast = (i) => ((text.charCodeAt(i) & 0xFC00) === 0xD800 && (text.charCodeAt(i + 1) & 0xFC00) === 0xDC00 ? i + 2 : i + 1);
    let m;
    while ((m = regex.exec(text)) !== null) {
      if (wholeWord && !isWholeWordMatch(text, m.index, m.index + m[0].length)) {
        regex.lastIndex = stepPast(m.index);
        continue;
      }
      onMatch(m);
      if (m[0].length === 0) regex.lastIndex = stepPast(m.index);
    }
  }

  function expandReplacement(tpl, m, text) {
    return tpl.replace(/\$(\$|&|`|'|\d\d?|<[^>]*>)/g, (all, tok) => {
      if (tok === '$') return '$';
      if (tok === '&') return m[0];
      if (tok === '`') return text.substring(0, m.index);
      if (tok === "'") return text.substring(m.index + m[0].length);
      if (tok[0] === '<') return m.groups ? (m.groups[tok.slice(1, -1)] || '') : all;
      const captures = m.length - 1;
      const two = parseInt(tok, 10);
      if (tok.length === 2 && two >= 1 && two <= captures) return m[two] || '';
      const one = parseInt(tok[0], 10);
      return one >= 1 && one <= captures ? (m[one] || '') + tok.slice(1) : all;
    });
  }

  const api = {
    buildFindRegex: buildFindRegex,
    isWholeWordMatch: isWholeWordMatch,
    scanFindMatches: scanFindMatches,
    expandReplacement: expandReplacement
  };

  global.FindReplaceEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
