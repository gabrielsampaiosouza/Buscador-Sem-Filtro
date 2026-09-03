// ============ MODELS — ModelRegistry + Adapters (dinâmico via API, fallback offline) ============
// Carregado DEPOIS de utils.js (usa AI_PROVIDERS como fallback) e ANTES de app.js.
// Nenhuma key é exibida em log/console. Timeout 12s via AbortController.
(function () {
  'use strict';

  var TTL_MS = 24 * 60 * 60 * 1000; // 24h
  var TIMEOUT_MS = 12000;
  var LS_PREFIX = 'bsf_models_';

  function lsKey(providerId) { return LS_PREFIX + providerId; }

  function cacheGet(providerId) {
    try {
      var raw = localStorage.getItem(lsKey(providerId));
      if (!raw) return null;
      var d = JSON.parse(raw);
      if (!d || !Array.isArray(d.items)) return null;
      if (Date.now() - (d.ts || 0) > TTL_MS) return null;
      return d;
    } catch (e) { return null; }
  }

  function cacheSet(providerId, items) {
    try {
      localStorage.setItem(lsKey(providerId), JSON.stringify({ ts: Date.now(), items: items }));
    } catch (e) {}
  }

  function cacheTs(providerId) {
    var d = cacheGet(providerId);
    return d ? d.ts : 0;
  }

  async function fetchJson(url, opts) {
    opts = opts || {};
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, opts.timeout || TIMEOUT_MS);
    try {
      var res = await fetch(url, {
        method: 'GET',
        headers: opts.headers || { 'Accept': 'application/json' },
        signal: ctrl.signal
      });
      if (!res.ok) {
        var err = new Error('HTTP ' + res.status + ' em ' + url.split('?')[0]);
        err.status = res.status;
        throw err;
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // ---- Fallback hardcoded (offline/sem key): AI_PROVIDERS[p].models, SEM Lite ----
  function fallbackItems(providerId) {
    var prov = (typeof AI_PROVIDERS !== 'undefined' && AI_PROVIDERS[providerId]) || null;
    var models = (prov && prov.models) || [];
    return models
      .filter(function (m) { return !isLite(m.id); })
      .map(function (m) {
        return { id: m.id, name: m.name || m.id, free: m.free !== false, context: 0, pricing: '', updated: '' };
      });
  }

  // Lite só aparece se vier da API real, nunca do fallback.
  function isLite(id) {
    return /(^|[\/:_-])(lite|light|1b)([\/:_-]|$)/i.test(id || '');
  }

  // ---- Adapter: OpenRouter (público, sem key) ----
  async function fetchOpenRouter() {
    var d = await fetchJson('https://openrouter.ai/api/v1/models');
    var arr = (d && d.data) || [];
    return arr.map(function (m) {
      var pricing = '';
      try {
        if (m.pricing) pricing = 'in $' + m.pricing.prompt + ' / out $' + m.pricing.completion;
      } catch (e) {}
      return {
        id: m.id,
        name: m.name || m.id,
        free: (m.id || '').endsWith(':free'),
        context: m.context_length || 0,
        pricing: pricing,
        updated: m.updated_at || m.created ? String(m.created || '') : ''
      };
    });
  }

  // Validação opcional da key OpenRouter (botão Testar): GET /auth/key com Bearer.
  async function validateOpenRouterKey(key) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);
    try {
      var res = await fetch('https://openrouter.ai/api/v1/auth/key', {
        headers: { 'Authorization': 'Bearer ' + key },
        signal: ctrl.signal
      });
      return res.ok;
    } catch (e) {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  // ---- Adapter: Gemini (GET /v1beta/models?key=KEY, paginação pageToken) ----
  // Filtra supportedGenerationMethods contendo generateContent. free=true (tier free).
  // Ordenação preferencial: 3.8-flash > 3.7-flash > demais (versão desc) > resto.
  var GEMINI_PREF = ['gemini-3.8-flash', 'gemini-3.7-flash'];
  async function fetchGemini(key) {
    if (!key) throw new Error('Gemini exige API key');
    var out = [];
    var pageToken = '';
    for (var page = 0; page < 5; page++) {
      var url = 'https://generativelanguage.googleapis.com/v1beta/models?key=' +
        encodeURIComponent(key) + '&pageSize=100' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
      var d = await fetchJson(url);
      var arr = (d && d.models) || [];
      for (var i = 0; i < arr.length; i++) {
        var m = arr[i];
        var methods = m.supportedGenerationMethods || [];
        if (methods.indexOf('generateContent') === -1) continue;
        var id = String(m.name || '').replace(/^models\//, '');
        if (!id) continue;
        out.push({
          id: id,
          name: m.displayName || id,
          free: true,
          context: m.inputTokenLimit || 0,
          pricing: '',
          updated: m.version || ''
        });
      }
      pageToken = (d && d.nextPageToken) || '';
      if (!pageToken) break;
    }
    out.sort(function (a, b) { return geminiRank(a.id) - geminiRank(b.id); });
    return out;
  }
  function geminiRank(id) {
    var i = GEMINI_PREF.indexOf(id);
    if (i !== -1) return i - 1000;
    var m = /gemini-(\d+)\.(\d+)/.exec(id || '');
    if (m) return -(parseInt(m[1], 10) * 100 + parseInt(m[2], 10));
    return 0;
  }

  // ---- Adapter genérico OpenAI-compatible: GET {base}/v1/models ----
  // Com Authorization: Bearer KEY quando auth==='bearer'. 404/CORS/falha => throw (fallback).
  var OAI_BASES = {
    huggingface: 'https://router.huggingface.co',
    nvidia: 'https://integrate.api.nvidia.com',
    ollama_cloud: 'https://api.ollama.cloud',
    llm7: 'https://api.llm7.io'
  };
  function shortName(id) {
    var s = String(id || '');
    var i = Math.max(s.lastIndexOf('/'), s.lastIndexOf(':'));
    return i >= 0 ? s.slice(i + 1) : s;
  }
  function makeOpenAIAdapter(providerId) {
    return async function (key) {
      var prov = (typeof AI_PROVIDERS !== 'undefined' && AI_PROVIDERS[providerId]) || {};
      var base = OAI_BASES[providerId];
      if (!base) throw new Error('Sem base para ' + providerId);
      if (prov.auth === 'bearer' && !key) throw new Error(providerId + ' exige API key');
      var headers = { 'Accept': 'application/json' };
      if (prov.auth === 'bearer' && key) headers['Authorization'] = 'Bearer ' + key;
      var d = await fetchJson(base + '/v1/models', { headers: headers });
      // Alguns gateways retornam {models:[{name}]} em vez de {data:[{id}]}; normaliza ambos.
      var arr = (d && d.data) || d.models || [];
      return arr.map(function (m) {
        var id = typeof m === 'string' ? m : (m.id || m.name || '');
        return { id: id, name: shortName(id), free: true, context: 0, pricing: '', updated: '' };
      }).filter(function (m) { return !!m.id; });
    };
  }
  // ---- Adapter: OpenCode Zen (GET /zen/v1/models é público; FILTRO: só gratuitos) ----
  function zenShort(id) {
    return String(id || '').replace(/-free$/, '').replace(/-contributor$/, '');
  }
  async function fetchZen() {
    var d = await fetchJson('https://opencode.ai/zen/v1/models');
    var arr = (d && d.data) || [];
    return arr
      .filter(function (m) {
        var id = typeof m === 'string' ? m : (m.id || '');
        return /free/i.test(id) || id === 'big-pickle';
      })
      .map(function (m) {
        var id = typeof m === 'string' ? m : m.id;
        return { id: id, name: zenShort(id), free: true, context: 0, pricing: 'Free', updated: '' };
      });
  }

  // Adapters por provider (um fetch cada, timeout 12s, sem vazar key em log).
  var adapters = {
    openrouter: fetchOpenRouter,
    gemini: fetchGemini,
    zen: fetchZen,
    huggingface: makeOpenAIAdapter('huggingface'),
    nvidia: makeOpenAIAdapter('nvidia'),
    ollama_cloud: makeOpenAIAdapter('ollama_cloud'),
    llm7: makeOpenAIAdapter('llm7')
  };

  function notifyFallback(providerId) {
    try {
      if (typeof toast === 'function') toast('Lista offline para ' + providerId + ' (sem internet ou API fora).', 'error');
    } catch (e) {}
  }

  async function list(providerId, opts) {
    opts = opts || {};
    if (!opts.force) {
      var cached = cacheGet(providerId);
      if (cached && cached.items.length) return cached.items;
    }
    var fn = adapters[providerId];
    if (fn) {
      try {
        var key = null;
        try {
          if (typeof getAIKey === 'function') key = getAIKey(providerId) || null;
        } catch (e) {}
        var items = await fn(key);
        items = (items || []).filter(function (m) { return m && m.id; });
        if (items.length) {
          cacheSet(providerId, items);
          return items;
        }
      } catch (e) {
        notifyFallback(providerId);
      }
    }
    // Sem adapter ou API falhou: tenta cache expirado, senão fallback.
    try {
      var raw = localStorage.getItem(lsKey(providerId));
      if (raw) {
        var d = JSON.parse(raw);
        if (d && d.items && d.items.length) return d.items;
      }
    } catch (e) {}
    var fb = fallbackItems(providerId);
    if (fb.length) cacheSet(providerId, fb);
    return fb;
  }

  // Filtragem client-side: multi-termo AND, case-insensitive, match em id+name.
  // Token ':free' ou 'free' sozinho => só free===true.
  function filterItems(items, query) {
    var q = (query || '').trim().toLowerCase();
    if (!q) return items.slice();
    var terms = q.split(/\s+/).filter(Boolean);
    return items.filter(function (m) {
      var hay = ((m.id || '') + ' ' + (m.name || '')).toLowerCase();
      for (var i = 0; i < terms.length; i++) {
        var t = terms[i];
        if (t === ':free' || t === 'free') {
          if (!m.free) return false;
        } else if (t.charAt(0) === ':' && t.length > 1) {
          if (hay.indexOf(t.slice(1)) === -1 && hay.indexOf(t) === -1) return false;
        } else if (hay.indexOf(t) === -1) {
          return false;
        }
      }
      return true;
    });
  }

  async function search(providerId, query) {
    var items = await list(providerId);
    return filterItems(items, query);
  }

  window.ModelRegistry = {
    list: list,
    search: search,
    filterItems: filterItems,
    cacheGet: cacheGet,
    cacheSet: cacheSet,
    cacheTs: cacheTs,
    validateOpenRouterKey: validateOpenRouterKey,
    _adapters: adapters, // ponto de extensão da Tarefa 2
    TTL_MS: TTL_MS
  };
})();
