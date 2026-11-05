const assert = require('assert');
const Engine = require('./find_replace_engine.js');

console.log('=== FindReplaceEngine Tests ===');

// 1. buildFindRegex
const r1 = Engine.buildFindRegex('foo', false, false);
assert.ok(r1.test('Foo'), 'case-insensitive plain');
const r2 = Engine.buildFindRegex('foo', false, true);
assert.ok(!r2.test('Foo'), 'case-sensitive plain');

// 2. isWholeWordMatch
const text = 'これは日本語です。 a 日本語 b 😀';
assert.ok(Engine.isWholeWordMatch(text, 12, 15), 'standalone Japanese word');
assert.ok(!Engine.isWholeWordMatch(text, 3, 6), 'embedded Japanese word');

// 3. scanFindMatches
const matches = [];
const r3 = Engine.buildFindRegex('日本語', false, false);
Engine.scanFindMatches(text, r3, true, (m) => matches.push(m.index));
assert.deepStrictEqual(matches, [12], 'only matches whole word');

// 4. expandReplacement
const m = /(\w+)@(\w+)/.exec('mail bob@host now');
assert.strictEqual(Engine.expandReplacement('$2:$1', m, 'mail bob@host now'), 'host:bob');
assert.strictEqual(Engine.expandReplacement('[$&]', m, 'mail bob@host now'), '[bob@host]');

console.log('All FindReplaceEngine tests passed.');
