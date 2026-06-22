// ============================================================
//   NexTrade — DRAWING / ANALYSIS TOOLS  (כלי ניתוח)
//   Canvas overlay anchored to chart data coordinates.
//   Tools: trend line, horizontal line, vertical line, ray,
//          rectangle, ellipse/circle, arrow, text, brush, fib.
//   Features: select, drag, resize (handles), delete, duplicate,
//             color/width edit, per-symbol persistence.
// ============================================================
(function () {
  'use strict';

  var canvas, ctx, toolbar, actionBar;
  var mode = 'off';          // 'off' | 'select' | tool name
  var shapes = [];           // current symbol drawings
  var selectedId = null;
  var dragState = null;      // { kind:'move'|'resize'|'create', ... }
  var draftShape = null;     // shape being created
  var nextId = 1;
  var curColor = '#2962ff';
  var curWidth = 2;
  var lastSymbol = null;
  var posPanel = null;
  var ppDragState = null;

  var COLORS = ['#2962ff', '#26a69a', '#ef5350', '#f5a623', '#cc5de8', '#ffffff'];
  var HANDLE = 5;            // half-size of a handle square in px
  var HIT = 7;               // hit tolerance in px

  // ---- tool definitions for the toolbar ----
  var TOOLS = [
    { id: 'off',     icon: '🖐', tip: 'ניווט בגרף' },
    { id: 'select',  icon: '⌖',  tip: 'בחירה / עריכה' },
    { id: 'trend',   icon: '╱',  tip: 'קו מגמה' },
    { id: 'hline',   icon: '─',  tip: 'קו אופקי' },
    { id: 'vline',   icon: '│',  tip: 'קו אנכי' },
    { id: 'ray',     icon: '⟶',  tip: 'קרן' },
    { id: 'rect',    icon: '▭',  tip: 'מלבן' },
    { id: 'ellipse', icon: '◯',  tip: 'עיגול / אליפסה' },
    { id: 'arrow',   icon: '↗',  tip: 'חץ' },
    { id: 'text',    icon: 'T',  tip: 'טקסט' },
    { id: 'brush',   icon: '✎',  tip: 'ציור חופשי' },
    { id: 'fib',     icon: 'F',  tip: 'פיבונאצ׳י' },
    { id: 'long',    icon: '▲',  tip: 'סרגל עסקה לונג' },
    { id: 'short',   icon: '▼',  tip: 'סרגל עסקה שורט' },
    { id: 'clear',   icon: '🗑', tip: 'מחק הכל' },
  ];

  var FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

  // ===== coordinate helpers (data <-> pixels) =====
  function ts() { return window.chartInstance ? window.chartInstance.timeScale() : null; }
  function lToX(l) { var t = ts(); if (!t) return null; var x = t.logicalToCoordinate(l); return x == null ? null : x; }
  function xToL(x) { var t = ts(); if (!t) return null; var l = t.coordinateToLogical(x); return l == null ? null : l; }
  function pToY(p) { var s = window.candleSeries; if (!s) return null; var y = s.priceToCoordinate(p); return y == null ? null : y; }
  function yToP(y) { var s = window.candleSeries; if (!s) return null; var p = s.coordinateToPrice(y); return p == null ? null : p; }

  function symKey() { return 'nt_draw_' + (window.currentSymbol || 'NA'); }

  function save() {
    try { localStorage.setItem(symKey(), JSON.stringify(shapes)); } catch (e) {}
  }
  function load() {
    shapes = [];
    selectedId = null;
    try {
      var raw = localStorage.getItem(symKey());
      if (raw) {
        var arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          shapes = arr;
          shapes.forEach(function (s) { if (s.id >= nextId) nextId = s.id + 1; });
        }
      }
    } catch (e) {}
  }

  // ===== build the DOM (canvas + toolbar + action bar) =====
  function ensureDom() {
    if (canvas) return;
    var wrap = document.querySelector('.chart-wrap');
    if (!wrap) return;

    canvas = document.createElement('canvas');
    canvas.id = 'drawCanvas';
    canvas.style.cssText = 'position:absolute;inset:0;z-index:9;pointer-events:none;';
    wrap.appendChild(canvas);
    ctx = canvas.getContext('2d');

    toolbar = document.createElement('div');
    toolbar.id = 'drawToolbar';
    toolbar.style.display = 'flex';
    toolbar.innerHTML = TOOLS.map(function (t) {
      return '<button class="dt-btn" data-tool="' + t.id + '" title="' + t.tip + '">' +
        '<span class="dt-ic">' + t.icon + '</span><span class="dt-tip">' + t.tip + '</span></button>';
    }).join('');
    wrap.appendChild(toolbar);
    toolbar.addEventListener('click', function (e) {
      var b = e.target.closest('.dt-btn'); if (!b) return;
      pickTool(b.getAttribute('data-tool'));
    });

    actionBar = document.createElement('div');
    actionBar.id = 'drawActionBar';
    actionBar.style.display = 'none';
    actionBar.innerHTML =
      COLORS.map(function (c) { return '<button class="da-col" data-col="' + c + '" style="background:' + c + '"></button>'; }).join('') +
      '<span class="da-sep"></span>' +
      '<button class="da-w" data-w="1">─</button>' +
      '<button class="da-w" data-w="2">━</button>' +
      '<button class="da-w" data-w="4">▬</button>' +
      '<span class="da-sep"></span>' +
      '<button class="da-act" id="daDup" title="שכפל">⧉</button>' +
      '<button class="da-act da-del" id="daDel" title="מחק">🗑</button>';
    wrap.appendChild(actionBar);
    actionBar.addEventListener('click', function (e) {
      var col = e.target.closest('.da-col');
      if (col) { applyToSelected('color', col.getAttribute('data-col')); curColor = col.getAttribute('data-col'); return; }
      var w = e.target.closest('.da-w');
      if (w) { applyToSelected('width', parseInt(w.getAttribute('data-w'), 10)); curWidth = parseInt(w.getAttribute('data-w'), 10); return; }
      if (e.target.closest('#daDup')) { duplicateSelected(); return; }
      if (e.target.closest('#daDel')) { deleteSelected(); return; }
    });

    // pointer handlers
    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('dblclick', onDblClick);
    document.addEventListener('keydown', onKey);

    // redraw on pan/zoom
    var t = ts();
    if (t) {
      t.subscribeVisibleLogicalRangeChange(scheduleDraw);
    }
    if (window.chartInstance) {
      window.chartInstance.subscribeCrosshairMove(function () { /* noop, draw loop handles */ });
    }

    // keep canvas sized to the chart
    try {
      var ro = new ResizeObserver(function () { resize(); });
      ro.observe(wrap);
    } catch (e) {
      window.addEventListener('resize', resize);
    }
    resize();
    rafLoop();
  }

  function resize() {
    if (!canvas) return;
    var wrap = canvas.parentElement;
    var w = wrap.clientWidth, h = wrap.clientHeight;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    scheduleDraw();
  }

  var drawPending = false;
  function scheduleDraw() { drawPending = true; }
  function rafLoop() {
    if (drawPending) { drawPending = false; draw(); }
    requestAnimationFrame(rafLoop);
  }

  // ===== tool selection =====
  function pickTool(tool) {
    if (tool === 'clear') {
      if (shapes.length && confirm('למחוק את כל הציורים על ' + (window.currentSymbol || '') + '?')) {
        shapes = []; selectedId = null; save(); hideActionBar(); scheduleDraw();
      }
      setActiveBtn(mode);
      return;
    }
    mode = tool;
    draftShape = null;
    if (tool !== 'select') { selectedId = null; hideActionBar(); }
    canvas.style.pointerEvents = (tool === 'off') ? 'none' : 'auto';
    canvas.style.cursor = (tool === 'select' || tool === 'off') ? 'default' : 'crosshair';
    setActiveBtn(tool);
    scheduleDraw();
  }

  function setActiveBtn(tool) {
    if (!toolbar) return;
    toolbar.querySelectorAll('.dt-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tool') === tool);
    });
  }

  // ===== public toggle (called from icon toolbar) =====
  function toggle() {
    ensureDom();
    // toolbar is always visible now; toggle just inits if needed
    if (toolbar) pickTool('select');
  }

  // called by main.js when the symbol changes
  function onSymbolChanged() {
    ensureDom();
    // toolbar is always visible; place it in the fixed left panel
    if (toolbar && toolbar.parentElement && toolbar.parentElement.classList.contains('chart-wrap')) {
      document.body.appendChild(toolbar);
    }
    if (lastSymbol === window.currentSymbol) return;
    lastSymbol = window.currentSymbol;
    load();
    scheduleDraw();
    // Refresh position panel for the new symbol
    if (posPanel && posPanel.style.display !== 'none') ppRefresh();
  }

  // ===== pixel position of a shape anchor =====
  function pt(anchor) {
    if (!anchor) return null;
    var x = lToX(anchor.l), y = pToY(anchor.p);
    if (x == null || y == null) return null;
    return { x: x, y: y };
  }

  // ===== drawing each shape onto the canvas =====
  function draw() {
    if (!ctx || !canvas) return;
    var W = canvas.clientWidth, H = canvas.clientHeight;
    ctx.clearRect(0, 0, W, H);

    shapes.forEach(function (s) { drawShape(s, s.id === selectedId); });
    if (draftShape) drawShape(draftShape, false);

    positionActionBar();
  }

  function drawShape(s, selected) {
    ctx.save();
    ctx.lineWidth = s.width || 2;
    ctx.strokeStyle = s.color || '#2962ff';
    ctx.fillStyle = s.color || '#2962ff';
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    if (s.type === 'hline') {
      var y = pToY(s.p); if (y == null) { ctx.restore(); return; }
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.clientWidth, y); ctx.stroke();
      label(s, 8, y - 6, fmtPrice(s.p));
      if (selected) handleAt(canvas.clientWidth / 2, y);
    } else if (s.type === 'vline') {
      var x = lToX(s.l); if (x == null) { ctx.restore(); return; }
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.clientHeight); ctx.stroke();
      if (selected) handleAt(x, canvas.clientHeight / 2);
    } else if (s.type === 'trend' || s.type === 'ray' || s.type === 'arrow') {
      var a = pt(s.a), b = pt(s.b); if (!a || !b) { ctx.restore(); return; }
      var bb = b;
      if (s.type === 'ray') bb = extend(a, b, canvas.clientWidth, canvas.clientHeight);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(bb.x, bb.y); ctx.stroke();
      if (s.type === 'arrow') drawArrowHead(a, b);
      if (selected) { handleAt(a.x, a.y); handleAt(b.x, b.y); }
    } else if (s.type === 'rect') {
      var a2 = pt(s.a), b2 = pt(s.b); if (!a2 || !b2) { ctx.restore(); return; }
      var x0 = Math.min(a2.x, b2.x), y0 = Math.min(a2.y, b2.y);
      var w = Math.abs(b2.x - a2.x), h = Math.abs(b2.y - a2.y);
      ctx.globalAlpha = 0.10; ctx.fillRect(x0, y0, w, h); ctx.globalAlpha = 1;
      ctx.strokeRect(x0, y0, w, h);
      if (selected) { handleAt(a2.x, a2.y); handleAt(b2.x, b2.y); handleAt(a2.x, b2.y); handleAt(b2.x, a2.y); }
    } else if (s.type === 'ellipse') {
      var a3 = pt(s.a), b3 = pt(s.b); if (!a3 || !b3) { ctx.restore(); return; }
      var cx = (a3.x + b3.x) / 2, cy = (a3.y + b3.y) / 2;
      var rx = Math.abs(b3.x - a3.x) / 2, ry = Math.abs(b3.y - a3.y) / 2;
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.globalAlpha = 0.10; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke();
      if (selected) { handleAt(a3.x, a3.y); handleAt(b3.x, b3.y); }
    } else if (s.type === 'text') {
      var p = pt(s.a); if (!p) { ctx.restore(); return; }
      ctx.font = '600 ' + (12 + (s.width || 2) * 2) + 'px Heebo, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(s.text || '', p.x, p.y);
      if (selected) { var mt = ctx.measureText(s.text || ''); strokeBox(p.x - 3, p.y - 10, mt.width + 6, 20); handleAt(p.x, p.y); }
    } else if (s.type === 'brush') {
      if (!s.points || s.points.length < 2) { ctx.restore(); return; }
      ctx.beginPath();
      var first = true;
      s.points.forEach(function (pt0) {
        var pp = pt(pt0); if (!pp) return;
        if (first) { ctx.moveTo(pp.x, pp.y); first = false; } else ctx.lineTo(pp.x, pp.y);
      });
      ctx.stroke();
      if (selected) { var bbx = brushBounds(s); if (bbx) strokeBox(bbx.x0, bbx.y0, bbx.x1 - bbx.x0, bbx.y1 - bbx.y0); }
    } else if (s.type === 'fib') {
      var fa = pt(s.a), fb = pt(s.b); if (!fa || !fb) { ctx.restore(); return; }
      var top = fa.y, bot = fb.y;
      var x1 = Math.min(fa.x, fb.x), x2 = Math.max(fa.x, fb.x);
      FIB_LEVELS.forEach(function (lv) {
        var yy = top + (bot - top) * lv;
        ctx.globalAlpha = 0.85;
        ctx.beginPath(); ctx.moveTo(x1, yy); ctx.lineTo(canvas.clientWidth, yy); ctx.stroke();
        ctx.globalAlpha = 1;
        var pr = yToP(yy);
        ctx.font = '600 10px Heebo, sans-serif'; ctx.textBaseline = 'bottom';
        ctx.fillText((lv * 100).toFixed(1) + '%  ' + (pr != null ? fmtPrice(pr) : ''), x1 + 4, yy - 2);
      });
      if (selected) { handleAt(fa.x, fa.y); handleAt(fb.x, fb.y); }
    } else if (s.type === 'position') {
      var yE = pToY(s.entry), ySL = pToY(s.sl), yTP = pToY(s.tp);
      if (yE == null || ySL == null || yTP == null) { ctx.restore(); return; }
      var W = canvas.clientWidth;
      var isLong = s.dir === 'long';
      // Colored zones on the RIGHT half only (from centre to right edge)
      var zoneStart = W * 0.45;
      ctx.globalAlpha = 0.13;
      ctx.fillStyle = '#26a69a';
      ctx.fillRect(zoneStart, Math.min(yE, yTP), W - zoneStart, Math.abs(yTP - yE));
      ctx.fillStyle = '#ef5350';
      ctx.fillRect(zoneStart, Math.min(yE, ySL), W - zoneStart, Math.abs(ySL - yE));
      ctx.globalAlpha = 1;
      // Entry line (full width, solid white)
      ctx.setLineDash([]);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, yE); ctx.lineTo(W, yE); ctx.stroke();
      // SL line (dashed red)
      ctx.strokeStyle = '#ef5350'; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(0, ySL); ctx.lineTo(W, ySL); ctx.stroke();
      // TP line (dashed green)
      ctx.strokeStyle = '#26a69a';
      ctx.beginPath(); ctx.moveTo(0, yTP); ctx.lineTo(W, yTP); ctx.stroke();
      ctx.setLineDash([]);
      // Labels on right side
      ctx.font = '600 10px Heebo, sans-serif'; ctx.textBaseline = 'middle';
      ctx.fillStyle = isLong ? '#26a69a' : '#ef5350';
      ctx.fillText((isLong ? '▲ LONG' : '▼ SHORT') + '  ' + fmtPrice(s.entry), W - 110, yE - 9);
      ctx.fillStyle = '#ef5350';
      ctx.fillText('SL  ' + fmtPrice(s.sl), W - 80, ySL + (ySL > yE ? 11 : -9));
      ctx.fillStyle = '#26a69a';
      ctx.fillText('TP  ' + fmtPrice(s.tp), W - 80, yTP + (yTP < yE ? -9 : 11));
      // R:R
      var risk = Math.abs(s.entry - s.sl), reward = Math.abs(s.tp - s.entry);
      var rr = risk > 0 ? (reward / risk).toFixed(1) : '∞';
      ctx.fillStyle = '#f5a623'; ctx.font = '700 10px Heebo, sans-serif';
      ctx.fillText('R:R ' + rr + ':1', W - 60, yE + (isLong ? 14 : -14));
      if (selected) { handleAt(W / 2, yE); handleAt(W / 2, ySL); handleAt(W / 2, yTP); }
    }
    ctx.restore();
  }

  function fmtPrice(p) {
    if (typeof window.formatPrice === 'function') return window.formatPrice(p);
    return (Math.round(p * 100) / 100).toString();
  }

  function label(s, x, y, txt) {
    ctx.save(); ctx.font = '600 10px Heebo, sans-serif'; ctx.textBaseline = 'bottom';
    ctx.fillStyle = s.color || '#2962ff'; ctx.fillText(txt, x, y); ctx.restore();
  }
  function strokeBox(x, y, w, h) {
    ctx.save(); ctx.setLineDash([4, 3]); ctx.strokeStyle = '#5b8def'; ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h); ctx.restore();
  }
  function handleAt(x, y) {
    ctx.save();
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#2962ff'; ctx.lineWidth = 1.5;
    ctx.fillRect(x - HANDLE, y - HANDLE, HANDLE * 2, HANDLE * 2);
    ctx.strokeRect(x - HANDLE, y - HANDLE, HANDLE * 2, HANDLE * 2);
    ctx.restore();
  }
  function drawArrowHead(a, b) {
    var ang = Math.atan2(b.y - a.y, b.x - a.x);
    var len = 12;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - len * Math.cos(ang - Math.PI / 7), b.y - len * Math.sin(ang - Math.PI / 7));
    ctx.lineTo(b.x - len * Math.cos(ang + Math.PI / 7), b.y - len * Math.sin(ang + Math.PI / 7));
    ctx.closePath(); ctx.fill();
  }
  function extend(a, b, W, H) {
    var dx = b.x - a.x, dy = b.y - a.y;
    if (dx === 0 && dy === 0) return b;
    var scale = (Math.abs(dx) > Math.abs(dy)) ? (W * 2) / Math.abs(dx) : (H * 2) / Math.abs(dy);
    return { x: a.x + dx * scale, y: a.y + dy * scale };
  }
  function brushBounds(s) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, any = false;
    s.points.forEach(function (p0) {
      var pp = pt(p0); if (!pp) return; any = true;
      x0 = Math.min(x0, pp.x); y0 = Math.min(y0, pp.y); x1 = Math.max(x1, pp.x); y1 = Math.max(y1, pp.y);
    });
    return any ? { x0: x0 - 3, y0: y0 - 3, x1: x1 + 3, y1: y1 + 3 } : null;
  }

  // ===== pointer interaction =====
  function relPos(e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function anchorFrom(px) {
    var l = xToL(px.x), p = yToP(px.y);
    if (l == null || p == null) return null;
    return { l: l, p: p };
  }

  function onDown(e) {
    if (mode === 'off') return;
    var px = relPos(e);

    if (mode === 'select') {
      // first: hit a handle of the selected shape (resize)?
      var sel = shapeById(selectedId);
      if (sel) {
        var hk = handleHit(sel, px);
        if (hk) { dragState = { kind: 'resize', id: sel.id, handle: hk, start: px }; e.preventDefault(); return; }
      }
      // else: hit any shape (select + move)
      var hit = topShapeAt(px);
      if (hit) {
        selectedId = hit.id;
        showActionBar(hit);
        dragState = { kind: 'move', id: hit.id, start: px, orig: clone(hit) };
      } else {
        selectedId = null; hideActionBar();
      }
      scheduleDraw();
      e.preventDefault();
      return;
    }

    // creation tools
    var a = anchorFrom(px);
    if (!a) return;

    if (mode === 'hline') { commit({ type: 'hline', p: a.p }); return; }
    if (mode === 'vline') { commit({ type: 'vline', l: a.l }); return; }
    if (mode === 'long' || mode === 'short') {
      var entry = a.p;
      var atrEst = Math.abs(entry) * 0.02; // default 2% range
      var sl, tp;
      if (mode === 'long') { sl = entry - atrEst; tp = entry + atrEst * 2; }
      else { sl = entry + atrEst; tp = entry - atrEst * 2; }
      commit({ type: 'position', dir: mode, entry: entry, sl: sl, tp: tp, l: a.l });
      ppRefresh();
      return;
    }
    if (mode === 'text') {
      var txt = prompt('טקסט:'); if (!txt) return;
      commit({ type: 'text', a: a, text: txt });
      return;
    }
    if (mode === 'brush') {
      draftShape = { type: 'brush', color: curColor, width: curWidth, points: [a] };
      dragState = { kind: 'brush' };
      e.preventDefault();
      return;
    }
    // two-point shapes
    draftShape = { type: mode, color: curColor, width: curWidth, a: a, b: a };
    dragState = { kind: 'create', start: px };
    e.preventDefault();
  }

  function onMove(e) {
    if (!dragState) {
      if (mode === 'select') updateHoverCursor(e);
      return;
    }
    var px = relPos(e);

    if (dragState.kind === 'brush') {
      var a = anchorFrom(px); if (a) draftShape.points.push(a);
      scheduleDraw(); return;
    }
    if (dragState.kind === 'create') {
      var a2 = anchorFrom(px); if (a2) draftShape.b = a2;
      scheduleDraw(); return;
    }
    if (dragState.kind === 'move') {
      var s = shapeById(dragState.id); if (!s) return;
      var dl = (xToL(px.x) - xToL(dragState.start.x));
      var dp = (yToP(px.y) - yToP(dragState.start.y));
      moveShape(s, dragState.orig, dl, dp);
      scheduleDraw(); return;
    }
    if (dragState.kind === 'resize') {
      var s2 = shapeById(dragState.id); if (!s2) return;
      var a3 = anchorFrom(px); if (!a3) return;
      resizeShape(s2, dragState.handle, a3);
      scheduleDraw(); return;
    }
  }

  function onUp() {
    if (!dragState) return;
    if (dragState.kind === 'create') {
      // discard zero-size shapes
      var aa = pt(draftShape.a), bb = pt(draftShape.b);
      if (aa && bb && Math.hypot(bb.x - aa.x, bb.y - aa.y) > 4) {
        commit(draftShape);
      }
      draftShape = null;
    } else if (dragState.kind === 'brush') {
      if (draftShape.points.length > 1) commit(draftShape);
      draftShape = null;
    } else if (dragState.kind === 'move' || dragState.kind === 'resize') {
      save();
    }
    dragState = null;
    scheduleDraw();
  }

  function onDblClick(e) {
    if (mode === 'off') return;
    var px = relPos(e);
    var hit = topShapeAt(px);
    if (hit && hit.type === 'text') {
      var nv = prompt('ערוך טקסט:', hit.text || ''); if (nv != null) { hit.text = nv; save(); scheduleDraw(); }
    }
  }

  function onKey(e) {
    if (toolbar && toolbar.style.display === 'none') return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedId != null && document.activeElement === document.body) { deleteSelected(); e.preventDefault(); }
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
      if (selectedId != null) { duplicateSelected(); e.preventDefault(); }
    } else if (e.key === 'Escape') {
      selectedId = null; draftShape = null; dragState = null; hideActionBar();
      if (mode !== 'off' && mode !== 'select') pickTool('select');
      scheduleDraw();
    }
  }

  // ===== shape helpers =====
  function commit(s) {
    s.id = nextId++;
    if (s.color == null) s.color = curColor;
    if (s.width == null) s.width = curWidth;
    shapes.push(s);
    save();
    selectedId = s.id;
    pickTool('select');
    showActionBar(s);
    scheduleDraw();
  }
  function clone(s) { return JSON.parse(JSON.stringify(s)); }
  function shapeById(id) { for (var i = 0; i < shapes.length; i++) if (shapes[i].id === id) return shapes[i]; return null; }

  function moveShape(s, orig, dl, dp) {
    if (s.type === 'hline') { s.p = orig.p + dp; }
    else if (s.type === 'vline') { s.l = orig.l + dl; }
    else if (s.type === 'position') { s.entry = orig.entry + dp; s.sl = orig.sl + dp; s.tp = orig.tp + dp; s.l = orig.l + dl; }
    else if (s.type === 'brush') { s.points = orig.points.map(function (q) { return { l: q.l + dl, p: q.p + dp }; }); }
    else {
      if (orig.a) s.a = { l: orig.a.l + dl, p: orig.a.p + dp };
      if (orig.b) s.b = { l: orig.b.l + dl, p: orig.b.p + dp };
    }
  }

  function resizeShape(s, handle, a) {
    if (s.type === 'hline') { s.p = a.p; }
    else if (s.type === 'vline') { s.l = a.l; }
    else if (s.type === 'position') {
      if (handle === 'entry') s.entry = a.p;
      else if (handle === 'sl') s.sl = a.p;
      else if (handle === 'tp') s.tp = a.p;
    }
    else if (handle === 'a') { s.a = a; }
    else if (handle === 'b') { s.b = a; }
    else if (handle === 'ab') { s.a = { l: a.l, p: s.a.p }; s.b = { l: s.b.l, p: a.p }; } // rect corner a.x,b.y
    else if (handle === 'ba') { s.b = { l: a.l, p: s.b.p }; s.a = { l: s.a.l, p: a.p }; }
  }

  // ===== hit testing =====
  function topShapeAt(px) {
    for (var i = shapes.length - 1; i >= 0; i--) {
      if (shapeHit(shapes[i], px)) return shapes[i];
    }
    return null;
  }
  function shapeHit(s, px) {
    if (s.type === 'hline') { var y = pToY(s.p); return y != null && Math.abs(px.y - y) <= HIT; }
    if (s.type === 'vline') { var x = lToX(s.l); return x != null && Math.abs(px.x - x) <= HIT; }
    if (s.type === 'position') {
      var yE = pToY(s.entry), ySL = pToY(s.sl), yTP = pToY(s.tp);
      if (yE == null) return false;
      return Math.abs(px.y - yE) <= HIT || (ySL != null && Math.abs(px.y - ySL) <= HIT) || (yTP != null && Math.abs(px.y - yTP) <= HIT);
    }
    if (s.type === 'text') { var p = pt(s.a); if (!p) return false; ctx.font = '600 ' + (12 + (s.width || 2) * 2) + 'px Heebo'; var w = ctx.measureText(s.text || '').width; return px.x >= p.x - 4 && px.x <= p.x + w + 4 && Math.abs(px.y - p.y) <= 12; }
    if (s.type === 'brush') {
      for (var k = 1; k < s.points.length; k++) {
        var a0 = pt(s.points[k - 1]), b0 = pt(s.points[k]);
        if (a0 && b0 && distToSeg(px, a0, b0) <= HIT) return true;
      }
      return false;
    }
    var a = pt(s.a), b = pt(s.b); if (!a || !b) return false;
    if (s.type === 'trend' || s.type === 'arrow') return distToSeg(px, a, b) <= HIT;
    if (s.type === 'ray') { var bb = extend(a, b, canvas.clientWidth, canvas.clientHeight); return distToSeg(px, a, bb) <= HIT; }
    if (s.type === 'rect') {
      var x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
      var nearV = (Math.abs(px.x - x0) <= HIT || Math.abs(px.x - x1) <= HIT) && px.y >= y0 - HIT && px.y <= y1 + HIT;
      var nearH = (Math.abs(px.y - y0) <= HIT || Math.abs(px.y - y1) <= HIT) && px.x >= x0 - HIT && px.x <= x1 + HIT;
      var inside = px.x >= x0 && px.x <= x1 && px.y >= y0 && px.y <= y1;
      return nearV || nearH || inside;
    }
    if (s.type === 'ellipse') {
      var cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
      if (rx < 2 || ry < 2) return false;
      var v = Math.pow((px.x - cx) / rx, 2) + Math.pow((px.y - cy) / ry, 2);
      return v <= 1.25 && v >= 0.0; // inside or on border
    }
    if (s.type === 'fib') {
      var top = a.y, bot = b.y;
      for (var f = 0; f < FIB_LEVELS.length; f++) {
        var yy = top + (bot - top) * FIB_LEVELS[f];
        if (Math.abs(px.y - yy) <= HIT) return true;
      }
      return false;
    }
    return false;
  }
  function handleHit(s, px) {
    var hs = handlePoints(s);
    for (var i = 0; i < hs.length; i++) {
      if (Math.abs(px.x - hs[i].x) <= HANDLE + 2 && Math.abs(px.y - hs[i].y) <= HANDLE + 2) return hs[i].k;
    }
    return null;
  }
  function handlePoints(s) {
    var out = [];
    if (s.type === 'hline') { var y = pToY(s.p); if (y != null) out.push({ x: canvas.clientWidth / 2, y: y, k: 'p' }); return out; }
    if (s.type === 'vline') { var x = lToX(s.l); if (x != null) out.push({ x: x, y: canvas.clientHeight / 2, k: 'l' }); return out; }
    if (s.type === 'brush' || s.type === 'text') return out;
    if (s.type === 'position') {
      var W = canvas.clientWidth, yE = pToY(s.entry), ySL = pToY(s.sl), yTP = pToY(s.tp);
      if (yE != null) out.push({ x: W / 2, y: yE, k: 'entry' });
      if (ySL != null) out.push({ x: W / 2, y: ySL, k: 'sl' });
      if (yTP != null) out.push({ x: W / 2, y: yTP, k: 'tp' });
      return out;
    }
    var a = pt(s.a), b = pt(s.b); if (!a || !b) return out;
    out.push({ x: a.x, y: a.y, k: 'a' });
    out.push({ x: b.x, y: b.y, k: 'b' });
    if (s.type === 'rect') { out.push({ x: a.x, y: b.y, k: 'ab' }); out.push({ x: b.x, y: a.y, k: 'ba' }); }
    return out;
  }
  function distToSeg(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    var t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  function updateHoverCursor(e) {
    var px = relPos(e);
    var sel = shapeById(selectedId);
    if (sel && handleHit(sel, px)) { canvas.style.cursor = 'nwse-resize'; return; }
    canvas.style.cursor = topShapeAt(px) ? 'move' : 'default';
  }

  // ===== selection action bar =====
  function showActionBar(s) {
    if (!actionBar) return;
    actionBar.style.display = 'flex';
    positionActionBar();
  }
  function hideActionBar() { if (actionBar) actionBar.style.display = 'none'; }
  function positionActionBar() {
    if (!actionBar || actionBar.style.display === 'none') return;
    var s = shapeById(selectedId);
    if (!s) { hideActionBar(); return; }
    var bx = shapeAnchorPixel(s);
    if (!bx) return;
    var W = canvas.clientWidth;
    var left = Math.max(6, Math.min(W - 230, bx.x - 110));
    var top = Math.max(6, bx.y - 44);
    actionBar.style.left = left + 'px';
    actionBar.style.top = top + 'px';
  }
  function shapeAnchorPixel(s) {
    if (s.type === 'hline') { var y = pToY(s.p); return y == null ? null : { x: canvas.clientWidth / 2, y: y }; }
    if (s.type === 'vline') { var x = lToX(s.l); return x == null ? null : { x: x, y: 40 }; }
    if (s.type === 'position') { var y2 = pToY(s.entry); return y2 == null ? null : { x: canvas.clientWidth / 2, y: y2 }; }
    if (s.type === 'brush') { var bb = brushBounds(s); return bb ? { x: (bb.x0 + bb.x1) / 2, y: bb.y0 } : null; }
    var a = pt(s.a); return a;
  }

  function applyToSelected(prop, val) {
    var s = shapeById(selectedId); if (!s) return;
    s[prop] = val; save(); scheduleDraw();
  }
  function deleteSelected() {
    if (selectedId == null) return;
    shapes = shapes.filter(function (s) { return s.id !== selectedId; });
    selectedId = null; hideActionBar(); save(); scheduleDraw();
  }
  function duplicateSelected() {
    var s = shapeById(selectedId); if (!s) return;
    var c = clone(s); c.id = nextId++;
    // nudge a touch so it's visible
    var dl = 2, dp = 0;
    moveShape(c, clone(s), dl, dp);
    shapes.push(c); selectedId = c.id; save(); showActionBar(c); scheduleDraw();
  }

  // ===== POSITION PANEL (floating, draggable, resizable) =====

  function ensurePositionPanel() {
    if (posPanel) return;
    var div = document.createElement('div');
    div.id = 'positionPanel';

    var hdr = document.createElement('div');
    hdr.id = 'pp-header';
    hdr.innerHTML = '<span id="pp-title">📊 סרגל עסקה</span><button id="pp-close">✕</button>';
    div.appendChild(hdr);

    var cnt = document.createElement('div');
    cnt.id = 'pp-content';
    div.appendChild(cnt);

    var act = document.createElement('div');
    act.id = 'pp-actions';
    act.innerHTML = '<button class="pp-add-long">▲ Long</button><button class="pp-add-short">▼ Short</button>';
    div.appendChild(act);

    document.body.appendChild(div);
    posPanel = div;

    // Close button
    div.querySelector('#pp-close').addEventListener('click', function () {
      div.style.display = 'none';
    });

    // Add new position buttons
    act.querySelector('.pp-add-long').addEventListener('click', function () { ppAddNew('long'); });
    act.querySelector('.pp-add-short').addEventListener('click', function () { ppAddNew('short'); });

    // Drag via header (mouse + touch)
    hdr.addEventListener('mousedown', ppBeginDrag);
    hdr.addEventListener('touchstart', ppBeginDrag, { passive: false });
  }

  function ppBeginDrag(e) {
    e.preventDefault();
    var rect = posPanel.getBoundingClientRect();
    var cx = e.touches ? e.touches[0].clientX : e.clientX;
    var cy = e.touches ? e.touches[0].clientY : e.clientY;
    var ox = cx - rect.left, oy = cy - rect.top;

    function onMove(ev) {
      var nx = ev.touches ? ev.touches[0].clientX : ev.clientX;
      var ny = ev.touches ? ev.touches[0].clientY : ev.clientY;
      posPanel.style.left = Math.max(0, nx - ox) + 'px';
      posPanel.style.top = Math.max(0, ny - oy) + 'px';
      posPanel.style.right = 'auto';
      posPanel.style.bottom = 'auto';
      if (ev.cancelable) ev.preventDefault();
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchend', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchend', onUp);
  }

  function ppRefresh() {
    ensurePositionPanel();
    var positions = shapes.filter(function (s) { return s.type === 'position'; });
    var cnt = document.getElementById('pp-content');
    if (!cnt) return;

    if (positions.length === 0) {
      cnt.innerHTML = '<div class="pp-empty">לחץ ▲Long או ▼Short על הגרף<br>להוספת עסקה</div>';
    } else {
      cnt.innerHTML = positions.map(function (s) {
        var risk = Math.abs(s.entry - s.sl);
        var reward = Math.abs(s.tp - s.entry);
        var rrNum = risk > 0 ? reward / risk : 0;
        var rrStr = risk > 0 ? rrNum.toFixed(2) : '∞';
        var rrColor = rrNum >= 2 ? '#26a69a' : rrNum >= 1 ? '#f5a623' : '#ef5350';
        var isLong = s.dir === 'long';
        var id = s.id;
        return '<div class="pp-pos" data-id="' + id + '">' +
          '<div class="pp-pos-hdr">' +
          '<span class="pp-dir ' + (isLong ? 'pp-long' : 'pp-short') + '">' + (isLong ? '▲ LONG' : '▼ SHORT') + '</span>' +
          '<span class="pp-sym">' + (window.currentSymbol || '') + '</span>' +
          '<button class="pp-del" data-del="' + id + '">🗑</button>' +
          '</div>' +
          '<div class="pp-row"><label>כניסה</label>' +
          '<input type="number" data-pid="' + id + '" data-f="entry" value="' + s.entry.toFixed(2) + '" step="any" /></div>' +
          '<div class="pp-row pp-row-sl"><label>סטופ</label>' +
          '<input type="number" data-pid="' + id + '" data-f="sl" value="' + s.sl.toFixed(2) + '" step="any" /></div>' +
          '<div class="pp-row pp-row-tp"><label>יעד</label>' +
          '<input type="number" data-pid="' + id + '" data-f="tp" value="' + s.tp.toFixed(2) + '" step="any" /></div>' +
          '<div class="pp-rr">R:R = <b style="color:' + rrColor + '">' + rrStr + ':1</b></div>' +
          '</div>';
      }).join('');

      // Wire input listeners (real-time update)
      cnt.querySelectorAll('input[data-pid]').forEach(function (inp) {
        inp.addEventListener('input', function () {
          var id2 = parseInt(inp.getAttribute('data-pid'), 10);
          var field = inp.getAttribute('data-f');
          var val = parseFloat(inp.value);
          if (isNaN(val)) return;
          var sh = shapeById(id2);
          if (!sh) return;
          sh[field] = val;
          save(); scheduleDraw();
          // Update R:R live without re-rendering everything
          var posDiv = cnt.querySelector('.pp-pos[data-id="' + id2 + '"]');
          if (!posDiv) return;
          var r2 = Math.abs(sh.entry - sh.sl), rw2 = Math.abs(sh.tp - sh.entry);
          var n2 = r2 > 0 ? rw2 / r2 : 0;
          var rrEl = posDiv.querySelector('.pp-rr b');
          if (rrEl) {
            rrEl.textContent = (r2 > 0 ? n2.toFixed(2) : '∞') + ':1';
            rrEl.style.color = n2 >= 2 ? '#26a69a' : n2 >= 1 ? '#f5a623' : '#ef5350';
          }
        });
      });

      // Wire delete buttons
      cnt.querySelectorAll('.pp-del[data-del]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id3 = parseInt(btn.getAttribute('data-del'), 10);
          shapes = shapes.filter(function (s) { return s.id !== id3; });
          save(); scheduleDraw(); ppRefresh();
        });
      });
    }

    posPanel.style.display = 'flex';
  }

  function ppAddNew(dir) {
    var midPrice = canvas ? yToP(canvas.clientHeight / 2) : null;
    if (!midPrice) midPrice = 100;
    var atrEst = Math.abs(midPrice) * 0.02;
    var sl, tp;
    if (dir === 'long') { sl = midPrice - atrEst; tp = midPrice + atrEst * 2; }
    else { sl = midPrice + atrEst; tp = midPrice - atrEst * 2; }
    var t = ts();
    var l = 0;
    if (t) { var r = t.getVisibleLogicalRange(); if (r) l = (r.from + r.to) / 2; }
    commit({ type: 'position', dir: dir, entry: midPrice, sl: sl, tp: tp, l: l });
    ppRefresh();
  }

  // ===== expose toggle for icon toolbar =====
  function openPositionPanel() {
    ensurePositionPanel();
    ppRefresh();
  }

  // expose
  window.NTDraw = {
    toggle: toggle,
    onSymbolChanged: onSymbolChanged,
    redraw: scheduleDraw,
    ensure: ensureDom,
    openPositionPanel: openPositionPanel
  };
})();
