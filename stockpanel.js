// ============================================================
//  NexTrade — Stock details panel (window.NTStockPanel)
//  Lives under the watchlist in the right sidebar and follows the selected symbol.
//  Data comes from GET /api/stock/details (server: Yahoo Finance, cached 5 min).
//  Every section is optional: if the server has no data for it, it is simply hidden.
// ============================================================
(function () {
  'use strict';

  var TTL = 5 * 60 * 1000;
  var cache = {};          // sym -> { ts, data }
  var cur = null;          // symbol currently shown
  var reqId = 0;

  function apiBase() {
    try { if (typeof API_BASE === 'string' && API_BASE) return API_BASE; } catch (e) {}
    return 'https://nextrade-lending.onrender.com';
  }
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function fnum(n, d) {
    if (!isNum(n)) return '—';
    return n.toLocaleString('en-US', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d });
  }
  function fbig(n, cur) {
    if (!isNum(n)) return '—';
    var a = Math.abs(n), s;
    if (a >= 1e12) s = (n / 1e12).toFixed(2) + 'T';
    else if (a >= 1e9) s = (n / 1e9).toFixed(2) + 'B';
    else if (a >= 1e6) s = (n / 1e6).toFixed(2) + 'M';
    else if (a >= 1e3) s = (n / 1e3).toFixed(1) + 'K';
    else s = n.toFixed(0);
    return (cur || '') + s;
  }
  function fpct(n, d) {
    if (!isNum(n)) return '—';
    return (n >= 0 ? '+' : '') + n.toFixed(d == null ? 2 : d) + '%';
  }
  function cls(n) { return !isNum(n) ? '' : (n >= 0 ? 'up' : 'down'); }
  function heDate(iso) {
    var p = String(iso || '').split('-');
    return p.length === 3 ? (p[2] + '.' + p[1] + '.' + p[0]) : '';
  }
  function daysTo(iso) {
    var d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return null;
    var t = new Date(); t.setHours(0, 0, 0, 0);
    return Math.round((d - t) / 86400000);
  }
  function ago(ts) {
    if (!ts) return '';
    var m = Math.floor((Date.now() - ts) / 60000);
    if (m < 60) return 'לפני ' + Math.max(1, m) + ' דק׳';
    var h = Math.floor(m / 60);
    if (h < 24) return 'לפני ' + h + ' שע׳';
    var d = Math.floor(h / 24);
    return 'לפני ' + d + (d === 1 ? ' יום' : ' ימים');
  }
  function safeUrl(u) { return /^https?:\/\//i.test(u || '') ? u : '#'; }

  var STATE_TXT = {
    REGULAR: ['שוק פתוח', 'open'], PRE: ['פרה-מרקט', 'ext'], PREPRE: ['השוק סגור', 'closed'],
    POST: ['אפטר-מרקט', 'ext'], POSTPOST: ['אפטר-מרקט', 'ext'], CLOSED: ['השוק סגור', 'closed']
  };
  var RATING_TXT = { strong_sell: 'מכירה חזקה', sell: 'מכירה', neutral: 'ניטרלי', buy: 'קנייה', strong_buy: 'קנייה חזקה' };
  var RATING_COL = { strong_sell: '#ef5350', sell: '#ff8a80', neutral: '#8b9ab5', buy: '#69f0ae', strong_buy: '#26a69a' };
  var AN_TXT = { strong_buy: 'קנייה חזקה', buy: 'קנייה', hold: 'החזקה', sell: 'מכירה', strong_sell: 'מכירה חזקה', underperform: 'ביצועי חסר' };
  var AN_COL = { strong_buy: '#26a69a', buy: '#69f0ae', hold: '#8b9ab5', sell: '#ff8a80', strong_sell: '#ef5350', underperform: '#ff8a80' };

  // ---------- small building blocks ----------
  function sec(title, body, open) {
    if (!body) return '';
    return '<details class="sp-sec"' + (open === false ? '' : ' open') + '><summary>' + title + '</summary><div class="sp-sec-b">' + body + '</div></details>';
  }
  function row(label, val, extra) {
    return '<div class="sp-kv"><span>' + label + '</span><b dir="ltr"' + (extra ? ' class="' + extra + '"' : '') + '>' + val + '</b></div>';
  }

  // ---------- sections ----------
  function headHtml(d, sym) {
    var short = String(sym).replace('.TA', '');
    var st = STATE_TXT[d.marketState] || null;
    var sub = [d.sector, d.industry].filter(Boolean).join(' · ');
    var ext = (d.extPrice != null)
      ? '<div class="sp-ext">' + (d.marketState === 'PRE' ? 'פרה-מרקט' : 'אפטר-מרקט') + ': <b dir="ltr">' + esc(d.currency) + fnum(d.extPrice) + '</b> <span class="' + cls(d.extChangePct) + '" dir="ltr">' + fpct(d.extChangePct) + '</span></div>' : '';
    return '<div class="sp-head">' +
        '<div class="sp-logo">' + esc(short.slice(0, 2).toUpperCase()) + '</div>' +
        '<div class="sp-id"><div class="sp-sym" dir="ltr">' + esc(short) + '</div><div class="sp-name" dir="auto">' + esc(d.name) + '</div></div>' +
        '<button class="sp-refresh" title="רענן" onclick="NTStockPanel.refresh()">⟳</button>' +
      '</div>' +
      '<div class="sp-sub" dir="auto">' + esc(d.exchange || '') + (sub ? ' · ' + esc(sub) : '') + '</div>' +
      '<div class="sp-price-row"><b class="sp-price" id="spPrice" dir="ltr">' + fnum(d.price) + '</b><span class="sp-cur">' + esc(d.currencyCode === 'ILA' ? 'אגורות' : (d.currencyCode || '')) + '</span></div>' +
      '<div class="sp-chg ' + cls(d.change) + '" id="spChg" dir="ltr">' + (isNum(d.change) ? (d.change >= 0 ? '+' : '') + fnum(d.change) : '—') + ' &nbsp;' + fpct(d.changePct) + '</div>' +
      (st ? '<div class="sp-state"><i class="sp-dot ' + st[1] + '"></i>' + st[0] + '</div>' : '') + ext;
  }

  function volHtml(d) {
    if (!isNum(d.volume) || !isNum(d.avgVolume30) || d.avgVolume30 <= 0) return '';
    var tot = d.volume + d.avgVolume30, a = Math.max(4, Math.min(96, d.volume / tot * 100));
    var ratio = d.volume / d.avgVolume30 * 100;
    return '<div class="sp-vol">' +
      '<div class="sp-vol-l"><span>נפח מסחר</span><b dir="ltr">' + fbig(d.volume) + '</b></div>' +
      '<div class="sp-vol-r"><span>ממוצע (30 ימים)</span><b dir="ltr">' + fbig(d.avgVolume30) + '</b></div>' +
      '<div class="sp-vbar" dir="ltr"><i style="width:' + a.toFixed(1) + '%"></i><u></u></div>' +
      '<div class="sp-vol-n ' + (ratio >= 100 ? 'up' : '') + '">' + Math.round(ratio) + '% מהממוצע' + (ratio >= 100 ? ' · מחזור גבוה' : '') + '</div>' +
    '</div>';
  }

  function newsHtml(d) {
    if (!d.news || !d.news.length) return '';
    return d.news.slice(0, 4).map(function (n) {
      return '<a class="sp-news" href="' + esc(safeUrl(n.link)) + '" target="_blank" rel="noopener noreferrer">' +
        '<div class="sp-news-t" dir="auto">' + esc(n.title) + '</div>' +
        '<div class="sp-news-m">' + esc(n.publisher || '') + (n.ts ? ' · ' + ago(n.ts) : '') + '</div></a>';
    }).join('');
  }

  function rangeBar(lo, hi, px, cur) {
    if (!isNum(lo) || !isNum(hi) || !isNum(px) || hi <= lo) return '';
    var p = Math.max(0, Math.min(100, (px - lo) / (hi - lo) * 100));
    return '<div class="sp-rng"><div class="sp-rng-l" dir="ltr"><span>' + esc(cur) + fnum(lo) + '</span><span>טווח 52 שבועות</span><span>' + esc(cur) + fnum(hi) + '</span></div>' +
      '<div class="sp-rng-bar" dir="ltr"><i style="left:' + p.toFixed(1) + '%"></i></div></div>';
  }

  function statsHtml(d) {
    var s = d.stats || {}, c = d.currency || '';
    var rows = '';
    if (d.nextEarnings) {
      var dt = daysTo(d.nextEarnings);
      if (dt != null && dt >= 0) rows += row('דוחות הבאים', (dt === 0 ? 'היום' : (dt === 1 ? 'מחר' : 'בעוד ' + dt + ' ימים')) + ' · ' + heDate(d.nextEarnings), dt <= 7 ? 'warn' : '');
    }
    if (isNum(s.marketCap)) rows += row('שווי שוק', fbig(s.marketCap, c));
    if (isNum(s.pe)) rows += row('מכפיל רווח (P/E)', fnum(s.pe, 1));
    if (isNum(s.forwardPE)) rows += row('P/E עתידי', fnum(s.forwardPE, 1));
    if (isNum(s.eps)) rows += row('רווח למניה (EPS)', c + fnum(s.eps), s.eps < 0 ? 'down' : '');
    if (isNum(s.dividendYield) && s.dividendYield > 0) rows += row('תשואת דיבידנד', fnum(s.dividendYield, 2) + '%' + (isNum(s.dividendRate) ? ' · ' + c + fnum(s.dividendRate) + '/שנה' : ''));
    else rows += row('דיבידנד', 'אין');
    if (isNum(s.payoutRatio) && s.payoutRatio > 0) rows += row('יחס חלוקה', fnum(s.payoutRatio, 0) + '%');
    if (s.exDividend) rows += row('ללא דיבידנד (Ex)', heDate(s.exDividend));
    if (isNum(s.beta)) rows += row('בטא', fnum(s.beta, 2));
    if (isNum(s.priceToBook)) rows += row('מכפיל הון (P/B)', fnum(s.priceToBook, 2));
    if (isNum(s.revenue)) rows += row('הכנסות (12 חודשים)', fbig(s.revenue, c));
    if (isNum(s.netIncome)) rows += row('רווח נקי', fbig(s.netIncome, c), s.netIncome < 0 ? 'down' : '');
    if (isNum(s.profitMargin)) rows += row('שולי רווח', fnum(s.profitMargin, 1) + '%', s.profitMargin < 0 ? 'down' : '');
    if (isNum(s.roe)) rows += row('תשואה להון (ROE)', fnum(s.roe, 1) + '%', s.roe < 0 ? 'down' : '');
    if (isNum(s.debtToEquity)) rows += row('חוב להון', fnum(s.debtToEquity, 1) + '%');
    if (isNum(s.sharesOut)) rows += row('מניות במחזור', fbig(s.sharesOut));
    if (isNum(s.shortPercent)) rows += row('Short % מהצף', fnum(s.shortPercent, 1) + '%');
    return rangeBar(s.lo52, s.hi52, d.price, c) + (rows ? '<div class="sp-kvs">' + rows + '</div>' : '');
  }

  // EPS quarterly: bar = actual, circle = analysts' estimate
  function epsChart(d) {
    var q = (d.epsQuarterly || []).filter(function (x) { return isNum(x.actual) || isNum(x.estimate); });
    if (!q.length) return '';
    var W = 260, H = 120, padT = 16, padB = 22, n = q.length, i;
    var vals = [0];
    q.forEach(function (x) { if (isNum(x.actual)) vals.push(x.actual); if (isNum(x.estimate)) vals.push(x.estimate); });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi === lo) { hi += 1; lo -= 1; }
    var ih = H - padT - padB, slot = W / n;
    function Y(v) { return padT + (hi - v) / (hi - lo) * ih; }
    var s = '<line x1="0" x2="' + W + '" y1="' + Y(0).toFixed(1) + '" y2="' + Y(0).toFixed(1) + '" stroke="#2a3348" stroke-width="1"/>';
    for (i = 0; i < n; i++) {
      var x = q[i], cx = slot * i + slot / 2, bw = Math.min(26, slot * 0.5);
      if (isNum(x.actual)) {
        var beat = isNum(x.estimate) ? x.actual >= x.estimate : x.actual >= 0;
        var y0 = Y(0), y1 = Y(x.actual);
        s += '<rect x="' + (cx - bw / 2).toFixed(1) + '" y="' + Math.min(y0, y1).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(1.5, Math.abs(y1 - y0)).toFixed(1) +
          '" rx="2" fill="' + (beat ? '#26a69a' : '#ef5350') + '"/>' +
          '<text x="' + cx.toFixed(1) + '" y="' + (Math.min(y0, y1) - 3).toFixed(1) + '" class="sp-ct" text-anchor="middle">' + fnum(x.actual) + '</text>';
      }
      if (isNum(x.estimate)) s += '<circle cx="' + cx.toFixed(1) + '" cy="' + Y(x.estimate).toFixed(1) + '" r="4.2" fill="none" stroke="#f5a623" stroke-width="2"/>';
      var m = /^(\d)Q(\d{4})$/.exec(String(x.q || ''));
      s += '<text x="' + cx.toFixed(1) + '" y="' + (H - 6) + '" class="sp-cx" text-anchor="middle">' + (m ? ('Q' + m[1] + " '" + m[2].slice(2)) : esc(x.q || '')) + '</text>';
    }
    var last = q[q.length - 1], msg = '';
    if (isNum(last.actual) && isNum(last.estimate) && last.estimate !== 0) {
      var sp = (last.actual - last.estimate) / Math.abs(last.estimate) * 100;
      msg = '<div class="sp-note ' + cls(sp) + '">רבעון אחרון: ' + (sp >= 0 ? 'עקף' : 'החמיץ') + ' תחזית ב-' + Math.abs(sp).toFixed(1) + '%</div>';
    }
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="sp-svg" dir="ltr" role="img" aria-label="רווח למניה לפי רבעון">' + s + '</svg>' +
      '<div class="sp-legend"><span><i style="background:#26a69a"></i>בפועל</span><span><i class="ring"></i>צפי אנליסטים</span></div>' + msg;
  }

  // Yearly revenue + net income
  function finChart(d) {
    var y = (d.financialsYearly || []).filter(function (x) { return isNum(x.revenue) || isNum(x.earnings); });
    if (!y.length) return '';
    var W = 260, H = 120, padT = 16, padB = 22, n = y.length, i, c = d.currency || '';
    var vals = [0];
    y.forEach(function (x) { if (isNum(x.revenue)) vals.push(x.revenue); if (isNum(x.earnings)) vals.push(x.earnings); });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi === lo) hi += 1;
    var ih = H - padT - padB, slot = W / n;
    function Y(v) { return padT + (hi - v) / (hi - lo) * ih; }
    var s = '<line x1="0" x2="' + W + '" y1="' + Y(0).toFixed(1) + '" y2="' + Y(0).toFixed(1) + '" stroke="#2a3348"/>';
    for (i = 0; i < n; i++) {
      var x = y[i], cx = slot * i + slot / 2, bw = Math.min(18, slot * 0.36);
      [['revenue', '#4f7cff', -1], ['earnings', null, 1]].forEach(function (k) {
        var v = x[k[0]]; if (!isNum(v)) return;
        var col = k[1] || (v >= 0 ? '#26a69a' : '#ef5350');
        var y0 = Y(0), y1 = Y(v), bx = cx + (k[2] < 0 ? -bw - 1 : 1);
        s += '<rect x="' + bx.toFixed(1) + '" y="' + Math.min(y0, y1).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(1.5, Math.abs(y1 - y0)).toFixed(1) + '" rx="2" fill="' + col + '"/>' +
          '<text x="' + (bx + bw / 2).toFixed(1) + '" y="' + (Math.min(y0, y1) - 3).toFixed(1) + '" class="sp-ct" text-anchor="middle">' + fbig(v).replace(/^-/, '−') + '</text>';
      });
      s += '<text x="' + cx.toFixed(1) + '" y="' + (H - 6) + '" class="sp-cx" text-anchor="middle">' + esc(x.y) + '</text>';
    }
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="sp-svg" dir="ltr" role="img" aria-label="הכנסות ורווח שנתי">' + s + '</svg>' +
      '<div class="sp-legend"><span><i style="background:#4f7cff"></i>הכנסות (' + esc(c) + ')</span><span><i style="background:#26a69a"></i>רווח נקי</span></div>';
  }

  function divChart(d) {
    var a = (d.dividends || []).slice(-8);
    if (!a.length) return '';
    var W = 260, H = 110, padT = 16, padB = 22, n = a.length, c = d.currency || '';
    var hi = Math.max.apply(null, a.map(function (x) { return x.amount; })) || 1;
    var ih = H - padT - padB, slot = W / n, s = '';
    a.forEach(function (x, i) {
      var cx = slot * i + slot / 2, bw = Math.min(22, slot * 0.55), h = Math.max(2, x.amount / hi * ih), y = padT + ih - h;
      s += '<rect x="' + (cx - bw / 2).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2" fill="#f5a623"/>' +
        '<text x="' + cx.toFixed(1) + '" y="' + (y - 3).toFixed(1) + '" class="sp-ct" text-anchor="middle">' + fnum(x.amount, x.amount < 1 ? 3 : 2) + '</text>' +
        '<text x="' + cx.toFixed(1) + '" y="' + (H - 6) + '" class="sp-cx" text-anchor="middle">' + x.date.slice(5, 7) + '/' + x.date.slice(2, 4) + '</text>';
    });
    var total = 0, yr = new Date().getFullYear();
    (d.dividends || []).forEach(function (x) { if (parseInt(x.date.slice(0, 4), 10) >= yr - 1 && Date.parse(x.date) > Date.now() - 365 * 86400000) total += x.amount; });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="sp-svg" dir="ltr" role="img" aria-label="דיבידנדים">' + s + '</svg>' +
      '<div class="sp-note">סה״כ 12 חודשים אחרונים: <b dir="ltr">' + esc(c) + fnum(total, 3) + '</b> למניה</div>';
  }

  function perfHtml(d) {
    var p = d.perf; if (!p) return '';
    var items = [['שבוע', p.w1], ['חודש', p.m1], ['3 חודשים', p.m3], ['6 חודשים', p.m6], ['מתחילת שנה', p.ytd], ['שנה', p.y1]];
    return '<div class="sp-perf">' + items.map(function (it) {
      var v = it[1], ok = isNum(v);
      var bg = ok ? ('rgba(' + (v >= 0 ? '38,166,154' : '239,83,80') + ',' + Math.min(0.32, 0.08 + Math.abs(v) / 100) + ')') : 'transparent';
      return '<div class="sp-pf" style="background:' + bg + '"><span>' + it[0] + '</span><b class="' + cls(v) + '" dir="ltr">' + (ok ? fpct(v, 1) : '—') + '</b></div>';
    }).join('') + '</div>';
  }

  // Gauge (TradingView style): 5 equal zones; needle position by piecewise mapping of the score.
  function gaugeSvg(score, key) {
    var cx = 100, cy = 96, r = 72, cols = ['#ef5350', '#ff8a80', '#8b9ab5', '#69f0ae', '#26a69a'];
    function pt(a, rad) { var t = a * Math.PI / 180; return [cx + rad * Math.cos(t), cy + rad * Math.sin(t)]; }
    var s = '';
    for (var i = 0; i < 5; i++) {
      var a0 = 180 + i * 36 + 1.5, a1 = 180 + (i + 1) * 36 - 1.5, p0 = pt(a0, r), p1 = pt(a1, r);
      s += '<path d="M' + p0[0].toFixed(1) + ' ' + p0[1].toFixed(1) + ' A' + r + ' ' + r + ' 0 0 1 ' + p1[0].toFixed(1) + ' ' + p1[1].toFixed(1) +
        '" fill="none" stroke="' + cols[i] + '" stroke-width="14" opacity="' + (RATING_COL[key] === cols[i] ? 1 : 0.4) + '"/>';
    }
    var bp = [-1, -0.5, -0.1, 0.1, 0.5, 1], pos = [0, 0.2, 0.4, 0.6, 0.8, 1], t = 0.5;
    score = Math.max(-1, Math.min(1, score));
    for (var k = 0; k < 5; k++) { if (score >= bp[k] && score <= bp[k + 1]) { t = pos[k] + (score - bp[k]) / (bp[k + 1] - bp[k]) * 0.2; break; } }
    var ang = 180 + t * 180, tip = pt(ang, r - 22);
    s += '<line x1="' + cx + '" y1="' + cy + '" x2="' + tip[0].toFixed(1) + '" y2="' + tip[1].toFixed(1) + '" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="' + cx + '" cy="' + cy + '" r="5" fill="#fff"/>';
    s += '<text x="12" y="' + (cy + 14) + '" class="sp-gl" text-anchor="start">מכירה</text><text x="188" y="' + (cy + 14) + '" class="sp-gl" text-anchor="end">קנייה</text>';
    return '<svg viewBox="0 0 200 116" class="sp-gauge" dir="ltr">' + s + '</svg>';
  }
  function cntLine(label, c) {
    if (!c) return '';
    return '<div class="sp-cnt"><span>' + label + '</span><b class="down" dir="ltr">' + c.sell + ' מכירה</b><b dir="ltr">' + c.neutral + ' ניטרלי</b><b class="up" dir="ltr">' + c.buy + ' קנייה</b></div>';
  }
  function techHtml(d) {
    var t = d.technical; if (!t) return '';
    return '<div class="sp-tech">' + gaugeSvg(t.overall.score, t.overall.key) +
      '<div class="sp-tech-l" style="color:' + RATING_COL[t.overall.key] + '">' + RATING_TXT[t.overall.key] + '</div>' +
      '<div class="sp-tech-s">לפי גרף יומי · ממוצעים נעים ואוסצילטורים</div></div>' +
      cntLine('ממוצעים נעים', t.counts.ma) + cntLine('אוסצילטורים', t.counts.osc);
  }

  function analystHtml(d) {
    var a = d.analysts; if (!a || (!a.key && !a.trend && !isNum(a.targetMean))) return '';
    var c = d.currency || '', out = '';
    if (a.key) out += '<div class="sp-an-l" style="color:' + (AN_COL[a.key] || '#8b9ab5') + '">' + esc(AN_TXT[a.key] || a.key) + (isNum(a.count) ? ' <small>(' + a.count + ' אנליסטים)</small>' : '') + '</div>';
    if (a.trend) {
      var tr = a.trend, tot = tr.strongBuy + tr.buy + tr.hold + tr.sell + tr.strongSell;
      if (tot > 0) {
        var segs = [['strongBuy', '#26a69a'], ['buy', '#69f0ae'], ['hold', '#8b9ab5'], ['sell', '#ff8a80'], ['strongSell', '#ef5350']];
        out += '<div class="sp-an-bar" dir="ltr">' + segs.map(function (s) { return tr[s[0]] ? '<i style="flex:' + tr[s[0]] + ';background:' + s[1] + '" title="' + tr[s[0]] + '"></i>' : ''; }).join('') + '</div>' +
          '<div class="sp-an-n" dir="ltr"><span style="color:#26a69a">' + tr.strongBuy + ' ק״ח</span><span style="color:#69f0ae">' + tr.buy + ' קנייה</span><span>' + tr.hold + ' החזקה</span><span style="color:#ff8a80">' + tr.sell + ' מכירה</span><span style="color:#ef5350">' + tr.strongSell + ' מ״ח</span></div>';
      }
    }
    if (isNum(a.targetMean)) {
      var up = isNum(d.price) && d.price ? (a.targetMean / d.price - 1) * 100 : null;
      out += '<div class="sp-kvs">' + row('מחיר יעד ממוצע', esc(c) + fnum(a.targetMean) + (up != null ? ' (' + fpct(up, 1) + ')' : ''), cls(up)) +
        (isNum(a.targetLow) && isNum(a.targetHigh) ? row('טווח יעדים', esc(c) + fnum(a.targetLow) + ' – ' + esc(c) + fnum(a.targetHigh)) : '') + '</div>';
    }
    return out;
  }

  function aboutHtml(d) {
    if (!d.summary && !d.website) return '';
    var host = '';
    try { host = d.website ? new URL(d.website).hostname.replace(/^www\./, '') : ''; } catch (e) {}
    return (d.summary ? '<div class="sp-about" dir="ltr">' + esc(d.summary) + (d.summary.length >= 420 ? '…' : '') + '</div>' : '') +
      '<div class="sp-kvs">' + (isNum(d.employees) ? row('עובדים', fnum(d.employees, 0)) : '') +
      (host ? '<div class="sp-kv"><span>אתר</span><b dir="ltr"><a href="' + esc(safeUrl(d.website)) + '" target="_blank" rel="noopener noreferrer">' + esc(host) + '</a></b></div>' : '') + '</div>';
  }

  // ---------- render ----------
  function render(d, sym) {
    var box = $('stockPanel'); if (!box) return;
    var keep = box.scrollTop;
    box.innerHTML =
      '<div class="sp-top">' + headHtml(d, sym) + volHtml(d) + '</div>' +
      sec('📰 חדשות', newsHtml(d)) +
      sec('📊 נתונים עיקריים', statsHtml(d)) +
      sec('📈 ביצועים', perfHtml(d)) +
      sec('🎯 דירוג טכני', techHtml(d)) +
      sec('🧠 דירוג אנליסטים', analystHtml(d)) +
      sec('💰 רווח למניה (EPS) לפי רבעון', epsChart(d)) +
      sec('🏢 הכנסות ורווח שנתי', finChart(d), false) +
      sec('💵 דיבידנדים ששולמו', divChart(d)) +
      sec('ℹ️ אודות החברה', aboutHtml(d), false) +
      '<div class="sp-foot">נתונים מ-Yahoo Finance, עשויים להתעכב. אינו ייעוץ השקעות.</div>';
    box.scrollTop = keep;
    tick();
  }
  function renderMsg(sym, html) {
    var box = $('stockPanel'); if (!box) return;
    box.innerHTML = '<div class="sp-msg"><div class="sp-sym" dir="ltr">' + esc(String(sym).replace('.TA', '')) + '</div>' + html + '</div>';
  }

  // Keep the header price in sync with the app's live price feed.
  function tick() {
    if (!cur) return;
    var pc; try { pc = window.priceCache && window.priceCache[cur]; } catch (e) { pc = null; }
    var d = cache[cur] && cache[cur].data;
    if (!pc || !isNum(pc.price) || !d) return;
    var p = $('spPrice'), c = $('spChg');
    if (p) p.textContent = fnum(pc.price);
    if (c && isNum(pc.change) && isNum(pc.changePct)) {
      c.className = 'sp-chg ' + cls(pc.change);
      c.innerHTML = (pc.change >= 0 ? '+' : '') + fnum(pc.change) + ' &nbsp;' + fpct(pc.changePct);
    }
  }

  function load(sym, force) {
    var my = ++reqId;
    var c = cache[sym];
    if (c && !force && Date.now() - c.ts < TTL) { render(c.data, sym); return; }
    if (c) render(c.data, sym); else renderMsg(sym, '<div class="sp-load"><span class="sp-spin"></span> טוען נתוני מניה…</div>');
    fetch(apiBase() + '/api/stock/details?symbol=' + encodeURIComponent(sym), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('http'); return r.json(); })
      .then(function (d) {
        cache[sym] = { ts: Date.now(), data: d };
        if (my !== reqId || cur !== sym) return;
        render(d, sym);
      })
      .catch(function () {
        if (my !== reqId || cur !== sym) return;
        if (!cache[sym]) renderMsg(sym, '<div class="sp-err">לא ניתן לטעון נתונים כרגע.<br><button class="sp-retry" onclick="NTStockPanel.refresh()">נסה שוב</button></div>');
      });
  }

  function show(sym) {
    sym = String(sym || '').trim().toUpperCase();
    if (!sym) return;
    if (!$('stockPanel')) return;
    if (sym === cur && cache[sym] && Date.now() - cache[sym].ts < TTL) return;
    var changed = sym !== cur;
    cur = sym;
    if (changed) { var b = $('stockPanel'); if (b) b.scrollTop = 0; }
    load(sym, false);
  }
  function refresh() { if (cur) load(cur, true); }

  // ---------- draggable splitter (list ⇄ panel) ----------
  function initSplit() {
    var split = $('spSplit'), top = $('wlTop'), view = $('sview-watchlist');
    if (!split || !top || !view) return;
    var saved = parseInt(localStorage.getItem('nt_sp_h') || '', 10);
    if (saved > 0) top.style.height = saved + 'px';
    var drag = false, startY = 0, startH = 0;
    function move(e) {
      if (!drag) return;
      var y = (e.touches ? e.touches[0].clientY : e.clientY);
      var h = Math.max(90, Math.min(view.clientHeight - 160, startH + (y - startY)));
      top.style.height = h + 'px';
      e.preventDefault();
    }
    function up() {
      if (!drag) return; drag = false;
      document.body.classList.remove('sp-dragging');
      try { localStorage.setItem('nt_sp_h', String(parseInt(top.style.height, 10) || '')); } catch (e) {}
    }
    function down(e) {
      drag = true; startY = (e.touches ? e.touches[0].clientY : e.clientY); startH = top.offsetHeight;
      document.body.classList.add('sp-dragging'); e.preventDefault();
    }
    split.addEventListener('mousedown', down);
    split.addEventListener('touchstart', down, { passive: false });
    document.addEventListener('mousemove', move);
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('mouseup', up);
    document.addEventListener('touchend', up);
  }

  function init() {
    initSplit();
    setInterval(tick, 15000);
    // first paint for the symbol that is already selected when the page loads
    try { if (window.currentSymbol) show(window.currentSymbol); } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.NTStockPanel = { show: show, refresh: refresh, tick: tick };
})();
