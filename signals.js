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
  var MODE_KEY   = 'nt_user_mode';       // 'signals' | 'analysis'
  var ALERTS_KEY = 'ib_alerts2';         // scanner signals (written by main.js)

  var activeTab = 'signals';
  var refreshTimer = null;

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

  // Read scanner signals and normalize into {sym,name,dir,entry,stop,tp,rr,curr,ts,status}
  function loadSignals() {
    var raw;
    try { raw = JSON.parse(localStorage.getItem(ALERTS_KEY) || '[]'); } catch (e) { raw = []; }
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
        entry: levels.entry, stop: levels.stop, tp: levels.tp, rr: levels.rr,
        ts: a.ts || 0, date: a.date || '', time: a.time || '',
        trendType: a.trendType || ''
      });
    });
    return out;
  }

  // Entry / Stop / TP from the scanner payload, using the 1:2 R:R method.
  function computeLevels(a, dir) {
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

  // Status of a signal relative to the live price.
  function signalStatus(s) {
    var live = livePrice(s.sym);
    if (live == null) return 'waiting';
    if (s.dir === 'long') {
      if (live >= s.tp) return 'hit';
      if (live >= s.entry) return 'active';
      return 'waiting';
    } else {
      if (live <= s.tp) return 'hit';
      if (live <= s.entry) return 'active';
      return 'waiting';
    }
  }
  var STATUS_TXT = { waiting: 'ממתין לכניסה', active: 'פעיל', hit: 'הגיע ליעד' };

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
    var st = signalStatus(s);
    var dirTxt = s.dir === 'long' ? '🟢 לונג' : '🔴 שורט';
    return '<div class="sig-card ' + s.dir + '">' +
      '<div class="sig-head">' +
        '<div><div class="sig-sym">' + (s.sym || '').replace('.TA', '') + '</div>' +
        '<div class="sig-name">' + s.name + '</div></div>' +
        '<span class="sig-dir ' + s.dir + '">' + dirTxt + '</span>' +
      '</div>' +
      miniChart(s.dir) +
      '<div class="sig-levels">' +
        '<div class="sig-lvl entry"><div class="sig-lvl-label">כניסה</div><div class="sig-lvl-val">' + fmt(s.entry, s.curr) + '</div></div>' +
        '<div class="sig-lvl stop"><div class="sig-lvl-label">סטופ</div><div class="sig-lvl-val">' + fmt(s.stop, s.curr) + '</div></div>' +
        '<div class="sig-lvl tp"><div class="sig-lvl-label">יעד</div><div class="sig-lvl-val">' + fmt(s.tp, s.curr) + '</div></div>' +
      '</div>' +
      '<div class="sig-meta">' +
        '<span class="sig-rr">יחס סיכוי/סיכון ' + s.rr + '</span>' +
        '<span class="sig-status ' + st + '">' + STATUS_TXT[st] + '</span>' +
      '</div>' +
      '<div class="sig-card-foot">' +
        '<button class="sig-btn" onclick="NTSignals.addTrade(\'' + s.sym + '\')">הוסף לתיק</button>' +
        '<button class="sig-btn ghost" onclick="NTSignals.analyze(\'' + s.sym + '\')">הצג בגרף</button>' +
      '</div>' +
    '</div>';
  }

  function renderSignals() {
    var sigs = loadSignals();
    if (!sigs.length) {
      return '<div class="sf-empty">אין איתותים פעילים כרגע.<br>הסורק רץ ברקע ומעדכן אוטומטית — איתותים חדשים יופיעו כאן.</div>';
    }
    // de-dupe by symbol+dir, keep newest
    var seen = {}, uniq = [];
    sigs.sort(function (a, b) { return b.ts - a.ts; });
    sigs.forEach(function (s) {
      var k = s.sym + '_' + s.dir;
      if (seen[k]) return; seen[k] = true; uniq.push(s);
    });
    return '<div class="sf-grid">' + uniq.map(signalCard).join('') + '</div>';
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

  function render() {
    var body = document.getElementById('sfBody');
    if (!body) return;
    if (activeTab === 'signals') body.innerHTML = renderSignals();
    else if (activeTab === 'trades') body.innerHTML = renderTrades();
    else if (activeTab === 'history') body.innerHTML = renderHistory();
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
    setMode('analysis');
    try { if (typeof window.selectSymbol === 'function') window.selectSymbol(sym); } catch (e) {}
  }

  function show() { setMode('signals'); }
  function hide() { setMode('analysis'); }

  function setMode(mode) {
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
    refreshTimer = setInterval(function () {
      var feed = document.getElementById('signalFeed');
      if (feed && feed.style.display !== 'none') render();
    }, 20000);
  }
  function stopAutoRefresh() { if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; } }

  // Called after the app is logged-in and ready
  function onAppReady() {
    var mode = localStorage.getItem(MODE_KEY) || 'signals'; // default to signals feed
    setMode(mode);
  }

  window.NTSignals = {
    onAppReady: onAppReady,
    show: show, hide: hide, setMode: setMode,
    switchTab: switchTab, addTrade: addTrade, closeTrade: closeTrade,
    analyze: analyze, render: render
  };
})();
