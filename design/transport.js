/*
 * design/transport.js — the frontend transport layer (CONTRACT.md F1).
 *
 * Plain browser JS, no build step, no dependencies. It also parses and runs
 * under Node (CommonJS export) so `node design/test-transport.mjs` can drive it
 * with a mock fetch/EventSource.
 *
 * Exposes one small Transport interface (PLAN.md §4: "the UI should sit on one
 * small `Transport` interface (send, receive, peers)"):
 *
 *   send(message) -> id        message: { type: 'ask'|'talk'|'loc', text, loc, note }
 *   onMessage(cb)              cb({ type: 'ack'|'answer'|'talk'|'loc'|'error', ask_id, text, loc, from, error })
 *   onAskState(cb)             cb(ask_id, state) — state: 'sent' | 'received' | 'answered' | 'unreachable'
 *   askState(id) -> state
 *   retry(id)                  re-send a question that reached 'unreachable' (HubTransport)
 *   peers() -> Promise<array>
 *   health() -> Promise<object>   (HubTransport; reports /v1/health)
 *   onHealth(cb)               (HubTransport)
 *   close()
 *
 * Two implementations:
 *   - SimulatedTransport — reproduces the scripted demo of design/index.html
 *     (keyword routing + timed fake answers), so `?transport=sim` (default)
 *     keeps the design review working offline, unchanged.
 *   - HubTransport — the dev transport of CONTRACT.md §3 (loopback HTTP + SSE
 *     against the hub dev server), selected with `?transport=hub`.
 *
 * Running against the hub
 * -----------------------
 * Start the hub dev server on the Mac mini (another workstream builds it):
 *
 *     python3 -m hub            # serves http://127.0.0.1:8787 (CONTRACT.md §3)
 *
 * then open the prototypes with the hub transport selected:
 *
 *     design/index.html?transport=hub
 *     design/index.html?transport=hub&hub=http://192.168.x.x:8787
 *     design/components.html?transport=hub
 *
 * `?transport=sim` (the default, or no query string) keeps today's scripted
 * demo exactly as it was. Wire protocol, SSE events and the Ask state machine
 * (sent → ack → received → answer → answered; no ack within HUB_ACK_TIMEOUT
 * 30 s → unreachable, with retry(id)) follow CONTRACT.md §2–§3.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TransportKit = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  var DEFAULT_HUB_URL = 'http://127.0.0.1:8787';
  /* CONTRACT.md §2: no ACK within 30 s means the question did not get through. */
  var HUB_ACK_TIMEOUT = 30000;
  /* CONTRACT.md §2: every hub answer ends with this exact line. */
  var DISCLAIMER = 'AI answer from an offline model. Not verified emergency advice.';
  var DISCLAIMER_RE = /\n?AI answer[^\n]*Not verified emergency advice\.?\s*$/i;

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  /* Strip the trailing disclaimer line from a hub answer (the UI renders its own
     AI-answer label under every answer, so it is never shown twice). */
  function stripDisclaimer(text) {
    return String(text == null ? '' : text).replace(DISCLAIMER_RE, '').replace(/\s+$/, '');
  }

  /* ------------------------------------------------------------------ *
   * Transport — the interface. Implementations override send/peers/close. *
   * ------------------------------------------------------------------ */
  function Transport() {
    this._messageCbs = [];
    this._stateCbs = [];
    this._asks = new Map();
  }
  Transport.prototype.send = function () { throw new Error('Transport.send() not implemented'); };
  Transport.prototype.onMessage = function (cb) { this._messageCbs.push(cb); return this; };
  Transport.prototype.onAskState = function (cb) { this._stateCbs.push(cb); return this; };
  Transport.prototype.askState = function (id) {
    var a = this._asks.get(id);
    return a ? a.state : null;
  };
  Transport.prototype.peers = function () { return Promise.resolve([]); };
  Transport.prototype.health = function () { return Promise.resolve({ ok: true, transport: this.kind }); };
  Transport.prototype.close = function () {};
  Transport.prototype._emit = function (msg) {
    this._messageCbs.forEach(function (cb) { try { cb(msg); } catch (e) { /* a bad listener must not break the transport */ } });
  };
  Transport.prototype._setAsk = function (id, state) {
    var a = this._asks.get(id) || { id: id };
    a.state = state;
    this._asks.set(id, a);
    var self = this;
    this._stateCbs.forEach(function (cb) { try { cb(id, state, a); } catch (e) {} });
    return a;
  };

  /* ------------------------------------------------------------------ *
   * SimulatedTransport — today's scripted demo, as a Transport.           *
   * Same keyword routing and timed fake answers as design/index.html.    *
   * ------------------------------------------------------------------ */
  var SIM_ROUTES = [
    { key: 'map',   re: /(defib|aed|water|map|fountain|tap|pharmac|shelter)/i,
      text: 'Water, 240 m: the fountain at Borough Market. Open the map for the rest.' },
    { key: 'cpr',   re: /(collaps|cpr|breath|unconscious|heart)/i,
      text: '1. Call 999, or get someone else to.\n2. Check if they are breathing normally.\n3. If not, push hard and fast in the centre of the chest, about 2 a second.\n4. Send someone for the defibrillator at Borough station, 180 m.' },
    { key: 'safe',  re: /(safe|family|mum|tell)/i,
      text: "Telling Mum and Sam you're safe." },
    { key: 'why',   re: /(why|cause|power|happen)/i,
      text: 'Nobody has said yet.',
      followUp: 'A fault at a substation in Bankside. Engineers are on site.' }
  ];
  var SIM_OTHER = "I don't have that yet. I've asked and will tell you when it answers.";

  function SimulatedTransport(opts) {
    opts = opts || {};
    Transport.call(this);
    this.kind = 'sim';
    this._delay = opts.delay != null ? opts.delay : 1400;        /* answer delay, ms (scripted demo) */
    this._localDelay = opts.localDelay != null ? opts.localDelay : 400; /* map/cpr answers come faster */
    this._ackDelay = opts.ackDelay != null ? opts.ackDelay : 250;
    this._followUpDelay = opts.followUpDelay != null ? opts.followUpDelay : 5000;
    this._scale = opts.delayScale != null ? opts.delayScale : 1; /* tests shrink all delays */
    this._timers = [];
  }
  SimulatedTransport.prototype = Object.create(Transport.prototype);
  SimulatedTransport.prototype.constructor = SimulatedTransport;
  SimulatedTransport.prototype.send = function (message) {
    message = message || {};
    var text = String(message.text || '');
    var loc = message.loc || null;
    var id = uuid();
    var self = this;
    this._setAsk(id, 'sent');
    var later = function (fn, ms) { self._timers.push(setTimeout(fn, ms * self._scale)); };
    later(function () {
      self._setAsk(id, 'received');
      self._emit({ type: 'ack', ask_id: id, text: 'Received. Working on an answer.' });
    }, this._ackDelay);
    var route = null;
    for (var i = 0; i < SIM_ROUTES.length; i++) { if (SIM_ROUTES[i].re.test(text)) { route = SIM_ROUTES[i]; break; } }
    var ms = route && (route.key === 'map' || route.key === 'cpr') ? this._localDelay : this._delay;
    later(function () {
      var body = (route ? route.text : SIM_OTHER) + '\n' + DISCLAIMER;
      self._setAsk(id, 'answered');
      self._emit({ type: 'answer', ask_id: id, text: body, loc: loc });
      if (route && route.followUp) {
        later(function () {
          self._emit({ type: 'answer', ask_id: id, text: route.followUp + '\n' + DISCLAIMER, loc: loc });
        }, self._followUpDelay);
      }
    }, ms);
    return id;
  };
  SimulatedTransport.prototype.peers = function () { return Promise.resolve(['phone-a', 'phone-b']); };
  SimulatedTransport.prototype.close = function () {
    this._timers.forEach(clearTimeout);
    this._timers = [];
  };

  /* ------------------------------------------------------------------ *
   * HubTransport — CONTRACT.md §3 dev transport (HTTP + SSE on loopback). *
   * ------------------------------------------------------------------ */
  function HubTransport(baseUrl, opts) {
    opts = opts || {};
    Transport.call(this);
    this.kind = 'hub';
    this.baseUrl = String(baseUrl || DEFAULT_HUB_URL).replace(/\/+$/, '');
    this._fetch = opts.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    this._ES = opts.EventSourceImpl || (typeof EventSource === 'function' ? EventSource : null);
    this._ackTimeout = opts.ackTimeout != null ? opts.ackTimeout : HUB_ACK_TIMEOUT;
    this._reconnectMin = opts.reconnectMin != null ? opts.reconnectMin : 1000;
    this._reconnectMax = opts.reconnectMax != null ? opts.reconnectMax : 30000;
    this._healthCbs = [];
    this._es = null;
    this._esAttempt = 0;
    this._reconnectTimer = null;
    this._closed = false;
    this._lastAskId = null;
    if (!this._fetch) throw new Error('HubTransport: no fetch implementation available');
    this._connect();
    this.health();
  }
  HubTransport.prototype = Object.create(Transport.prototype);
  HubTransport.prototype.constructor = HubTransport;

  HubTransport.prototype.send = function (message) {
    message = message || {};
    var type = message.type || 'ask';
    var id = uuid();
    var self = this;
    if (type === 'ask') {
      /* CONTRACT.md §3: POST /v1/ask { id, text, loc|null }. loc is attached
         only when the user opted in (F3) — the caller decides. */
      var body = { id: id, text: String(message.text || ''), loc: message.loc || null };
      this._asks.set(id, { id: id, body: body, state: 'sent', timer: null });
      this._setAsk(id, 'sent');
      this._armAck(id);
      this._lastAskId = id;
      this._post('/v1/ask', body).catch(function () { self._unreachable(id); });
    } else if (type === 'loc') {
      this._post('/v1/loc', { loc: String(message.loc || ''), note: String(message.note || '') }).catch(function () {});
    } else {
      this._post('/v1/talk', { text: String(message.text || '') }).catch(function () {});
    }
    return id;
  };

  /* Re-POST the same question after 'unreachable' (CONTRACT.md §2 retry). */
  HubTransport.prototype.retry = function (id) {
    var a = this._asks.get(id);
    if (!a || this._closed) return null;
    if (a.timer) clearTimeout(a.timer);
    this._setAsk(id, 'sent');
    this._armAck(id);
    var self = this;
    this._post('/v1/ask', a.body).catch(function () { self._unreachable(id); });
    return id;
  };

  HubTransport.prototype.onHealth = function (cb) { this._healthCbs.push(cb); return this; };

  HubTransport.prototype.peers = function () {
    return this._get('/v1/peers').then(function (j) { return (j && j.peers) || []; }).catch(function () { return []; });
  };

  /* Reports hub health via GET /v1/health (CONTRACT.md §3). */
  HubTransport.prototype.health = function () {
    var self = this;
    function notify(h) { self._healthCbs.forEach(function (cb) { try { cb(h); } catch (e) {} }); return h; }
    return this._get('/v1/health').then(function (j) {
      return notify((j && typeof j === 'object') ? j : { ok: false });
    }).catch(function (e) {
      return notify({ ok: false, error: String((e && e.message) || e) });
    });
  };

  HubTransport.prototype.close = function () {
    this._closed = true;
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
    this._closeES();
    this._asks.forEach(function (a) { if (a.timer) clearTimeout(a.timer); });
  };

  /* ---------------------------- internals ---------------------------- */
  HubTransport.prototype._armAck = function (id) {
    var a = this._asks.get(id);
    if (!a) return;
    if (a.timer) clearTimeout(a.timer);
    var self = this;
    a.timer = setTimeout(function () { self._unreachable(id); }, this._ackTimeout);
  };

  HubTransport.prototype._unreachable = function (id) {
    var a = this._asks.get(id);
    if (!a || a.state === 'answered' || a.state === 'received') return;
    if (a.timer) clearTimeout(a.timer);
    a.timer = null;
    this._setAsk(id, 'unreachable');
  };

  HubTransport.prototype._post = function (path, body) {
    return this._fetch(this.baseUrl + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r || r.ok === false) throw new Error('HTTP ' + (r && r.status));
      return r;
    });
  };

  HubTransport.prototype._get = function (path) {
    return this._fetch(this.baseUrl + path).then(function (r) {
      if (!r || r.ok === false) throw new Error('HTTP ' + (r && r.status));
      return r.json ? r.json() : r;
    });
  };

  /* One SSE stream, GET /v1/events (CONTRACT.md §3). Reconnects with
     exponential backoff and reports hub health while the stream is down. */
  HubTransport.prototype._connect = function () {
    if (this._closed || !this._ES) return;
    this._closeES();
    var q = this._lastAskId ? '?id=' + encodeURIComponent(this._lastAskId) : '';
    var es = new this._ES(this.baseUrl + '/v1/events' + q);
    var self = this;
    this._es = es;
    es.onopen = function () { self._esAttempt = 0; };
    ['ack', 'answer', 'talk', 'loc', 'error'].forEach(function (name) {
      es.addEventListener(name, function (ev) { self._onEvent(name, ev); });
    });
    es.onerror = function () { self._onStreamError(); };
  };

  HubTransport.prototype._closeES = function () {
    if (this._es) { try { this._es.close(); } catch (e) {} this._es = null; }
  };

  HubTransport.prototype._onStreamError = function () {
    if (this._closed) return;
    this._closeES();
    this.health();
    var delay = Math.min(this._reconnectMax, this._reconnectMin * Math.pow(2, this._esAttempt++));
    var self = this;
    this._reconnectTimer = setTimeout(function () { if (!self._closed) self._connect(); }, delay);
  };

  /* Map SSE events to protocol messages and drive the Ask state machine. */
  HubTransport.prototype._onEvent = function (name, ev) {
    var d = {};
    try { d = JSON.parse(ev && ev.data ? ev.data : '{}') || {}; } catch (e) { d = {}; }
    var a = d.ask_id ? this._asks.get(d.ask_id) : null;
    if (name === 'ack') {
      if (a && a.state === 'sent') {
        if (a.timer) clearTimeout(a.timer);
        a.timer = null;
        this._setAsk(d.ask_id, 'received');
      }
      this._emit({ type: 'ack', ask_id: d.ask_id, text: d.text || '' });
    } else if (name === 'answer') {
      if (a) {
        if (a.timer) clearTimeout(a.timer);
        a.timer = null;
        this._setAsk(d.ask_id, 'answered');
      }
      this._emit({ type: 'answer', ask_id: d.ask_id, text: d.text || '' });
    } else if (name === 'talk') {
      this._emit({ type: 'talk', from: d.from || '', text: d.text || '' });
    } else if (name === 'loc') {
      this._emit({ type: 'loc', from: d.from || '', loc: d.loc || '' });
    } else if (name === 'error') {
      this._emit({ type: 'error', ask_id: d.ask_id, error: d.error || 'Something went wrong.' });
    }
  };

  /* ------------------------------------------------------------------ *
   * Factory: ?transport=hub|sim (default sim) and ?hub=<url>.            *
   * ------------------------------------------------------------------ */
  function createTransport(params, opts) {
    var p = params;
    if (!p) {
      p = (typeof location !== 'undefined' && location.search)
        ? new URLSearchParams(location.search)
        : new URLSearchParams();
    }
    var get = function (k) { return (p && typeof p.get === 'function') ? p.get(k) : p[k]; };
    var kind = String(get('transport') || 'sim').toLowerCase();
    var hubUrl = get('hub') || DEFAULT_HUB_URL;
    if (kind === 'hub') return new HubTransport(hubUrl, opts);
    return new SimulatedTransport(opts);
  }

  return {
    Transport: Transport,
    SimulatedTransport: SimulatedTransport,
    HubTransport: HubTransport,
    createTransport: createTransport,
    stripDisclaimer: stripDisclaimer,
    DEFAULT_HUB_URL: DEFAULT_HUB_URL,
    HUB_ACK_TIMEOUT: HUB_ACK_TIMEOUT,
    DISCLAIMER: DISCLAIMER
  };
});
