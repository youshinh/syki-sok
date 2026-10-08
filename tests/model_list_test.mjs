// The model suggestions read from the provider (frontend/js/model_list.js).
import assert from 'assert';
import { createRequire } from 'module';

console.log('=== model list tests ===');
const require = createRequire(import.meta.url);
const M = require('../frontend/js/model_list.js');

// 1. list URLs: Gemini always from the host (a base URL ending in /v1beta must not be doubled), Ollama /api/tags, OpenAI-compatible /v1/models
assert.strictEqual(M.listUrl('https://generativelanguage.googleapis.com/v1beta', 'K'),
  'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=K');
assert.strictEqual(M.listUrl('https://generativelanguage.googleapis.com/', ''),
  'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000');
assert.strictEqual(M.listUrl('http://localhost:11434', ''), 'http://localhost:11434/api/tags');
assert.strictEqual(M.listUrl('http://localhost:11434/v1', ''), 'http://localhost:11434/api/tags');
assert.strictEqual(M.listUrl('https://api.openai.com/v1', 'k'), 'https://api.openai.com/v1/models');
assert.strictEqual(M.listUrl('https://openrouter.ai/api', 'k'), 'https://openrouter.ai/api/v1/models');

// 2. parsing the three answers
const gemini = M.parse({ models: [
  { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.1-flash-lite-image', displayName: 'Nano Banana 2 Lite', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
  { name: 'models/gemini-3.5-transcribe', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-2.5-flash-preview-tts', supportedGenerationMethods: ['generateContent'] }
] });
assert.deepStrictEqual(gemini[0], { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (gemini-2.5-flash)', methods: ['generateContent'] });
assert.deepStrictEqual(M.parse({ data: [{ id: 'gpt-4o' }] }).map(m => m.id), ['gpt-4o']);
assert.deepStrictEqual(M.parse({ models: [{ name: 'bge-m3:latest', details: { parameter_size: '567M' } }] })[0].label, 'bge-m3:latest (567M)');
assert.deepStrictEqual(M.parse(null), []);

// 3. which models fit which field
const ids = (kind) => M.filterFor(kind, gemini).map(m => m.id);
assert.deepStrictEqual(ids('text'), ['gemini-2.5-flash']);
assert.deepStrictEqual(ids('image'), ['gemini-3.1-flash-lite-image']);
assert.deepStrictEqual(ids('embed'), ['gemini-embedding-001']);
assert.deepStrictEqual(ids('voice'), ['gemini-2.5-flash', 'gemini-3.5-transcribe']);
const ollama = M.parse({ models: [{ name: 'qwen2.5:latest' }, { name: 'bge-m3:latest' }, { name: 'nomic-embed-text' }] });
assert.deepStrictEqual(M.filterFor('embed', ollama).map(m => m.id), ['bge-m3:latest', 'nomic-embed-text']);
assert.deepStrictEqual(M.filterFor('text', ollama).map(m => m.id), ['qwen2.5:latest']);

// 4. fetchModels: no Bearer header for Gemini (the key is the ?key= of the URL), Bearer for the others; an HTTP error throws
{
  const calls = [];
  const fake = async (url, opts) => { calls.push({ url, opts }); return { ok: true, json: async () => ({ data: [{ id: 'x' }] }) }; };
  await M.fetchModels('https://generativelanguage.googleapis.com/v1beta', 'K', fake);
  await M.fetchModels('https://api.openai.com/v1', 'sk', fake);
  assert.strictEqual(calls[0].opts.headers.Authorization, undefined);
  assert.strictEqual(calls[1].opts.headers.Authorization, 'Bearer sk');
  await assert.rejects(M.fetchModels('https://api.openai.com/v1', 'sk', async () => ({ ok: false, status: 401, statusText: 'Unauthorized' })), /HTTP 401/);
}

console.log('model list tests passed');
