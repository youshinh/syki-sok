// syki::sok: the model suggestions of the settings (text, vision, voice, image, embedding), read from the provider so a new model shows up
// without a new release. The <datalist> options written in index.html stay as the offline fallback and are kept after the fetched ones.
//
//  - Pure functions first (no DOM): the list URL of a provider, the parsing of its answer, and which models fit a field.
//  - Not loaded at startup: app.js loads this file on the first focus of a model field. refreshIfStale() then fetches the list once per
//    endpoint and key, silently; refresh() is the same fetch on demand, for the "Fetch Models" button, and it reports failures.
(function (global) {
  'use strict';

  const GOOGLE_HOST = 'generativelanguage.googleapis.com';
  const GOOGLE_BASE = 'https://' + GOOGLE_HOST;

  function isGoogle(baseUrl) {
    return String(baseUrl || '').includes(GOOGLE_HOST);
  }
  function isOllama(baseUrl) {
    return /:11434(\/|$)/.test(String(baseUrl || ''));
  }

  // The URL that lists the models of baseUrl. Gemini wants the host alone (a base URL of the settings may end in /v1beta), Ollama has
  // /api/tags, and an OpenAI-compatible server has <base>/v1/models (or <base>/models when the base already ends in /v1).
  function listUrl(baseUrl, apiKey) {
    const base = String(baseUrl || '').trim().replace(/\/+$/, '');
    if (isGoogle(base)) {
      return `${GOOGLE_BASE}/v1beta/models?pageSize=1000${apiKey ? `&key=${encodeURIComponent(apiKey)}` : ''}`;
    }
    if (isOllama(base)) return base.replace(/\/(v1|api)$/, '') + '/api/tags';
    if (base.endsWith('/models')) return base;
    return /\/v\d+$/.test(base) ? `${base}/models` : `${base}/v1/models`;
  }

  // [{ id, label, methods }] from the answer of any of the three kinds of server.
  function parse(data) {
    if (!data || typeof data !== 'object') return [];
    if (Array.isArray(data.data)) return data.data.map(m => ({ id: String(m.id || ''), label: '', methods: [] })).filter(m => m.id);
    if (!Array.isArray(data.models)) return [];
    return data.models.map(m => {
      const id = String(m.name || m.id || '').replace(/^models\//, '');
      let label = '';
      if (m.displayName) label = `${m.displayName} (${id})`;
      else if (m.details && m.details.parameter_size) label = `${id} (${m.details.parameter_size})`;
      return { id: id, label: label, methods: Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods : [] };
    }).filter(m => m.id);
  }

  const IMAGE_RE = /image|imagen|banana/i;
  const EMBED_RE = /embed|bge|e5-|minilm/i;
  const NOT_TEXT_RE = /image|imagen|banana|embed|tts|transcribe|native-audio|live|veo|lyria|aqa/i;

  // Whether model m fits the field kind: 'text' (chat and vision), 'voice', 'image' or 'embed'. Gemini says what a model supports; the other
  // servers do not, so their names decide.
  function fits(kind, m) {
    const id = m.id;
    const has = (method) => m.methods.includes(method);
    switch (kind) {
      case 'image': return IMAGE_RE.test(id);
      case 'embed': return has('embedContent') || EMBED_RE.test(id);
      case 'voice': return /transcribe/i.test(id) || fits('text', m);
      default: return !NOT_TEXT_RE.test(id) && !EMBED_RE.test(id) && (m.methods.length === 0 || has('generateContent'));
    }
  }

  function filterFor(kind, models) {
    return models.filter(m => fits(kind, m));
  }

  async function fetchModels(baseUrl, apiKey, fetchImpl) {
    const doFetch = fetchImpl || global.fetch;
    const headers = {};
    if (apiKey && !isGoogle(baseUrl)) headers.Authorization = `Bearer ${apiKey}`;
    const res = await doFetch(listUrl(baseUrl, apiKey), { headers: headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}${res.statusText ? ': ' + res.statusText : ''}`);
    return parse(await res.json());
  }

  // ---- DOM ----

  const fallbacks = new WeakMap(); // datalist -> its options from index.html, as [{ id, label }]
  const loaded = new WeakMap();    // input -> the endpoint+key its list was read for

  function fallbackOf(dl) {
    if (!fallbacks.has(dl)) {
      fallbacks.set(dl, Array.from(dl.querySelectorAll('option')).map(o => ({ id: o.value, label: o.textContent })));
    }
    return fallbacks.get(dl);
  }

  function fill(dl, models) {
    const seen = new Set();
    const all = models.concat(fallbackOf(dl));
    dl.innerHTML = '';
    for (const m of all) {
      if (!m.id || seen.has(m.id)) continue;
      seen.add(m.id);
      const opt = dl.ownerDocument.createElement('option');
      opt.value = m.id;
      if (m.label) opt.textContent = m.label;
      dl.appendChild(opt);
    }
  }

  // field: { input, kind, endpoint: () => ({ baseUrl, apiKey }) }. Returns the number of models read; throws when the server could not be read.
  async function refresh(field) {
    const dl = field.input && field.input.list;
    if (!dl) return 0;
    const ep = field.endpoint() || {};
    if (!ep.baseUrl) throw new Error('no base URL');
    if (isGoogle(ep.baseUrl) && !ep.apiKey) throw new Error('no API key');
    fallbackOf(dl);
    const models = filterFor(field.kind, await fetchModels(ep.baseUrl, ep.apiKey));
    fill(dl, models);
    loaded.set(field.input, ep.baseUrl + '\n' + (ep.apiKey || ''));
    return models.length;
  }

  // The silent refresh of a focused field: once per endpoint and key, and a failure leaves the suggestions of index.html.
  function refreshIfStale(field) {
    if (!field.input || !field.input.list) return;
    const ep = field.endpoint() || {};
    if (loaded.get(field.input) === ep.baseUrl + '\n' + (ep.apiKey || '')) return;
    refresh(field).catch(() => { /* offline or no key */ });
  }

  const api = { listUrl: listUrl, parse: parse, fits: fits, filterFor: filterFor, fetchModels: fetchModels, refresh: refresh, refreshIfStale: refreshIfStale, GOOGLE_BASE: GOOGLE_BASE };
  global.ModelList = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
