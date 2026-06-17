// ============================================================
//   NexTrade — ADVANCED FEATURES  (פיצרים מתקדמים)
//   #9 ATR stop-loss | #4 why moving | #5 pattern match
//   #10 optimal entry hour | #6 portfolio risk | #2 calendar
//   #1 reports (demo) | #3 sentiment | #7 crowd (demo) | #8 ideas (demo)
// ============================================================
(function () {
  'use strict';

  // ---------- math helpers ----------
  function sma(arr, p, i) { var s = 0; for (var j = i - p + 1; j <= i; j++) s += arr[j]; return s / p; }
  function mean(a) { if (!a.length) return 0; var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s / a.length; }
  function stdev(a) { if (a.length < 2) return 0; var m = mean(a), s = 0; for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m); return Math.sqrt(s / (a.length - 1)); }
  function corr(a, b) {
    var n = Math.min(a.length, b.length); if (n < 3) return 0;
    var ma = mean(a.slice(-n)), mb = mean(b.slice(-n)); var num = 0, da = 0, db = 0;
    for (var i = 0; i < n; i++) { var x = a[a.length - n + i] - ma, y = b[b.length - n + i] - mb; num += x * y; da += x * x; db += y * y; }
    if (da === 0 || db === 0) return 0;
    return num / Math.sqrt(da * db);
  }
  function atr(bars, period) {
    if (!bars || bars.length < period + 1) return null;
    var trs = [];
    for (var i = 1; i < bars.length; i++) {
      var h = bars[i].high, l = bars[i].low, pc = bars[i - 1].close;
      trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    // Wilder's smoothing
    var a = trs.slice(0, period).reduce(function (s, v) { return s + v; }, 0) / period;
    for (var k = period; k < trs.length; k++) a = (a * (period - 1) + trs[k]) / period;
    return a;
  }
  function returns(closes) { var r = []; for (var i = 1; i < closes.length; i++) r.push((closes[i] - closes[i - 1]) / closes[i - 1]); return r; }

  function curBars() { return (window.lastBars && window.lastBars.length) ? window.lastBars : []; }
  function curSym() { return (window.currentSymbol || '').replace('.TA', ''); }
  function curName() { return (window.NAMES && window.NAMES[window.currentSymbol]) || curSym(); }
  function shekel(s) { return (window.currentSymbol || '').endsWith('.TA') ? '₪' : '$'; }
  function f2(n) { return (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function pct(n) { return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'; }

  // ============================================================
  //   INSIGHTS PANEL  (#4, #9, #5, #10)
  // ============================================================
  function renderInsights() {
    var el = document.getElementById('insightsBody');
    if (!el) return;
    var bars = curBars();
    if (!bars.length) { el.innerHTML = empty('טוען נתוני מניה...'); return; }
    el.innerHTML =
      '<div class="ins-sym">' + curSym() + ' · <span style="color:var(--text-muted);font-weight:400">' + curName() + '</span></div>' +
      whyMovingHTML(bars) +
      atrStopHTML(bars) +
      patternHTML(bars) +
      '<div id="insHour" class="ins-card"><div class="ins-h">🕐 שעת כניסה אופטימלית</div><div class="ins-sub" style="color:var(--text-muted)">מחשב מנתוני תוך-יומי...</div></div>';
    // hour analysis is async
    optimalHourHTML();
  }

  // ---- #4 why is the stock moving today ----
  function whyMovingHTML(bars) {
    var last = bars[bars.length - 1], prev = bars[bars.length - 2];
    if (!last || !prev) return '';
    var closes = bars.map(function (b) { return b.close; });
    var reasons = [];
    var chg = (last.close - prev.close) / prev.close * 100;

    // gap
    var gap = (last.open - prev.close) / prev.close * 100;
    if (Math.abs(gap) > 1.0) reasons.push((gap > 0 ? '⬆️' : '⬇️') + ' פתיחה בפער של ' + pct(gap) + ' מהסגירה הקודמת');

    // volume spike
    var vols = bars.map(function (b) { return b.volume || 0; });
    var avgVol = mean(vols.slice(-21, -1));
    if (avgVol > 0 && last.volume > avgVol * 1.8) reasons.push('🔊 מחזור גבוה פי ' + (last.volume / avgVol).toFixed(1) + ' מהממוצע (עניין חריג)');

    // breakout of 20/55-day high/low
    var hi20 = Math.max.apply(null, bars.slice(-21, -1).map(function (b) { return b.high; }));
    var lo20 = Math.min.apply(null, bars.slice(-21, -1).map(function (b) { return b.low; }));
    if (last.close > hi20) reasons.push('🚀 פריצת שיא 20 ימים (' + shekel() + f2(hi20) + ')');
    else if (last.close < lo20) reasons.push('📉 שבירת שפל 20 ימים (' + shekel() + f2(lo20) + ')');

    // strong body candle
    var body = Math.abs(last.close - last.open) / last.open * 100;
    if (body > 2.5) reasons.push((last.close >= last.open ? '🟢' : '🔴') + ' נר חזק ביום (גוף ' + body.toFixed(1) + '%)');

    // vs MA50/MA200
    if (closes.length > 50) {
      var ma50 = sma(closes, 50, closes.length - 1);
      reasons.push((last.close >= ma50 ? '✅ מעל' : '⚠️ מתחת ל') + ' ממוצע 50 (' + shekel() + f2(ma50) + ')');
    }
    if (closes.length > 200) {
      var ma200 = sma(closes, 200, closes.length - 1);
      reasons.push((last.close >= ma200 ? '✅ מעל' : '⚠️ מתחת ל') + ' ממוצע 200 — מגמה ' + (last.close >= ma200 ? 'עולה' : 'יורדת') + ' ארוכת טווח');
    }

    if (!reasons.length) reasons.push('יום רגיל — אין תנועה חריגה או נפח יוצא דופן');

    var col = chg >= 0 ? 'var(--green)' : 'var(--red)';
    return '<div class="ins-card">' +
      '<div class="ins-h">📌 למה המניה זזה היום</div>' +
      '<div class="ins-big" style="color:' + col + '">' + pct(chg) + '</div>' +
      '<ul class="ins-list">' + reasons.map(function (r) { return '<li>' + r + '</li>'; }).join('') + '</ul>' +
      '</div>';
  }

  // ---- #9 ATR-based stop-loss & sizing ----
  function atrStopHTML(bars) {
    var a = atr(bars, 14);
    var last = bars[bars.length - 1];
    if (!a || !last) return '';
    var price = last.close;
    var sl15 = price - 1.5 * a, sl2 = price - 2 * a, sl3 = price - 3 * a;
    var tp2 = price + 2 * a, tp3 = price + 3 * a;
    var atrPct = a / price * 100;
    // position sizing: risk 1% of a 100k portfolio with 2*ATR stop
    var capital = 100000, riskPct = 1;
    var riskPerShare = 2 * a;
    var shares = riskPerShare > 0 ? Math.floor((capital * riskPct / 100) / riskPerShare) : 0;
    return '<div class="ins-card">' +
      '<div class="ins-h">🛡️ סטופ-לוס חכם (ATR 14)</div>' +
      '<div class="ins-row"><span>תנודתיות יומית (ATR)</span><b>' + shekel() + f2(a) + ' (' + atrPct.toFixed(2) + '%)</b></div>' +
      '<div class="ins-grid">' +
      '<div class="ins-cell sl"><span>סטופ 1.5×</span><b>' + shekel() + f2(sl15) + '</b></div>' +
      '<div class="ins-cell sl"><span>סטופ 2×</span><b>' + shekel() + f2(sl2) + '</b></div>' +
      '<div class="ins-cell sl"><span>סטופ 3×</span><b>' + shekel() + f2(sl3) + '</b></div>' +
      '<div class="ins-cell tp"><span>יעד 2×</span><b>' + shekel() + f2(tp2) + '</b></div>' +
      '<div class="ins-cell tp"><span>יעד 3×</span><b>' + shekel() + f2(tp3) + '</b></div>' +
      '<div class="ins-cell"><span>R:R 2:1</span><b>טוב</b></div>' +
      '</div>' +
      '<div class="ins-sub">בסיכון 1% מתיק 100K₪ עם סטופ 2×ATR → גודל פוזיציה ≈ <b>' + shares.toLocaleString() + '</b> מניות</div>' +
      '</div>';
  }

  // ---- #5 historical pattern matching ----
  function patternHTML(bars) {
    var closes = bars.map(function (b) { return b.close; });
    if (closes.length < 60) return '';
    var L = 10, H = 10; // window length, forward horizon
    var recent = normReturns(closes.slice(-L - 1));
    var matches = [];
    for (var i = L; i < closes.length - H - 1; i++) {
      var win = normReturns(closes.slice(i - L, i + 1));
      var d = euclid(recent, win);
      var fwd = (closes[i + H] - closes[i]) / closes[i] * 100;
      matches.push({ i: i, d: d, fwd: fwd });
    }
    matches.sort(function (x, y) { return x.d - y.d; });
    var top = matches.slice(0, 20);
    if (!top.length) return '';
    var avgFwd = mean(top.map(function (m) { return m.fwd; }));
    var wins = top.filter(function (m) { return m.fwd > 0; }).length;
    var winRate = wins / top.length * 100;
    var col = avgFwd >= 0 ? 'var(--green)' : 'var(--red)';
    return '<div class="ins-card">' +
      '<div class="ins-h">🔮 התאמת תבניות היסטוריות</div>' +
      '<div class="ins-sub">מצאנו ' + top.length + ' מצבים דומים בעבר. אחרי ' + H + ' ימים:</div>' +
      '<div class="ins-row"><span>תשואה ממוצעת</span><b style="color:' + col + '">' + pct(avgFwd) + '</b></div>' +
      '<div class="ins-row"><span>אחוז הצלחה (ירוק)</span><b>' + winRate.toFixed(0) + '%</b></div>' +
      '<div class="ins-bar"><div class="ins-bar-fill" style="width:' + winRate.toFixed(0) + '%;background:' + (winRate >= 50 ? 'var(--green)' : 'var(--red)') + '"></div></div>' +
      '<div class="ins-sub" style="font-size:.66rem;opacity:.7">מבוסס על דמיון צורת תנועה — לא ייעוץ השקעות</div>' +
      '</div>';
  }
  function normReturns(seg) { var r = returns(seg); var s = stdev(r) || 1; return r.map(function (v) { return v / s; }); }
  function euclid(a, b) { var n = Math.min(a.length, b.length), s = 0; for (var i = 0; i < n; i++) { var d = a[i] - b[i]; s += d * d; } return Math.sqrt(s); }

  // ---- #10 optimal entry hour (async, from 1H bars) ----
  async function optimalHourHTML() {
    var box = document.getElementById('insHour');
    if (!box) return;
    try {
      var sym = window.currentSymbol;
      var bars = (typeof window.fetchYahooChartDirect === 'function') ? await window.fetchYahooChartDirect(sym, '1H') : [];
      if (!bars || bars.length < 8) { box.innerHTML = '<div class="ins-h">🕐 שעת כניסה אופטימלית</div><div class="ins-sub">אין מספיק נתוני תוך-יומי לניתוח</div>'; return; }
      var buckets = {}; // hour -> {sum, n, vol}
      bars.forEach(function (b) {
        var d = new Date((typeof b.time === 'number' ? b.time : Date.parse(b.time)) * (typeof b.time === 'number' ? 1000 : 1));
        // convert to Israel hour
        var il = new Date(d.getTime() + (d.getTimezoneOffset() + 180) * 60000);
        var hr = il.getHours();
        if (hr < 9 || hr > 18) return;
        var ret = (b.close - b.open) / b.open * 100;
        if (!buckets[hr]) buckets[hr] = { sum: 0, n: 0, vol: 0 };
        buckets[hr].sum += ret; buckets[hr].n++; buckets[hr].vol += (b.volume || 0);
      });
      var rows = Object.keys(buckets).map(function (h) {
        var b = buckets[h]; return { hr: +h, avg: b.sum / b.n, n: b.n, vol: b.vol / b.n };
      }).filter(function (r) { return r.n >= 2; });
      if (!rows.length) { box.innerHTML = '<div class="ins-h">🕐 שעת כניסה אופטימלית</div><div class="ins-sub">אין מספיק דגימות</div>'; return; }
      rows.sort(function (a, b) { return b.avg - a.avg; });
      var best = rows[0], worst = rows[rows.length - 1];
      var maxAbs = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.avg); })) || 1;
      var barsHtml = rows.slice().sort(function (a, b) { return a.hr - b.hr; }).map(function (r) {
        var w = Math.abs(r.avg) / maxAbs * 100;
        var col = r.avg >= 0 ? 'var(--green)' : 'var(--red)';
        return '<div class="hr-row"><span class="hr-lbl">' + String(r.hr).padStart(2, '0') + ':00</span>' +
          '<div class="hr-track"><div class="hr-fill" style="width:' + w.toFixed(0) + '%;background:' + col + '"></div></div>' +
          '<span class="hr-val" style="color:' + col + '">' + pct(r.avg) + '</span></div>';
      }).join('');
      box.innerHTML = '<div class="ins-h">🕐 שעת כניסה אופטימלית</div>' +
        '<div class="ins-sub">השעה הטובה היסטורית: <b style="color:var(--green)">' + String(best.hr).padStart(2, '0') + ':00</b> · החלשה: <b style="color:var(--red)">' + String(worst.hr).padStart(2, '0') + ':00</b></div>' +
        '<div class="hr-chart">' + barsHtml + '</div>' +
        '<div class="ins-sub" style="font-size:.66rem;opacity:.7">מבוסס על נרות שעתיים אחרונים (מדגם מוגבל)</div>';
    } catch (e) {
      box.innerHTML = '<div class="ins-h">🕐 שעת כניסה אופטימלית</div><div class="ins-sub">שגיאה בטעינת נתונים</div>';
    }
  }

  // ============================================================
  //   #6 PORTFOLIO RISK
  // ============================================================
  async function renderRisk() {
    var el = document.getElementById('riskBody');
    if (!el) return;
    var holdings = (window.portHoldings && window.portHoldings.length) ? window.portHoldings : [];
    if (!holdings.length) { el.innerHTML = empty('התיק ריק — הוסף מניות בעמוד התיק כדי לראות ניתוח סיכון'); return; }
    el.innerHTML = empty('מחשב סיכון תיק...');

    // fetch daily bars for each holding
    var data = await Promise.all(holdings.map(async function (h) {
      var bars = [];
      try { bars = await window.fetchYahooChartDirect(h.sym, '1D'); } catch (e) {}
      var price = (window.priceCache[h.sym] && window.priceCache[h.sym].price) || (bars.length ? bars[bars.length - 1].close : h.buyPrice) || 0;
      return { sym: h.sym, shares: h.shares, price: price, bars: bars || [] };
    }));

    var totalValue = data.reduce(function (s, d) { return s + d.price * d.shares; }, 0);
    if (totalValue <= 0) { el.innerHTML = empty('אין מחירים זמינים לחישוב'); return; }

    // weights + per-stock vol
    data.forEach(function (d) {
      d.value = d.price * d.shares;
      d.weight = d.value / totalValue;
      var closes = d.bars.map(function (b) { return b.close; });
      d.rets = returns(closes.slice(-90));
      d.vol = stdev(d.rets) * Math.sqrt(252) * 100; // annualized %
    });

    // portfolio variance via covariance
    var pVar = 0;
    for (var i = 0; i < data.length; i++) {
      for (var j = 0; j < data.length; j++) {
        var c = (i === j) ? 1 : corr(data[i].rets, data[j].rets);
        var vi = stdev(data[i].rets), vj = stdev(data[j].rets);
        pVar += data[i].weight * data[j].weight * c * vi * vj;
      }
    }
    var pVol = Math.sqrt(Math.max(0, pVar)) * Math.sqrt(252) * 100; // annualized %
    var dailyVol = Math.sqrt(Math.max(0, pVar)) * 100;
    var var95 = 1.65 * dailyVol; // 1-day 95% VaR %
    var var95Amt = var95 / 100 * totalValue;

    // concentration
    var hhi = data.reduce(function (s, d) { return s + d.weight * d.weight; }, 0);
    var maxW = Math.max.apply(null, data.map(function (d) { return d.weight; }));
    var maxStock = data.find(function (d) { return d.weight === maxW; });
    var nEff = hhi > 0 ? (1 / hhi) : 0;

    // diversification: avg pairwise correlation
    var corrs = [];
    for (var a = 0; a < data.length; a++) for (var b = a + 1; b < data.length; b++) corrs.push(corr(data[a].rets, data[b].rets));
    var avgCorr = corrs.length ? mean(corrs) : 0;

    // risk score 0-100 (higher = riskier)
    var score = Math.min(100, Math.round(pVol * 1.4 + maxW * 60 + Math.max(0, avgCorr) * 25));
    var scoreCol = score < 35 ? 'var(--green)' : score < 65 ? 'var(--gold)' : 'var(--red)';
    var scoreLbl = score < 35 ? 'נמוך' : score < 65 ? 'בינוני' : 'גבוה';

    var rows = data.slice().sort(function (a, b) { return b.weight - a.weight; }).map(function (d) {
      var sym = d.sym.replace('.TA', '');
      return '<div class="rk-row">' +
        '<span class="rk-sym">' + sym + '</span>' +
        '<div class="rk-track"><div class="rk-fill" style="width:' + (d.weight * 100).toFixed(0) + '%"></div></div>' +
        '<span class="rk-w">' + (d.weight * 100).toFixed(1) + '%</span>' +
        '<span class="rk-vol" title="תנודתיות שנתית">σ ' + (isFinite(d.vol) ? d.vol.toFixed(0) : '–') + '%</span>' +
        '</div>';
    }).join('');

    el.innerHTML =
      '<div class="rk-score-wrap"><div class="rk-gauge" style="--c:' + scoreCol + ';--v:' + score + '">' +
      '<span class="rk-score" style="color:' + scoreCol + '">' + score + '</span><span class="rk-score-lbl">סיכון ' + scoreLbl + '</span></div></div>' +
      '<div class="rk-stats">' +
      stat('שווי תיק', shekelSym(data[0].sym) + f2(totalValue)) +
      stat('תנודתיות שנתית', pVol.toFixed(1) + '%') +
      stat('VaR יומי (95%)', '-' + var95.toFixed(2) + '% (' + shekelSym(data[0].sym) + f2(var95Amt) + ')') +
      stat('ריכוזיות (מניות אפקטיביות)', nEff.toFixed(1)) +
      stat('חשיפה מקסימלית', maxStock.sym.replace('.TA', '') + ' ' + (maxW * 100).toFixed(0) + '%') +
      stat('קורלציה ממוצעת', avgCorr.toFixed(2) + (avgCorr > 0.6 ? ' ⚠️' : '')) +
      '</div>' +
      '<div class="rk-h">פיזור החזקות</div>' + rows +
      (maxW > 0.4 ? '<div class="rk-warn">⚠️ חשיפה גבוהה למניה בודדת (' + (maxW * 100).toFixed(0) + '%). שקול פיזור.</div>' : '') +
      (avgCorr > 0.6 ? '<div class="rk-warn">⚠️ ההחזקות נעות יחד (קורלציה גבוהה) — פיזור אמיתי נמוך.</div>' : '');
  }
  function shekelSym(s) { return (s || '').endsWith('.TA') ? '₪' : '$'; }
  function stat(label, val) { return '<div class="rk-stat"><span>' + label + '</span><b>' + val + '</b></div>'; }

  // ============================================================
  //   #2 REGULATORY / EVENTS CALENDAR  (+ chart markers)
  // ============================================================
  function buildEvents() {
    var sym = curSym();
    var now = new Date();
    var ev = [];
    // estimated quarterly report dates (TASE convention) for this + last year
    var reportMonths = [
      { m: 2, d: 28, t: 'דוח שנתי', icon: '📑' },   // annual ~ end March (reported by ~end Mar)
      { m: 4, d: 30, t: 'דוח רבעון Q1', icon: '📊' },
      { m: 7, d: 31, t: 'דוח חצי שנתי', icon: '📊' },
      { m: 10, d: 30, t: 'דוח רבעון Q3', icon: '📊' },
    ];
    for (var yOff = -1; yOff <= 1; yOff++) {
      var yr = now.getFullYear() + yOff;
      reportMonths.forEach(function (r) {
        ev.push({ date: new Date(yr, r.m, r.d), type: 'report', title: r.t + ' — ' + sym, icon: r.icon, est: true });
      });
      // market-wide: TA-35 index review (Jan & Jul), monthly derivatives expiry (~last Thu)
      ev.push({ date: new Date(yr, 1, 1), type: 'index', title: 'עדכון מדד ת״א-35', icon: '🏛️', est: false });
      ev.push({ date: new Date(yr, 7, 1), type: 'index', title: 'עדכון מדד ת״א-35', icon: '🏛️', est: false });
    }
    // monthly options expiry — last Thursday of next 6 months
    for (var k = 0; k < 6; k++) {
      var dd = lastThursday(now.getFullYear(), now.getMonth() + k);
      ev.push({ date: dd, type: 'expiry', title: 'פקיעת אופציות/מדדים חודשית', icon: '⏳', est: false });
    }
    ev.sort(function (a, b) { return a.date - b.date; });
    return ev;
  }
  function lastThursday(y, m) {
    var d = new Date(y, m + 1, 0); // last day of month
    while (d.getDay() !== 4) d.setDate(d.getDate() - 1);
    return d;
  }
  function renderCalendar() {
    var el = document.getElementById('calBody');
    if (!el) return;
    var ev = buildEvents();
    var now = new Date();
    var upcoming = ev.filter(function (e) { return e.date >= new Date(now.getFullYear(), now.getMonth(), now.getDate()); }).slice(0, 14);
    el.innerHTML =
      '<div class="cal-sym">' + curSym() + ' · אירועים קרובים</div>' +
      upcoming.map(function (e) {
        var days = Math.round((e.date - now) / 86400000);
        var when = days <= 0 ? 'היום' : days === 1 ? 'מחר' : 'בעוד ' + days + ' ימים';
        return '<div class="cal-item cal-' + e.type + '">' +
          '<span class="cal-ic">' + e.icon + '</span>' +
          '<div class="cal-mid"><div class="cal-title">' + e.title + (e.est ? ' <span class="cal-est">משוער</span>' : '') + '</div>' +
          '<div class="cal-date">' + e.date.toLocaleDateString('he-IL', { day: '2-digit', month: 'short', year: 'numeric' }) + '</div></div>' +
          '<span class="cal-when">' + when + '</span></div>';
      }).join('') +
      '<button class="btn btn-sm" style="width:100%;margin-top:.5rem" onclick="NTFeatures.markEventsOnChart()">📍 סמן דוחות עבר על הגרף</button>' +
      '<div class="ins-sub" style="font-size:.66rem;opacity:.7;margin-top:.4rem">תאריכי דוחות הם הערכה לפי לוח הזמנים הרגיל של הבורסה. עדכון מדויק יגיע מהשרת.</div>';
  }
  function markEventsOnChart() {
    if (!window.candleSeries) return;
    var ev = buildEvents();
    var bars = curBars();
    if (!bars.length) return;
    var firstT = bars[0].time, lastT = bars[bars.length - 1].time;
    function toYmd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
    var markers = ev.filter(function (e) { return e.type === 'report' && e.date <= new Date(); })
      .map(function (e) {
        // snap to nearest bar date
        var ymd = toYmd(e.date);
        return { time: ymd, position: 'aboveBar', color: '#f5a623', shape: 'circle', text: 'דוח' };
      })
      .filter(function (mk) { return String(mk.time) >= String(firstT) && String(mk.time) <= String(lastT); });
    try { window.candleSeries.setMarkers(markers); } catch (e) {}
    if (!markers.length) alert('אין תאריכי דוח בטווח הגרף הנוכחי.');
  }

  // ============================================================
  //   DEMO HUB  (#1 reports, #3 sentiment, #7 crowd, #8 ideas)
  // ============================================================
  function renderLab(tab) {
    var el = document.getElementById('labBody');
    if (!el) return;
    labTab = tab || labTab || 'sentiment';
    var nav = ['sentiment', 'reports', 'crowd', 'ideas'].map(function (t) {
      var names = { sentiment: '🧠 סנטימנט', reports: '📑 דוחות', crowd: '🇮🇱 קהל', ideas: '💡 רעיונות' };
      return '<button class="lab-tab' + (t === labTab ? ' active' : '') + '" onclick="NTFeatures.lab(\'' + t + '\')">' + names[t] + '</button>';
    }).join('');
    el.innerHTML = '<div class="lab-nav">' + nav + '</div><div id="labContent"></div>';
    if (labTab === 'sentiment') renderSentiment();
    else if (labTab === 'reports') renderReports();
    else if (labTab === 'crowd') renderCrowd();
    else if (labTab === 'ideas') renderIdeas();
  }
  var labTab = 'sentiment';

  // ---- #3 news sentiment (semi-real: scores live Yahoo headlines) ----
  var POS_WORDS = ['beat', 'beats', 'surge', 'soar', 'gain', 'gains', 'jump', 'rise', 'rises', 'up', 'high', 'record', 'profit', 'growth', 'upgrade', 'buy', 'bullish', 'rally', 'strong', 'wins', 'win', 'raises', 'outperform', 'עולה', 'זינוק', 'שיא', 'רווח', 'צמיחה', 'חיובי', 'מזנקת'];
  var NEG_WORDS = ['miss', 'misses', 'fall', 'falls', 'drop', 'drops', 'plunge', 'slump', 'down', 'low', 'loss', 'losses', 'cut', 'cuts', 'downgrade', 'sell', 'bearish', 'weak', 'warning', 'lawsuit', 'fraud', 'probe', 'יורד', 'צניחה', 'הפסד', 'שלילי', 'אזהרה', 'חקירה', 'צונחת'];
  function scoreText(t) {
    t = (t || '').toLowerCase(); var s = 0;
    POS_WORDS.forEach(function (w) { if (t.indexOf(w) !== -1) s++; });
    NEG_WORDS.forEach(function (w) { if (t.indexOf(w) !== -1) s--; });
    return s;
  }
  async function renderSentiment() {
    var c = document.getElementById('labContent'); if (!c) return;
    c.innerHTML = '<div class="lab-badge">בטא · ניתוח כותרות חי</div><div class="ins-sub">טוען חדשות עבור ' + curSym() + '...</div>';
    var articles = [];
    try { if (typeof window.fetchNews === 'function') articles = await window.fetchNews(window.currentSymbol); } catch (e) {}
    if (!articles || !articles.length) { c.innerHTML = '<div class="lab-badge">בטא</div>' + empty('אין כותרות זמינות כרגע עבור ' + curSym()); return; }
    var scored = articles.slice(0, 12).map(function (a) { return { title: a.title || '', link: a.link, pub: a.publisher, s: scoreText(a.title) }; });
    var net = scored.reduce(function (s, a) { return s + a.s; }, 0);
    var posN = scored.filter(function (a) { return a.s > 0; }).length;
    var negN = scored.filter(function (a) { return a.s < 0; }).length;
    var total = scored.length;
    var idx = Math.max(-100, Math.min(100, Math.round(net / Math.max(1, total) * 50)));
    var col = idx > 15 ? 'var(--green)' : idx < -15 ? 'var(--red)' : 'var(--gold)';
    var lbl = idx > 15 ? 'חיובי' : idx < -15 ? 'שלילי' : 'נייטרלי';
    c.innerHTML =
      '<div class="lab-badge">בטא · ניתוח כותרות חי</div>' +
      '<div class="sent-gauge"><div class="sent-needle" style="--v:' + idx + '"></div></div>' +
      '<div class="sent-val" style="color:' + col + '">' + lbl + ' (' + (idx > 0 ? '+' : '') + idx + ')</div>' +
      '<div class="sent-counts"><span style="color:var(--green)">▲ ' + posN + ' חיובי</span><span style="color:var(--text-muted)">● ' + (total - posN - negN) + '</span><span style="color:var(--red)">▼ ' + negN + ' שלילי</span></div>' +
      scored.map(function (a) {
        var sc = a.s > 0 ? 'pos' : a.s < 0 ? 'neg' : 'neu';
        var dot = a.s > 0 ? '🟢' : a.s < 0 ? '🔴' : '⚪';
        return '<a class="sent-item ' + sc + '" href="' + (a.link || '#') + '" target="_blank" rel="noopener">' + dot + ' ' + a.title + '</a>';
      }).join('');
  }

  // ---- #1 financial reports scanner (DEMO) ----
  function renderReports() {
    var c = document.getElementById('labContent'); if (!c) return;
    var demo = [
      { sym: 'TEVA', rev: '4.0B$', revG: 6.2, eps: '0.69$', surp: 8.1, beat: true, date: 'מאי 2026' },
      { sym: 'NICE', rev: '720M$', revG: 12.4, eps: '2.87$', surp: 5.3, beat: true, date: 'מאי 2026' },
      { sym: 'ELBIT', rev: '1.8B$', revG: 9.1, eps: '2.41$', surp: 3.4, beat: true, date: 'מאי 2026' },
      { sym: 'POLI', rev: '5.2B₪', revG: 4.0, eps: '1.92₪', surp: -2.1, beat: false, date: 'מאי 2026' },
      { sym: 'LUMI', rev: '4.9B₪', revG: 3.2, eps: '1.78₪', surp: 1.2, beat: true, date: 'מאי 2026' },
      { sym: 'ICL', rev: '1.7B$', revG: -5.5, eps: '0.11$', surp: -14.0, beat: false, date: 'מאי 2026' },
      { sym: 'BEZQ', rev: '2.3B₪', revG: 1.1, eps: '0.34₪', surp: 0.5, beat: true, date: 'מאי 2026' },
    ];
    c.innerHTML =
      '<div class="lab-badge demo">🧪 דמו · יתחבר לשרת</div>' +
      '<div class="rep-head"><span>מניה</span><span>הכנסות</span><span>EPS</span><span>הפתעה</span></div>' +
      demo.map(function (r) {
        var col = r.surp >= 0 ? 'var(--green)' : 'var(--red)';
        return '<div class="rep-row" onclick="selectSymbol(\'' + r.sym + '.TA\')">' +
          '<span class="rep-sym">' + r.sym + ' ' + (r.beat ? '<span class="rep-beat">BEAT</span>' : '<span class="rep-miss">MISS</span>') + '</span>' +
          '<span>' + r.rev + ' <small style="color:' + (r.revG >= 0 ? 'var(--green)' : 'var(--red)') + '">' + pct(r.revG) + '</small></span>' +
          '<span>' + r.eps + '</span>' +
          '<span style="color:' + col + ';font-weight:700">' + pct(r.surp) + '</span>' +
          '</div>';
      }).join('');
  }

  // ---- #7 what Israelis are buying (DEMO) ----
  function renderCrowd() {
    var c = document.getElementById('labContent'); if (!c) return;
    var demo = [
      { sym: 'TEVA', name: 'טבע', buy: 78, trend: 'up' },
      { sym: 'NVDA', name: 'NVIDIA', buy: 74, trend: 'up' },
      { sym: 'POLI', name: 'בנק הפועלים', buy: 66, trend: 'flat' },
      { sym: 'ELBIT', name: 'אלביט', buy: 63, trend: 'up' },
      { sym: 'LUMI', name: 'בנק לאומי', buy: 58, trend: 'flat' },
      { sym: 'ICL', name: 'כיל', buy: 41, trend: 'down' },
      { sym: 'BEZQ', name: 'בזק', buy: 38, trend: 'down' },
    ];
    var tIcon = { up: '🔥', flat: '➖', down: '❄️' };
    c.innerHTML =
      '<div class="lab-badge demo">🧪 דמו · יתחבר לשרת</div>' +
      '<div class="ins-sub">המניות הנקנות ביותר ע״י משקיעים ישראלים השבוע</div>' +
      demo.map(function (r, i) {
        return '<div class="crowd-row" onclick="selectSymbol(\'' + r.sym + (r.sym === 'NVDA' ? '' : '.TA') + '\')">' +
          '<span class="crowd-rank">' + (i + 1) + '</span>' +
          '<span class="crowd-sym">' + r.sym + '<small>' + r.name + '</small></span>' +
          '<div class="crowd-track"><div class="crowd-fill" style="width:' + r.buy + '%"></div></div>' +
          '<span class="crowd-pct">' + r.buy + '% ' + tIcon[r.trend] + '</span>' +
          '</div>';
      }).join('');
  }

  // ---- #8 trade ideas tracking (DEMO + user-added persists) ----
  function getIdeas() {
    var seed = [
      { sym: 'TEVA', dir: 'long', entry: 58.0, target: 68.0, stop: 53.0, status: 'open', result: 6.4, date: '2026-05-20', demo: true },
      { sym: 'ELBIT', dir: 'long', entry: 920, target: 1050, stop: 860, status: 'open', result: 3.1, date: '2026-05-28', demo: true },
      { sym: 'ICL', dir: 'short', entry: 22.0, target: 18.5, stop: 24.0, status: 'closed', result: 9.2, date: '2026-04-10', demo: true },
    ];
    var user = [];
    try { user = JSON.parse(localStorage.getItem('nt_ideas') || '[]'); } catch (e) {}
    return seed.concat(user);
  }
  function renderIdeas() {
    var c = document.getElementById('labContent'); if (!c) return;
    var ideas = getIdeas();
    c.innerHTML =
      '<div class="lab-badge demo">🧪 דמו · רעיונות לדוגמה + שלך</div>' +
      '<div class="idea-add">' +
      '<input id="ideaSym" placeholder="סמל" />' +
      '<select id="ideaDir"><option value="long">לונג</option><option value="short">שורט</option></select>' +
      '<input id="ideaEntry" type="number" placeholder="כניסה" />' +
      '<input id="ideaTarget" type="number" placeholder="יעד" />' +
      '<input id="ideaStop" type="number" placeholder="סטופ" />' +
      '<button class="btn btn-sm" onclick="NTFeatures.addIdea()">+ הוסף רעיון</button>' +
      '</div>' +
      ideas.map(function (it, i) {
        var price = (window.priceCache[it.sym + '.TA'] && window.priceCache[it.sym + '.TA'].price) || (window.priceCache[it.sym] && window.priceCache[it.sym].price);
        var pnl;
        if (it.demo) {
          pnl = (it.result != null) ? it.result : null;  // preset demo P&L (live prices are in agorot, can't compare)
        } else {
          pnl = it.status === 'closed' ? it.result : (price ? ((it.dir === 'long' ? (price - it.entry) : (it.entry - price)) / it.entry * 100) : null);
        }
        var col = pnl == null ? 'var(--text-muted)' : pnl >= 0 ? 'var(--green)' : 'var(--red)';
        var pnlStr = pnl == null ? '—' : pct(pnl);
        return '<div class="idea-row">' +
          '<span class="idea-sym ' + it.dir + '">' + it.sym + ' <small>' + (it.dir === 'long' ? '▲ לונג' : '▼ שורט') + '</small></span>' +
          '<div class="idea-mid"><span>כניסה ' + it.entry + ' · יעד ' + it.target + ' · סטופ ' + it.stop + '</span>' +
          '<span class="idea-status ' + it.status + '">' + (it.status === 'open' ? 'פתוח' : 'סגור') + '</span></div>' +
          '<span class="idea-pnl" style="color:' + col + '">' + pnlStr + '</span>' +
          (it.demo ? '' : '<button class="idea-del" onclick="NTFeatures.delIdea(' + (i - 3) + ')">✕</button>') +
          '</div>';
      }).join('');
  }
  function addIdea() {
    var sym = (document.getElementById('ideaSym').value || '').trim().toUpperCase().replace('.TA', '');
    var dir = document.getElementById('ideaDir').value;
    var entry = parseFloat(document.getElementById('ideaEntry').value);
    var target = parseFloat(document.getElementById('ideaTarget').value);
    var stop = parseFloat(document.getElementById('ideaStop').value);
    if (!sym || !entry || !target || !stop) return;
    var user = [];
    try { user = JSON.parse(localStorage.getItem('nt_ideas') || '[]'); } catch (e) {}
    user.push({ sym: sym, dir: dir, entry: entry, target: target, stop: stop, status: 'open', date: new Date().toISOString().slice(0, 10) });
    localStorage.setItem('nt_ideas', JSON.stringify(user));
    renderIdeas();
  }
  function delIdea(i) {
    var user = [];
    try { user = JSON.parse(localStorage.getItem('nt_ideas') || '[]'); } catch (e) {}
    if (i >= 0 && i < user.length) { user.splice(i, 1); localStorage.setItem('nt_ideas', JSON.stringify(user)); renderIdeas(); }
  }

  // ---------- shared ----------
  function empty(msg) { return '<div style="color:var(--text-muted);font-size:.78rem;text-align:center;padding:1.5rem .5rem">' + msg + '</div>'; }

  // hook: when symbol changes, refresh open panels + drawings
  function onSymbolChanged() {
    if (panelOpen('insights')) renderInsights();
    if (panelOpen('calendar')) renderCalendar();
    if (panelOpen('lab')) renderLab(labTab);
    if (window.NTDraw) window.NTDraw.onSymbolChanged();
  }
  function panelOpen(name) { var el = document.getElementById('ibPanel-' + name); return el && el.classList.contains('open'); }

  window.NTFeatures = {
    renderInsights: renderInsights,
    renderRisk: renderRisk,
    renderCalendar: renderCalendar,
    renderLab: renderLab,
    lab: renderLab,
    markEventsOnChart: markEventsOnChart,
    addIdea: addIdea,
    delIdea: delIdea,
    onSymbolChanged: onSymbolChanged
  };
})();
