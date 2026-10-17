// Mermaid from a text: one diagram by default, several (2 to 4, each a meaningful unit) when the text holds several things. The answer with
// several titled diagrams must reach the note untouched.
import assert from 'assert';
import fs from 'fs';
import vm from 'vm';

console.log('=== mermaid: several diagrams ===');
const app = fs.readFileSync(new URL('../frontend/js/app.js', import.meta.url), 'utf8');

const promptMatch = /const DEGRAM_MERMAID_SYSTEM_PROMPT = `([\s\S]*?)`;\r?\n/.exec(app);
assert.ok(promptMatch, 'the system prompt exists');
const prompt = promptMatch[1];

assert.ok(/HOW MANY DIAGRAMS \(one is the default/.test(prompt), 'one stays the default');
assert.ok(/ONE diagram when the text is about a single subject/.test(prompt) && /Do not split a cohesive text just to produce more/.test(prompt), 'a cohesive text is not split');
assert.ok(/2 to 4, never more/.test(prompt), 'at most four');
assert.ok(/different kinds of content/.test(prompt) && /several independent flows or scenarios/.test(prompt) && /exceed about 15 nodes/.test(prompt), 'when to split: different kinds, independent flows, a flow that is too large');
assert.ok(/best-fitting diagram type for EACH part/.test(prompt), 'each part gets its own diagram type');
assert.ok(/ONE diagram: only the fenced code block/.test(prompt), 'a single diagram is answered exactly as before');
assert.ok(/"### Title"/.test(prompt) && /language of the text/.test(prompt), 'several diagrams carry a title each, in the text\'s language');
assert.ok(/STRICT SYNTAX SAFETY RULES/.test(prompt) && /NEVER use the reserved word 'end'/.test(prompt), 'the syntax rules are still there');
assert.ok(!/Return ONLY the markdown fenced mermaid code block/.test(prompt), 'the old "only one block" rule is gone');

const request = /const promptPayload = `([^`]*)`/.exec(app.slice(app.indexOf('function convertSelectionToMermaid')));
assert.ok(request && /複数の図に分けてください/.test(request[1]) && /最大4つまで/.test(request[1]) && /図は1つに/.test(request[1]), 'the request says the same');

// the answer: titled blocks pass through the code that cleans an answer
const fn = (re) => { const m = re.exec(app); assert.ok(m); return m[0]; };
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fn(/function stripMarkdownCodeFences\(text, markdownOnly\) \{[\s\S]*?\r?\n  \}\r?\n/) + fn(/function fencesAreNested\(innerLines\) \{[\s\S]*?\r?\n  \}\r?\n/), ctx);
const strip = (t, b) => vm.runInContext('stripMarkdownCodeFences', ctx)(t, b);
const several = '### 受注の流れ\n\n```mermaid\nflowchart TD\n  A["受注"] --> B["出荷"]\n```\n\n### データの関係\n\n```mermaid\nerDiagram\n  CUSTOMER ||--o{ ORDER : places\n```';
assert.strictEqual(strip(several, true), several, 'several titled diagrams are not touched');
const one = '```mermaid\nflowchart TD\n  A["a"] --> B["b"]\n```';
assert.strictEqual(strip(one, true), one, 'one diagram is not touched either');
const twoBare = '```mermaid\nflowchart TD\n  A --> B\n```\n\n```mermaid\nsequenceDiagram\n  A->>B: hi\n```';
assert.strictEqual(strip(twoBare, true), twoBare, 'two blocks without titles are not merged or unwrapped');

// the preview draws every mermaid block of a note (it looks for all of them), so each diagram shows
assert.ok(/querySelectorAll\('pre code\.language-mermaid'\)/.test(app) && /mermaidCodeBlocks\.forEach/.test(app), 'the preview renders every mermaid block');
// an ER diagram with Japanese attribute names is a syntax error in Mermaid: the prompt says where Japanese may go
assert.ok(/8\. In erDiagram, entity names AND attribute names MUST be ASCII words/.test(prompt) && /An attribute name in Japanese is a syntax error/.test(prompt), 'ER names are ASCII, Japanese goes in quotes');
// a diagram that fails to render must not leave Mermaid's error element in the page
assert.ok(/function removeMermaidLeftovers\(id\) \{[\s\S]*?'d' \+ id, id/.test(app), 'the leftover is found by its id (d + id)');
assert.ok(/catch \(err\) \{\s*removeMermaidLeftovers\(id\);\s*container\.innerHTML = '<div class="mermaid-error"/.test(app), 'the preview removes it when a diagram fails');
assert.ok(/removeMermaidLeftovers\(exportId\)/.test(app), 'so does the export');
console.log('mermaid: several diagrams tests passed');
