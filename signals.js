// ============================================================
//  NexTrade — Signal Feed (Mode A)
//  Clean signals board for signal-only users:
//    - Big signal cards: symbol, direction, entry/stop/TP, R:R, status
//    - "My Trades" tab: open / closed / live P&L
//    - "History" tab: closed-trade log for tracking
//  Shares the scanner engine; this is presentation only.
// ============================================================
(function () {
  'use strict';

  var TRADES_KEY = 'nt_trades';          // open + closed trades
  var MODE_KEY   = 'nt_user_mode';       // 'signals' | 'analysis' (current view)
  var PLAN_KEY   = 'nt_user_plan';       // 'signals' | 'analysis' (stable onboarding choice)
  var ALERTS_KEY = 'ib_alerts2';         // scanner signals (written by main.js, local fallback)
  var SERVER_KEY = 'nt_server_signals';  // authoritative signals fetched from the server
  var FAVS_KEY   = 'nt_sig_favs';        // symbols the user wants alerts for
  var EARN_KEY   = 'nt_earnings';        // optional { SYM: 'YYYY-MM-DD' } earnings dates

  // When the server feed is in use, this holds its plan/total metadata so the
  // upsell banner can show the REAL hidden-count (enforced server-side).
  var _serverInfo = null;
  var _lastSync = 0;

  // The logged-in user's role (admins get full access to both modes).
  function userRole() {
    try { return (JSON.parse(localStorage.getItem('nt_user') || '{}') || {}).role || null; } catch (e) { return null; }
  }
  function isAdmin() { return userRole() === 'admin'; }

  // Signals-only users are LOCKED to the feed (no switching to analysis).
  // Admins are NEVER locked — they can move freely between the feed and the site.
  function isSignalsLocked() {
    if (isAdmin()) return false;
    var plan = localStorage.getItem(PLAN_KEY) || localStorage.getItem(MODE_KEY);
    return plan === 'signals';
  }

  var activeTab = 'signals';
  var refreshTimer = null;
  // Signals-tab view state
  var VIEW_KEY = 'nt_sig_view';
  var viewMode = 'list';      // 'list' (compact rows) | 'cards'
  try { if (localStorage.getItem(VIEW_KEY) === 'cards') viewMode = 'cards'; } catch (e) {}
  var filterKey = 'all';      // all | long | short | ready | fav
  var sortBy = 'newest';      // newest | entry | rr
  var marketFilter = 'all';   // all | tase | us | cmd
  var textFilter = '';
  var _expanded = {};         // row key -> true (expanded details)

  // ---------- plan helpers (thin wrappers over window.NTPlan) ----------
  function isPremium() { try { return !window.NTPlan || window.NTPlan.isPremium(); } catch (e) { return true; } }
  function favCap()    { try { return window.NTPlan ? window.NTPlan.favLimit() : Infinity; } catch (e) { return Infinity; } }
  function sigCap()    { try { return window.NTPlan ? window.NTPlan.signalLimit() : Infinity; } catch (e) { return Infinity; } }
  function canUse(f)   { try { return !window.NTPlan || window.NTPlan.canUse(f); } catch (e) { return true; } }
  function openUpgrade(ctx) { try { if (window.NTPlan) window.NTPlan.openUpgrade(ctx); } catch (e) {} }
  function tierId()    { try { return window.NTPlan ? window.NTPlan.tier() : 'free'; } catch (e) { return 'free'; } }
  function tierLabel() { try { return window.NTPlan ? window.NTPlan.tierName() : ''; } catch (e) { return ''; } }
  function favLimitMsg() {
    var cap = favCap();
    return 'במסלול שלך (' + tierLabel() + ') אפשר לעקוב אחרי עד ' + cap + ' מניות. שדרג למעקב אחרי יותר.';
  }

  // ---------- favorites (alert watch) ----------
  function loadFavs() {
    try { return JSON.parse(localStorage.getItem(FAVS_KEY) || '[]') || []; } catch (e) { return []; }
  }
  function saveFavs(a) { try { localStorage.setItem(FAVS_KEY, JSON.stringify(a)); } catch (e) {} }
  function isFav(sym) { return loadFavs().indexOf(sym) !== -1; }
  function toggleFav(sym) {
    var f = loadFavs();
    var i = f.indexOf(sym);
    if (i === -1) {
      // Free users are capped on how many symbols they can watch.
      if (f.length >= favCap()) {
        openUpgrade(favLimitMsg());
        return;
      }
      f.push(sym);
    } else { f.splice(i, 1); }
    saveFavs(f);
    render();
  }

  // ---------- earnings ----------
  // Reads an optional local map of upcoming earnings dates. Degrades gracefully
  // when unknown. Rule: exit ONE DAY BEFORE the report.
  function loadEarnings() {
    try { return JSON.parse(localStorage.getItem(EARN_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function earningsInfo(sym, serverDate) {
    var map = loadEarnings();
    var d = serverDate || map[sym] || map[(sym || '').replace('.TA', '')];
    if (!d) return null;
    var when = new Date(d + 'T00:00:00');
    if (isNaN(when.getTime())) return null;
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var days = Math.round((when - today) / 86400000);
    return { date: d, days: days, exitToday: days <= 1 };
  }

  // ---------- helpers ----------
  function fmt(n, curr) {
    if (n == null || isNaN(n)) return '--';
    var s = (Math.abs(n) >= 100 ? n.toFixed(2) : n.toFixed(2));
    return (curr || '') + s;
  }
  function pct(n) { return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'; }
  // Compact money / volume: 1.2K, 3.4M, 5.6B (curr prefix optional)
  function fmtBig(n, curr) {
    if (n == null || isNaN(n)) return '--';
    var a = Math.abs(n), s;
    if (a >= 1e9) s = (n / 1e9).toFixed(2) + 'B';
    else if (a >= 1e6) s = (n / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M';
    else if (a >= 1e3) s = (n / 1e3).toFixed(0) + 'K';
    else s = String(Math.round(n));
    return (curr || '') + s;
  }

  function livePrice(sym) {
    try {
      if (window.priceCache && window.priceCache[sym] && window.priceCache[sym].price) {
        return window.priceCache[sym].price;
      }
    } catch (e) {}
    return null;
  }

  function loadTrades() {
    try { return JSON.parse(localStorage.getItem(TRADES_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveTrades(t) { localStorage.setItem(TRADES_KEY, JSON.stringify(t)); }

  // Live quotes for open trades: the watchlist price cache only holds watchlist symbols, so
  // every open trade symbol is fetched explicitly and pushed into the shared price cache.
  var _tradePxTs = 0, _tradePxBusy = false;
  function refreshTradePrices(force) {
    if (_tradePxBusy || typeof window.fetchQuote !== 'function') return;
    if (!force && Date.now() - _tradePxTs < 8000) return;
    var syms = [];
    loadTrades().forEach(function (t) {
      if (t.status === 'open' && syms.indexOf(t.sym) === -1) syms.push(t.sym);
    });
    if (!syms.length) return;
    _tradePxBusy = true;
    Promise.all(syms.map(function (sym) {
      return Promise.resolve(window.fetchQuote(sym)).then(function (d) {
        if (d && d.price != null && window.priceCache) window.priceCache[sym] = d;
      }).catch(function () {});
    })).then(function () {
      _tradePxBusy = false;
      _tradePxTs = Date.now();
      if (activeTab === 'trades') render();
    }, function () { _tradePxBusy = false; });
  }

  // ---------- server signal feed (authoritative, plan-enforced) ----------
  function apiBase() {
    try {
      return (typeof window.API_BASE === 'string' && window.API_BASE) ||
             localStorage.getItem('nt_api_base') ||
             'https://nextrade-lending.onrender.com';
    } catch (e) { return 'https://nextrade-lending.onrender.com'; }
  }
  function authToken() { try { return localStorage.getItem('nt_token'); } catch (e) { return null; } }
  function loadServerCache() {
    try { return JSON.parse(localStorage.getItem(SERVER_KEY) || 'null'); } catch (e) { return null; }
  }

  // Pull the plan-gated signal feed from the server and cache it. The server
  // decides WHICH signals this user is entitled to — the client cannot unlock more.
  function syncServerSignals(force) {
    var token = authToken();
    if (!token) return; // demo / offline — fall back to the local scanner feed
    if (!force && Date.now() - _lastSync < 45000) return;
    _lastSync = Date.now();
    fetch(apiBase() + '/api/signals', {
      headers: { 'Authorization': 'Bearer ' + token },
      cache: 'no-store'
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !Array.isArray(d.signals)) return;
        try {
          localStorage.setItem(SERVER_KEY, JSON.stringify({
            ts: Date.now(), data: d.signals, total: d.total,
            isPremium: d.isPremium, tier: d.tier, delayedMs: d.delayedMs, lastScan: d.lastScan, resting: !!d.scannerResting
          }));
        } catch (e) {}
        // keep the plan badge/UI + limits honest with the server's authoritative answer
        try {
          if (window.NTPlan) window.NTPlan.applyServerPlan({
            plan: d.plan || (d.isPremium ? 'premium' : 'free'), tier: d.tier, limits: d.limits
          });
        } catch (e) {}
        render();
      })
      .catch(function () {});
  }

  // Index / commodity / forex tickers are shown with readable names (e.g. ^GSPC → S&P 500).
  var SPECIAL_SYM = {
    '^GSPC': { disp: 'S&P 500', name: 'מדד S&P 500' },
    'TA35.TA': { disp: 'ת״א 35', name: 'מדד תל אביב 35' },
    'GC=F': { disp: 'GOLD', name: 'זהב (חוזה עתידי)' },
    'SI=F': { disp: 'SILVER', name: 'כסף (חוזה עתידי)' },
    'CL=F': { disp: 'OIL', name: 'נפט WTI (חוזה עתידי)' },
    'EURUSD=X': { disp: 'EUR/USD', name: 'אירו/דולר' }
  };
  function dispSym(sym) {
    var sp = SPECIAL_SYM[sym];
    return sp ? sp.disp : (sym || '').replace('.TA', '');
  }
  function friendlyName(sym, name) {
    var sp = SPECIAL_SYM[sym];
    return sp ? sp.name : (name || (sym || '').replace('.TA', ''));
  }
  // Small "Tel Aviv listing" tag so a TASE line (prices in ₪) is never mistaken for the US listing.
  function mktTag(sym) {
    return (/\.TA$/i.test(sym || '') && !SPECIAL_SYM[sym])
      ? ' <span style="font-size:10px;font-weight:700;padding:1px 6px;border-radius:6px;background:rgba(255,255,255,.1);color:#9fb3c8;vertical-align:middle">ת״א · ₪</span>'
      : '';
  }

  // Read scanner signals and normalize into a rich signal object. Prefers the
  // server feed (authoritative) and falls back to the local scanner (ib_alerts2).
  function loadSignals() {
    var raw;
    var sc = loadServerCache();
    if (sc && Array.isArray(sc.data)) {
      raw = sc.data;
      _serverInfo = { total: sc.total, isPremium: sc.isPremium, tier: sc.tier || (sc.isPremium ? 'premium' : 'free'), delayedMs: sc.delayedMs, lastScan: sc.lastScan, resting: !!sc.resting };
    } else {
      _serverInfo = null;
      try { raw = JSON.parse(localStorage.getItem(ALERTS_KEY) || '[]'); } catch (e) { raw = []; }
    }
    var out = [];
    raw.forEach(function (a) {
      var cond = a.condition || '';
      var isBuy  = cond === 'buy_signal'  || a.direction === 'long'  || a.direction === 'bullish';
      var isSell = cond === 'sell_signal' || a.direction === 'short' || a.direction === 'bearish';
      if (!isBuy && !isSell) return;
      // Hard rule: no short above SMA30, no long below it (drops stale/cached signals too).
      if (a.sma30 != null && a.price != null && ((isSell && !isBuy && a.price >= a.sma30) || (isBuy && !isSell && a.price < a.sma30))) return;
      if (/=[FX]$|-USD$/i.test(a.sym || '')) return;   // only stocks + the two indices
      var dir = isBuy ? 'long' : 'short';
      var levels = computeLevels(a, dir);
      out.push({
        sym: a.sym, name: friendlyName(a.sym, a.name),
        key: a.key || (a.sym + '_' + dir),
        dir: dir, curr: (a.sym && (a.sym.charAt(0) === '^' || a.sym === 'TA35.TA')) ? '' : (a.curr || ''),
        price: a.price,
        entry: levels.entry, stop: levels.stop, tp: levels.tp, rr: levels.rr,
        ts: a.ts || 0, date: a.date || '', time: a.time || '',
        trendType: a.trendType || '',
        setup: a.setup || '',
        reasons: Array.isArray(a.reasons) ? a.reasons : [],
        alertLevel: (a.alertLevel != null ? a.alertLevel : null),
        alertSide: a.alertSide || '',
        avgTurnover: (a.avgTurnover != null ? a.avgTurnover : null),
        earnDate: a.earnDate || '',
        avgVolume: (a.avgVolume != null ? a.avgVolume : null),
        lastWeekTurnover: (a.lastWeekTurnover != null ? a.lastWeekTurnover : null),
        scanStatus: a.status || ''
      });
    });
    return out;
  }

  // Human label for the setup type.
  var SETUP_TXT = {
    pullback: 'Pullback לתמיכה',
    breakout_retest: 'פריצה + ריטסט',
    breakdown_retest: 'שבירה + ריטסט',
    range_breakout: 'פריצת טווח',
    sma30_reclaim: 'החזרת SMA30',
    sma30_rejection: 'דחייה מ-SMA30'
  };

  // Entry / Stop / TP — prefer the scanner's own levels (SMA30 method), else
  // fall back to the legacy 1:2 computation from price + 5-week structure.
  function computeLevels(a, dir) {
    if (a.entry != null && a.stop != null && a.target != null) {
      return { entry: a.entry, stop: a.stop, tp: a.target, rr: '1:' + (a.rr || 2) };
    }
    var entry = a.price;
    var stop, tp, risk;
    var struct = a.support5; // long: 5-wk support low; short: 5-wk resistance high
    if (dir === 'long') {
      stop = (struct != null && struct < entry) ? struct : entry * 0.95;
      risk = entry - stop;
      tp = entry + 2 * risk;
    } else {
      stop = (struct != null && struct > entry) ? struct : entry * 1.05;
      risk = stop - entry;
      tp = entry - 2 * risk;
    }
    return { entry: entry, stop: stop, tp: tp, rr: '1:2' };
  }

  // Status of a signal relative to the live price, with distance-to-entry.
  // waiting → armed (within ~1.5% of entry) → active (past entry) → hit / stopped.
  function signalStatus(s) {
    var live = livePrice(s.sym);
    if (live == null) {
      // No live price: lean on the scanner's own armed/entry status if present.
      if (s.scanStatus === 'entry') return { key: 'armed', dist: null };
      return { key: 'waiting', dist: null };
    }
    var dist = ((live - s.entry) / s.entry) * 100; // +above / -below entry
    if (s.dir === 'long') {
      if (live <= s.stop) return { key: 'stopped', dist: dist };
      if (live >= s.tp) return { key: 'hit', dist: dist };
      if (live >= s.entry) return { key: 'active', dist: dist };
      if (Math.abs(dist) <= 1.5) return { key: 'armed', dist: dist };
      return { key: 'waiting', dist: dist };
    } else {
      if (live >= s.stop) return { key: 'stopped', dist: dist };
      if (live <= s.tp) return { key: 'hit', dist: dist };
      if (live <= s.entry) return { key: 'active', dist: dist };
      if (Math.abs(dist) <= 1.5) return { key: 'armed', dist: dist };
      return { key: 'waiting', dist: dist };
    }
  }
  var STATUS_TXT = {
    waiting: 'ממתין לכניסה',
    armed: '⚡ קרוב לכניסה',
    active: 'בכניסה (פעיל)',
    hit: 'הגיע ליעד ✓',
    stopped: 'נפגע סטופ ✕'
  };

  // ---------- rendering ----------
  var STATUS_HINT = {
    waiting: 'המחיר עדיין רחוק מרמת הכניסה',
    armed: 'המחיר במרחק של עד 1.5% מרמת הכניסה — הכין התראה',
    active: 'המחיר עבר את רמת הכניסה',
    hit: 'המחיר הגיע ליעד',
    stopped: 'המחיר פגע בסטופ'
  };
  function marketOf(sym) {
    sym = sym || '';
    if (/\.TA$/i.test(sym)) return 'tase';
    if (/=F$|-USD$/i.test(sym)) return 'cmd';
    return 'us';
  }
  var MARKET_TXT = { tase: 'ת״א', us: 'ארה״ב', cmd: 'סחורות/קריפטו' };

  function ageTxt(ts) {
    if (!ts) return '';
    var m = Math.floor((Date.now() - ts) / 60000);
    if (m < 1) return 'ממש עכשיו';
    if (m < 60) return 'לפני ' + m + ' דק׳';
    var h = Math.floor(m / 60);
    if (h < 24) return 'לפני ' + h + ' שע׳';
    var d = Math.floor(h / 24);
    return 'לפני ' + d + (d === 1 ? ' יום' : ' ימים');
  }
  function isNewSig(s) { return s.ts && (Date.now() - s.ts) < 24 * 3600 * 1000; }
  function rrNum(s) { var n = parseFloat(String(s.rr || '').split(':')[1]); return isNaN(n) ? 0 : n; }

  // Real stop / entry / target bar with the live price marker (always left→right).
  function rangeBar(s) {
    var live = livePrice(s.sym);
    var vals = [s.stop, s.entry, s.tp];
    if (live != null) vals.push(live);
    for (var i = 0; i < vals.length; i++) { if (vals[i] == null || isNaN(vals[i])) return ''; }
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var span = (hi - lo) || 1;
    function pos(v) { return ((v - lo) / span * 100).toFixed(1); }
    function seg(a, b, cls) {
      var l = Math.min(a, b), w = Math.abs(a - b);
      return '<div class="' + cls + '" style="left:' + pos(l) + '%;width:' + (w / span * 100).toFixed(1) + '%"></div>';
    }
    return '<div class="sig-rb" dir="ltr" title="סטופ · כניסה · יעד">' +
      seg(s.stop, s.entry, 'sig-rb-risk') + seg(s.entry, s.tp, 'sig-rb-rew') +
      '<div class="sig-rb-entry" style="left:' + pos(s.entry) + '%"></div>' +
      (live != null ? '<div class="sig-rb-live" style="left:' + pos(live) + '%"></div>' : '') +
    '</div>';
  }

  function adminDelBtn(s) {
    if (!isAdmin()) return '';
    return '<button class="sig-del" title="מחק איתות (מנהל)" onclick="event.stopPropagation();NTSignals.deleteSignal(\'' + s.sym + '\',\'' + s.dir + '\')">🗑</button>';
  }

  // Shared detail block (reasons, earnings, actions) for row expansion.
  function sigDetail(s) {
    var earn = earningsInfo(s.sym, s.earnDate);
    var setupTxt = SETUP_TXT[s.setup] || s.setup || '';
    var stt = signalStatus(s);
    var out = '<div class="sr-detail-grid">' +
      '<div class="sig-lvl entry"><div class="sig-lvl-label">כניסה</div><div class="sig-lvl-val">' + fmt(s.entry, s.curr) + '</div></div>' +
      '<div class="sig-lvl stop"><div class="sig-lvl-label">סטופ</div><div class="sig-lvl-val">' + fmt(s.stop, s.curr) + '</div></div>' +
      '<div class="sig-lvl tp"><div class="sig-lvl-label">יעד</div><div class="sig-lvl-val">' + fmt(s.tp, s.curr) + '</div></div>' +
    '</div>';
    var chips = '';
    if (setupTxt) chips += '<span class="sig-setup">' + esc(setupTxt) + '</span> ';
    if (s.trendType) chips += '<span class="sig-setup">מגמה ' + esc(s.trendType) + '</span> ';
    chips += '<span class="sig-setup">' + (MARKET_TXT[marketOf(s.sym)] || '') + '</span>';
    if (s.avgTurnover != null) {
      var tc = s.sym.slice(-3) === '.TA' ? '₪' : '$';
      chips += ' <span class="sig-setup vol" title="סך המסחר בדולרים/שקלים בשבוע, ממוצע 3 חודשים (מחזור = כמות מניות × מחיר)">מחזור שבועי ממוצע (3 חודשים): ' + fmtBig(s.avgTurnover * 5, tc) + '</span>';
      if (s.lastWeekTurnover != null) chips += ' <span class="sig-setup vol">שבוע אחרון: ' + fmtBig(s.lastWeekTurnover * 5, tc) + '</span>';
      if (s.avgVolume != null) chips += ' <span class="sig-setup vol" title="כמות מניות שנסחרו בשבוע, ממוצע 3 חודשים">נפח שבועי ממוצע: ' + fmtBig(s.avgVolume * 5, '') + ' מניות</span>';
    }
    if (stt.dist != null) chips += ' <span class="sig-dist ' + (Math.abs(stt.dist) <= 1.5 ? 'near' : '') + '">' + (stt.dist >= 0 ? '+' : '') + stt.dist.toFixed(1) + '% מהכניסה</span>';
    if (earn && earn.days >= 0 && canUse('earnings')) chips += ' <span class="sig-setup earn' + (earn.days <= 14 ? ' soon' : '') + '">📅 דוחות בעוד ' + earn.days + ' ימים (' + esc(earn.date) + ')</span>';
    out += '<div class="sr-chips">' + chips + '</div>';
    if (s.reasons && s.reasons.length) out += '<div class="sig-why">💡 ' + s.reasons.slice(0, 3).map(esc).join(' · ') + '</div>';
    if (earn && canUse('earnings')) {
      out += '<div class="sig-earn ' + (earn.exitToday ? 'warn' : '') + '">📅 דוח בעוד ' + earn.days + ' ימים' +
        (earn.exitToday ? ' — מומלץ לצאת יום לפני!' : '') + '</div>';
    }
    out += '<div class="sig-card-foot">' +
      '<button class="sig-btn" onclick="event.stopPropagation();NTSignals.addTrade(\'' + s.sym + '\')">הוסף לתיק</button>' +
      '<button class="sig-btn ghost" onclick="event.stopPropagation();NTSignals.setAlert(\'' + s.sym + '\')">🔔 קבע התראה</button>' +
    '</div>';
    return out;
  }

  // Compact one-line row (default view). Click to expand details.
  function signalRow(s) {
    var stt = signalStatus(s);
    var st = stt.key;
    var fav = isFav(s.sym);
    var open = !!_expanded[s.key];
    var ready = (st === 'armed' || st === 'active');
    var isLong = s.dir === 'long';
    return '<div class="sig-row ' + s.dir + (ready ? ' ready' : '') + (st === 'hit' || st === 'stopped' ? ' done' : '') + (open ? ' open' : '') + '">' +
      '<div class="sr-main" data-k="' + esc(s.key) + '" onclick="NTSignals.toggleRow(this.getAttribute(\'data-k\'))">' +
        '<button class="sig-fav sr-fav ' + (fav ? 'on' : '') + '" title="מעקב" onclick="event.stopPropagation();NTSignals.toggleFav(\'' + s.sym + '\')">' + (fav ? '★' : '☆') + '</button>' +
        '<div class="sr-sym" dir="auto"><b>' + esc(dispSym(s.sym)) + '</b>' + mktTag(s.sym) +
          (isNewSig(s) ? '<span class="sr-new">חדש</span>' : '') +
          '<small>' + esc(s.name) + '</small></div>' +
        '<span class="sr-dir ' + s.dir + '">' + (isLong ? '▲ לונג' : '▼ שורט') + '</span>' +
        '<div class="sr-lv"><small>כניסה</small>' + fmt(s.entry, s.curr) + '</div>' +
        '<div class="sr-lv stop"><small>סטופ</small>' + fmt(s.stop, s.curr) + '</div>' +
        '<div class="sr-lv tp"><small>יעד</small>' + fmt(s.tp, s.curr) + '</div>' +
        '<div class="sr-bar">' + rangeBar(s) + '</div>' +
        '<div class="sr-rr"><small>R:R</small>' + esc(String(s.rr)) + '</div>' +
        '<div class="sr-vol" title="מחזור מסחר שבועי ממוצע ל-3 חודשים"><small>מחזור שבועי ממוצע</small>' + (s.avgTurnover != null ? fmtBig(s.avgTurnover * 5, s.sym.slice(-3) === '.TA' ? '₪' : '$') : '—') + '</div>' +
        '<span class="sig-status ' + st + '" title="' + STATUS_HINT[st] + '">' + STATUS_TXT[st] + '</span>' +
        '<div class="sr-age">' + ageTxt(s.ts) + '</div>' +
        '<div class="sr-act">' + adminDelBtn(s) + '<span class="sr-chev">' + (open ? '▴' : '▾') + '</span></div>' +
      '</div>' +
      (open ? '<div class="sr-detail">' + sigDetail(s) + '</div>' : '') +
    '</div>';
  }

  function signalCard(s) {
    var stt = signalStatus(s);
    var st = stt.key;
    var dirTxt = s.dir === 'long' ? '🟢 לונג' : '🔴 שורט';
    var fav = isFav(s.sym);
    var earn = earningsInfo(s.sym, s.earnDate);
    var setupTxt = SETUP_TXT[s.setup] || s.setup || '';

    // distance-to-entry chip
    var distTxt = '';
    if (stt.dist != null) {
      var near = Math.abs(stt.dist) <= 1.5;
      distTxt = '<span class="sig-dist ' + (near ? 'near' : '') + '">' +
        (stt.dist >= 0 ? '+' : '') + stt.dist.toFixed(1) + '% מהכניסה</span>';
    }
    // earnings warning (exit 1 day before) — premium feature
    var earnTxt = '';
    if (earn && canUse('earnings')) {
      earnTxt = '<div class="sig-earn ' + (earn.exitToday ? 'warn' : '') + '">📅 דוח בעוד ' + earn.days + ' ימים' +
        (earn.exitToday ? ' — מומלץ לצאת יום לפני!' : '') + '</div>';
    }
    // short explanation (why) from the scanner reasons
    var whyTxt = '';
    if (s.reasons && s.reasons.length) {
      whyTxt = '<div class="sig-why">💡 ' + s.reasons.slice(0, 2).join(' · ') + '</div>';
    }

    return '<div class="sig-card ' + s.dir + ((st === 'armed' || st === 'active') ? ' ready' : '') + '">' +
      '<div class="sig-head">' +
        '<div><div class="sig-sym">' + esc(dispSym(s.sym)) + mktTag(s.sym) +
          (isNewSig(s) ? ' <span class="sr-new">חדש</span>' : '') +
          (setupTxt ? ' <span class="sig-setup">' + setupTxt + '</span>' : '') +
          (earn && earn.days >= 0 && canUse('earnings') ? ' <span class="sig-setup earn' + (earn.days <= 14 ? ' soon' : '') + '">📅 דוחות בעוד ' + earn.days + ' ימים</span>' : '') + '</div>' +
        '<div class="sig-name">' + s.name + ' · ' + ageTxt(s.ts) + '</div></div>' +
        '<div class="sig-head-right">' +
          adminDelBtn(s) +
          '<button class="sig-fav ' + (fav ? 'on' : '') + '" title="קבל התראה על מניה זו" onclick="NTSignals.toggleFav(\'' + s.sym + '\')">' + (fav ? '★' : '☆') + '</button>' +
          '<span class="sig-dir ' + s.dir + '">' + dirTxt + '</span>' +
        '</div>' +
      '</div>' +
      rangeBar(s) +
      '<div class="sig-levels">' +
        '<div class="sig-lvl entry"><div class="sig-lvl-label">כניסה</div><div class="sig-lvl-val">' + fmt(s.entry, s.curr) + '</div></div>' +
        '<div class="sig-lvl stop"><div class="sig-lvl-label">סטופ</div><div class="sig-lvl-val">' + fmt(s.stop, s.curr) + '</div></div>' +
        '<div class="sig-lvl tp"><div class="sig-lvl-label">יעד</div><div class="sig-lvl-val">' + fmt(s.tp, s.curr) + '</div></div>' +
      '</div>' +
      whyTxt +
      earnTxt +
      '<div class="sig-meta">' +
        '<span class="sig-rr">יחס סיכוי/סיכון ' + s.rr + '</span>' +
        (s.avgTurnover != null ? '<span class="sig-dist" title="מחזור מסחר שבועי ממוצע ל-3 חודשים">💵 מחזור שבועי: ' + fmtBig(s.avgTurnover * 5, s.sym.slice(-3) === '.TA' ? '₪' : '$') + '</span>' : '') +
        distTxt +
        '<span class="sig-status ' + st + '">' + STATUS_TXT[st] + '</span>' +
      '</div>' +
      '<div class="sig-card-foot">' +
        '<button class="sig-btn" onclick="NTSignals.addTrade(\'' + s.sym + '\')">הוסף לתיק</button>' +
        '<button class="sig-btn ghost" onclick="NTSignals.setAlert(\'' + s.sym + '\')">🔔 קבע התראה</button>' +
      '</div>' +
    '</div>';
  }

  // "What to do now" hero: the single most actionable signal (armed/active).
  function heroCard(sigs) {
    var ranked = sigs.slice().map(function (s) {
      var k = signalStatus(s).key;
      var score = k === 'active' ? 3 : (k === 'armed' ? 2 : 0);
      return { s: s, score: score };
    }).filter(function (x) { return x.score > 0; })
      .sort(function (a, b) { return b.score - a.score || b.s.ts - a.s.ts; });
    if (!ranked.length) return '';
    var s = ranked[0].s;
    var stt = signalStatus(s);
    var action = stt.key === 'active'
      ? 'המחיר בטווח הכניסה — אפשר להוסיף לתיק עכשיו'
      : 'המחיר קרוב מאוד לכניסה — היכון וקבע התראה';
    return '<div class="sf-hero ' + s.dir + '">' +
      '<div class="sf-hero-tag">⚡ מה עושים עכשיו</div>' +
      '<div class="sf-hero-sym">' + esc(dispSym(s.sym)) + ' · ' + (s.dir === 'long' ? 'לונג' : 'שורט') + '</div>' +
      '<div class="sf-hero-action">' + action + '</div>' +
      '<div class="sf-hero-levels">כניסה ' + fmt(s.entry, s.curr) + ' · סטופ ' + fmt(s.stop, s.curr) + ' · יעד ' + fmt(s.tp, s.curr) + '</div>' +
      '<div class="sf-hero-foot">' +
        '<button class="sig-btn" onclick="NTSignals.addTrade(\'' + s.sym + '\')">הוסף לתיק</button>' +
        '<button class="sig-btn ghost" onclick="NTSignals.setAlert(\'' + s.sym + '\')">🔔 קבע התראה</button>' +
      '</div>' +
    '</div>';
  }

  // Performance summary: win rate, avg R, current win streak (from closed trades).
  function perfSummary() {
    var closed = loadTrades().filter(function (t) { return t.status === 'closed'; })
                             .sort(function (a, b) { return (a.closeTs || 0) - (b.closeTs || 0); });
    if (!closed.length) return '';
    // Advanced performance summary is a premium feature.
    if (!canUse('perf')) {
      return '<div class="sf-upsell">' +
        '<div class="sf-upsell-txt">' +
          '<div class="sf-upsell-title">📊 סיכום ביצועים</div>' +
          '<div class="sf-upsell-sub">אחוז הצלחה, ממוצע R ורצף נצחונות — זמין בפרימיום.</div>' +
        '</div>' +
        '<button class="sf-upsell-btn" onclick="NTSignals.openUpgrade()">⭐ שדרג</button>' +
      '</div>';
    }
    var wins = 0, rSum = 0, rCount = 0, streak = 0, bestStreak = 0, cur = 0;
    closed.forEach(function (t) {
      var win = (t.pnl || 0) >= 0;
      if (win) wins++;
      // R multiple = pnl% / risk%; approximate R from entry/stop if available
      if (t.entry != null && t.stop != null && t.pnlPct != null) {
        var riskPct = Math.abs((t.entry - t.stop) / t.entry) * 100;
        if (riskPct > 0) { rSum += (t.pnlPct / riskPct); rCount++; }
      }
      if (win) { cur++; if (cur > bestStreak) bestStreak = cur; } else { cur = 0; }
    });
    streak = cur;
    var winRate = Math.round(wins / closed.length * 100);
    var avgR = rCount ? (rSum / rCount) : null;
    return '<div class="sf-perf">' +
      '<div class="sf-perf-item"><div class="sf-perf-label">אחוז הצלחה</div><div class="sf-perf-val">' + winRate + '%</div></div>' +
      '<div class="sf-perf-item"><div class="sf-perf-label">ממוצע R</div><div class="sf-perf-val ' + (avgR != null && avgR >= 0 ? 'pos' : 'neg') + '">' + (avgR != null ? (avgR >= 0 ? '+' : '') + avgR.toFixed(2) + 'R' : '--') + '</div></div>' +
      '<div class="sf-perf-item"><div class="sf-perf-label">רצף נצחונות</div><div class="sf-perf-val">' + streak + '</div></div>' +
      '<div class="sf-perf-item"><div class="sf-perf-label">רצף שיא</div><div class="sf-perf-val">' + bestStreak + '</div></div>' +
    '</div>';
  }

  // De-duped (symbol+direction, newest wins) normalized signals.
  function dedupedSignals() {
    var sigs = loadSignals();
    var seen = {}, uniq = [];
    sigs.sort(function (a, b) { return b.ts - a.ts; });
    sigs.forEach(function (s) {
      var k = s.sym + '_' + s.dir;
      if (seen[k]) return; seen[k] = true; uniq.push(s);
    });
    return uniq;
  }

  function isReadySig(s) { var k = signalStatus(s).key; return k === 'armed' || k === 'active'; }

  // Chips + (grouped) list + upsell. Re-rendered on its own when filtering/typing.
  function renderSigDyn() {
    var uniq = dedupedSignals();
    var tf = (textFilter || '').trim().toLowerCase();
    var base = uniq.filter(function (s) {
      if (marketFilter !== 'all' && marketOf(s.sym) !== marketFilter) return false;
      if (tf && (s.sym || '').toLowerCase().indexOf(tf) === -1 && (s.name || '').toLowerCase().indexOf(tf) === -1) return false;
      return true;
    });
    var cnt = { all: base.length, long: 0, short: 0, ready: 0, fav: 0 };
    base.forEach(function (s) {
      if (s.dir === 'long') cnt.long++; else cnt.short++;
      if (isReadySig(s)) cnt.ready++;
      if (isFav(s.sym)) cnt.fav++;
    });
    function chip(k, label) {
      return '<button class="sf-chip ' + k + (filterKey === k ? ' active' : '') + '" onclick="NTSignals.setFilter(\'' + k + '\')">' +
        label + ' <b>' + cnt[k] + '</b></button>';
    }
    var filterBar = '<div class="sf-chips">' +
      chip('all', 'הכל') + chip('long', '▲ לונג') + chip('short', '▼ שורט') + chip('ready', '⚡ קרובות לכניסה') + chip('fav', '★ מועדפים') +
    '</div>';

    var list = base.filter(function (s) {
      if (filterKey === 'long') return s.dir === 'long';
      if (filterKey === 'short') return s.dir === 'short';
      if (filterKey === 'ready') return isReadySig(s);
      if (filterKey === 'fav') return isFav(s.sym);
      return true;
    });
    if (sortBy === 'entry') {
      list.sort(function (a, b) {
        var da = signalStatus(a).dist, db = signalStatus(b).dist;
        da = da == null ? 1e9 : Math.abs(da); db = db == null ? 1e9 : Math.abs(db);
        return da - db || b.ts - a.ts;
      });
    } else if (sortBy === 'rr') {
      list.sort(function (a, b) { return rrNum(b) - rrNum(a) || b.ts - a.ts; });
    } else {
      list.sort(function (a, b) { return b.ts - a.ts; });
    }

    if (!list.length) {
      var emptyMsg;
      if (!uniq.length) {
        emptyMsg = 'אין איתותים פעילים כרגע.<br>הסורק רץ ברקע ומעדכן אוטומטית — איתותים חדשים יופיעו כאן.';
      } else if (filterKey === 'fav') {
        emptyMsg = 'אין איתותים במניות המועדפות שלך כרגע.<br>סמן מניות בכוכב כדי לקבל עליהן התראות.';
      } else {
        emptyMsg = 'אין איתותים שמתאימים לסינון.<br><button class="sf-filter-btn" onclick="NTSignals.resetFilters()">נקה סינון</button>';
      }
      return filterBar + '<div class="sf-empty">' + emptyMsg + '</div>';
    }

    // Free-tier cap + upsell. When the SERVER feed is active, enforcement already
    // happened server-side (delayed + capped), so we tease using the real total it
    // reported. Otherwise (local fallback) we cap client-side.
    var upsell = '';
    if (_serverInfo) {
      if (!_serverInfo.isPremium && _serverInfo.total > uniq.length && filterKey !== 'fav') {
        var hiddenS = _serverInfo.total - uniq.length;
        var goldTier = _serverInfo.tier === 'gold';
        upsell = '<div class="sf-upsell">' +
          '<div class="sf-upsell-txt">' +
            '<div class="sf-upsell-title">🔒 יש עוד ' + hiddenS + ' איתותים</div>' +
            '<div class="sf-upsell-sub">' + (goldTier
              ? 'במסלול גולד מוצגים עד ' + uniq.length + ' איתותים בזמן אמת. שדרג לפרימיום לקבל את הכל ללא הגבלה.'
              : 'במסלול הבסיסי האיתותים מוצגים בעיכוב ובכמות מוגבלת. שדרג כדי לקבל את הכל בזמן אמת.') + '</div>' +
          '</div>' +
          '<button class="sf-upsell-btn" onclick="NTSignals.openUpgrade()">⭐ שדרג</button>' +
        '</div>';
      }
    } else {
      var cap = sigCap();
      if (cap !== Infinity && list.length > cap) {
        var hidden = list.length - cap;
        list = list.slice(0, cap);
        upsell = '<div class="sf-upsell">' +
          '<div class="sf-upsell-txt">' +
            '<div class="sf-upsell-title">🔒 יש עוד ' + hidden + ' איתותים חדשים</div>' +
            '<div class="sf-upsell-sub">במסלול שלך (' + tierLabel() + ') מוצגים ' + cap + ' איתותים. שדרג כדי לראות את כולם בזמן אמת.</div>' +
          '</div>' +
          '<button class="sf-upsell-btn" onclick="NTSignals.openUpgrade()">⭐ שדרג</button>' +
        '</div>';
      }
    }

    // Group: ready to enter → waiting → finished (hit / stopped)
    var gReady = [], gWait = [], gDone = [];
    list.forEach(function (s) {
      var k = signalStatus(s).key;
      if (k === 'armed' || k === 'active') gReady.push(s);
      else if (k === 'hit' || k === 'stopped') gDone.push(s);
      else gWait.push(s);
    });
    var groups = [
      { t: '⚡ קרובות לכניסה', cls: 'ready', items: gReady },
      { t: '👀 ממתינות לכניסה', cls: 'wait', items: gWait },
      { t: '✓ הושלמו / נפגעו', cls: 'done', items: gDone }
    ].filter(function (g) { return g.items.length; });
    var showHeads = groups.length > 1;
    var body = groups.map(function (g) {
      var inner = viewMode === 'cards'
        ? '<div class="sf-grid">' + g.items.map(signalCard).join('') + '</div>'
        : '<div class="sig-rows">' + g.items.map(signalRow).join('') + '</div>';
      return (showHeads ? '<div class="sig-group ' + g.cls + '"><span>' + g.t + '</span><b>' + g.items.length + '</b></div>' : '') + inner;
    }).join('');

    return filterBar + body + upsell;
  }

  function renderSignals() {
    var uniq = dedupedSignals();   // also refreshes _serverInfo
    var perf = perfSummary();
    var hero = (filterKey === 'all' && !textFilter && marketFilter === 'all') ? heroCard(uniq) : '';

    // live status strip
    var lastScan = _serverInfo && _serverInfo.lastScan;
    var resting = false;
    try {
      var wd = new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Jerusalem', weekday: 'short' });
      resting = (wd === 'Sat' || wd === 'Sun');
    } catch (e) {}
    var live = '<div class="sf-live-bar">' +
      (resting
        ? '<span class="sf-live rest"><i></i>סוף שבוע</span><span class="sf-live-txt">הסורק עוצר בשבת ובראשון (אין מסחר) · חוזר ביום שני' + (lastScan ? ' · סריקה אחרונה ' + ageTxt(lastScan) : '') + '</span>'
        : '<span class="sf-live"><i></i>LIVE</span><span class="sf-live-txt">הסורק פעיל' + (lastScan ? ' · עודכן ' + ageTxt(lastScan) : '') + '</span>') +
      (isAdmin() && uniq.length ? '<button class="sf-clearall" onclick="NTSignals.clearAllSignals()">🗑 מחק הכל (מנהל)</button>' : '') +
    '</div>';

    // toolbar: search, sort, market, view toggle
    var mk = {}, mkN = 0;
    uniq.forEach(function (s) { var m = marketOf(s.sym); if (!mk[m]) { mk[m] = 1; mkN++; } });
    var marketSel = '';
    if (mkN > 1) {
      marketSel = '<select class="sf-sel" onchange="NTSignals.setMarket(this.value)">' +
        '<option value="all"' + (marketFilter === 'all' ? ' selected' : '') + '>כל השווקים</option>' +
        Object.keys(mk).map(function (m) { return '<option value="' + m + '"' + (marketFilter === m ? ' selected' : '') + '>' + MARKET_TXT[m] + '</option>'; }).join('') +
      '</select>';
    }
    var toolbar = '<div class="sf-toolbar">' +
      '<input id="sigTextFilter" class="sf-search" type="search" placeholder="🔍 חפש מניה…" value="' + esc(textFilter) + '" oninput="NTSignals.onFilterText(this.value)" autocomplete="off">' +
      '<select class="sf-sel" onchange="NTSignals.setSort(this.value)">' +
        '<option value="newest"' + (sortBy === 'newest' ? ' selected' : '') + '>מיון: החדשים ביותר</option>' +
        '<option value="entry"' + (sortBy === 'entry' ? ' selected' : '') + '>מיון: הקרובים לכניסה</option>' +
        '<option value="rr"' + (sortBy === 'rr' ? ' selected' : '') + '>מיון: יחס סיכוי/סיכון</option>' +
      '</select>' +
      marketSel +
      '<div class="sf-viewtog">' +
        '<button class="' + (viewMode === 'list' ? 'active' : '') + '" title="רשימה" onclick="NTSignals.setView(\'list\')">☰</button>' +
        '<button class="' + (viewMode === 'cards' ? 'active' : '') + '" title="כרטיסים" onclick="NTSignals.setView(\'cards\')">▦</button>' +
      '</div>' +
    '</div>';

    var riskBanner = '<button class="rk-banner" onclick="NTSignals.switchTab(\'risk\')">' +
      '<span class="rk-banner-ic">🛡️</span>' +
      '<span class="rk-banner-txt"><b>לפני שנכנסים לעסקה - נהל סיכונים</b><small>כלל ה-1%, סטופ לוס ויחס סיכוי/סיכון · לחץ לקריאה</small></span>' +
      '<span class="rk-banner-go">←</span></button>';
    return trialStripHtml() + earnBannerHtml() + riskBanner + perf + hero + live + toolbar + '<div id="sigDyn">' + renderSigDyn() + '</div>';
  }

  // TASE stocks are quoted in agorot by Yahoo: show/compute everything in shekels (÷100).
  function tDiv(t) { return (/\.TA$/i.test(t.sym) && t.curr === '₪') ? 100 : 1; }
  function tGroup(t) { return /\.TA$/i.test(t.sym) ? 'il' : 'us'; }
  function tClosedPnl(t) { return t.pnl == null ? 0 : (t.pnlV2 ? t.pnl : t.pnl / tDiv(t)); }
  // Signed money, e.g. -$5.96 / +₪562.50 (forced LTR so the sign stays attached to the amount).
  function fmtM(n, cur, plus) {
    if (n == null || isNaN(n)) return '--';
    return '<span dir="ltr">' + (n < 0 ? '-' : (plus ? '+' : '')) + (cur || '') + Math.abs(n).toFixed(2) + '</span>';
  }
  function fmtP(n, t) { return n == null ? '--' : fmt(n / tDiv(t), t.curr); }

  function tradePnl(t, live) {
    if (live == null) return { abs: null, pct: null };
    var sign = t.dir === 'long' ? 1 : -1;
    var shares = t.shares || 1;
    var abs = (live - t.entry) * sign * shares / tDiv(t);
    var p = ((live - t.entry) / t.entry) * 100 * sign;
    return { abs: abs, pct: p };
  }

  function tradeRow(t, isOpen) {
    var live = isOpen ? livePrice(t.sym) : t.closePrice;
    var pnl = isOpen ? tradePnl(t, live) : { abs: t.pnl == null ? null : tClosedPnl(t), pct: t.pnlPct };
    var cls = (pnl.abs == null) ? '' : (pnl.abs >= 0 ? 'pos' : 'neg');
    var dirTxt = t.dir === 'long' ? 'לונג' : 'שורט';
    var pnlTxt = (pnl.abs == null) ? '--' : (fmtM(pnl.abs, t.curr, true) + ' (' + pct(pnl.pct) + ')');
    return '<div class="trade-row">' +
      '<div><span class="tr-sym">' + esc(dispSym(t.sym)) + '</span>' +
        '<br><span class="tr-dir ' + t.dir + '">' + dirTxt + '</span></div>' +
      '<div><div class="tr-cell-label">כניסה</div>' + fmtP(t.entry, t) + '</div>' +
      '<div><div class="tr-cell-label">' + (isOpen ? 'מחיר נוכחי' : 'מחיר סגירה') + '</div>' + fmtP(live, t) + '</div>' +
      '<div><div class="tr-cell-label">סטופ / יעד</div>' + fmtP(t.stop, t) + ' / ' + fmtP(t.tp, t) + '</div>' +
      '<div><div class="tr-cell-label">רווח/הפסד</div><span class="tr-pnl ' + cls + '">' + pnlTxt + '</span></div>' +
      '<div>' + (isOpen
          ? '<button class="tr-close-btn" onclick="NTSignals.closeTrade(\'' + t.id + '\')">סגור עסקה</button>'
          : '<span class="tr-cell-label">' + (t.closeDate || '') + '</span>') +
      '</div>' +
    '</div>';
  }

  var T_GROUPS = [
    { k: 'us', cur: '$', title: 'מניות ארה״ב ($ דולר)' },
    { k: 'il', cur: '₪', title: 'מניות ישראל (₪ שקל)' }
  ];
  function statBox(label, val, cls) {
    return '<div class="sf-stat"><div class="sf-stat-label">' + label + '</div><div class="sf-stat-val ' + (cls || '') + '">' + val + '</div></div>';
  }

  function renderTrades() {
    var trades = loadTrades();
    var open = trades.filter(function (t) { return t.status === 'open'; });
    var html = '<div class="sf-trades">';
    if (!open.length) {
      html += '<div class="sf-empty">אין עסקאות פתוחות. הוסף עסקה מלוח האיתותים.</div></div>';
      return html;
    }
    T_GROUPS.forEach(function (g) {
      var gOpen = open.filter(function (t) { return tGroup(t) === g.k; });
      if (!gOpen.length) return;
      var gClosed = trades.filter(function (t) { return t.status === 'closed' && tGroup(t) === g.k; });
      var openPnl = 0, haveLive = false;
      gOpen.forEach(function (t) { var p = tradePnl(t, livePrice(t.sym)); if (p.abs != null) { openPnl += p.abs; haveLive = true; } });
      var realized = gClosed.reduce(function (s, t) { return s + tClosedPnl(t); }, 0);
      var wins = gClosed.filter(function (t) { return tClosedPnl(t) >= 0; }).length;
      var winRate = gClosed.length ? Math.round(wins / gClosed.length * 100) + '%' : '--';
      html += '<div class="sf-sec-title">' + g.title + '</div>';
      html += '<div class="sf-stats">' +
        statBox('עסקאות פתוחות', gOpen.length) +
        statBox('רווח/הפסד פתוח', haveLive ? fmtM(openPnl, g.cur, true) : '--', haveLive ? (openPnl >= 0 ? 'pos' : 'neg') : '') +
        statBox('רווח/הפסד ממומש', fmtM(realized, g.cur, true), realized >= 0 ? 'pos' : 'neg') +
        statBox('אחוז הצלחה', winRate) +
      '</div>';
      html += '<div class="sf-rows-head"><div>מניה</div><div>כניסה</div><div>מחיר נוכחי</div><div>סטופ / יעד</div><div>רווח/הפסד</div><div></div></div>';
      html += gOpen.map(function (t) { return tradeRow(t, true); }).join('');
    });
    if (_tradePxTs) html += '<div class="tr-cell-label" style="text-align:center;margin-top:.6rem">🟢 מחירים בזמן אמת · עודכן ' + new Date(_tradePxTs).toLocaleTimeString('he-IL') + '</div>';
    html += '</div>';
    return html;
  }

  function renderHistory() {
    var trades = loadTrades();
    var closed = trades.filter(function (t) { return t.status === 'closed'; })
                       .sort(function (a, b) { return (b.closeTs || 0) - (a.closeTs || 0); });
    if (!closed.length) {
      return '<div class="sf-empty">אין היסטוריית עסקאות עדיין.<br>עסקאות שתסגור יתועדו כאן למעקב.</div>';
    }
    var html = '<div class="sf-trades">';
    T_GROUPS.forEach(function (g) {
      var gc = closed.filter(function (t) { return tGroup(t) === g.k; });
      if (!gc.length) return;
      var realized = gc.reduce(function (s, t) { return s + tClosedPnl(t); }, 0);
      var wins = gc.filter(function (t) { return tClosedPnl(t) >= 0; }).length;
      html += '<div class="sf-sec-title">' + g.title + '</div>';
      html += '<div class="sf-stats">' +
        statBox('סה״כ עסקאות', gc.length) +
        statBox('מנצחות', wins, 'pos') +
        statBox('מפסידות', gc.length - wins, 'neg') +
        statBox('רווח/הפסד כולל', fmtM(realized, g.cur, true), realized >= 0 ? 'pos' : 'neg') +
      '</div>';
      html += '<div class="sf-rows-head"><div>מניה</div><div>כניסה</div><div>מחיר סגירה</div><div>סטופ / יעד</div><div>רווח/הפסד</div><div>תאריך</div></div>';
      html += gc.map(function (t) { return tradeRow(t, false); }).join('');
    });
    html += '</div>';
    return html;
  }

  // Alerts log (bell): chronological list of every signal the scanner fired.
  function renderAlertsLog() {
    // Full alerts log is a premium feature.
    if (!canUse('alertsLog')) {
      return '<div class="sf-locked">' +
        '<div class="sf-locked-ic">🔔</div>' +
        '<div class="sf-locked-title">יומן התראות מלא</div>' +
        '<div class="sf-locked-sub">עקוב אחרי כל איתות שהסורק שלח, בתיעוד כרונולוגי מלא.<br>הפיצ׳ר זמין במסלול פרימיום.</div>' +
        '<button class="sf-locked-btn" onclick="NTSignals.openUpgrade()">⭐ שדרג לפרימיום</button>' +
      '</div>';
    }
    var raw;
    // Prefer the authoritative server feed (premium users), else the local log.
    var sc = loadServerCache();
    if (sc && Array.isArray(sc.data) && sc.data.length) { raw = sc.data; }
    else { try { raw = JSON.parse(localStorage.getItem(ALERTS_KEY) || '[]'); } catch (e) { raw = []; } }
    if (!raw.length) {
      return '<div class="sf-empty">יומן ההתראות ריק.<br>כאן יופיע תיעוד כרונולוגי של כל איתות שהסורק שלח.</div>';
    }
    var rows = raw.slice(0, 80).map(function (a) {
      var isShort = a.direction === 'short' || a.direction === 'bearish' || a.condition === 'sell_signal';
      var icon = isShort ? '🔴' : '🟢';
      var sym = dispSym(a.sym);
      var when = (a.date || '') + (a.time ? ' · ' + a.time : '');
      var line = a.msg || (icon + ' ' + sym);
      return '<div class="sf-log-row">' +
        '<div class="sf-log-icon">' + icon + '</div>' +
        '<div class="sf-log-body">' +
          '<div class="sf-log-sym">' + sym + '</div>' +
          '<div class="sf-log-msg">' + line + '</div>' +
          '<div class="sf-log-when">' + when + '</div>' +
        '</div>' +
      '</div>';
    }).join('');
    return '<div class="sf-log">' + rows + '</div>';
  }

  // ---------- legal disclaimer + risk-management education ----------
  var DISC_ITEMS = [
    'המידע והאיתותים שיפורסמו כאן אינם מהווים ייעוץ השקעות, המלצה לקנייה או מכירה של ניירות ערך, או תחליף לייעוץ מקצועי מורשה.',
    'השירות אינו מורשה על ידי רשות ניירות ערך הישראלית כיועץ השקעות.',
    'כל החלטת השקעה היא באחריות המשתמש בלבד ואין לראות בו תחליף לבדיקה עצמאית או לייעוץ מקצועי.',
    'אני לא יועץ מוסמך וכל הנאמר משקף את דעתנו האישית בלבד.',
    'הביצועים שהוצגו בעבר אינם מבטיחים תוצאות דומות בעתיד.',
    'שוק ההון הינו שוק תנודתי ומסוכן - לא מתאים לכל אחד.',
    'הציבור מתבקש לבצע בדיקה מעמיקה והתייעצות עם גורמים מוסמכים לפני קבלת החלטת קנייה.'
  ];
  function disclaimerHtml() {
    return '<div class="rk-disc"><div class="rk-disc-h">⚖️ דיסקליימר - הסתייגות משפטית*</div><ul>' +
      DISC_ITEMS.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div>';
  }
  // Persistent one-line bar under every tab; click to expand the full text.
  function renderDiscBar() {
    var el = document.getElementById('sfDisc');
    if (!el || el.getAttribute('data-ready')) return;
    el.setAttribute('data-ready', '1');
    el.innerHTML = '<button class="sf-disc-btn" onclick="NTSignals.toggleDisc()">⚠️ אין באיתותים ייעוץ השקעות · הסתייגות משפטית מלאה <span id="sfDiscArrow">▲</span></button>' +
      '<div class="sf-disc-full" id="sfDiscFull">' + disclaimerHtml() + '</div>';
  }
  function toggleDisc() {
    var f = document.getElementById('sfDiscFull');
    var a = document.getElementById('sfDiscArrow');
    if (!f) return;
    var open = !f.classList.contains('open');
    f.classList.toggle('open', open);
    if (a) a.textContent = open ? '▼' : '▲';
  }

  function riskCalc() {
    var out = document.getElementById('rkOut');
    if (!out) return;
    var g = function (id) { var e = document.getElementById(id); return e ? parseFloat(e.value) : NaN; };
    var port = g('rkPort'), pc = g('rkPct'), entry = g('rkEntry'), stop = g('rkStop');
    if (!(port > 0) || !(pc > 0) || !(entry > 0) || !(stop > 0) || entry === stop) {
      out.innerHTML = '<div class="rk-out-empty">מלא את כל השדות (מחיר כניסה וסטופ חייבים להיות שונים) כדי לחשב.</div>';
      return;
    }
    var riskAmt = port * pc / 100;
    var perShare = Math.abs(entry - stop);
    var shares = Math.floor(riskAmt / perShare);
    var posVal = shares * entry;
    var posPct = posVal / port * 100;
    var target = entry + 2 * (entry - stop);
    var nf = function (n, d) { return Number(n).toLocaleString('he-IL', { maximumFractionDigits: d == null ? 0 : d }); };
    var warn = posVal > port ? '<div class="rk-warn">⚠️ שווי הפוזיציה גדול מהתיק - נדרשת מינוף. מומלץ לצמצם או להרחיק סטופ.</div>' : '';
    out.innerHTML =
      '<div class="rk-out-grid">' +
        '<div><span>סיכון מקסימלי לעסקה</span><b>' + nf(riskAmt, 2) + '</b></div>' +
        '<div><span>סיכון למניה</span><b>' + nf(perShare, 2) + '</b></div>' +
        '<div class="big"><span>כמות מניות מקסימלית</span><b>' + nf(shares) + '</b></div>' +
        '<div><span>שווי הפוזיציה</span><b>' + nf(posVal) + ' (' + nf(posPct, 1) + '% מהתיק)</b></div>' +
        '<div><span>יעד ביחס 1:2</span><b>' + nf(target, 2) + '</b></div>' +
        '<div><span>רווח אפשרי ביעד 1:2</span><b class="pos">+' + nf(shares * perShare * 2) + '</b></div>' +
      '</div>' + warn;
  }

  function renderRisk() {
    var sp = portLoad().vals, prePort = sp['₪'] || sp['$'] || 100000;
    var tbl = [['1%', '~22'], ['2%', '~11'], ['5%', '~4'], ['10%', '~2']].map(function (r, i) {
      return '<tr' + (i === 0 ? ' class="best"' : '') + '><td>' + r[0] + '</td><td>' + r[1] + ' הפסדים רצופים</td></tr>';
    }).join('');
    return '<div class="rk" id="riskPanel">' +
      '<div class="rk-hero"><div class="rk-shield">🛡️</div>' +
        '<h2>ניהול סיכונים</h2>' +
        '<p>ניהול סיכונים הוא הבסיס של כל מסחר מוצלח לטווח ארוך. רוב הסוחרים המתחילים מתמקדים בלמצוא "עסקאות מנצחות", אבל הסוחרים המקצועיים יודעים שהשרידות בשוק תלויה קודם כל בשמירה על ההון.</p>' +
        '<div class="rk-quote">המטרה הראשונה של כל סוחר היא <b>לשמור על ההון</b>.<br>המטרה השנייה היא לצמוח אותו.</div>' +
      '</div>' +

      '<div class="rk-card rk-gold"><div class="rk-h"><span class="rk-ic">💡</span>למה ניהול סיכונים חשוב יותר מלמצוא עסקאות טובות?</div>' +
        '<p>גם הסוחר הטוב ביותר מפסיד בחלק מהעסקאות. מי שמנהל סיכון נכון יכול <b>לטעות הרבה ועדיין לרוויח</b>, ומי שלא - מספיקות כמה עסקאות רעות כדי להיעלם מהשוק.</p></div>' +

      '<div class="rk-card rk-rule"><div class="rk-bigpct">1%</div><div>' +
        '<div class="rk-h">כלל ה-1% לעסקה</div>' +
        '<p><b>בכל עסקה בודדת, לא מסכנים יותר מ-1% מסך התיק.</b></p></div></div>' +

      '<div class="rk-card"><div class="rk-h"><span class="rk-ic">🧮</span>דוגמה מספרית</div>' +
        '<ul class="rk-steps">' +
          '<li>תיק של <b>100,000 ש"ח</b></li>' +
          '<li>סיכון מקסימלי לעסקה: <b>1,000 ש"ח</b></li>' +
          '<li>קניתם מניה ב-50 ש"ח, עם סטופ לוס ב-47 ש"ח (סיכון של 3 ש"ח למניה)</li>' +
          '<li>כמות מניות מקסימלית: 1,000 ÷ 3 = <b>333 מניות</b></li>' +
        '</ul></div>' +

      '<div class="rk-card rk-calc"><div class="rk-h"><span class="rk-ic">⚙️</span>מחשבון גודל פוזיציה</div>' +
        '<div class="rk-form">' +
          '<label>גודל התיק<input id="rkPort" type="number" inputmode="decimal" value="' + prePort + '" oninput="NTSignals.riskCalc()"></label>' +
          '<label>סיכון לעסקה (%)<input id="rkPct" type="number" inputmode="decimal" step="0.1" value="1" oninput="NTSignals.riskCalc()"></label>' +
          '<label>מחיר כניסה<input id="rkEntry" type="number" inputmode="decimal" step="any" value="50" oninput="NTSignals.riskCalc()"></label>' +
          '<label>מחיר סטופ לוס<input id="rkStop" type="number" inputmode="decimal" step="any" value="47" oninput="NTSignals.riskCalc()"></label>' +
        '</div><div id="rkOut"></div></div>' +

      '<div class="rk-card"><div class="rk-h"><span class="rk-ic">📉</span>למה דווקא 1%? עמידות בפני רצף הפסדים</div>' +
        '<table class="rk-tbl"><thead><tr><th>% סיכון לעסקה</th><th>הפסדים רצופים עד אובדן 20% מהתיק</th></tr></thead><tbody>' + tbl + '</tbody></table>' +
        '<p>גם סוחר מעולה חווה רצפי הפסדים. עם כלל ה-1%, אפשר לשרוד אותם ולהישאר במשחק.</p></div>' +

      '<div class="rk-title">⚔️ עקרונות ברזל</div>' +
      '<div class="rk-iron">' +
        '<div class="rk-card rk-i"><div class="rk-num">1</div><div class="rk-h">יחס סיכוי/סיכון</div>' +
          '<p>לא כדאי להיכנס לעסקה שבה מסכנים 1,000 ש"ח כדי להרוויח 500. היחס המינימלי המומלץ הוא <b>1:2</b> (מסכנים 1, מצפים לרווח של 2).</p></div>' +
        '<div class="rk-card rk-i"><div class="rk-num">2</div><div class="rk-h">סטופ לוס - חובה, לא אופציה</div>' +
          '<p>הסטופ לוס הוא הכלי שמגדיר את ה-1%. בלי סטופ לוס, אין ניהול סיכונים - יש רק תקווה.</p></div>' +
        '<div class="rk-card rk-i"><div class="rk-num">3</div><div class="rk-h">גודל פוזיציה</div>' +
          '<p>ה-1% לא אומר להשקיע רק 1% מהתיק - אפשר לקנות הרבה מניות, כל עוד <b>ההפסד המקסימלי</b> (מחיר כניסה מינוס סטופ, כפול כמות) הוא 1%.</p></div>' +
      '</div>' +

      '<div class="rk-card rk-win"><div class="rk-h"><span class="rk-ic">🏆</span>הכוח של הניהול הנכון</div>' +
        '<p>ניהול סיכון נכון מאפשר לך <b>לטעות הרבה ועדיין לרוויח</b>. אם שיעור ההצלחה שלך הוא 50% ויחס הסיכוי/סיכון הוא 1:2 - אתה רווחי לאורך זמן, גם אם חצי מהעסקאות שלך מפסידות.</p></div>' +

      disclaimerHtml() +
    '</div>';
  }

  function render() {
    var body = document.getElementById('sfBody');
    if (!body) return;
    renderDiscBar();
    // The risk tab already shows the full disclaimer in its red box - hide the bottom bar there.
    var discEl = document.getElementById('sfDisc');
    if (discEl) discEl.style.display = (activeTab === 'risk') ? 'none' : '';
    if (activeTab === 'signals') {
      // While typing in the search box, only refresh the list (keeps focus/caret).
      var tfEl = document.getElementById('sigTextFilter');
      var dyn = document.getElementById('sigDyn');
      if (tfEl && dyn && document.activeElement === tfEl) dyn.innerHTML = renderSigDyn();
      else body.innerHTML = renderSignals();
    }
    else if (activeTab === 'trades') body.innerHTML = renderTrades();
    else if (activeTab === 'history') body.innerHTML = renderHistory();
    else if (activeTab === 'alerts') body.innerHTML = renderAlertsLog();
    else if (activeTab === 'risk') {
      // Static content; never rebuild while the user is typing in the calculator.
      if (!document.getElementById('riskPanel')) { body.innerHTML = renderRisk(); riskCalc(); }
    }
    else if (activeTab === 'ai') {
      // Never rebuild the AI panel while the user is typing; only refresh the quota line.
      if (!document.getElementById('aiPanel')) { body.innerHTML = renderAI(); loadAiQuota(); }
      else { loadAiQuota(); updateAiQuotaUI(); }
    }
    renderHeaderChrome();
  }

  // Keep the header avatar, user menu, and trial banner in sync with the user/plan.
  function renderHeaderChrome() {
    var u = document.getElementById('userNameDisplay');
    var name = (u && u.textContent) ? u.textContent.trim() : 'משתמש';
    var av = document.getElementById('sfAvatar');
    if (av) av.textContent = (name.charAt(0) || '?').toUpperCase();
    var mn = document.getElementById('sfUserMenuName');
    if (mn) mn.textContent = name;

    var premium = false, trialActive = false, days = 0, paid = false, tid = 'free';
    try {
      premium = window.NTPlan ? window.NTPlan.isPremium() : false;
      paid = window.NTPlan ? window.NTPlan.isPaid() : false;
      tid = window.NTPlan ? window.NTPlan.tier() : 'free';
      trialActive = window.NTPlan ? window.NTPlan.isTrialActive() : false;
      days = window.NTPlan ? window.NTPlan.daysLeft() : 0;
    } catch (e) {}

    var mp = document.getElementById('sfUserMenuPlan');
    if (mp) {
      mp.textContent = trialActive ? ('ניסיון פרימיום · נותרו ' + days + ' ימים')
        : (premium ? 'מנוי פרימיום פעיל' : (paid ? 'מנוי גולד פעיל' : 'מסלול בסיסי'));
    }

    // Left banner: trial countdown → premium badge → upgrade CTA.
    var tb = document.getElementById('sfTrialBanner');
    var tt = document.getElementById('sfTrialTxt');
    var ic = tb ? tb.querySelector('.sf-trial-ic') : null;
    if (tb && tt) {
      if (trialActive) {
        tb.classList.remove('premium');
        var ti = trialInfo();
        tt.textContent = ti ? ti.short : ('נותרו ' + days + ' ימי ניסיון');
        tb.classList.toggle('urgent', !!(ti && ti.last));
        if (ic) ic.textContent = '🎁';
      } else if (premium) {
        tb.classList.remove('urgent');
        tb.classList.add('premium');
        tt.textContent = 'פרימיום פעיל';
        if (ic) ic.textContent = '⭐';
      } else if (tid === 'gold') {
        tb.classList.remove('urgent');
        tb.classList.add('premium');
        tt.textContent = 'גולד · שדרג לפרימיום';
        if (ic) ic.textContent = '🥇';
      } else {
        tb.classList.remove('premium', 'urgent');
        tt.textContent = '⭐ שדרג מסלול';
        if (ic) ic.textContent = '';
      }
    }
  }

  // Toggle the account dropdown (logout). Closes on outside click.
  function toggleUserMenu(ev) {
    if (ev) ev.stopPropagation();
    var menu = document.getElementById('sfUserMenu');
    if (!menu) return;
    var willOpen = !menu.classList.contains('open');
    menu.classList.toggle('open', willOpen);
    if (willOpen) {
      setTimeout(function () {
        document.addEventListener('click', function closer(e) {
          var wrap = document.getElementById('sfUserWrap');
          if (wrap && !wrap.contains(e.target)) {
            menu.classList.remove('open');
            document.removeEventListener('click', closer);
          }
        });
      }, 0);
    }
  }

  // ---------- public actions ----------
  function switchTab(tab) {
    activeTab = tab;
    var tabs = document.querySelectorAll('#signalFeed .sf-tab');
    tabs.forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-tab') === tab); });
    var sb = document.getElementById('sfBody');
    if (sb) sb.scrollTop = 0;
    render();
    if (tab === 'trades') refreshTradePrices(true);
  }

  // ---------- AI stock analysis (tab + popup) ----------
  // The user types a ticker/name; the SERVER runs the scanner's own SMA30 / support-
  // resistance / 5-candle logic on 5y weekly data and returns a full profile, shown in a
  // popup. The daily quota (Basic 3 / Gold 15 / Premium unlimited) is enforced server-side.
  var _aiQuota = null;   // { quota:{tier,used,limit,remaining}, symbols:[today's analysed] }
  var _aiBusy = false;
  var _aiTok = null, _aiQuotaTs = 0;
  var _aiRun = 0, _aiStepTimer = null;
  var AI_MIN_MS = 12500;  // an analysis always takes at least ~12.5s (feels like real work behind the scenes)
  var AI_STEPS = [
    'מתחבר לשרת הנתונים ומאמת את הסימול',
    'מושך 5 שנות נתונים שבועיים',
    'מחשב ממוצע נע SMA30 ושיפוע המגמה',
    'מזהה רמות תמיכה והתנגדות חזקות',
    'בודק פריצות ואישור 5 נרות',
    'בוחן מחזורי מסחר ופרסום דוחות',
    'מחשב ציון הזדמנות ורמות כניסה, סטופ ויעד',
    'מסכם מסקנות וזמן משוער לאיתות'
  ];

  // Trial countdown: exact time left of the free premium window.
  function trialInfo() {
    var P = window.NTPlan;
    if (!P || !P.isTrialActive || !P.isTrialActive() || !P.msLeft) return null;
    var ms = P.msLeft();
    if (!isFinite(ms) || ms <= 0) return null;
    var total = (P.LIMITS && P.LIMITS.TRIAL_DAYS) || 7;
    var days = Math.ceil(ms / 86400000);
    var hours = Math.ceil(ms / 3600000);
    var dayNo = Math.max(1, Math.min(total, total - days + 1));
    var elapsed = Math.max(0, Math.min(1, 1 - ms / (total * 86400000)));
    var last = days <= 1;
    var txt = days >= 2 ? ('נותרו ' + days + ' ימים לתקופת הניסיון')
      : (hours > 1 ? ('היום האחרון לתקופת הניסיון · נותרו ' + hours + ' שעות') : 'פחות משעה לסיום תקופת הניסיון');
    var short = days >= 2 ? ('נותרו ' + days + ' ימים') : (hours > 1 ? ('יום אחרון · ' + hours + ' שעות') : 'פחות משעה');
    return { days: days, hours: hours, dayNo: dayNo, total: total, pct: Math.round(elapsed * 100), last: last, txt: txt, short: short };
  }
  function trialStripHtml() {
    var t = trialInfo();
    if (!t) return '';
    return '<div class="trial-strip' + (t.last ? ' urgent' : '') + '">' +
      '<div class="ts-top"><span class="ts-l">🎁 תקופת ניסיון פרימיום · יום ' + t.dayNo + ' מתוך ' + t.total + '</span><b class="ts-r">' + esc(t.txt) + '</b></div>' +
      '<div class="ts-bar"><i style="width:' + Math.max(4, t.pct) + '%"></i></div>' +
      '<div class="ts-sub">' + (t.last ? 'הניסיון מסתיים בקרוב — שדרג כדי לא לאבד גישה לכל האיתותים והניתוחים. ' : 'כל התכונות פתוחות לך בזמן הניסיון. ') +
        '<button class="ts-up" onclick="NTSignals.openUpgrade()">⭐ שדרג</button></div>' +
    '</div>';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function heDate(iso) {
    var p = String(iso || '').split('-');
    return p.length === 3 ? (parseInt(p[2], 10) + '.' + parseInt(p[1], 10) + '.' + p[0]) : esc(iso || '');
  }

  function aiQuotaText() {
    var q = _aiQuota && _aiQuota.quota;
    if (!q) return '';
    var tn = (window.NTPlan && window.NTPlan.TIER_NAME && window.NTPlan.TIER_NAME[q.tier]) || '';
    if (q.limit == null) return '♾️ ניתוחים ללא הגבלה · מסלול ' + esc(tn);
    return '🎟️ נותרו <b>' + q.remaining + '</b> מתוך ' + q.limit + ' ניתוחים היום · מסלול ' + esc(tn);
  }
  function updateAiQuotaUI() {
    var el = document.getElementById('aiQuota');
    if (el) el.innerHTML = aiQuotaText();
    var q = _aiQuota && _aiQuota.quota;
    var up = document.getElementById('aiUpgradeBtn');
    if (up) up.style.display = (q && q.limit != null) ? '' : 'none';
  }
  function loadAiQuota() {
    var token = authToken();
    if (!token) return;
    // a different user logged in on this device -> drop the previous user's quota view
    if (_aiTok !== token) { _aiTok = token; _aiQuota = null; _aiQuotaTs = 0; updateAiQuotaUI(); }
    if (_histTok !== token) { _histTok = token; histSyncServer(token); }
    if (Date.now() - _aiQuotaTs < 30000) return;
    _aiQuotaTs = Date.now();
    fetch(apiBase() + '/api/analyze/quota', { headers: { 'Authorization': 'Bearer ' + token }, cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.quota) { _aiQuota = d; updateAiQuotaUI(); } })
      .catch(function () {});
  }

  function renderAI() {
    return '<div class="ai-panel" id="aiPanel">' + trialStripHtml() + earnBannerHtml() +
      '<div class="ai-hero">' +
        '<div class="ai-hero-title">🤖 ניתוח AI למניות</div>' +
        '<div class="ai-hero-sub">הקלד סימול או שם מניה וקבל ניתוח מלא לפי שיטת הסורק: מגמה, SMA30, תמיכה והתנגדות, פריצות, דוחות וזמן משוער לאיתות.</div>' +
        '<div class="ai-input-row">' +
          '<div class="ai-input-wrap">' +
            '<input id="aiInput" type="text" inputmode="search" enterkeyhint="search" autocomplete="off" maxlength="40" placeholder="לדוגמה: AAPL, TSLA, טבע, אפל…" ' +
              'oninput="NTSignals.aiSuggest(this.value)" onfocus="NTSignals.aiSuggest(this.value)" onblur="NTSignals.aiSugHideLater()" onkeydown="NTSignals.aiKey(event)" />' +
            '<div class="ai-sug" id="aiSug" onmousedown="event.preventDefault()"></div>' +
          '</div>' +
          '<button class="ai-go" onclick="NTSignals.analyzeFromInput()">🔍 נתח</button>' +
        '</div>' +
        '<div class="ai-quota-row">' +
          '<div class="ai-quota" id="aiQuota">' + aiQuotaText() + '</div>' +
          '<button class="ai-upgrade" id="aiUpgradeBtn" onclick="NTSignals.openUpgrade()" style="display:none">⭐ שדרג</button>' +
        '</div>' +
      '</div>' +
      '<div id="aiRemWrap">' + remListInner() + '</div>' +
      '<div id="aiHistWrap">' + historyInner() + '</div>' +
      '<div class="ai-note">הניתוח מבוסס על נתוני 5 שנים בגרף שבועי. אינו מהווה ייעוץ השקעות.</div>' +
    '</div>';
  }

  function analyzeFromInput() {
    var el = document.getElementById('aiInput');
    aiSugHide();
    analyzeSymbol(el ? el.value : '');
  }

  // ---------- AI search suggestions (autocomplete) ----------
  // [symbol, English name, Hebrew name] — shown even when the full universe isn't cached yet.
  var AI_POP = [
    ['AAPL', 'Apple', 'אפל'], ['MSFT', 'Microsoft', 'מיקרוסופט'], ['NVDA', 'NVIDIA', 'אנבידיה'], ['TSLA', 'Tesla', 'טסלה'],
    ['AMZN', 'Amazon', 'אמזון'], ['GOOGL', 'Alphabet Google', 'גוגל אלפבית'], ['META', 'Meta Facebook', 'מטא פייסבוק'],
    ['NFLX', 'Netflix', 'נטפליקס'], ['AMD', 'Advanced Micro Devices', 'אמד'], ['INTC', 'Intel', 'אינטל'],
    ['AVGO', 'Broadcom', 'ברודקום'], ['ORCL', 'Oracle', 'אורקל'], ['CRM', 'Salesforce', 'סיילספורס'], ['ADBE', 'Adobe', 'אדובי'],
    ['PYPL', 'PayPal', 'פייפאל'], ['UBER', 'Uber', 'אובר'], ['DIS', 'Disney', 'דיסני'], ['NKE', 'Nike', 'נייקי'],
    ['KO', 'Coca-Cola', 'קוקה קולה'], ['PEP', 'PepsiCo', 'פפסי'], ['MCD', "McDonald's", 'מקדונלדס'], ['SBUX', 'Starbucks', 'סטארבקס'],
    ['WMT', 'Walmart', 'וולמארט'], ['COST', 'Costco', 'קוסטקו'], ['JPM', 'JPMorgan', 'ג׳יי פי מורגן'], ['BAC', 'Bank of America', 'בנק אוף אמריקה'],
    ['V', 'Visa', 'ויזה'], ['MA', 'Mastercard', 'מאסטרקארד'], ['BA', 'Boeing', 'בואינג'], ['XOM', 'Exxon Mobil', 'אקסון'],
    ['PFE', 'Pfizer', 'פייזר'], ['JNJ', 'Johnson & Johnson', 'ג׳ונסון'], ['PLTR', 'Palantir', 'פלנטיר'], ['COIN', 'Coinbase', 'קוינבייס'],
    ['SHOP', 'Shopify', 'שופיפיי'], ['SNOW', 'Snowflake', 'סנופלייק'], ['MU', 'Micron', 'מיקרון'], ['QCOM', 'Qualcomm', 'קוואלקום'],
    ['SMCI', 'Super Micro Computer', 'סופר מיקרו'], ['MSTR', 'MicroStrategy', 'מיקרוסטרטגי'],
    ['CHKP', 'Check Point', 'צ׳ק פוינט'], ['MNDY', 'Monday.com', 'מאנדיי'], ['GLBE', 'Global-E', 'גלובל אי'], ['WIX', 'Wix', 'וויקס'],
    ['CYBR', 'CyberArk', 'סייברארק'],
    ['ICL', 'ICL Group (NYSE)', 'כיל'], ['TEVA', 'Teva (NYSE)', 'טבע'], ['NICE', 'NICE (Nasdaq)', 'נייס'], ['ESLT', 'Elbit Systems (Nasdaq)', 'אלביט'],
    ['TEVA.TA', 'Teva', 'טבע'], ['ESLT.TA', 'Elbit Systems', 'אלביט'], ['LUMI.TA', 'Bank Leumi', 'לאומי'], ['POLI.TA', 'Bank Hapoalim', 'פועלים'],
    ['DSCT.TA', 'Discount Bank', 'דיסקונט'], ['BEZQ.TA', 'Bezeq', 'בזק'], ['ICL.TA', 'ICL', 'כיל'], ['NICE.TA', 'NICE', 'נייס']
  ];
  var _sugList = [], _sugIdx = -1, _sugTimer = null;

  function aiSugFind(q) {
    var ql = q.toLowerCase(), qu = q.toUpperCase();
    var out = [], seen = {};
    function add(score, sym, short, name, ex) {
      var k = sym.toUpperCase();
      if (seen[k]) { if (score < seen[k].score) seen[k].score = score; return; }
      var o = { score: score, sym: sym, short: short, name: name, ex: ex };
      seen[k] = o; out.push(o);
    }
    AI_POP.forEach(function (p) {
      var short = p[0].replace('.TA', ''), su = short.toUpperCase(), en = p[1].toLowerCase(), he = p[2];
      var score = -1;
      if (su === qu) score = 0;
      else if (su.indexOf(qu) === 0) score = 1;
      else if (en.indexOf(ql) === 0 || he.indexOf(q) === 0) score = 2;
      else if (en.indexOf(ql) !== -1 || he.indexOf(q) !== -1) score = 3;
      if (score < 0) return;
      var isTA = p[0].slice(-3) === '.TA';
      add(score, p[0], short, isTA ? p[2] : (p[1] + ' · ' + p[2]), isTA ? 'TASE' : 'US');
    });
    if (typeof TASE_UNIVERSE !== 'undefined' && TASE_UNIVERSE && TASE_UNIVERSE.length) {
      for (var i = 0; i < TASE_UNIVERSE.length; i++) {
        var it = TASE_UNIVERSE[i], su2 = String(it.short || '').toUpperCase(), nm = String(it.name || ''), nl = nm.toLowerCase();
        var sc = -1;
        if (su2 === qu) sc = 0;
        else if (su2.indexOf(qu) === 0) sc = 1;
        else if (nl.indexOf(ql) === 0) sc = 2;
        else if (nl.indexOf(ql) !== -1) sc = 3;
        if (sc >= 0) add(sc, it.sym, it.short, nm, 'TASE');
      }
    }
    if (typeof US_SYMBOLS !== 'undefined' && US_SYMBOLS && /^[A-Za-z.\-]+$/.test(q)) {
      for (var j = 0; j < US_SYMBOLS.length; j++) {
        var s = String(US_SYMBOLS[j]);
        if (s.toUpperCase().indexOf(qu) === 0) {
          add(s.toUpperCase() === qu ? 0 : 1.5, s, s, (typeof NAMES !== 'undefined' && NAMES[s]) || '', 'US');
        }
      }
    }
    out.sort(function (a, b) { return a.score - b.score || a.short.length - b.short.length; });
    return out.slice(0, 7);
  }

  function aiSugHide() {
    clearTimeout(_sugTimer);
    var box = document.getElementById('aiSug');
    if (box) { box.classList.remove('open'); box.innerHTML = ''; }
    _sugList = []; _sugIdx = -1;
  }
  function aiSugHideLater() { clearTimeout(_sugTimer); _sugTimer = setTimeout(aiSugHide, 250); }

  function aiSuggest(v) {
    var box = document.getElementById('aiSug');
    if (!box) return;
    clearTimeout(_sugTimer);
    var q = String(v == null ? '' : v).trim();
    if (!q) { aiSugHide(); return; }
    // make sure the cached TASE universe is available for the search (no network needed)
    try { if ((typeof TASE_UNIVERSE === 'undefined' || !TASE_UNIVERSE.length) && typeof buildUniverseFromCache === 'function') buildUniverseFromCache(); } catch (e) {}
    _sugList = aiSugFind(q); _sugIdx = -1;
    var rows = _sugList.map(function (o, i) {
      return '<div class="ai-sug-item" data-i="' + i + '" onclick="NTSignals.aiPick(' + i + ')">' +
        '<span class="ai-sug-sym">' + esc(o.short) + '</span>' +
        '<span class="ai-sug-name">' + esc(o.name) + '</span>' +
        '<span class="ai-sug-ex">' + esc(o.ex) + '</span>' +
      '</div>';
    }).join('');
    if (!_sugList.length) {
      rows = '<div class="ai-sug-item raw" onclick="NTSignals.analyzeFromInput()">🔍 נתח "' + esc(q.toUpperCase()) + '" כפי שהוקלד</div>';
    }
    box.innerHTML = rows;
    box.classList.add('open');
  }

  function aiSugMark() {
    var items = document.querySelectorAll('#aiSug .ai-sug-item');
    items.forEach(function (el, i) { el.classList.toggle('active', i === _sugIdx); });
    if (items[_sugIdx] && items[_sugIdx].scrollIntoView) { try { items[_sugIdx].scrollIntoView({ block: 'nearest' }); } catch (e) {} }
  }

  function aiKey(e) {
    if (e.key === 'ArrowDown' && _sugList.length) {
      e.preventDefault(); _sugIdx = Math.min(_sugIdx + 1, _sugList.length - 1); aiSugMark();
    } else if (e.key === 'ArrowUp' && _sugList.length) {
      e.preventDefault(); _sugIdx = Math.max(_sugIdx - 1, 0); aiSugMark();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (_sugIdx >= 0 && _sugList[_sugIdx]) aiPick(_sugIdx); else analyzeFromInput();
    } else if (e.key === 'Escape') {
      aiSugHide();
    }
  }

  function aiPick(i) {
    var o = _sugList[i];
    if (!o) return;
    var el = document.getElementById('aiInput');
    if (el) el.value = o.short;
    aiSugHide();
    analyzeSymbol(o.sym);
  }

  // "Search the next stock" trigger: closes the popup and jumps back to a focused, empty search box.
  function aiNext() {
    closeAiModal();
    if (activeTab !== 'ai') switchTab('ai');
    setTimeout(function () {
      var el = document.getElementById('aiInput');
      if (!el) return;
      el.value = '';
      try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
      el.focus();
    }, 60);
  }

  function aiNextHtml(q, curSym) {
    var rem = null;
    if (q && q.limit != null) rem = q.remaining != null ? q.remaining : Math.max(0, q.limit - (q.used || 0));
    if (rem === 0) {
      return '<div class="aim-next">' +
        '<div class="aim-next-t">🎟️ ניצלת את כל הניתוחים להיום</div>' +
        '<button class="sig-btn aim-up-btn" onclick="NTSignals.closeAiModal();NTSignals.openUpgrade(\'ניצלת את מכסת ניתוחי ה-AI היומית. שדרג להמשך.\')">⭐ שדרג להמשך ניתוחים</button>' +
      '</div>';
    }
    var done = ((_aiQuota && _aiQuota.symbols) || []).map(function (s) { return String(s).toUpperCase(); });
    var cur = String(curSym || '').toUpperCase();
    var pool = AI_POP.filter(function (p) {
      var u = p[0].toUpperCase();
      return u !== cur && u.replace('.TA', '') !== cur.replace('.TA', '') && done.indexOf(u) === -1;
    });
    for (var i = pool.length - 1; i > 0; i--) {   // shuffle
      var j = Math.floor(Math.random() * (i + 1)); var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    var chips = pool.slice(0, 4).map(function (p) {
      return '<button class="ai-chip" data-sym="' + esc(p[0]) + '" onclick="NTSignals.analyzeSymbol(this.getAttribute(\'data-sym\'))">' + esc(p[0].replace('.TA', '')) + '</button>';
    }).join('');
    return '<div class="aim-next">' +
      '<button class="sig-btn aim-next-btn" onclick="NTSignals.aiNext()">🔍 חפש את המניה הבאה</button>' +
      '<div class="aim-next-sub">' + (rem != null ? 'נותרו <b>' + rem + '</b> ניתוחים להיום' : 'ניתוחים ללא הגבלה') + '</div>' +
      (chips ? '<div class="aim-next-t">🔥 מה עוד כדאי לבדוק?</div><div class="ai-chips aim-next-chips">' + chips + '</div>' : '') +
    '</div>';
  }

  function aiModalEl() { return document.getElementById('aiModal'); }
  function openAiModal(html) {
    var m = aiModalEl(); if (!m) return;
    var b = document.getElementById('aiModalBody'); if (b) b.innerHTML = html;
    m.classList.add('open');
  }
  function setAiModal(html) {
    var b = document.getElementById('aiModalBody'); if (b) { b.innerHTML = html; b.scrollTop = 0; }
  }
  function closeAiModal() {
    var m = aiModalEl(); if (m) m.classList.remove('open');
    // closing mid-analysis cancels the pending display (the result stays under "analysed today")
    _aiRun++; _aiBusy = false;
    clearInterval(_aiStepTimer);
  }

  function aiProgressHtml(sym) {
    var steps = AI_STEPS.map(function (s, i) {
      return '<li id="aiStep' + i + '" class="aim-step">' + esc(s) + '</li>';
    }).join('');
    return '<div class="aim-msg aim-work"><div class="aim-spin"></div>' +
      '<div class="aim-msg-title">מנתח את ' + esc(sym) + '…</div>' +
      '<div class="aim-pbar"><i id="aiPbar" style="transition-duration:' + AI_MIN_MS + 'ms"></i></div>' +
      '<ul class="aim-steps">' + steps + '</ul>' +
      '<div class="aim-msg-sub">אם השרת התעורר הרגע זה יכול לקחת עד דקה.</div></div>';
  }
  function aiStartProgress(run) {
    clearInterval(_aiStepTimer);
    var bar = document.getElementById('aiPbar');
    if (bar) { void bar.offsetWidth; bar.style.width = '92%'; }
    var n = 0;
    function tick() {
      if (run !== _aiRun) { clearInterval(_aiStepTimer); return; }
      for (var i = 0; i < AI_STEPS.length; i++) {
        var el = document.getElementById('aiStep' + i);
        if (el) { el.className = 'aim-step' + (i < n ? ' done' : (i === n ? ' act' : '')); }
      }
      n++;
      if (n > AI_STEPS.length) clearInterval(_aiStepTimer);
    }
    tick();
    _aiStepTimer = setInterval(tick, Math.floor(AI_MIN_MS / AI_STEPS.length));
  }

  function aiMsgHtml(icon, title, sub, extra) {
    return '<div class="aim-msg"><div class="aim-msg-ic">' + icon + '</div><div class="aim-msg-title">' + esc(title) + '</div>' +
      (sub ? '<div class="aim-msg-sub">' + sub + '</div>' : '') + (extra || '') +
      '<button class="sig-btn ghost aim-close-btn" onclick="NTSignals.closeAiModal()">סגור</button></div>';
  }

  function analyzeSymbol(q) {
    q = String(q || '').trim();
    if (!q || _aiBusy) return;
    if (!authToken()) { openAiModal(aiMsgHtml('🔒', 'יש להתחבר', 'כדי להשתמש בניתוח AI יש להתחבר לחשבון.')); return; }
    // UX shortcut: out of credits and this isn't an already-analysed symbol today.
    var qt = _aiQuota && _aiQuota.quota;
    var doneToday = (_aiQuota && _aiQuota.symbols) || [];
    var qUp = q.toUpperCase();
    var isRepeat = doneToday.some(function (s) { return s.toUpperCase() === qUp || s.toUpperCase().replace('.TA', '') === qUp; });
    if (qt && qt.limit != null && qt.remaining === 0 && !isRepeat) {
      openAiModal(quotaHtml(qt));
      return;
    }
    _aiBusy = true;
    var run = ++_aiRun, t0 = Date.now();
    openAiModal(aiProgressHtml(q.toUpperCase()));
    aiStartProgress(run);
    // Successful results are held back until AI_MIN_MS has passed; errors show immediately.
    function showSuccess(fn) {
      var wait = Math.max(0, AI_MIN_MS - (Date.now() - t0));
      setTimeout(function () {
        if (run !== _aiRun) return;           // user closed the popup / started another run
        clearInterval(_aiStepTimer);
        _aiBusy = false;
        fn();
      }, wait);
    }
    fetch(apiBase() + '/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken() },
      body: JSON.stringify({ symbol: q })
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d || {} }; }, function () { return { ok: false, d: {} }; }); })
      .then(function (res) {
        var d = res.d;
        if (res.ok && d.analysis) {
          if (d.quota) {
            var syms = ((_aiQuota && _aiQuota.symbols) || []).slice();
            if (d.charged && syms.indexOf(d.analysis.symbol) === -1) syms.push(d.analysis.symbol);
            _aiQuota = { quota: d.quota, symbols: syms };
          }
          showSuccess(function () {
            histAdd(d);                                   // save first -- nothing below may prevent it
            try { autoRemind(d.analysis); } catch (e1) {}
            setAiModal(resultHtml(d));
            updateAiQuotaUI();
            aiRefreshLists();
          });
          return;
        }
        if (run === _aiRun) { clearInterval(_aiStepTimer); _aiBusy = false; }
        if (d.code === 'quota') {
          if (d.quota) _aiQuota = { quota: d.quota, symbols: (_aiQuota && _aiQuota.symbols) || [] };
          if (run === _aiRun) setAiModal(quotaHtml(d.quota));
          updateAiQuotaUI();
          return;
        }
        if (run === _aiRun) setAiModal(aiMsgHtml('⚠️', d.error || 'שגיאה בניתוח', d.code === 'not_found' || d.code === 'bad_symbol' || d.code === 'no_data' ? 'הניתוח לא נספר במכסה שלך.' : '',
          '<button class="sig-btn aim-next-btn" onclick="NTSignals.aiNext()">🔍 נסה מניה אחרת</button>'));
      })
      .catch(function () {
        if (run !== _aiRun) return;
        clearInterval(_aiStepTimer);
        _aiBusy = false;
        setAiModal(aiMsgHtml('📡', 'אין חיבור לשרת', 'נסה שוב בעוד רגע. הניתוח לא נספר במכסה שלך.'));
      });
  }

  function quotaHtml(q) {
    var lim = q && q.limit != null ? q.limit : '';
    var tid = (q && q.tier) || tierId();
    var nextTxt = tid === 'free'
      ? 'שדרג לגולד (15 ניתוחים ביום) או לפרימיום (ללא הגבלה).'
      : 'שדרג לפרימיום לניתוחים ללא הגבלה.';
    return aiMsgHtml('🎟️', 'ניצלת את ' + lim + ' הניתוחים היומיים', nextTxt + '<br>המכסה מתאפסת בחצות (שעון ישראל).',
      '<button class="sig-btn aim-up-btn" onclick="NTSignals.closeAiModal();NTSignals.openUpgrade(\'ניצלת את מכסת ניתוחי ה-AI היומית. שדרג להמשך.\')">⭐ שדרג עכשיו</button>');
  }

  // ============================================================
  //  AI result extras: score, mini chart, position size, similar signals,
  //  7-day history, share, earnings reminders, entry price alert
  // ============================================================
  var _aiCur = null;   // result currently shown in the popup: { analysis, quota, charged, fromHistory }

  function userKey() {
    try {
      var u = JSON.parse(localStorage.getItem('nt_user') || '{}') || {};
      return String(u.username || u.email || u.id || 'u').toLowerCase();
    } catch (e) { return 'u'; }
  }
  function lsGet(key, def) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? def : v; } catch (e) { return def; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
  }
  function toast(m) { try { if (typeof window.ntToast === 'function') window.ntToast(m); } catch (e) {} }
  function nfmt(n, d) { return Number(n).toLocaleString('he-IL', { maximumFractionDigits: d == null ? 0 : d }); }
  function isIdxSym(s) { return /^\^|^TA35\.TA$/i.test(s || ''); }
  function daysTo(dateStr) {
    var d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return null;
    var t = new Date(); t.setHours(0, 0, 0, 0);
    return Math.round((d - t) / 86400000);
  }
  function dayTxt(d) { return d === 0 ? 'היום' : (d === 1 ? 'מחר' : 'בעוד ' + d + ' ימים'); }
  function requestNotifPerm() {
    try { if (window.Notification && Notification.permission === 'default') Notification.requestPermission(); } catch (e) {}
  }

  // ---- 1. opportunity score ----
  function scoreColor(v) { return v >= 75 ? '#26a69a' : (v >= 55 ? '#8bc34a' : (v >= 35 ? '#f5a623' : '#ef5350')); }
  function scoreHtml(a) {
    var s = a.score;
    if (!s || s.value == null) return '';
    var col = scoreColor(s.value), C = 2 * Math.PI * 42;
    var parts = (s.parts || []).map(function (p) {
      var pc = p.v / 20 * 100;
      return '<div class="sc-part"><span class="sc-pl">' + esc(p.label) + '</span>' +
        '<div class="sc-pbar"><i style="width:' + pc + '%;background:' + scoreColor(pc) + '"></i></div><b>' + p.v + '/20</b></div>';
    }).join('');
    return '<div class="aim-score">' +
      '<div class="sc-top">' +
        '<div class="sc-ring"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" class="sc-bg"/>' +
          '<circle cx="50" cy="50" r="42" class="sc-fg" style="stroke:' + col + ';stroke-dasharray:' + (C * s.value / 100).toFixed(1) + ' ' + C.toFixed(1) + '"/></svg>' +
          '<div class="sc-num" style="color:' + col + '">' + s.value + '<small>/100</small></div></div>' +
        '<div class="sc-body"><div class="sc-title">ציון הזדמנות</div>' +
          '<div class="sc-label" style="color:' + col + '">' + esc(s.label) + '</div>' +
          '<div class="sc-grad"><i style="left:' + s.value + '%"></i></div>' +
          '<div class="sc-scale"><span>נמנע</span><span>חלש</span><span>סביר</span><span>חזק</span></div></div>' +
      '</div>' +
      '<div class="sc-parts">' + parts + '</div></div>';
  }

  // ---- 2. mini weekly chart (SVG: candles + SMA30 + support/resistance + entry/stop/target) ----
  function mcFmt(p) { return Math.abs(p) >= 1000 ? p.toFixed(0) : (Math.abs(p) >= 100 ? p.toFixed(1) : p.toFixed(2)); }
  function miniChartHtml(a) {
    var ch = a.chart;
    if (!ch || !ch.c || ch.c.length < 8) return '';
    var n = ch.c.length, W = 420, H = 232, padL = 4, padR = 50, padT = 10, padB = 20, i;
    var en = a.entry || {};
    var lv = [];
    if (a.support) lv.push({ p: a.support.price, col: '#26a69a', dash: '', lab: 'תמיכה' });
    if (a.resistance) lv.push({ p: a.resistance.price, col: '#ef5350', dash: '', lab: 'התנגדות' });
    var hasTrade = en.entry != null && en.stop != null && en.target != null;
    if (hasTrade) {
      lv.push({ p: en.entry, col: '#ffffff', dash: '5 3', lab: 'כניסה' });
      lv.push({ p: en.stop, col: '#ff8a80', dash: '2 3', lab: 'סטופ' });
      lv.push({ p: en.target, col: '#69f0ae', dash: '2 3', lab: 'יעד' });
    }
    var lo = Infinity, hi = -Infinity;
    for (i = 0; i < n; i++) { if (ch.l[i] < lo) lo = ch.l[i]; if (ch.h[i] > hi) hi = ch.h[i]; }
    var span0 = (hi - lo) || 1;
    lv = lv.filter(function (l) { return l.p >= lo - span0 * 0.2 && l.p <= hi + span0 * 0.2; });
    lv.forEach(function (l) { if (l.p < lo) lo = l.p; if (l.p > hi) hi = l.p; });
    var pad = (hi - lo) * 0.05; lo -= pad; hi += pad;
    var iw = W - padL - padR, ih = H - padT - padB;
    function X(k) { return padL + (k + 0.5) * iw / n; }
    function Y(p) { return padT + (hi - p) / (hi - lo) * ih; }
    var bw = Math.max(1.6, iw / n * 0.62), s = '';
    for (i = 0; i <= 4; i++) {
      var gp = lo + (hi - lo) * i / 4, gy = Y(gp);
      s += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + gy.toFixed(1) + '" y2="' + gy.toFixed(1) + '" class="mc-grid"/>' +
        '<text x="' + (W - padR + 4) + '" y="' + (gy + 3).toFixed(1) + '" class="mc-ax">' + mcFmt(gp) + '</text>';
    }
    for (i = 0; i < n; i++) {
      var up = ch.c[i] >= ch.o[i], col = up ? '#26a69a' : '#ef5350', x = X(i);
      var yo = Y(ch.o[i]), yc = Y(ch.c[i]);
      s += '<line x1="' + x.toFixed(1) + '" x2="' + x.toFixed(1) + '" y1="' + Y(ch.h[i]).toFixed(1) + '" y2="' + Y(ch.l[i]).toFixed(1) + '" stroke="' + col + '" stroke-width="1"/>' +
        '<rect x="' + (x - bw / 2).toFixed(1) + '" y="' + Math.min(yo, yc).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(1, Math.abs(yo - yc)).toFixed(1) + '" fill="' + col + '"/>';
    }
    var pts = [];
    for (i = 0; i < n; i++) { if (ch.sma && ch.sma[i] != null) pts.push(X(i).toFixed(1) + ',' + Y(ch.sma[i]).toFixed(1)); }
    if (pts.length > 1) s += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="#f5a623" stroke-width="2" stroke-linejoin="round"/>';
    lv.forEach(function (l) {
      var y = Y(l.p).toFixed(1);
      s += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y + '" y2="' + y + '" stroke="' + l.col + '" stroke-width="1.3"' + (l.dash ? ' stroke-dasharray="' + l.dash + '"' : '') + '/>' +
        '<text x="' + (padL + 3) + '" y="' + (parseFloat(y) - 3) + '" class="mc-lv" fill="' + l.col + '">' + l.lab + ' ' + mcFmt(l.p) + '</text>';
    });
    function tl(k) { var t = String(ch.t[k] || ''); return t.slice(5, 7) + '/' + t.slice(2, 4); }
    [0, Math.floor(n / 2), n - 1].forEach(function (k, idx) {
      s += '<text x="' + X(k).toFixed(1) + '" y="' + (H - 5) + '" class="mc-ax" text-anchor="' + (idx === 0 ? 'start' : (idx === 2 ? 'end' : 'middle')) + '">' + tl(k) + '</text>';
    });
    return '<div class="aim-chart"><div class="aim-chart-h">📈 גרף שבועי · ' + n + ' שבועות אחרונים</div>' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" class="mc-svg" role="img" aria-label="גרף שבועי">' + s + '</svg>' +
      '<div class="mc-legend"><span><i style="background:#f5a623"></i>SMA30</span><span><i style="background:#26a69a"></i>תמיכה</span><span><i style="background:#ef5350"></i>התנגדות</span>' +
      (hasTrade ? '<span><i style="background:#fff"></i>כניסה</span><span><i style="background:#69f0ae"></i>יעד</span>' : '') + '</div></div>';
  }

  // ---- 3. position size (risk rule) ----
  function portLoad() {
    var p = lsGet('nt_ai_port_' + userKey(), null);
    if (!p || typeof p !== 'object') p = {};
    if (!p.vals || typeof p.vals !== 'object') p.vals = {};
    if (!(p.risk > 0)) p.risk = 1;
    return p;
  }
  function portSave(p) { lsSet('nt_ai_port_' + userKey(), p); }
  function posInner(a) {
    var en = a.entry || {};
    if (en.entry == null || en.stop == null || en.entry === en.stop || isIdxSym(a.symbol) || !a.curr) return '';
    var cur = a.curr, p = portLoad(), val = p.vals[cur];
    var head = '<div class="aim-card-h">💼 כמה מניות לקנות? <span>לפי כלל הסיכון</span></div>';
    if (!(val > 0)) {
      return head + '<div class="pz-ask">הזן פעם אחת את גודל התיק שלך ב-<b>' + esc(cur) + '</b> (נשמר רק במכשיר שלך), ונחשב לך כמות מניות מדויקת בכל ניתוח.</div>' +
        '<div class="pz-form"><input id="pzPort" type="number" inputmode="decimal" placeholder="לדוגמה 100000" onkeydown="if(event.key===\'Enter\')this.nextSibling.click()">' +
        '<button class="pz-save" data-cur="' + esc(cur) + '" onclick="NTSignals.aiSavePort(this)">שמור וחשב</button></div>';
    }
    var div = a.div || 1;
    var riskAmt = val * p.risk / 100;
    var perShare = Math.abs(en.entry - en.stop) / div;
    var shares = Math.floor(riskAmt / perShare);
    var posVal = shares * en.entry / div;
    var posPct = posVal / val * 100;
    var warn = '';
    if (shares < 1) warn = 'הסטופ רחוק מדי ביחס לסיכון שהגדרת — יוצא פחות ממניה אחת.';
    else if (posPct > 100) warn = 'שווי הפוזיציה גדול מהתיק — דרוש מינוף. מומלץ לצמצם.';
    else if (posPct > 30) warn = 'פוזיציה גדולה (' + nfmt(posPct, 0) + '% מהתיק) — שקול פיזור.';
    var sel = [0.5, 1, 2].map(function (r) { return '<option value="' + r + '"' + (p.risk === r ? ' selected' : '') + '>' + r + '%</option>'; }).join('');
    return head +
      '<div class="pz-grid">' +
        '<div><span>סיכון מקסימלי</span><b>' + esc(cur) + nfmt(riskAmt, riskAmt < 100 ? 2 : 0) + '</b></div>' +
        '<div class="big"><span>כמות מניות</span><b>' + nfmt(shares) + '</b></div>' +
        '<div><span>שווי פוזיציה</span><b>' + esc(cur) + nfmt(posVal) + '</b><small>' + nfmt(posPct, 1) + '% מהתיק</small></div>' +
      '</div>' +
      (warn ? '<div class="pz-warn">⚠️ ' + warn + '</div>' : '') +
      '<div class="pz-foot"><label>סיכון לעסקה <select onchange="NTSignals.aiSetRisk(this.value)">' + sel + '</select></label>' +
        '<span>תיק: ' + esc(cur) + nfmt(val) + ' <a onclick="NTSignals.aiEditPort(\'' + esc(cur) + '\')">✏️ שנה</a></span>' +
        '<a onclick="NTSignals.aiGoRisk()">איך זה מחושב? ←</a></div>';
  }
  function posRefresh() {
    var w = document.getElementById('aiPosWrap');
    if (w && _aiCur) w.innerHTML = posInner(_aiCur.analysis);
  }
  function aiSavePort(btn) {
    var cur = btn && btn.getAttribute('data-cur');
    var el = document.getElementById('pzPort');
    var v = el ? parseFloat(el.value) : NaN;
    if (!cur || !(v > 0)) { toast('הזן סכום תקין'); return; }
    var p = portLoad(); p.vals[cur] = v; portSave(p);
    posRefresh();
  }
  function aiEditPort(cur) {
    var p = portLoad(); delete p.vals[cur]; portSave(p);
    posRefresh();
  }
  function aiSetRisk(v) {
    var p = portLoad(); p.risk = parseFloat(v) || 1; portSave(p);
    posRefresh();
  }
  function aiGoRisk() { closeAiModal(); switchTab('risk'); }

  // ---- 4. similar stocks with a live signal ----
  function similarHtml(a) {
    var cur = String(a.symbol || '').toUpperCase(), en = a.entry || {};
    var dir = en.direction || (a.trend && a.trend.type === 'down' ? 'short' : (a.trend && a.trend.type === 'up' ? 'long' : null));
    var mk = marketOf(a.symbol), list = [], seen = {};
    try { list = loadSignals(); } catch (e) { list = []; }
    list = list.filter(function (s) {
      var u = String(s.sym || '').toUpperCase();
      if (!u || u === cur || seen[u]) return false;
      seen[u] = 1; return true;
    });
    var pool = list.filter(function (s) { return marketOf(s.sym) === mk && (!dir || s.dir === dir); });
    if (pool.length < 2) pool = list.filter(function (s) { return marketOf(s.sym) === mk; });
    if (!pool.length) return '';
    pool.forEach(function (s) { s._st = signalStatus(s).key; });
    pool.sort(function (x, y) { return (x._st === 'armed' ? 0 : 1) - (y._st === 'armed' ? 0 : 1) || (y.ts || 0) - (x.ts || 0); });
    var items = pool.slice(0, 3).map(function (s) {
      return '<button class="sim-item" data-sym="' + esc(s.sym) + '" onclick="NTSignals.analyzeSymbol(this.getAttribute(\'data-sym\'))">' +
        '<span class="sim-sym">' + esc(dispSym(s.sym)) + '</span>' +
        '<span class="sim-dir ' + s.dir + '">' + (s.dir === 'long' ? 'לונג' : 'שורט') + '</span>' +
        '<span class="sim-rr">' + esc(s.rr || '') + '</span>' +
        '<span class="sim-st">' + esc(STATUS_TXT[s._st] || '') + '</span>' +
        '<span class="sim-go">נתח ←</span></button>';
    }).join('');
    return '<div class="aim-card sim"><div class="aim-card-h">🔥 מניות דומות עם איתות עכשיו <span>' + esc(MARKET_TXT[mk] || '') +
      (dir ? (dir === 'long' ? ' · לונג' : ' · שורט') : '') + '</span></div><div class="sim-list">' + items + '</div></div>';
  }

  // ---- 5. 7-day analysis history (kept on this device, per user; opens instantly, no quota) ----
  var HIST_DAYS = 7, HIST_MAX = 30;
  function histKey() { return 'nt_ai_hist_' + userKey(); }
  function histLoad() {
    var arr = lsGet(histKey(), []);
    if (!Array.isArray(arr)) arr = [];
    var cut = Date.now() - HIST_DAYS * 86400000;
    return arr.filter(function (h) { return h && h.sym && h.snap && h.ts >= cut; });
  }
  function histAdd(res) {
    var a = res && res.analysis;
    if (!a || !a.symbol) return;
    var arr = histLoad().filter(function (h) { return h.sym !== a.symbol; });
    arr.unshift({ sym: a.symbol, name: a.name, ts: Date.now(), price: a.price, curr: a.curr,
      score: a.score ? a.score.value : null, vkey: (a.verdict || {}).key, snap: a });
    arr = arr.slice(0, HIST_MAX);
    while (arr.length && !lsSet(histKey(), arr)) arr.pop();   // storage full -> drop the oldest
  }
  // Pull the account's history from the server (follows the user across devices / cleared caches)
  // and merge it with what's stored locally (newest entry per symbol wins).
  var _histTok = null;
  function histSyncServer(token) {
    fetch(apiBase() + '/api/analyze/history', { headers: { 'Authorization': 'Bearer ' + token }, cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !Array.isArray(d.items)) { _histTok = null; return; }
        var map = {};
        histLoad().concat(d.items.filter(function (h) { return h && h.sym && h.snap; })).forEach(function (h) {
          if (!map[h.sym] || h.ts > map[h.sym].ts) map[h.sym] = h;
        });
        var arr = Object.keys(map).map(function (k) { return map[k]; })
          .sort(function (x, y) { return y.ts - x.ts; }).slice(0, HIST_MAX);
        while (arr.length && !lsSet(histKey(), arr)) arr.pop();
        aiRefreshLists();
      })
      .catch(function () { _histTok = null; });
  }
  function histDayLabel(ts) {
    var d = new Date(ts), t = new Date(); t.setHours(0, 0, 0, 0);
    var dd = new Date(d); dd.setHours(0, 0, 0, 0);
    var diff = Math.round((t - dd) / 86400000);
    return diff <= 0 ? 'היום' : (diff === 1 ? 'אתמול' : (d.getDate() + '.' + (d.getMonth() + 1)));
  }
  function historyInner() {
    var h = histLoad();
    if (!h.length) return '';
    var out = '<div class="ai-sec">🕘 היסטוריית ניתוחים · 7 ימים אחרונים</div><div class="hist-list">', lastDay = '';
    h.forEach(function (x) {
      var dl = histDayLabel(x.ts);
      if (dl !== lastDay) { out += '<div class="hist-day">' + esc(dl) + '</div>'; lastDay = dl; }
      var vi = x.vkey === 'enter' ? '✅' : (x.vkey === 'wait' ? '⏳' : '⛔');
      out += '<button class="hist-row" data-sym="' + esc(x.sym) + '" onclick="NTSignals.aiOpenHist(this.getAttribute(\'data-sym\'))">' +
        '<span class="hr-sym">' + esc(dispSym(x.sym)) + '</span><span class="hr-name">' + esc(x.name || '') + '</span>' +
        '<span class="hr-v">' + vi + '</span>' +
        (x.score != null ? '<span class="hr-score" style="background:' + scoreColor(x.score) + '">' + x.score + '</span>' : '') + '</button>';
    });
    return out + '</div>';
  }
  function aiOpenHist(sym) {
    var h = histLoad().filter(function (x) { return x.sym === sym; })[0];
    if (!h) return;
    openAiModal(resultHtml({ analysis: h.snap, quota: (_aiQuota && _aiQuota.quota) || {}, charged: false, fromHistory: h.ts }));
  }

  // ---- 6. earnings reminders (day before the report) ----
  function remKey() { return 'nt_earn_remind_' + userKey(); }
  function remLoad() { var m = lsGet(remKey(), {}); return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {}; }
  function remSave(m) { lsSet(remKey(), m); }
  function autoRemind(a) {
    var e = a && a.earnings;
    if (!e || !e.available || !e.date) return;
    var d = daysTo(e.date);
    if (d == null || d < 0 || d > 150) return;
    var m = remLoad(), k = a.symbol, r = m[k];
    if (!r) m[k] = { sym: k, name: a.name, date: e.date, on: true, notified: false };
    else { if (r.date !== e.date) { r.date = e.date; r.notified = false; } r.name = a.name; }
    remSave(m);
    // also feed the signal cards' "exit before earnings" warning
    try { var em = loadEarnings(); em[k] = e.date; localStorage.setItem(EARN_KEY, JSON.stringify(em)); } catch (err) {}
  }
  function earnCardInner(a) {
    var e = a.earnings;
    if (!e || !e.available || !e.date) return '';
    var d = daysTo(e.date);
    if (d == null || d < 0) return '';
    var r = remLoad()[a.symbol], on = !!(r && r.on);
    return '<div class="aim-card-h">📅 תזכורת דוחות</div>' +
      '<div class="er-row"><div class="er-txt">דוחות ב-<b>' + heDate(e.date) + '</b> (' + dayTxt(d) + ')<br>' +
        '<span class="aim-dim">' + (on ? 'נתריע לך יום לפני הפרסום — כדי לצאת מהפוזיציה בזמן.' : 'התזכורת כבויה.') + '</span></div>' +
      '<button class="er-btn' + (on ? ' on' : '') + '" onclick="NTSignals.aiToggleRemind()">' + (on ? '🔔 פעילה' : '🔕 הפעל') + '</button></div>';
  }
  function aiToggleRemind() {
    var a = _aiCur && _aiCur.analysis;
    if (!a || !a.earnings || !a.earnings.date) return;
    var m = remLoad(), r = m[a.symbol];
    if (!r) r = m[a.symbol] = { sym: a.symbol, name: a.name, date: a.earnings.date, on: false, notified: false };
    r.on = !r.on;
    remSave(m);
    if (r.on) { requestNotifPerm(); toast('🔔 נתריע לך יום לפני הדוחות של ' + dispSym(a.symbol)); }
    var w = document.getElementById('aiEarnWrap');
    if (w) w.innerHTML = earnCardInner(a);
    aiRefreshLists();
  }
  function aiRemoveRemind(sym) {
    var m = remLoad();
    if (m[sym]) { m[sym].on = false; remSave(m); }
    aiRefreshLists();
  }
  function remListInner() {
    var m = remLoad(), rows = [];
    Object.keys(m).forEach(function (k) {
      var r = m[k]; if (!r || !r.on) return;
      var d = daysTo(r.date); if (d == null || d < 0) return;
      rows.push({ r: r, d: d });
    });
    if (!rows.length) return '';
    rows.sort(function (x, y) { return x.d - y.d; });
    var perm = (window.Notification && Notification.permission === 'default')
      ? '<button class="er-perm" onclick="NTSignals.aiNotifPerm();this.remove()">🔔 אפשר התראות דפדפן</button>' : '';
    return '<div class="ai-sec">🔔 תזכורות דוחות פעילות</div><div class="er-list">' +
      rows.map(function (x) {
        return '<div class="er-item' + (x.d <= 1 ? ' soon' : '') + '"><span class="er-sym">' + esc(dispSym(x.r.sym)) + '</span>' +
          '<span class="er-d">' + heDate(x.r.date) + ' · ' + dayTxt(x.d) + '</span>' +
          '<button class="er-x" title="בטל תזכורת" data-sym="' + esc(x.r.sym) + '" onclick="NTSignals.aiRemoveRemind(this.getAttribute(\'data-sym\'))">✕</button></div>';
      }).join('') + perm + '</div>';
  }
  function earnBannerHtml() {
    var m = remLoad(), soon = [];
    Object.keys(m).forEach(function (k) {
      var r = m[k]; if (!r || !r.on) return;
      var d = daysTo(r.date);
      if (d != null && d >= 0 && d <= 1) soon.push({ r: r, d: d });
    });
    if (!soon.length) return '';
    return '<div class="earn-banner">📅 <b>' + (soon.some(function (x) { return x.d === 0; }) ? 'היום' : 'מחר') + ' דוחות:</b> ' +
      soon.map(function (x) { return esc(dispSym(x.r.sym)) + (x.d === 0 ? ' (היום)' : ' (מחר)'); }).join(', ') +
      ' — מומלץ לצאת מהפוזיציה יום לפני הפרסום.</div>';
  }
  function checkEarnReminders() {
    var m = remLoad(), changed = false, due = [];
    Object.keys(m).forEach(function (k) {
      var r = m[k]; if (!r || !r.date) return;
      var d = daysTo(r.date);
      if (d == null) return;
      if (d < -1) { delete m[k]; changed = true; return; }          // report already out
      if (r.on && !r.notified && d >= 0 && d <= 1) { r.notified = true; changed = true; due.push({ r: r, d: d }); }
    });
    if (changed) remSave(m);
    due.forEach(function (x) {
      var msg = '📅 ' + dayTxt(x.d) + ' דוחות ' + dispSym(x.r.sym) + ' — מומלץ לצאת מהפוזיציה יום לפני';
      toast(msg);
      try { if (window.Notification && Notification.permission === 'granted') new Notification('NexTrade · תזכורת דוחות', { body: msg }); } catch (e) {}
    });
    if (due.length) { var f = document.getElementById('signalFeed'); if (f && f.style.display !== 'none') render(); }
  }
  var _remTimer = null;
  function startRemChecks() {
    checkEarnReminders();
    if (!_remTimer) _remTimer = setInterval(checkEarnReminders, 30 * 60 * 1000);
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { try { checkEarnReminders(); } catch (e) {} } });

  function aiRefreshLists() {
    var r = document.getElementById('aiRemWrap'); if (r) r.innerHTML = remListInner();
    var h = document.getElementById('aiHistWrap'); if (h) h.innerHTML = historyInner();
  }

  // ---- 7. action bar: entry price alert / watch / share ----
  function entryLevel(a) { var en = a.entry || {}; return en.entry != null ? en.entry : (en.alertLevel != null ? en.alertLevel : null); }
  function alertIsSet(sym, lvl) {
    try { return (window.alerts || []).some(function (x) { return x.symbol === sym && Math.abs(x.price - lvl) < 1e-9; }); } catch (e) { return false; }
  }
  function actionsInner() {
    var a = _aiCur && _aiCur.analysis;
    if (!a) return '';
    var lvl = entryLevel(a), sym = a.symbol, fav = isFav(sym), h = '';
    if (lvl != null) {
      var set = alertIsSet(sym, lvl);
      h += '<button class="aim-act primary' + (set ? ' done' : '') + '" onclick="NTSignals.aiSetEntryAlert()">' +
        (set ? '✓ התראה נקבעה' : '🔔 התראה על מחיר הכניסה') + '<small>' + fmt(lvl, a.curr) + '</small></button>';
    }
    h += '<button class="aim-act' + (fav ? ' on' : '') + '" onclick="NTSignals.aiToggleWatch()">' + (fav ? '★ במעקב' : '☆ הוסף למעקב') + '</button>';
    h += '<button class="aim-act wa" onclick="NTSignals.aiShare()">📲 שתף</button>';
    return h;
  }
  function aiRefreshActions() { var b = document.getElementById('aiActBar'); if (b) b.innerHTML = actionsInner(); }
  function aiSetEntryAlert() {
    var a = _aiCur && _aiCur.analysis;
    if (!a) return;
    var lvl = entryLevel(a);
    if (lvl == null) return;
    if (typeof window.ntAddEntryAlert !== 'function') { toast('התראות אינן זמינות כרגע'); return; }
    if (!isFav(a.symbol)) { var f = loadFavs(); if (f.length < favCap()) { f.push(a.symbol); saveFavs(f); } }
    var r = window.ntAddEntryAlert(a.symbol, lvl, a.price);
    requestNotifPerm();
    toast(r && r.dup ? 'ההתראה כבר קיימת' : ('🔔 נקבעה התראה: ' + dispSym(a.symbol) + (r && r.cond === 'above' ? ' מעל ' : ' מתחת ל') + fmt(lvl, a.curr)));
    aiRefreshActions();
  }
  function aiToggleWatch() {
    var a = _aiCur && _aiCur.analysis;
    if (!a) return;
    toggleFav(a.symbol);
    aiRefreshActions();
  }
  function shareText(a) {
    var en = a.entry || {}, v = a.verdict || {}, tr = a.trend || {}, sm = a.sma || {}, s = a.score, c = a.curr || '', L = [];
    L.push('📊 *ניתוח AI · ' + dispSym(a.symbol) + '*' + (a.name ? ' (' + a.name + ')' : ''));
    if (s) L.push('🎯 ציון הזדמנות: *' + s.value + '/100* (' + s.label + ')');
    if (v.text) L.push(v.text);
    L.push('📈 ' + (tr.text || '') + ' · ' + (sm.position === 'above' ? 'מעל' : 'מתחת') + ' SMA30');
    if (en.entry != null && en.stop != null && en.target != null) {
      L.push('כניסה ' + fmt(en.entry, c) + ' | סטופ ' + fmt(en.stop, c) + ' | יעד ' + fmt(en.target, c) + ' (1:' + en.rr + ')');
    }
    var d = (a.earnings && a.earnings.available) ? daysTo(a.earnings.date) : null;
    if (d != null && d >= 0 && d <= 21) L.push('📅 דוחות ' + dayTxt(d));
    L.push('');
    L.push('⚠️ אינו ייעוץ השקעות');
    L.push('🤖 ניתוח AI למניות ב-NexTrade: ' + location.origin);
    return L.join('\n');
  }
  function aiShare() {
    var a = _aiCur && _aiCur.analysis;
    if (!a) return;
    var url = 'https://wa.me/?text=' + encodeURIComponent(shareText(a));
    var w = null;
    try { w = window.open(url, '_blank', 'noopener'); } catch (e) {}
    if (!w) { try { window.location.href = url; } catch (e2) {} }
  }
  function aiCopy() {
    var a = _aiCur && _aiCur.analysis;
    if (!a) return;
    var txt = shareText(a);
    function fallback() {
      try {
        var ta = document.createElement('textarea'); ta.value = txt; ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('הסיכום הועתק ✓');
      } catch (e) { toast('לא ניתן להעתיק'); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(function () { toast('הסיכום הועתק ✓'); }, fallback);
    else fallback();
  }

  function aiRow(icon, label, html) {
    return '<div class="aim-row"><div class="aim-k"><span class="aim-ic">' + icon + '</span>' + label + '</div><div class="aim-v">' + html + '</div></div>';
  }

  function resultHtml(res) {
    var a = res.analysis, c = a.curr || '';
    var en = a.entry || {};
    var v = a.verdict || { key: 'avoid', text: '' };
    var tr = a.trend || {};
    var sm = a.sma || {};

    // 1. trend + duration
    var trIcon = tr.type === 'up' ? '📈' : (tr.type === 'down' ? '📉' : '↔️');
    var trCls = tr.type === 'up' ? 'pos' : (tr.type === 'down' ? 'neg' : 'mid');
    var trTxt = '<b class="' + trCls + '">' + esc(tr.text) + '</b> · ' + (tr.capped ? 'לפחות ' : '') + tr.weeks + ' שבועות' +
      (tr.since ? ' <span class="aim-dim">(מאז ' + heDate(tr.since) + ')</span>' : '');

    // 2. SMA30
    var slope = sm.slope === 'rising' ? 'עולה' : (sm.slope === 'falling' ? 'יורד' : 'שטוח');
    var smaTxt = '<b class="' + (sm.position === 'above' ? 'pos' : 'neg') + '">' + (sm.position === 'above' ? 'מעל' : 'מתחת') + ' SMA30</b> ' +
      '(' + fmt(sm.value, c) + ' · ' + pct(sm.distPct || 0) + ') · השיפוע ' + slope + ' · ' + sm.sideWeeks + ' שבועות ברצף';

    // 3/4. strong levels
    function lvl(l, none) {
      if (!l) return none;
      return '<b>' + fmt(l.price, c) + '</b> · ' + l.touches + ' נגיעות' + (l.veryStrong ? ' (חזקה מאוד)' : (l.strong ? ' (חזקה)' : ' (חלשה)')) +
        (l.lastTouch ? ' · נגיעה אחרונה ' + heDate(l.lastTouch) : '') + ' <span class="aim-dim">(' + pct(l.distPct) + ' מהמחיר)</span>';
    }

    // 5. broke resistance / support
    var b = a.broke, bTxt;
    if (b) {
      var when = b.weeksAgo === 0 ? 'השבוע' : ('לפני ' + b.weeksAgo + ' שבועות');
      var isRes = b.type === 'resistance';
      bTxt = '<b class="' + (isRes ? 'pos' : 'neg') + '">' + (isRes ? 'פרצה התנגדות' : 'שברה תמיכה') + '</b> ב-' + fmt(b.level, c) + ' ' + when +
        ' · ' + b.held + ' נרות ' + (isRes ? 'מעל' : 'מתחת') + ' הרמה' +
        (b.confirmed ? ' — <b>אושרה (5+ נרות)</b>' : ' — עדיין לא אושרה (נדרשים 5 נרות)') +
        (b.retesting ? ' · כעת בריטסט' : '');
    } else if (a.nearResistance && a.resistance) {
      bTxt = 'לא פרצה — נבחנת מתחת להתנגדות ב-' + fmt(a.resistance.price, c);
    } else if (a.nearSupport && a.support) {
      bTxt = 'נמצאת על התמיכה ב-' + fmt(a.support.price, c) + ' — עדיין לא נשברה';
    } else {
      bTxt = 'לא פרצה התנגדות ולא שברה תמיכה לאחרונה';
    }

    // 6. earnings
    var e = a.earnings || {}, eTxt;
    if (e.available) {
      eTxt = '<b>' + heDate(e.date) + '</b>' + (e.days >= 0 ? ' · בעוד ' + e.days + ' ימים' : ' (פורסם)') +
        ((e.days >= 0 && e.days <= 7) ? ' <b class="neg">— קרוב! מומלץ לצאת יום לפני</b>' : '');
    } else {
      eTxt = '<span class="aim-dim">לא זמין למניה זו</span>';
    }

    // liquidity: last session vs 3-month daily average
    var lq = a.liquidity, lqTxt = '';
    if (lq && lq.isIndex) {
      lqTxt = '<span class="aim-dim">מדד — לא רלוונטי</span>';
    } else if (lq) {
      var lc = lq.curr || '';
      var ratioTxt = lq.ratio != null ? ' <span class="' + (lq.ratio >= 1 ? 'pos' : 'neg') + '">(' + (lq.ratio >= 1 ? '+' : '') + Math.round((lq.ratio - 1) * 100) + '% מהממוצע)</span>' : '';
      lqTxt = '<div>יום מסחר אחרון' + (lq.lastDate ? ' <span class="aim-dim">(' + heDate(lq.lastDate) + ')</span>' : '') + ': <b>' + fmtBig(lq.lastTurnover, lc) + '</b> · ' + fmtBig(lq.lastVolume, '') + ' מניות' + ratioTxt + '</div>' +
        '<div>ממוצע יומי ל-3 חודשים: <b>' + fmtBig(lq.avgTurnover, lc) + '</b> · ' + fmtBig(lq.avgVolume, '') + ' מניות</div>' +
        (lq.meetsMin ? '' : '<div class="neg"><b>⚠️ סחירות נמוכה</b> — מתחת לסף ' + fmtBig(lq.min, lc) + ' ליום, לא מומלץ לסחור</div>');
    } else {
      lqTxt = '<span class="aim-dim">לא זמין למניה זו</span>';
    }

    // 7. enter now?
    var enterNow = en.canEnter
      ? '<b class="pos">✅ כן — ניתנת לכניסה כעת</b>'
      : (v.key === 'wait' ? '<b class="mid">⏳ עדיין לא — במעקב</b>' : '<b class="neg">⛔ לא ניתנת לכניסה כרגע</b>');
    var levelsBlock = '';
    if (en.entry != null) {
      levelsBlock = '<div class="aim-levels">' +
        '<div class="sig-lvl entry"><div class="sig-lvl-label">כניסה</div><div class="sig-lvl-val">' + fmt(en.entry, c) + '</div></div>' +
        '<div class="sig-lvl stop"><div class="sig-lvl-label">סטופ</div><div class="sig-lvl-val">' + fmt(en.stop, c) + '</div></div>' +
        '<div class="sig-lvl tp"><div class="sig-lvl-label">יעד</div><div class="sig-lvl-val">' + fmt(en.target, c) + '</div></div>' +
        '</div><div class="aim-dim aim-lvl-note">' + (en.direction === 'short' ? 'שורט' : 'לונג') + ' · יחס סיכוי/סיכון 1:' + en.rr + (en.setupText ? ' · ' + esc(en.setupText) : '') + '</div>';
    }

    // 8. ETA
    var eta = a.eta || {};
    var etaTxt = '<b>' + esc(eta.text) + '</b>' +
      (eta.basis ? '<div class="aim-dim">' + esc(eta.basis) + '</div>' : '') +
      (eta.kind === 'estimate' ? '<div class="aim-dim">הערכה בלבד — תלויה בהתנהגות השוק.</div>' : '');

    var reasons = (a.reasons || []).slice(0, 4).map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('');
    var q = res.quota || {};
    var symRaw = a.symbol || '';
    _aiCur = res;

    var histNote = '';
    if (res.fromHistory) {
      var hd = new Date(res.fromHistory);
      histNote = '<div class="aim-hist-note">🕘 ניתוח שמור מה-' + hd.getDate() + '.' + (hd.getMonth() + 1) + ' · השעה ' +
        ('0' + hd.getHours()).slice(-2) + ':' + ('0' + hd.getMinutes()).slice(-2) + ' — המחיר והנתונים נכונים לאותו זמן. ' +
        '<button class="aim-hist-btn" data-sym="' + esc(symRaw) + '" onclick="NTSignals.analyzeSymbol(this.getAttribute(\'data-sym\'))">🔄 נתח מחדש</button>' +
        '<span class="aim-dim"> (נספר במכסה אם לא נותח היום)</span></div>';
    }
    var posInr = posInner(a);
    var earnInr = earnCardInner(a);

    return '<div class="aim-head">' +
        '<div><div class="aim-sym">' + esc(dispSym(symRaw)) + '</div><div class="aim-name">' + esc(a.name) + '</div></div>' +
        '<div class="aim-price"><div class="aim-price-v">' + fmt(a.price, c) + '</div><div class="aim-dim">נכון ל-' + heDate(a.lastBar) + '</div></div>' +
      '</div>' + histNote +
      '<div class="aim-verdict ' + esc(v.key) + '">' + esc(v.text) + '</div>' +
      scoreHtml(a) +
      miniChartHtml(a) +
      '<div class="aim-rows">' +
        aiRow(trIcon, 'מגמה ומשכה', trTxt) +
        aiRow('〰️', 'ממוצע נע 30', smaTxt) +
        aiRow('🟢', 'תמיכה חזקה אחרונה', lvl(a.support, 'לא זוהתה תמיכה מתחת למחיר')) +
        aiRow('🔴', 'התנגדות חזקה אחרונה', lvl(a.resistance, 'לא זוהתה התנגדות מעל המחיר')) +
        aiRow('💥', 'פריצה / שבירה', bTxt) +
        aiRow('📅', 'פרסום דוחות', eTxt) +
        aiRow('💵', 'מחזור מסחר', lqTxt) +
        aiRow('🎯', 'ניתנת לכניסה כרגע?', enterNow + levelsBlock) +
        aiRow('⏱️', 'זמן משוער לאיתות כניסה', etaTxt) +
      '</div>' +
      (posInr ? '<div class="aim-card" id="aiPosWrap">' + posInr + '</div>' : '') +
      (earnInr ? '<div class="aim-card" id="aiEarnWrap">' + earnInr + '</div>' : '') +
      similarHtml(a) +
      (reasons ? '<div class="aim-why"><div class="aim-why-title">💡 למה?</div><ul>' + reasons + '</ul></div>' : '') +
      aiNextHtml(q, symRaw) +
      '<div class="aim-foot">' +
        '<button class="sig-btn ghost" onclick="NTSignals.aiCopy()">📋 העתק סיכום</button>' +
        '<button class="sig-btn ghost" onclick="NTSignals.closeAiModal()">סגור</button>' +
      '</div>' +
      '<div class="aim-disc">' + (q.limit == null ? 'ניתוחים ללא הגבלה' : ('נוצלו ' + q.used + ' מתוך ' + q.limit + ' ניתוחים היום')) +
        (res.charged === false && !res.fromHistory ? ' · ניתוח חוזר, לא נספר' : '') + '<br>אינו מהווה ייעוץ השקעות.</div>' +
      '<div class="aim-actions" id="aiActBar">' + actionsInner() + '</div>';
  }

  function addTrade(sym) {
    var sigs = loadSignals();
    var s = null;
    for (var i = 0; i < sigs.length; i++) { if (sigs[i].sym === sym) { s = sigs[i]; break; } }
    if (!s) return;
    var trades = loadTrades();
    // avoid duplicate open trade for same symbol+direction
    var dup = trades.some(function (t) { return t.status === 'open' && t.sym === s.sym && t.dir === s.dir; });
    if (dup) { alert('כבר קיימת עסקה פתוחה על ' + sym.replace('.TA', '')); return; }
    trades.unshift({
      id: 'tr_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      sym: s.sym, name: s.name, dir: s.dir, curr: s.curr,
      entry: s.entry, stop: s.stop, tp: s.tp, rr: s.rr, shares: 1,
      status: 'open', openTs: Date.now(),
      openDate: new Date().toLocaleDateString('he-IL')
    });
    saveTrades(trades);
    refreshTradePrices(true);
    switchTab('trades');
  }

  function closeTrade(id) {
    var trades = loadTrades();
    var t = null;
    for (var i = 0; i < trades.length; i++) { if (trades[i].id === id) { t = trades[i]; break; } }
    if (!t) return;
    if (!confirm('לסגור את העסקה על ' + t.sym.replace('.TA', '') + '?')) return;
    var live = livePrice(t.sym);
    if (live == null) live = t.entry;
    var pnl = tradePnl(t, live);
    t.status = 'closed';
    t.closePrice = live;
    t.closeTs = Date.now();
    t.closeDate = new Date().toLocaleDateString('he-IL');
    t.pnl = pnl.abs;
    t.pnlV2 = true;   // pnl stored in main currency units (shekels for TASE)
    t.pnlPct = pnl.pct;
    saveTrades(trades);
    render();
  }

  // Open the full chart (analysis) for a symbol from a signal card
  function analyze(sym) {
    // Signals-only users are locked to the feed — don't leave it.
    if (isSignalsLocked()) { try { if (typeof window.ntToast === 'function') window.ntToast('מצב איתותים בלבד'); } catch (e) {} return; }
    setMode('analysis');
    try { if (typeof window.selectSymbol === 'function') window.selectSymbol(sym); } catch (e) {}
  }

  // Back-compat: old favorites toggle maps onto the new chip filter.
  function setFavFilter(on) { filterKey = on ? 'fav' : 'all'; render(); }
  function setFilter(k) { filterKey = k || 'all'; render(); }
  function setSort(v) { sortBy = v || 'newest'; render(); }
  function setMarket(v) { marketFilter = v || 'all'; render(); }
  function setView(v) {
    viewMode = v === 'cards' ? 'cards' : 'list';
    try { localStorage.setItem(VIEW_KEY, viewMode); } catch (e) {}
    render();
  }
  function resetFilters() { filterKey = 'all'; marketFilter = 'all'; textFilter = ''; render(); }
  function onFilterText(v) {
    textFilter = String(v || '');
    var dyn = document.getElementById('sigDyn');
    if (dyn) dyn.innerHTML = renderSigDyn(); else render();
  }
  function toggleRow(key) {
    if (_expanded[key]) delete _expanded[key]; else _expanded[key] = true;
    var dyn = document.getElementById('sigDyn');
    if (dyn) dyn.innerHTML = renderSigDyn(); else render();
  }

  // ---- admin: delete signals from the scanner feed ----
  function purgeLocalSignals(sym, dir) {
    function match(a) {
      if (!a || a.sym !== sym) return false;
      if (!dir) return true;
      var isShort = a.direction === 'short' || a.direction === 'bearish' || a.condition === 'sell_signal';
      return (isShort ? 'short' : 'long') === dir;
    }
    try {
      var sc = loadServerCache();
      if (sc && Array.isArray(sc.data)) {
        sc.data = sc.data.filter(function (a) { return !match(a); });
        localStorage.setItem(SERVER_KEY, JSON.stringify(sc));
      }
    } catch (e) {}
    try {
      var al = JSON.parse(localStorage.getItem(ALERTS_KEY) || '[]');
      al = al.filter(function (a) { return !match(a); });
      localStorage.setItem(ALERTS_KEY, JSON.stringify(al));
    } catch (e) {}
  }
  function adminDeleteRequest(body, done) {
    var token = authToken();
    if (!token) { done(null); return; }   // demo/offline: local only
    fetch(apiBase() + '/api/admin/signals/delete', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }, function () { return { ok: r.ok, d: {} }; }); })
      .then(function (res) { done(res.ok ? null : ((res.d && res.d.error) || 'שגיאה במחיקה')); })
      .catch(function () { done('שגיאת רשת'); });
  }
  function deleteSignal(sym, dir) {
    if (!isAdmin()) return;
    if (!confirm('למחוק את האיתות על ' + (sym || '').replace('.TA', '') + ' (' + (dir === 'long' ? 'לונג' : 'שורט') + ')?')) return;
    adminDeleteRequest({ sym: sym, direction: dir }, function (err) {
      if (err) { alert(err); return; }
      purgeLocalSignals(sym, dir);
      render();
      syncServerSignals(true);
    });
  }
  function clearAllSignals(skipConfirm) {
    if (!isAdmin()) return;
    if (skipConfirm !== true && !confirm('למחוק את כל האיתותים מהסורק? הפעולה חלה על כל המשתמשים.')) return;
    adminDeleteRequest({ all: true }, function (err) {
      if (err) { alert(err); return; }
      try {
        var sc = loadServerCache();
        if (sc) { sc.data = []; sc.total = 0; localStorage.setItem(SERVER_KEY, JSON.stringify(sc)); }
        localStorage.setItem(ALERTS_KEY, '[]');
      } catch (e) {}
      render();
      syncServerSignals(true);
    });
  }

  // "Set alert" — mark the symbol as a favorite (so it's watched) and confirm.
  function setAlert(sym) {
    if (!isFav(sym)) {
      var f = loadFavs();
      if (f.length >= favCap()) {
        openUpgrade(favLimitMsg());
        return;
      }
      f.push(sym); saveFavs(f);
    }
    try { if (typeof window.ntToast === 'function') window.ntToast('התראה נקבעה על ' + (sym || '').replace('.TA', '') + ' 🔔'); } catch (e) {}
    render();
  }

  function show() { setMode('signals'); }
  function hide() { if (isSignalsLocked()) return; setMode('analysis'); }

  function setMode(mode) {
    // Prevent signals-only users from switching into analysis.
    if (mode === 'analysis' && isSignalsLocked()) mode = 'signals';
    localStorage.setItem(MODE_KEY, mode);
    var feed = document.getElementById('signalFeed');
    if (!feed) return;
    // Admins move freely: keep the body mode classes in sync so the mode-analysis
    // CSS (which hides the feed with !important) never blocks opening it, while the
    // in-feed mode toggle stays visible so they can switch back to the site.
    if (isAdmin()) {
      if (mode === 'signals') {
        document.body.classList.remove('mode-analysis');
        document.body.classList.remove('mode-signals');
      } else {
        document.body.classList.add('mode-analysis');
        document.body.classList.remove('mode-signals');
      }
      document.body.classList.add('mode-admin');
    }
    // update toggle buttons
    var btns = document.querySelectorAll('#signalFeed .sf-mode');
    btns.forEach(function (b, idx) { b.classList.toggle('active', (idx === 0) === (mode === 'signals')); });
    if (mode === 'signals') {
      feed.style.display = 'flex';
      render();
      startAutoRefresh();
    } else {
      feed.style.display = 'none';
      stopAutoRefresh();
    }
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    syncServerSignals(true); // pull the authoritative feed immediately
    refreshTimer = setInterval(function () {
      var feed = document.getElementById('signalFeed');
      if (feed && feed.style.display !== 'none') { syncServerSignals(); render(); refreshTradePrices(); }
    }, 20000);
  }
  function stopAutoRefresh() { if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; } }

  // Called after the app is logged-in and ready
  function onAppReady() {
    startRemChecks();
    syncServerSignals(true); // fetch the server feed as soon as we're logged in
    // Admins default to the regular (analysis) site — they are not signal-locked.
    if (isAdmin()) { setMode('analysis'); return; }
    var plan = localStorage.getItem(PLAN_KEY);
    // Analysis users never see the feed; signals users are shown it.
    if (plan === 'analysis') { setMode('analysis'); return; }
    if (plan === 'signals')  { setMode('signals');  return; }
    // No explicit plan (legacy): fall back to last view, default to signals.
    var mode = localStorage.getItem(MODE_KEY) || 'signals';
    setMode(mode);
  }

  // Safety net: a signals-only user must never remain on the regular site (e.g. after the
  // mobile browser restores the page, or something hides the feed).
  function enforceLock() {
    try {
      if (!authToken() || !isSignalsLocked()) return;
      var feed = document.getElementById('signalFeed');
      if (feed && feed.style.display === 'none') setMode('signals');
    } catch (e) {}
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) enforceLock(); });
  window.addEventListener('pageshow', enforceLock);
  window.addEventListener('focus', enforceLock);

  window.NTSignals = {
    onAppReady: onAppReady,
    show: show, hide: hide, setMode: setMode,
    switchTab: switchTab, addTrade: addTrade, closeTrade: closeTrade,
    riskCalc: riskCalc, toggleDisc: toggleDisc,
    aiSuggest: aiSuggest, aiKey: aiKey, aiPick: aiPick, aiNext: aiNext, aiSugHideLater: aiSugHideLater,
    analyze: analyze, render: render,
    toggleFav: toggleFav, setFavFilter: setFavFilter, setAlert: setAlert,
    setFilter: setFilter, setSort: setSort, setMarket: setMarket, setView: setView,
    resetFilters: resetFilters, onFilterText: onFilterText, toggleRow: toggleRow,
    deleteSignal: deleteSignal, clearAllSignals: clearAllSignals, isAdmin: isAdmin,
    analyzeSymbol: analyzeSymbol, analyzeFromInput: analyzeFromInput, closeAiModal: closeAiModal,
    aiSetEntryAlert: aiSetEntryAlert, aiToggleWatch: aiToggleWatch, aiShare: aiShare, aiCopy: aiCopy,
    aiSavePort: aiSavePort, aiEditPort: aiEditPort, aiSetRisk: aiSetRisk, aiGoRisk: aiGoRisk,
    aiToggleRemind: aiToggleRemind, aiRemoveRemind: aiRemoveRemind, aiNotifPerm: requestNotifPerm, aiOpenHist: aiOpenHist,
    syncServerSignals: syncServerSignals,
    toggleUserMenu: toggleUserMenu,
    openUpgrade: function (ctx) { openUpgrade(ctx); }
  };
})();
