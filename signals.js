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

  // Signals-only users are LOCKED to the feed (no switching to analysis).
  function isSignalsLocked() {
    var plan = localStorage.getItem(PLAN_KEY) || localStorage.getItem(MODE_KEY);
    return plan === 'signals';
  }

  var activeTab = 'signals';
  var refreshTimer = null;
  var favFilter = false; // when true, show only favorite symbols in the signals tab
  var searchQuery = ''; // in-feed search text (filters cards; also drives "add to watch")

  // ---------- plan helpers (thin wrappers over window.NTPlan) ----------
  function isPremium() { try { return !window.NTPlan || window.NTPlan.isPremium(); } catch (e) { return true; } }
  function favCap()    { try { return window.NTPlan ? window.NTPlan.favLimit() : Infinity; } catch (e) { return Infinity; } }
  function sigCap()    { try { return window.NTPlan ? window.NTPlan.signalLimit() : Infinity; } catch (e) { return Infinity; } }
  function canUse(f)   { try { return !window.NTPlan || window.NTPlan.canUse(f); } catch (e) { return true; } }
  function openUpgrade(ctx) { try { if (window.NTPlan) window.NTPlan.openUpgrade(ctx); } catch (e) {} }

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
        openUpgrade('במסלול החינם אפשר לעקוב אחרי עד ' + favCap() + ' מניות. שדרג למעקב ללא הגבלה.');
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
  function earningsInfo(sym) {
    var map = loadEarnings();
    var d = map[sym] || map[(sym || '').replace('.TA', '')];
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
            isPremium: d.isPremium, delayedMs: d.delayedMs, lastScan: d.lastScan
          }));
        } catch (e) {}
        // keep the plan badge/UI honest with the server's authoritative answer
        try { if (window.NTPlan) window.NTPlan.applyServerPlan({ plan: d.isPremium ? 'premium' : 'free' }); } catch (e) {}
        render();
      })
      .catch(function () {});
  }

  // Read scanner signals and normalize into a rich signal object. Prefers the
  // server feed (authoritative) and falls back to the local scanner (ib_alerts2).
  function loadSignals() {
    var raw;
    var sc = loadServerCache();
    if (sc && Array.isArray(sc.data)) {
      raw = sc.data;
      _serverInfo = { total: sc.total, isPremium: sc.isPremium, delayedMs: sc.delayedMs, lastScan: sc.lastScan };
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
      var dir = isBuy ? 'long' : 'short';
      var levels = computeLevels(a, dir);
      out.push({
        sym: a.sym, name: a.name || (a.sym || '').replace('.TA', ''),
        dir: dir, curr: a.curr || '',
        price: a.price,
        entry: levels.entry, stop: levels.stop, tp: levels.tp, rr: levels.rr,
        ts: a.ts || 0, date: a.date || '', time: a.time || '',
        trendType: a.trendType || '',
        setup: a.setup || '',
        reasons: Array.isArray(a.reasons) ? a.reasons : [],
        alertLevel: (a.alertLevel != null ? a.alertLevel : null),
        alertSide: a.alertSide || '',
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
    armed: 'מזומן — קרוב לכניסה',
    active: 'פעיל',
    hit: 'הגיע ליעד ✓',
    stopped: 'נפגע סטופ ✕'
  };

  // ---------- rendering ----------
  function miniChart(dir) {
    // Schematic sparkline for illustration only (no network). Up for long, down for short.
    var up = dir === 'long';
    var color = up ? '#26a69a' : '#ef5350';
    var path = up
      ? 'M2,46 L30,40 L58,44 L92,30 L130,34 L170,14 L200,8'
      : 'M2,10 L30,16 L58,12 L92,26 L130,22 L170,42 L200,50';
    return '<svg class="sig-thumb" viewBox="0 0 200 60" preserveAspectRatio="none">' +
      '<polyline points="0,58 200,58" stroke="rgba(255,255,255,.06)" fill="none"/>' +
      '<path d="' + path + '" fill="none" stroke="' + color + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>';
  }

  function signalCard(s) {
    var stt = signalStatus(s);
    var st = stt.key;
    var dirTxt = s.dir === 'long' ? '🟢 לונג' : '🔴 שורט';
    var fav = isFav(s.sym);
    var earn = earningsInfo(s.sym);
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

    return '<div class="sig-card ' + s.dir + '">' +
      '<div class="sig-head">' +
        '<div><div class="sig-sym">' + (s.sym || '').replace('.TA', '') +
          (setupTxt ? ' <span class="sig-setup">' + setupTxt + '</span>' : '') + '</div>' +
        '<div class="sig-name">' + s.name + '</div></div>' +
        '<div class="sig-head-right">' +
          '<button class="sig-fav ' + (fav ? 'on' : '') + '" title="קבל התראה על מניה זו" onclick="NTSignals.toggleFav(\'' + s.sym + '\')">' + (fav ? '★' : '☆') + '</button>' +
          '<span class="sig-dir ' + s.dir + '">' + dirTxt + '</span>' +
        '</div>' +
      '</div>' +
      miniChart(s.dir) +
      '<div class="sig-levels">' +
        '<div class="sig-lvl entry"><div class="sig-lvl-label">כניסה</div><div class="sig-lvl-val">' + fmt(s.entry, s.curr) + '</div></div>' +
        '<div class="sig-lvl stop"><div class="sig-lvl-label">סטופ</div><div class="sig-lvl-val">' + fmt(s.stop, s.curr) + '</div></div>' +
        '<div class="sig-lvl tp"><div class="sig-lvl-label">יעד</div><div class="sig-lvl-val">' + fmt(s.tp, s.curr) + '</div></div>' +
      '</div>' +
      whyTxt +
      earnTxt +
      '<div class="sig-meta">' +
        '<span class="sig-rr">יחס סיכוי/סיכון ' + s.rr + '</span>' +
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
      '<div class="sf-hero-sym">' + (s.sym || '').replace('.TA', '') + ' · ' + (s.dir === 'long' ? 'לונג' : 'שורט') + '</div>' +
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

  function renderSignals() {
    var sigs = loadSignals();
    // de-dupe by symbol+dir, keep newest
    var seen = {}, uniq = [];
    sigs.sort(function (a, b) { return b.ts - a.ts; });
    sigs.forEach(function (s) {
      var k = s.sym + '_' + s.dir;
      if (seen[k]) return; seen[k] = true; uniq.push(s);
    });

    // Favorites filter toggle bar
    var favCount = loadFavs().length;
    var filterBar = '<div class="sf-filter">' +
      '<button class="sf-filter-btn ' + (!favFilter ? 'active' : '') + '" onclick="NTSignals.setFavFilter(false)">הכל</button>' +
      '<button class="sf-filter-btn ' + (favFilter ? 'active' : '') + '" onclick="NTSignals.setFavFilter(true)">★ מועדפים' + (favCount ? ' (' + favCount + ')' : '') + '</button>' +
    '</div>';

    var list = uniq;
    if (favFilter) list = uniq.filter(function (s) { return isFav(s.sym); });
    // in-feed text search (symbol or name)
    if (searchQuery) {
      var q = searchQuery.toLowerCase();
      list = list.filter(function (s) {
        var a = (s.sym || '').toLowerCase();
        var b = (s.name || '').toLowerCase();
        return a.indexOf(q) !== -1 || b.indexOf(q) !== -1;
      });
    }

    var perf = perfSummary();
    var hero = (favFilter || searchQuery) ? '' : heroCard(uniq);

    if (!list.length) {
      var emptyMsg;
      if (searchQuery) {
        emptyMsg = 'אין איתות פעיל על "' + searchQuery + '".<br>הוסף אותה למעקב כדי לקבל התראה כשייווצר איתות.';
      } else if (favFilter) {
        emptyMsg = 'אין איתותים במניות המועדפות שלך כרגע.<br>סמן מניות בכוכב כדי לקבל עליהן התראות.';
      } else {
        emptyMsg = 'אין איתותים פעילים כרגע.<br>הסורק רץ ברקע ומעדכן אוטומטית — איתותים חדשים יופיעו כאן.';
      }
      return perf + filterBar + '<div class="sf-empty">' + emptyMsg + '</div>';
    }

    // Free-tier cap + upsell. When the SERVER feed is active, enforcement already
    // happened server-side (delayed + capped), so we tease using the real total it
    // reported. Otherwise (local fallback) we cap client-side.
    var upsell = '';
    if (_serverInfo) {
      if (!_serverInfo.isPremium && _serverInfo.total > list.length && !favFilter && !searchQuery) {
        var hiddenS = _serverInfo.total - list.length;
        upsell = '<div class="sf-upsell">' +
          '<div class="sf-upsell-txt">' +
            '<div class="sf-upsell-title">🔒 יש עוד ' + hiddenS + ' איתותים</div>' +
            '<div class="sf-upsell-sub">במסלול החינם האיתותים מוצגים בעיכוב ובכמות מוגבלת. שדרג כדי לקבל הכל בזמן אמת.</div>' +
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
            '<div class="sf-upsell-sub">במסלול החינם מוצגים ' + cap + ' איתותים. שדרג כדי לראות את כולם בזמן אמת.</div>' +
          '</div>' +
          '<button class="sf-upsell-btn" onclick="NTSignals.openUpgrade()">⭐ שדרג</button>' +
        '</div>';
      }
    }

    return perf + hero + filterBar + '<div class="sf-grid">' + list.map(signalCard).join('') + '</div>' + upsell;
  }

  function tradePnl(t, live) {
    if (live == null) return { abs: null, pct: null };
    var sign = t.dir === 'long' ? 1 : -1;
    var shares = t.shares || 1;
    var abs = (live - t.entry) * sign * shares;
    var p = ((live - t.entry) / t.entry) * 100 * sign;
    return { abs: abs, pct: p };
  }

  function tradeRow(t, isOpen) {
    var live = isOpen ? livePrice(t.sym) : t.closePrice;
    var pnl = isOpen ? tradePnl(t, live) : { abs: t.pnl, pct: t.pnlPct };
    var cls = (pnl.abs == null) ? '' : (pnl.abs >= 0 ? 'pos' : 'neg');
    var dirTxt = t.dir === 'long' ? 'לונג' : 'שורט';
    var pnlTxt = (pnl.abs == null) ? '--' : (fmt(pnl.abs, t.curr) + ' (' + pct(pnl.pct) + ')');
    return '<div class="trade-row">' +
      '<div><span class="tr-sym">' + (t.sym || '').replace('.TA', '') + '</span>' +
        '<br><span class="tr-dir ' + t.dir + '">' + dirTxt + '</span></div>' +
      '<div><div class="tr-cell-label">כניסה</div>' + fmt(t.entry, t.curr) + '</div>' +
      '<div><div class="tr-cell-label">' + (isOpen ? 'מחיר נוכחי' : 'מחיר סגירה') + '</div>' + fmt(live, t.curr) + '</div>' +
      '<div><div class="tr-cell-label">סטופ / יעד</div>' + fmt(t.stop, t.curr) + ' / ' + fmt(t.tp, t.curr) + '</div>' +
      '<div><div class="tr-cell-label">רווח/הפסד</div><span class="tr-pnl ' + cls + '">' + pnlTxt + '</span></div>' +
      '<div>' + (isOpen
          ? '<button class="tr-close-btn" onclick="NTSignals.closeTrade(\'' + t.id + '\')">סגור עסקה</button>'
          : '<span class="tr-cell-label">' + (t.closeDate || '') + '</span>') +
      '</div>' +
    '</div>';
  }

  function renderTrades() {
    var trades = loadTrades();
    var open = trades.filter(function (t) { return t.status === 'open'; });
    var closed = trades.filter(function (t) { return t.status === 'closed'; });

    // live totals
    var openPnl = 0, haveLive = false;
    open.forEach(function (t) { var l = livePrice(t.sym); var p = tradePnl(t, l); if (p.abs != null) { openPnl += p.abs; haveLive = true; } });
    var realized = closed.reduce(function (s, t) { return s + (t.pnl || 0); }, 0);
    var wins = closed.filter(function (t) { return (t.pnl || 0) >= 0; }).length;
    var winRate = closed.length ? Math.round(wins / closed.length * 100) : 0;

    var html = '<div class="sf-trades">';
    html += '<div class="sf-stats">' +
      '<div class="sf-stat"><div class="sf-stat-label">עסקאות פתוחות</div><div class="sf-stat-val">' + open.length + '</div></div>' +
      '<div class="sf-stat"><div class="sf-stat-label">רווח/הפסד פתוח</div><div class="sf-stat-val ' + (openPnl >= 0 ? 'pos' : 'neg') + '">' + (haveLive ? fmt(openPnl) : '--') + '</div></div>' +
      '<div class="sf-stat"><div class="sf-stat-label">רווח/הפסד ממומש</div><div class="sf-stat-val ' + (realized >= 0 ? 'pos' : 'neg') + '">' + fmt(realized) + '</div></div>' +
      '<div class="sf-stat"><div class="sf-stat-label">אחוז הצלחה</div><div class="sf-stat-val">' + winRate + '%</div></div>' +
    '</div>';

    if (!open.length) {
      html += '<div class="sf-empty">אין עסקאות פתוחות. הוסף עסקה מלוח האיתותים.</div>';
    } else {
      html += '<div class="sf-rows-head"><div>מניה</div><div>כניסה</div><div>מחיר נוכחי</div><div>סטופ / יעד</div><div>רווח/הפסד</div><div></div></div>';
      html += open.map(function (t) { return tradeRow(t, true); }).join('');
    }
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
    var realized = closed.reduce(function (s, t) { return s + (t.pnl || 0); }, 0);
    var wins = closed.filter(function (t) { return (t.pnl || 0) >= 0; }).length;
    var html = '<div class="sf-trades">';
    html += '<div class="sf-stats">' +
      '<div class="sf-stat"><div class="sf-stat-label">סה״כ עסקאות</div><div class="sf-stat-val">' + closed.length + '</div></div>' +
      '<div class="sf-stat"><div class="sf-stat-label">מנצחות</div><div class="sf-stat-val pos">' + wins + '</div></div>' +
      '<div class="sf-stat"><div class="sf-stat-label">מפסידות</div><div class="sf-stat-val neg">' + (closed.length - wins) + '</div></div>' +
      '<div class="sf-stat"><div class="sf-stat-label">רווח/הפסד כולל</div><div class="sf-stat-val ' + (realized >= 0 ? 'pos' : 'neg') + '">' + fmt(realized) + '</div></div>' +
    '</div>';
    html += '<div class="sf-rows-head"><div>מניה</div><div>כניסה</div><div>מחיר סגירה</div><div>סטופ / יעד</div><div>רווח/הפסד</div><div>תאריך</div></div>';
    html += closed.map(function (t) { return tradeRow(t, false); }).join('');
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
      var sym = (a.sym || '').replace('.TA', '');
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

  function render() {
    var body = document.getElementById('sfBody');
    if (!body) return;
    if (activeTab === 'signals') body.innerHTML = renderSignals();
    else if (activeTab === 'trades') body.innerHTML = renderTrades();
    else if (activeTab === 'history') body.innerHTML = renderHistory();
    else if (activeTab === 'alerts') body.innerHTML = renderAlertsLog();
    var nameEl = document.getElementById('sfUserName');
    if (nameEl) {
      var u = document.getElementById('userNameDisplay');
      nameEl.textContent = u && u.textContent ? ('שלום, ' + u.textContent) : '';
    }
  }

  // ---------- public actions ----------
  function switchTab(tab) {
    activeTab = tab;
    var tabs = document.querySelectorAll('#signalFeed .sf-tab');
    tabs.forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-tab') === tab); });
    // the in-feed search belongs to the signals tab only
    var searchWrap = document.getElementById('sfSearchWrap');
    if (searchWrap) searchWrap.style.display = (tab === 'signals') ? 'flex' : 'none';
    render();
  }

  // ---------- in-feed search + watch ----------
  function onSearch(val) {
    searchQuery = (val || '').trim();
    if (activeTab !== 'signals') return;
    render();
  }

  // Validate a typed query against the scanner's known symbols.
  function resolveSymbol(q) {
    q = (q || '').trim().toUpperCase();
    if (!q) return null;
    var all = (typeof window.ALL_SCANNER_SYMBOLS !== 'undefined') ? window.ALL_SCANNER_SYMBOLS : (typeof ALL_SCANNER_SYMBOLS !== 'undefined' ? ALL_SCANNER_SYMBOLS : []);
    if (!all || !all.length) return q; // can't validate — accept as-is
    // exact match on symbol or its .TA-stripped form
    for (var i = 0; i < all.length; i++) {
      var s = all[i].toUpperCase();
      if (s === q || s.replace('.TA', '') === q) return all[i];
    }
    // TASE symbols are stored with .TA — try appending it
    for (var j = 0; j < all.length; j++) {
      if (all[j].toUpperCase() === q + '.TA') return all[j];
    }
    return null;
  }

  // Add the symbol in the search box to the user's watch list (favorites).
  function addWatchFromSearch() {
    var input = document.getElementById('sfSearchInput');
    var q = input ? input.value : searchQuery;
    var sym = resolveSymbol(q);
    if (!sym) {
      try { if (typeof window.ntToast === 'function') window.ntToast('לא נמצאה מניה בשם "' + (q || '') + '"'); else alert('מניה לא נמצאה'); } catch (e) {}
      return;
    }
    if (isFav(sym)) {
      try { if (typeof window.ntToast === 'function') window.ntToast((sym || '').replace('.TA', '') + ' כבר במעקב ✓'); } catch (e) {}
      return;
    }
    var f = loadFavs();
    if (f.length >= favCap()) {
      openUpgrade('במסלול החינם אפשר לעקוב אחרי עד ' + favCap() + ' מניות. שדרג למעקב ללא הגבלה.');
      return;
    }
    f.push(sym); saveFavs(f);
    if (input) input.value = '';
    searchQuery = '';
    try { if (typeof window.ntToast === 'function') window.ntToast('✓ ' + (sym || '').replace('.TA', '') + ' נוספה למעקב — נודיע כשייווצר איתות'); } catch (e) {}
    render();
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

  // Toggle the favorites filter in the signals tab.
  function setFavFilter(on) { favFilter = !!on; render(); }

  // "Set alert" — mark the symbol as a favorite (so it's watched) and confirm.
  function setAlert(sym) {
    if (!isFav(sym)) {
      var f = loadFavs();
      if (f.length >= favCap()) {
        openUpgrade('במסלול החינם אפשר לעקוב אחרי עד ' + favCap() + ' מניות. שדרג למעקב ללא הגבלה.');
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
      if (feed && feed.style.display !== 'none') { syncServerSignals(); render(); }
    }, 20000);
  }
  function stopAutoRefresh() { if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; } }

  // Called after the app is logged-in and ready
  function onAppReady() {
    syncServerSignals(true); // fetch the server feed as soon as we're logged in
    var plan = localStorage.getItem(PLAN_KEY);
    // Analysis users never see the feed; signals users are shown it.
    if (plan === 'analysis') { setMode('analysis'); return; }
    if (plan === 'signals')  { setMode('signals');  return; }
    // No explicit plan (legacy): fall back to last view, default to signals.
    var mode = localStorage.getItem(MODE_KEY) || 'signals';
    setMode(mode);
  }

  window.NTSignals = {
    onAppReady: onAppReady,
    show: show, hide: hide, setMode: setMode,
    switchTab: switchTab, addTrade: addTrade, closeTrade: closeTrade,
    analyze: analyze, render: render,
    toggleFav: toggleFav, setFavFilter: setFavFilter, setAlert: setAlert,
    onSearch: onSearch, addWatchFromSearch: addWatchFromSearch,
    syncServerSignals: syncServerSignals,
    openUpgrade: function (ctx) { openUpgrade(ctx); }
  };
})();
