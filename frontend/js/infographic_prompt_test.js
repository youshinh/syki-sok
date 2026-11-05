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

console.log('All InfographicPrompt tests passed.');
