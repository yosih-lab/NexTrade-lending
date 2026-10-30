// ============================================================================
//   NexTrade PLAN OVERLAY — draws the scanner's trade plan on the chart:
//   level line, risk/reward ruler (stop · entry · target), a direction arrow and
//   a circle on the entry point. Until the setup is confirmed (break → 5 weekly
//   candles → retest) everything is drawn dimmed/dashed with an "after 5 candles
//   + retest" label; once the entry is live the circle and ruler light up.
//   Data comes from NTSignals.signalsFor(symbol) (server feed). Pure overlay.
// ============================================================================
(function () {
  'use strict';

  var OFF_KEY = 'nt_plan_overlay_off';
  var canvas = null, ctx = null, btn = null;
  var priceLines = [];
  var sig = null, lastSym = null, lastKey = '', lastGeom = '', pending = true, started = false;

  function chart() { return window.chartInstance || null; }
  function series() { return window.candleSeries || null; }
  function isOff() { try { return localStorage.getItem(OFF_KEY) === '1'; } catch (e) { return false; } }

  function pickSignal(sym) {
    try {
      if (!sym || !window.NTSignals || typeof window.NTSignals.signalsFor !== 'function') return null;
      var list = window.NTSignals.signalsFor(sym) || [];
      if (!list.length) return null;
      list.sort(function (a, b) { return (a.planOnly ? 1 : 0) - (b.planOnly ? 1 : 0) || (b.ts || 0) - (a.ts || 0); });
      var s = list[0];
      return (s && s.entry != null && s.stop != null && s.tp != null) ? s : null;
    } catch (e) { return null; }
  }

  function ensureDom() {
    if (canvas) return true;
    var wrap = document.querySelector('.chart-wrap');
    if (!wrap) return false;
    canvas = document.createElement('canvas');
    canvas.id = 'planCanvas';
    canvas.style.cssText = 'position:absolute;inset:0;z-index:8;pointer-events:none;';
    wrap.appendChild(canvas);
    ctx = canvas.getContext('2d');

    btn = document.createElement('button');
    btn.id = 'planToggle';
    btn.type = 'button';
    btn.title = 'הצג/הסתר תכנית עסקה על הגרף';
    btn.style.cssText = 'position:absolute;top:34px;left:8px;z-index:12;display:none;background:rgba(30,34,45,.9);color:#ffd27a;' +
      'border:1px solid rgba(245,166,35,.5);border-radius:8px;padding:.2rem .55rem;font:700 12px Heebo,sans-serif;cursor:pointer;';
    btn.addEventListener('click', function () {
      try { localStorage.setItem(OFF_KEY, isOff() ? '0' : '1'); } catch (e) {}
      refresh(true);
    });
    wrap.appendChild(btn);

    try { new ResizeObserver(resize).observe(wrap); } catch (e) { window.addEventListener('resize', resize); }
    resize();
    return true;
  }

  function resize() {
    if (!canvas) return;
    var wrap = canvas.parentElement;
    var w = wrap.clientWidth, h = wrap.clientHeight, dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pending = true;
  }

  function clearLines() {
    var s = series();
    priceLines.forEach(function (pl) { try { if (s) s.removePriceLine(pl); } catch (e) {} });
    priceLines = [];
  }

  function addLine(price, color, title, style) {
    var s = series();
    if (!s || price == null) return;
    try {
      priceLines.push(s.createPriceLine({
        price: price, color: color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title: title
      }));
    } catch (e) {}
  }

  function planLabel(s) {
    var p = s.plan;
    return p && (p.kind === 'breakdown' || p.kind === 'pullback') ? 'תמיכה' : 'התנגדות';
  }

  // Re-read the signal for the current symbol and rebuild the price lines.
  function refresh(force) {
    if (!ensureDom()) return;
    var sym = window.currentSymbol;
    var s = pickSignal(sym);
    var key = s ? [s.key, s.entry, s.stop, s.tp, s.plan && s.plan.stage, s.plan && s.plan.closes, isOff()].join('|') : 'none|' + isOff();
    if (!force && sym === lastSym && key === lastKey) return;
    lastSym = sym; lastKey = key; sig = s;
    clearLines();
    if (btn) {
      btn.style.display = s ? 'block' : 'none';
      btn.textContent = isOff() ? '📐 הצג תכנית' : '📐 הסתר תכנית';
    }
    if (s && !isOff()) {
      var planned = !!s.planOnly;
      var lvlP = s.plan && s.plan.level != null ? s.plan.level : null;
      var sameAsEntry = lvlP != null && Math.abs(lvlP - s.entry) / s.entry < 0.001;
      if (lvlP != null) addLine(lvlP, '#f5c518', planLabel(s) + (s.plan.touches ? ' ×' + s.plan.touches : '') + (sameAsEntry ? ' = כניסה' : ''), 0);
      if (!sameAsEntry) addLine(s.entry, planned ? '#8b9ab5' : '#ffffff', planned ? 'כניסה (אחרי 5 נרות+ריטסט)' : 'כניסה', 2);
      addLine(s.stop, '#ef5350', 'סטופ', 2);
      addLine(s.tp, '#26a69a', 'יעד', 2);
    }
    pending = true;
  }

  function geomSig() {
    try {
      var sr = series(), t = chart() && chart().timeScale();
      if (!sr || !t) return '';
      var r = t.getVisibleLogicalRange();
      return (r ? r.from + '|' + r.to : '') + '|' + sr.priceToCoordinate(1) + '|' + sr.priceToCoordinate(1000) +
        '|' + (canvas ? canvas.width + 'x' + canvas.height : '');
    } catch (e) { return ''; }
  }

  function lastBarX() {
    var t = chart().timeScale(), sr = series(), idx = null;
    try { if (sr && typeof sr.data === 'function') { var d = sr.data(); if (d && d.length) idx = d.length - 1; } } catch (e) {}
    if (idx == null) { var r = t.getVisibleLogicalRange(); idx = r ? Math.floor(r.to) : null; }
    var x = idx == null ? null : t.logicalToCoordinate(idx);
    return x == null ? null : x;
  }

  function arrowHead(x1, y1, x2, y2, color) {
    var a = Math.atan2(y2 - y1, x2 - x1), L = 14;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - L * Math.cos(a - 0.45), y2 - L * Math.sin(a - 0.45));
    ctx.lineTo(x2 - L * Math.cos(a + 0.45), y2 - L * Math.sin(a + 0.45));
    ctx.closePath(); ctx.fill();
  }

  function tag(x, y, text, color) {
    ctx.font = '700 12px Heebo, sans-serif';
    var w = ctx.measureText(text).width + 12;
    ctx.fillStyle = 'rgba(19,23,34,.88)';
    ctx.fillRect(x, y - 10, w, 20);
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillText(text, x + 6, y);
  }

  function draw() {
    if (!ctx || !canvas) return;
    var W = canvas.clientWidth, H = canvas.clientHeight;
    ctx.clearRect(0, 0, W, H);
    if (!sig || isOff() || !chart() || !series()) return;
    var sr = series();
    var yE = sr.priceToCoordinate(sig.entry), yS = sr.priceToCoordinate(sig.stop), yT = sr.priceToCoordinate(sig.tp);
    if (yE == null || yS == null || yT == null) return;
    var lvl = sig.plan && sig.plan.level != null ? sig.plan.level : sig.entry;
    var yL = sr.priceToCoordinate(lvl);
    var yP = sig.price != null ? sr.priceToCoordinate(sig.price) : null;
    var live = !sig.planOnly && sig.scanStatus === 'entry';
    var isShort = sig.dir === 'short';
    var col = isShort ? '#ef5350' : '#26a69a';

    var anchor = lastBarX();
    var boxW = Math.min(210, Math.max(120, W * 0.28));
    var x0 = (anchor == null ? W * 0.7 : anchor + 18);
    x0 = Math.min(x0, W - 70 - boxW);
    if (x0 < 6) x0 = 6;
    var x1 = x0 + boxW;

    // risk / reward ruler
    var alpha = live ? 0.28 : 0.13;
    var risk = isShort ? [yE, yS] : [yS, yE];
    var rew = isShort ? [yT, yE] : [yE, yT];
    ctx.fillStyle = 'rgba(239,83,80,' + alpha + ')';
    ctx.fillRect(x0, Math.min(risk[0], risk[1]), boxW, Math.abs(risk[1] - risk[0]));
    ctx.fillStyle = 'rgba(38,166,154,' + alpha + ')';
    ctx.fillRect(x0, Math.min(rew[0], rew[1]), boxW, Math.abs(rew[1] - rew[0]));
    ctx.strokeStyle = live ? 'rgba(255,255,255,.55)' : 'rgba(139,154,181,.55)';
    ctx.lineWidth = 1; ctx.setLineDash(live ? [] : [5, 4]);
    ctx.strokeRect(x0, Math.min(yS, yT), boxW, Math.abs(yS - yT));
    ctx.beginPath(); ctx.moveTo(x0, yE); ctx.lineTo(x1, yE); ctx.stroke();
    ctx.setLineDash([]);

    // direction arrow: current price → dip through the level → retest → target
    var dipY = isShort ? yL + Math.max(18, Math.abs(yT - yL) * 0.22) : yL - Math.max(18, Math.abs(yT - yL) * 0.22);
    // A pullback to support dips slightly BELOW the level and bounces (no break-and-retest leg).
    if (sig.plan && sig.plan.kind === 'pullback') dipY = yL + 14;
    var pStart = { x: x0 - 4, y: yP != null ? yP : yL };
    var pDip = { x: x0 + boxW * 0.28, y: dipY };
    var pRet = { x: x0 + boxW * 0.55, y: yE };
    var pEnd = { x: x1 + 12, y: yT + (isShort ? 26 : -26) };
    ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
    ctx.globalAlpha = live ? 1 : 0.8;
    ctx.beginPath();
    ctx.moveTo(pStart.x, pStart.y); ctx.lineTo(pDip.x, pDip.y); ctx.lineTo(pRet.x, pRet.y); ctx.lineTo(pEnd.x, pEnd.y);
    ctx.stroke();
    arrowHead(pRet.x, pRet.y, pEnd.x, pEnd.y, col);
    ctx.globalAlpha = 1;

    // entry circle
    ctx.beginPath(); ctx.arc(pRet.x, pRet.y, 12, 0, Math.PI * 2);
    ctx.lineWidth = live ? 3 : 2.5; ctx.strokeStyle = '#ffd400';
    ctx.setLineDash(live ? [] : [4, 3]); ctx.stroke(); ctx.setLineDash([]);
    if (live) { ctx.fillStyle = 'rgba(255,212,0,.22)'; ctx.fill(); }

    // labels
    var p = sig.plan;
    var txt = live ? '✅ כניסה עכשיו' : (p && p.kind === 'pullback' ? '⏳ כניסה בנר היפוך + מחזור מעל הממוצע' : (p && p.stage === 'await_retest' ? '⏳ ממתין לריטסט' :
      (p && p.stage === 'holding' ? '⏳ נר ' + Math.min(p.closes, p.needed) + '/' + p.needed : '⏳ כניסה רק אחרי שבירה + 5 נרות + ריטסט')));
    tag(x0, Math.min(yS, yT, yE) - 16, txt, live ? '#6fe0d2' : '#ffd27a');
  }

  function loop() {
    var g = geomSig();
    if (g !== lastGeom) { lastGeom = g; pending = true; }
    if (pending) { pending = false; draw(); }
    requestAnimationFrame(loop);
  }

  function start() {
    if (started) return;
    if (!ensureDom()) return;
    started = true;
    loop();
    setInterval(function () { refresh(false); }, 15000);
  }

  window.NTPlanOverlay = {
    onSymbolChanged: function () { start(); refresh(true); },
    refresh: function () { start(); refresh(false); }
  };
})();
