const assert = require('assert');
const InfoPrompt = require('./infographic_prompt.js');

console.log('=== InfographicPrompt Tests ===');

// 1. Style Prompts
assert.ok(InfoPrompt.getInfographicStylePrompt('material').includes('Material Design 3'));
assert.ok(InfoPrompt.getInfographicStylePrompt('sketchy').includes('Whiteboard'));
assert.ok(InfoPrompt.getInfographicStylePrompt('terminal').includes('terminal'));
assert.ok(InfoPrompt.getInfographicStylePrompt('ink').includes('sumi-ink'));

// 2. Flow direction extraction
assert.strictEqual(InfoPrompt.extractFlowDirectionText('flowchart LR\nA-->B'), 'from left to right');
assert.strictEqual(InfoPrompt.extractFlowDirectionText('graph TD\nA-->B'), 'from top to bottom');
assert.strictEqual(InfoPrompt.extractFlowDirectionText('classDiagram\nclass A'), 'with a clear directional flow');

// 3. Title derivation
assert.strictEqual(InfoPrompt.deriveDiagramTitle('title: System Overview\nflowchart TD'), 'System Overview');
assert.strictEqual(InfoPrompt.deriveDiagramTitle('flowchart TD', '# Note Heading\nsome text'), 'Note Heading');
assert.strictEqual(InfoPrompt.deriveDiagramTitle('flowchart TD', ''), 'プロセス構造図');

// 4. Prompt builder
const prompt = InfoPrompt.buildInfographicImagePrompt('flowchart TD\nA-->B', '# Arch', 'material');
assert.ok(prompt.includes('Arch'));
assert.ok(prompt.includes('from top to bottom'));
assert.ok(prompt.includes('Material Design 3'));

// 5. Dedicated image model check
assert.strictEqual(InfoPrompt.isDedicatedImageModel('imagen-3.0-generate-002'), true);
assert.strictEqual(InfoPrompt.isDedicatedImageModel('nano-banana-image'), true);
assert.strictEqual(InfoPrompt.isDedicatedImageModel('gemini-1.5-pro'), false);

// 6. Input classification (mermaid / infographic / free)
assert.strictEqual(InfoPrompt.classifyImageInput('flowchart LR\n  A --> B'), 'mermaid');
assert.strictEqual(InfoPrompt.classifyImageInput('```mermaid\nsequenceDiagram\n  A->>B: Hi\n```'), 'mermaid');
assert.strictEqual(InfoPrompt.classifyImageInput('- 項目1\n- 項目2'), 'infographic');
assert.strictEqual(InfoPrompt.classifyImageInput('入力 → 処理 → 出力'), 'infographic');
assert.strictEqual(InfoPrompt.classifyImageInput('認証の仕組み'), 'infographic');
assert.strictEqual(InfoPrompt.classifyImageInput('夕暮れの海辺のカフェの写真'), 'free');
assert.strictEqual(InfoPrompt.classifyImageInput('水彩画風の柴犬のイラスト'), 'free');

// 7. Unified buildImagePrompt
const mRes = InfoPrompt.buildImagePrompt('```mermaid\nflowchart TD\nA-->B\n```', '# Title', 'material');
assert.strictEqual(mRes.kind, 'mermaid');
assert.ok(mRes.prompt.includes('DIAGRAM FIDELITY'));

const iRes = InfoPrompt.buildImagePrompt('- Step 1\n- Step 2', '# Plan', 'sketchy');
assert.strictEqual(iRes.kind, 'infographic');
assert.ok(iRes.prompt.includes('Whiteboard'));
assert.ok(iRes.prompt.includes('CONTENT FIDELITY'));

const fRes = InfoPrompt.buildImagePrompt('夕暮れの海辺のカフェの写真', '# Note', 'material');
assert.strictEqual(fRes.kind, 'free');
assert.ok(fRes.prompt.includes('夕暮れの海辺のカフェの写真'));
assert.ok(fRes.prompt.includes('Photography direction:'));
assert.ok(fRes.prompt.includes('No unintended text'));

const illusRes = InfoPrompt.buildImagePrompt('水彩画風の柴犬', '# Note', 'material');
assert.strictEqual(illusRes.kind, 'free');
assert.ok(illusRes.prompt.includes('水彩画風の柴犬'));
assert.ok(illusRes.prompt.includes('Illustration direction:'));
assert.ok(illusRes.prompt.includes('paper-and-ink aesthetic'));

console.log('All InfographicPrompt tests passed.');
