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

  // ---- SVG icon set (TradingView-style line art, 24x24, uses currentColor) ----
  function svg(inner) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round" stroke-linejoin="round" width="20" height="20">' + inner + '</svg>';
  }
  var ICONS = {
    off:     svg('<path d="M12 3v5M12 16v5M3 12h5M16 12h5"/><circle cx="12" cy="12" r="2.2"/>'),
    select:  svg('<path d="M5 3l5.5 14 2.3-5.9L18.7 9z"/>'),
    trend:   svg('<circle cx="5.5" cy="18.5" r="1.7"/><circle cx="18.5" cy="5.5" r="1.7"/><path d="M6.9 17.1 17.1 6.9"/>'),
    hline:   svg('<circle cx="4.5" cy="12" r="1.6"/><circle cx="19.5" cy="12" r="1.6"/><path d="M7 12h10"/>'),
    vline:   svg('<circle cx="12" cy="4.5" r="1.6"/><circle cx="12" cy="19.5" r="1.6"/><path d="M12 7v10"/>'),
    ray:     svg('<circle cx="4.5" cy="19.5" r="1.6"/><path d="M6 18 19 5"/><path d="M14.5 5H19v4.5"/>'),
    rect:    svg('<rect x="4" y="6.5" width="16" height="11" rx="1"/>'),
    ellipse: svg('<ellipse cx="12" cy="12" rx="8" ry="6.5"/>'),
    arrow:   svg('<path d="M5 19 18.5 5.5"/><path d="M10.5 5.5H18.5V13.5"/>'),
    text:    svg('<path d="M5 6.5V5h14v1.5M12 5v14M9.5 19h5"/>'),
    brush:   svg('<path d="M4 20c0-2 1-3 3-3 1.5 0 2 1 2 2 0 1.4-1.6 1.8-3 1.8"/><path d="M9 17 18.6 7.4a1.7 1.7 0 0 0-2.4-2.4L6.6 14.6"/>'),
    fib:     svg('<path d="M4 5h16M4 19h16"/><path d="M4 9.5h16M4 14.5h16" opacity=".55"/><path d="M4 12h16" stroke-dasharray="2.2 2.2"/>'),
    gann:    svg('<path d="M4.5 19.5 20 19.5M4.5 19.5 20 13M4.5 19.5 20 6.5M4.5 19.5 13 4M4.5 19.5 4.5 4"/>'),
    gannbox: svg('<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 20 20 4" opacity=".7"/><path d="M12 4v16M4 12h16" opacity=".45"/>'),
    gannsq:  svg('<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 4 20 20M20 4 4 20" opacity=".7"/>'),
    gannfix: svg('<circle cx="12" cy="12" r="8"/><path d="M12 4v16M4 12h16M6.3 6.3 17.7 17.7M17.7 6.3 6.3 17.7" opacity=".55"/>'),
    long:    svg('<rect x="4" y="15" width="16" height="5" rx="1"/><path d="M12 12V4M8.5 7.5 12 4l3.5 3.5"/>'),
    short:   svg('<rect x="4" y="4" width="16" height="5" rx="1"/><path d="M12 12v8M8.5 16.5 12 20l3.5-3.5"/>'),
    clear:   svg('<path d="M5 7h14M9.5 7V4.8h5V7M7 7l1 12.2h8L17 7"/>'),
  };

  // ---- tool definitions for the toolbar ----
  // Grouped + separated (thin divider lines) to match the TradingView-style
  // vertical drawing toolbar layout: cursor modes / line tools / shapes /
  // text & freehand / fibonacci / gann tools / trade rulers / clear-all.
  var TOOLS = [
    { id: 'off',      icon: ICONS.off,     tip: 'ניווט בגרף' },
    { id: 'select',   icon: ICONS.select,  tip: 'בחירה / עריכה' },
    { sep: true },
    { id: 'trend',    icon: ICONS.trend,   tip: 'קו מגמה' },
    { id: 'hline',    icon: ICONS.hline,   tip: 'קו אופקי' },
    { id: 'vline',    icon: ICONS.vline,   tip: 'קו אנכי' },
    { id: 'ray',      icon: ICONS.ray,     tip: 'קרן' },
    { sep: true },
    { id: 'rect',     icon: ICONS.rect,    tip: 'מלבן' },
    { id: 'ellipse',  icon: ICONS.ellipse, tip: 'עיגול / אליפסה' },
    { id: 'arrow',    icon: ICONS.arrow,   tip: 'חץ' },
    { sep: true },
    { id: 'text',     icon: ICONS.text,    tip: 'טקסט' },
    { id: 'brush',    icon: ICONS.brush,   tip: 'ציור חופשי' },
    { sep: true },
    { id: 'fib',      icon: ICONS.fib,     tip: 'פיבונאצ׳י' },
    { sep: true },
    { id: 'gann',     icon: ICONS.gann,    tip: 'מניפת גאן (Gann Fan)' },
    { id: 'gannbox',  icon: ICONS.gannbox, tip: 'תיבת גאן (Gann Box)' },
    { id: 'gannsq',   icon: ICONS.gannsq,  tip: 'ריבוע גאן (Gann Square)' },
    { id: 'gannfix',  icon: ICONS.gannfix, tip: 'ריבוע גאן קבוע (Square Fixed)' },
    { sep: true },
    { id: 'long',     icon: ICONS.long,    tip: 'סרגל עסקה לונג' },
    { id: 'short',    icon: ICONS.short,   tip: 'סרגל עסקה שורט' },
    { sep: true },
    { id: 'clear',    icon: ICONS.clear,   tip: 'מחק הכל' },
  ];

  // Gann fan angles as [time, price] ratios relative to the 1x1 line
  var GANN_RATIOS = [[1,8],[1,4],[1,3],[1,2],[1,1],[2,1],[3,1],[4,1],[8,1]];
  // Gann box/square internal grid levels
  var GANN_LEVELS = [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1];

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
    var headHtml =
      '<div class="dt-head">' +
        '<button class="dt-ctl dt-grip" title="גרור סרגל (מצב צף)">' +
          svg('<circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/>') +
        '</button>' +
        '<button class="dt-ctl dt-float" title="סרגל צף / מעוגן">' +
          svg('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6v6"/>') +
        '</button>' +
        '<button class="dt-ctl dt-hide" title="הסתר סרגל">' +
          svg('<path d="M6 6 18 18M18 6 6 18"/>') +
        '</button>' +
      '</div>';
    toolbar.innerHTML = headHtml + TOOLS.map(function (t) {
      if (t.sep) return '<span class="dt-sep"></span>';
      return '<button class="dt-btn" data-tool="' + t.id + '" title="' + t.tip + '">' +
        '<span class="dt-ic">' + t.icon + '</span><span class="dt-tip">' + t.tip + '</span></button>';
    }).join('');
    wrap.appendChild(toolbar);
    toolbar.addEventListener('click', function (e) {
      var b = e.target.closest('.dt-btn'); if (!b) return;
      pickTool(b.getAttribute('data-tool'));
    });
    // Header controls: float toggle, hide, and drag handle
    toolbar.querySelector('.dt-float').addEventListener('click', function () { toggleFloating(); });
    toolbar.querySelector('.dt-hide').addEventListener('click', function () { hideToolbar(); });
    initToolbarDrag();

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

    // Click-through handler: catch clicks on position shapes even in 'off' mode
    // Since canvas has pointer-events:none in off mode, clicks land on the wrap/chart.
    // We listen on the wrap in capture phase to detect hits on position shapes.
    wrap.addEventListener('mousedown', function(ev) {
      if (mode !== 'off') return; // already handled by canvas onDown
      var rect = canvas.getBoundingClientRect();
      var px = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
      var posHit = topShapeAt(px);
      if (posHit && posHit.type === 'position') {
        selectedId = posHit.id;
        showActionBar(posHit);
        ppRefresh();
        scheduleDraw();
        ev.stopPropagation();
        ev.preventDefault();
      }
    }, true);

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

  // ===== floating / draggable / hideable toolbar =====
  var floating = false;
  var showLauncher = null;

  function isFloating() { return floating; }

  function toggleFloating() {
    if (!toolbar) return;
    floating = !floating;
    if (floating) {
      // Detach from the fixed left rail → free-floating movable panel.
      document.body.classList.add('draw-float');
      toolbar.classList.add('floating');
      var savedPos = null;
      try { savedPos = JSON.parse(localStorage.getItem('nt_drawtb_pos') || 'null'); } catch (e) {}
      var left = savedPos && savedPos.left != null ? savedPos.left : 70;
      var top  = savedPos && savedPos.top  != null ? savedPos.top  : 90;
      left = Math.max(4, Math.min(window.innerWidth - 60, left));
      top  = Math.max(48, Math.min(window.innerHeight - 80, top));
      toolbar.style.left = left + 'px';
      toolbar.style.top = top + 'px';
    } else {
      document.body.classList.remove('draw-float');
      toolbar.classList.remove('floating');
      toolbar.style.left = '';
      toolbar.style.top = '';
    }
    try { localStorage.setItem('nt_drawtb_float', floating ? '1' : '0'); } catch (e) {}
    setActiveBtn(mode);
  }

  function hideToolbar() {
    if (!toolbar) return;
    toolbar.style.display = 'none';
    document.body.classList.add('draw-hidden');
    ensureLauncher();
    showLauncher.style.display = 'flex';
    try { localStorage.setItem('nt_drawtb_hidden', '1'); } catch (e) {}
  }

  function showToolbar() {
    if (!toolbar) return;
    toolbar.style.display = 'flex';
    document.body.classList.remove('draw-hidden');
    if (showLauncher) showLauncher.style.display = 'none';
    try { localStorage.setItem('nt_drawtb_hidden', '0'); } catch (e) {}
  }

  function ensureLauncher() {
    if (showLauncher) return;
    var b = document.createElement('button');
    b.id = 'drawToolLauncher';
    b.title = 'הצג סרגל כלים';
    b.innerHTML = svg('<path d="M4 20l3-.8L18.7 7.5a1.8 1.8 0 0 0-2.5-2.5L4.6 16.8z"/><path d="M14.5 6.8l2.7 2.7"/>');
    b.style.display = 'none';
    b.addEventListener('click', showToolbar);
    document.body.appendChild(b);
    showLauncher = b;
  }

  function initToolbarDrag() {
    var grip = toolbar.querySelector('.dt-grip');
    if (!grip) return;
    var dragging = false, offX = 0, offY = 0;
    function start(e) {
      // Dragging only makes sense in floating mode; a single click enables it.
      if (!floating) { toggleFloating(); }
      dragging = true;
      var cx = e.touches ? e.touches[0].clientX : e.clientX;
      var cy = e.touches ? e.touches[0].clientY : e.clientY;
      var r = toolbar.getBoundingClientRect();
      offX = cx - r.left; offY = cy - r.top;
      e.preventDefault();
    }
    function move(e) {
      if (!dragging) return;
      var cx = e.touches ? e.touches[0].clientX : e.clientX;
      var cy = e.touches ? e.touches[0].clientY : e.clientY;
      var left = Math.max(4, Math.min(window.innerWidth - 54, cx - offX));
      var top  = Math.max(46, Math.min(window.innerHeight - 60, cy - offY));
      toolbar.style.left = left + 'px';
      toolbar.style.top = top + 'px';
    }
    function end() {
      if (!dragging) return;
      dragging = false;
      try {
        localStorage.setItem('nt_drawtb_pos', JSON.stringify({
          left: parseInt(toolbar.style.left, 10), top: parseInt(toolbar.style.top, 10)
        }));
      } catch (e) {}
    }
    grip.addEventListener('mousedown', start);
    grip.addEventListener('touchstart', start, { passive: false });
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('mouseup', end);
    window.addEventListener('touchend', end);

    // Restore persisted float / hidden state
    try {
      if (localStorage.getItem('nt_drawtb_float') === '1') toggleFloating();
      if (localStorage.getItem('nt_drawtb_hidden') === '1') hideToolbar();
    } catch (e) {}
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
    } else if (s.type === 'gann') {
      drawGannFan(s, selected);
    } else if (s.type === 'gannbox' || s.type === 'gannsq' || s.type === 'gannfix') {
      drawGannBox(s, selected);
    } else if (s.type === 'position') {
      drawPositionTV(s, selected);
    }
    ctx.restore();
  }

  // ===== Gann Fan — lines radiating from pivot a at Gann angles (1x1 defined by a→b) =====
  function drawGannFan(s, selected) {
    var a = pt(s.a), b = pt(s.b); if (!a || !b) return;
    var W = canvas.clientWidth, H = canvas.clientHeight;
    var bdx = b.x - a.x, bdy = b.y - a.y;
    if (bdx === 0 && bdy === 0) return;
    GANN_RATIOS.forEach(function (r) {
      var dirx = bdx * r[0], diry = bdy * r[1];
      if (dirx === 0 && diry === 0) return;
      var end = extend(a, { x: a.x + dirx, y: a.y + diry }, W, H);
      var is11 = (r[0] === 1 && r[1] === 1);
      ctx.globalAlpha = is11 ? 1 : 0.5;
      ctx.lineWidth = is11 ? (s.width || 2) + 0.6 : (s.width || 2);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(end.x, end.y); ctx.stroke();
      // ratio label near the pivot
      if (Math.abs(dirx) > 24 || Math.abs(diry) > 24) {
        var lx = a.x + dirx * 0.18, ly = a.y + diry * 0.18;
        ctx.globalAlpha = 0.8; ctx.font = '600 9px Heebo, sans-serif';
        ctx.textBaseline = 'middle'; ctx.fillText(r[1] + 'x' + r[0], lx, ly);
      }
    });
    ctx.globalAlpha = 1;
    if (selected) { handleAt(a.x, a.y); handleAt(b.x, b.y); }
  }

  // ===== Gann Box / Square / Square-Fixed — grid + diagonals across the a→b box =====
  function drawGannBox(s, selected) {
    var a = pt(s.a), b = pt(s.b); if (!a || !b) return;
    var x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
    var x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    var w = x1 - x0, h = y1 - y0;
    if (w < 2 || h < 2) { if (selected) { handleAt(a.x, a.y); handleAt(b.x, b.y); } return; }

    // outer border
    ctx.globalAlpha = 1; ctx.lineWidth = s.width || 2;
    ctx.strokeRect(x0, y0, w, h);

    // internal grid at Gann levels
    ctx.globalAlpha = 0.28; ctx.lineWidth = 1;
    GANN_LEVELS.forEach(function (lv) {
      if (lv === 0 || lv === 1) return;
      var gx = x0 + w * lv, gy = y0 + h * lv;
      ctx.beginPath(); ctx.moveTo(gx, y0); ctx.lineTo(gx, y1); ctx.stroke(); // vertical
      ctx.beginPath(); ctx.moveTo(x0, gy); ctx.lineTo(x1, gy); ctx.stroke(); // horizontal
    });

    // diagonals
    ctx.globalAlpha = 0.7; ctx.lineWidth = (s.width || 2);
    ctx.beginPath(); ctx.moveTo(x0, y1); ctx.lineTo(x1, y0); ctx.stroke(); // ↗ 1x1
    if (s.type === 'gannsq' || s.type === 'gannfix') {
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); // ↘
    }
    // square-fixed adds an inscribed ellipse (circle-in-square Gann geometry)
    if (s.type === 'gannfix') {
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (selected) { handleAt(a.x, a.y); handleAt(b.x, b.y); handleAt(a.x, b.y); handleAt(b.x, a.y); }
  }

  // ===== TradingView-style Position Tool =====
  function drawPositionTV(s, selected) {
    var yE = pToY(s.entry), ySL = pToY(s.sl), yTP = pToY(s.tp);
    if (yE == null || ySL == null || yTP == null) { return; }
    var anchorX = lToX(s.l);
    if (anchorX == null) { return; }
    var boxW = s.pxW || 100;
    var x1 = anchorX;
    var x2 = anchorX + boxW;
    if (s.l1 != null && s.l2 != null) {
      var xl = lToX(s.l1), xr = lToX(s.l2);
      if (xl != null && xr != null) { x1 = Math.min(xl, xr); x2 = Math.max(xl, xr); boxW = x2 - x1; }
    }
    if (boxW < 20) { x2 = x1 + 100; boxW = 100; }
    var isLong = s.dir === 'long';
    var qty = s.qty || 1;
    var R = 6;
    var LABEL_GREEN = '#1e7d3a';
    var LABEL_RED   = '#b32828';
    var tpCol = s.tpColor || '#1e7d3a';
    var slCol = s.slColor || '#b32828';
    var tpOpa = s.tpOpacity != null ? s.tpOpacity : 0.55;
    var slOpa = s.slOpacity != null ? s.slOpacity : 0.55;

    // ---- Profit zone (clean — no labels inside) ----
    var tpTop = Math.min(yE, yTP), tpBot = Math.max(yE, yTP);
    ctx.save();
    ctx.globalAlpha = tpOpa;
    ctx.fillStyle = tpCol;
    roundRect(ctx, x1, tpTop, boxW, tpBot - tpTop, isLong ? {tl:0,tr:0,bl:0,br:0} : {tl:0,tr:0,bl:R,br:R});
    ctx.fill();
    ctx.globalAlpha = 1;

    // ---- Loss zone (clean — no labels inside) ----
    var slTop = Math.min(yE, ySL), slBot = Math.max(yE, ySL);
    ctx.globalAlpha = slOpa;
    ctx.fillStyle = slCol;
    roundRect(ctx, x1, slTop, boxW, slBot - slTop, isLong ? {tl:0,tr:0,bl:R,br:R} : {tl:0,tr:0,bl:0,br:0});
    ctx.fill();
    ctx.globalAlpha = 1;

    // ---- Border outline ----
    var totalTop = Math.min(tpTop, slTop), totalBot = Math.max(tpBot, slBot);
    ctx.strokeStyle = isLong ? LABEL_GREEN : LABEL_RED;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    roundRect(ctx, x1, totalTop, boxW, totalBot - totalTop, {tl:0,tr:0,bl:R,br:R});
    ctx.stroke();

    // ---- Entry line ----
    ctx.strokeStyle = '#e8d43a';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x1, yE); ctx.lineTo(x2, yE); ctx.stroke();

    // ---- TP line ----
    ctx.strokeStyle = LABEL_GREEN; ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(x1, yTP); ctx.lineTo(x2, yTP); ctx.stroke();

    // ---- SL line ----
    ctx.strokeStyle = LABEL_RED;
    ctx.beginPath(); ctx.moveTo(x1, ySL); ctx.lineTo(x2, ySL); ctx.stroke();
    ctx.setLineDash([]);

    // ---- Calculations ----
    var rewardDelta = Math.abs(s.tp - s.entry);
    var riskDelta   = Math.abs(s.sl - s.entry);
    var profitPct = (rewardDelta / s.entry * 100);
    var lossPct   = (riskDelta / s.entry * 100);
    var profitAbs = rewardDelta * qty;
    var lossAbs   = riskDelta * qty;
    var rewardPts = rewardDelta * 100;
    var riskPts   = riskDelta * 100;
    var rr = riskDelta > 0 ? (rewardDelta / riskDelta).toFixed(2) : '∞';
    var livePrice = (window.priceCache && window.priceCache[window.currentSymbol]) ? window.priceCache[window.currentSymbol].price : s.entry;
    var openPnl = (livePrice - s.entry) * (isLong ? 1 : -1);

    // ---- TARGET label bar — solid green, attached to top of profit zone ----
    var targetBoxH = 22;
    var targetBoxY = tpTop - targetBoxH;
    ctx.fillStyle = LABEL_GREEN;
    roundRect(ctx, x1, targetBoxY, boxW, targetBoxH, {tl:6,tr:6,bl:0,br:0});
    ctx.fill();
    ctx.font = '700 10px Heebo, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var targetText = 'Target: ' + rewardDelta.toFixed(5) + ' (' + profitPct.toFixed(3) + '%) ' + rewardPts.toFixed(1) + ', Amount: ' + profitAbs.toFixed(2);
    ctx.fillText(targetText, x1 + boxW / 2, targetBoxY + targetBoxH / 2);

    // ---- OPEN PNL label — solid red, straddling the entry line ----
    var pnlBoxH = 30;
    var pnlBoxY = yE - pnlBoxH / 2;
    ctx.fillStyle = LABEL_RED;
    roundRect(ctx, x1, pnlBoxY, boxW, pnlBoxH, {tl:4,tr:4,bl:4,br:4});
    ctx.fill();
    ctx.font = '700 10px Heebo, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var pnlLine1 = 'Open PnL: ' + (openPnl >= 0 ? '' : '-') + Math.abs(openPnl).toFixed(5) + ', Qty: ' + qty;
    var pnlLine2 = 'Risk/reward ratio: ' + rr;
    ctx.fillText(pnlLine1, x1 + boxW / 2, pnlBoxY + pnlBoxH * 0.32);
    ctx.fillText(pnlLine2, x1 + boxW / 2, pnlBoxY + pnlBoxH * 0.72);

    // ---- STOP label bar — solid red, attached to bottom of loss zone ----
    var stopBoxH = 22;
    var stopBoxY = slBot;
    ctx.fillStyle = LABEL_RED;
    roundRect(ctx, x1, stopBoxY, boxW, stopBoxH, {tl:0,tr:0,bl:6,br:6});
    ctx.fill();
    ctx.font = '700 10px Heebo, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var stopText = 'Stop: ' + riskDelta.toFixed(5) + ' (' + lossPct.toFixed(3) + '%) ' + riskPts.toFixed(1) + ', Amount: ' + lossAbs.toFixed(2);
    ctx.fillText(stopText, x1 + boxW / 2, stopBoxY + stopBoxH / 2);
    ctx.textAlign = 'left';

    // ---- Price labels on right edge (like TradingView price scale) ----
    drawPriceTag(x2, yTP, fmtPrice(s.tp), LABEL_GREEN);
    drawPriceTag(x2, ySL, fmtPrice(s.sl), LABEL_RED);
    drawPriceTag(x2, yE, fmtPrice(s.entry), '#e8d43a');

    // ---- Selection handles ----
    if (selected) {
      var midX = x1 + boxW / 2;
      // Corner handles on target/stop label boxes
      handleAt(x1, targetBoxY);
      handleAt(x2, stopBoxY + stopBoxH);
      // Horizontal drag handles on each line (mid-point)
      handleAt(midX, yE);
      handleAt(midX, yTP);
      handleAt(midX, ySL);
      // Left/right edge handles for width
      handleAt(x1, yE);
      handleAt(x2, yE);
    }

    ctx.restore();
  }

  function drawPriceTag(x, y, text, color) {
    ctx.save();
    ctx.font = '600 10px Heebo, sans-serif';
    var tw = ctx.measureText(text).width;
    var pad = 5, h = 18, arrowW = 6;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + arrowW, y - h / 2);
    ctx.lineTo(x + arrowW + tw + pad * 2, y - h / 2);
    ctx.lineTo(x + arrowW + tw + pad * 2, y + h / 2);
    ctx.lineTo(x + arrowW, y + h / 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + arrowW + pad, y);
    ctx.restore();
  }

  function roundRect(ctx2, x, y, w, h, radii) {
    var r = radii || {tl:0,tr:0,bl:0,br:0};
    ctx2.beginPath();
    ctx2.moveTo(x + r.tl, y);
    ctx2.lineTo(x + w - r.tr, y);
    ctx2.quadraticCurveTo(x + w, y, x + w, y + r.tr);
    ctx2.lineTo(x + w, y + h - r.br);
    ctx2.quadraticCurveTo(x + w, y + h, x + w - r.br, y + h);
    ctx2.lineTo(x + r.bl, y + h);
    ctx2.quadraticCurveTo(x, y + h, x, y + h - r.bl);
    ctx2.lineTo(x, y + r.tl);
    ctx2.quadraticCurveTo(x, y, x + r.tl, y);
    ctx2.closePath();
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
    var px = relPos(e);

    if (mode === 'off') return;

    if (mode === 'select') {
      // first: hit a handle of the selected shape (resize)?
      var sel = shapeById(selectedId);
      if (sel) {
        var hk = handleHit(sel, px);
        if (hk && !(sel.type === 'position' && posLocked)) { dragState = { kind: 'resize', id: sel.id, handle: hk, start: px }; e.preventDefault(); return; }
      }
      // else: hit any shape (select + move)
      var hit = topShapeAt(px);
      if (hit) {
        selectedId = hit.id;
        showActionBar(hit);
        if (hit.type === 'position') {
          ppRefresh(); // open position panel on click
        }
        if (!(hit.type === 'position' && posLocked)) {
          dragState = { kind: 'move', id: hit.id, start: px, orig: clone(hit) };
        }
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
      // Calculate TP/SL so each zone is 50px tall (total 100x100 square)
      var yClick = pToY(entry);
      var tp50 = yToP(yClick - 50); // 50px above for TP (long) 
      var sl50 = yToP(yClick + 50); // 50px below for SL (long)
      var sl, tp;
      if (mode === 'long') { tp = tp50 != null ? tp50 : entry * 1.02; sl = sl50 != null ? sl50 : entry * 0.98; }
      else { tp = sl50 != null ? sl50 : entry * 0.98; sl = tp50 != null ? tp50 : entry * 1.02; }
      commit({ type: 'position', dir: mode, entry: entry, sl: sl, tp: tp, l: a.l, pxW: 100, qty: 1 });
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
    else if (s.type === 'position') { s.entry = orig.entry + dp; s.sl = orig.sl + dp; s.tp = orig.tp + dp; s.l = (orig.l || 0) + dl; s.l1 = (orig.l1 != null ? orig.l1 : orig.l) + dl; s.l2 = (orig.l2 != null ? orig.l2 : (orig.l || 0) + 40) + dl; }
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
      else if (handle === 'pl') { s.l1 = a.l; } // left edge
      else if (handle === 'pr') { s.l2 = a.l; } // right edge
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
      var px1 = lToX(s.l1 != null ? s.l1 : s.l);
      var px2 = lToX(s.l2 != null ? s.l2 : (s.l || 0) + 40);
      if (px1 == null || px2 == null) return false;
      if (px1 > px2) { var t2 = px1; px1 = px2; px2 = t2; }
      // Inside bounding box?
      var topP = Math.min(yE, ySL, yTP), botP = Math.max(yE, ySL, yTP);
      if (px.x >= px1 - HIT && px.x <= px2 + HIT && px.y >= topP - HIT && px.y <= botP + HIT) return true;
      return false;
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
    if (s.type === 'gann') {
      var gbdx = b.x - a.x, gbdy = b.y - a.y;
      if (gbdx === 0 && gbdy === 0) return false;
      for (var gi = 0; gi < GANN_RATIOS.length; gi++) {
        var gr = GANN_RATIOS[gi];
        var gend = extend(a, { x: a.x + gbdx * gr[0], y: a.y + gbdy * gr[1] }, canvas.clientWidth, canvas.clientHeight);
        if (distToSeg(px, a, gend) <= HIT) return true;
      }
      return false;
    }
    if (s.type === 'gannbox' || s.type === 'gannsq' || s.type === 'gannfix') {
      var gx0 = Math.min(a.x, b.x), gy0 = Math.min(a.y, b.y), gx1 = Math.max(a.x, b.x), gy1 = Math.max(a.y, b.y);
      var gNearV = (Math.abs(px.x - gx0) <= HIT || Math.abs(px.x - gx1) <= HIT) && px.y >= gy0 - HIT && px.y <= gy1 + HIT;
      var gNearH = (Math.abs(px.y - gy0) <= HIT || Math.abs(px.y - gy1) <= HIT) && px.x >= gx0 - HIT && px.x <= gx1 + HIT;
      var gInside = px.x >= gx0 && px.x <= gx1 && px.y >= gy0 && px.y <= gy1;
      return gNearV || gNearH || gInside;
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
      var pxL = lToX(s.l1 != null ? s.l1 : s.l);
      var pxR = lToX(s.l2 != null ? s.l2 : (s.l || 0) + 40);
      if (pxL != null && pxR != null) {
        if (pxL > pxR) { var tt = pxL; pxL = pxR; pxR = tt; }
        var midXP = (pxL + pxR) / 2;
        var yE2 = pToY(s.entry), ySL2 = pToY(s.sl), yTP2 = pToY(s.tp);
        if (yE2 != null) out.push({ x: midXP, y: yE2, k: 'entry' });
        if (ySL2 != null) out.push({ x: midXP, y: ySL2, k: 'sl' });
        if (yTP2 != null) out.push({ x: midXP, y: yTP2, k: 'tp' });
        if (yE2 != null) out.push({ x: pxL, y: yE2, k: 'pl' }); // left edge
        if (yE2 != null) out.push({ x: pxR, y: yE2, k: 'pr' }); // right edge
      }
      return out;
    }
    var a = pt(s.a), b = pt(s.b); if (!a || !b) return out;
    out.push({ x: a.x, y: a.y, k: 'a' });
    out.push({ x: b.x, y: b.y, k: 'b' });
    if (s.type === 'rect' || s.type === 'gannbox' || s.type === 'gannsq' || s.type === 'gannfix') { out.push({ x: a.x, y: b.y, k: 'ab' }); out.push({ x: b.x, y: a.y, k: 'ba' }); }
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
    if (s.type === 'position') {
      var y2 = pToY(s.entry);
      var px1b = lToX(s.l1 != null ? s.l1 : s.l);
      var px2b = lToX(s.l2 != null ? s.l2 : (s.l || 0) + 40);
      var midXB = (px1b != null && px2b != null) ? (px1b + px2b) / 2 : canvas.clientWidth / 2;
      return y2 == null ? null : { x: midXB, y: y2 };
    }
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

    // Inner wrapper clips content; outer keeps overflow:visible for resize handles
    var inner = document.createElement('div');
    inner.id = 'pp-inner';

    var hdr = document.createElement('div');
    hdr.id = 'pp-header';
    hdr.innerHTML = '<span id="pp-title">📊 סרגל עסקה</span><button id="pp-close">✕</button>';
    inner.appendChild(hdr);

    var cnt = document.createElement('div');
    cnt.id = 'pp-content';
    inner.appendChild(cnt);

    var act = document.createElement('div');
    act.id = 'pp-actions';
    act.innerHTML = '<button class="pp-add-long">▲ Long</button><button class="pp-add-short">▼ Short</button>';
    inner.appendChild(act);

    div.appendChild(inner);

    // ── 8 custom resize handles (replaces CSS resize:both) ──
    ['n','ne','e','se','s','sw','w','nw'].forEach(function(d) {
      var h = document.createElement('div');
      h.className = 'pp-rh pp-rh-' + d;
      h.setAttribute('data-dir', d);
      div.appendChild(h);
      h.addEventListener('mousedown', ppBeginResize);
      h.addEventListener('touchstart', ppBeginResize, { passive: false });
    });

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

  function ppBeginResize(e) {
    e.preventDefault(); e.stopPropagation();
    var dir = e.currentTarget.getAttribute('data-dir');
    var rect = posPanel.getBoundingClientRect();
    var startX = e.touches ? e.touches[0].clientX : e.clientX;
    var startY = e.touches ? e.touches[0].clientY : e.clientY;
    var origL = rect.left, origT = rect.top, origW = rect.width, origH = rect.height;

    function onMove(ev) {
      var nx = ev.touches ? ev.touches[0].clientX : ev.clientX;
      var ny = ev.touches ? ev.touches[0].clientY : ev.clientY;
      var dx = nx - startX, dy = ny - startY;
      var newL = origL, newT = origT, newW = origW, newH = origH;
      var MIN_W = 190, MIN_H = 120;

      if (dir.indexOf('e') !== -1) newW = Math.max(MIN_W, origW + dx);
      if (dir.indexOf('w') !== -1) {
        newW = Math.max(MIN_W, origW - dx);
        newL = origL + (origW - newW);
      }
      if (dir.indexOf('s') !== -1) newH = Math.max(MIN_H, origH + dy);
      if (dir.indexOf('n') !== -1) {
        newH = Math.max(MIN_H, origH - dy);
        newT = origT + (origH - newH);
      }

      posPanel.style.left   = newL + 'px';
      posPanel.style.top    = newT + 'px';
      posPanel.style.width  = newW + 'px';
      posPanel.style.height = newH + 'px';
      posPanel.style.right  = 'auto';
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
        var profitPct = ((s.tp - s.entry) / s.entry * 100);
        var lossPct = ((s.sl - s.entry) / s.entry * 100);
        var id = s.id;
        return '<div class="pp-pos" data-id="' + id + '">' +
          '<div class="pp-pos-hdr">' +
          '<span class="pp-dir ' + (isLong ? 'pp-long' : 'pp-short') + '">' + (isLong ? '▲ LONG' : '▼ SHORT') + '</span>' +
          '<span class="pp-sym">' + (window.currentSymbol || '') + '</span>' +
          '<button class="pp-del" data-del="' + id + '">🗑</button>' +
          '</div>' +
          '<div class="pp-row"><label>כניסה</label>' +
          '<input type="number" data-pid="' + id + '" data-f="entry" value="' + s.entry.toFixed(2) + '" step="any" /></div>' +
          '<div class="pp-row pp-row-tp"><label>יעד</label>' +
          '<input type="number" data-pid="' + id + '" data-f="tp" value="' + s.tp.toFixed(2) + '" step="any" />' +
          '<span style="color:#26a69a;font-size:.66rem;width:44px;text-align:left">' + (profitPct >= 0 ? '+' : '') + profitPct.toFixed(1) + '%</span></div>' +
          '<div class="pp-row pp-row-sl"><label>סטופ</label>' +
          '<input type="number" data-pid="' + id + '" data-f="sl" value="' + s.sl.toFixed(2) + '" step="any" />' +
          '<span style="color:#ef5350;font-size:.66rem;width:44px;text-align:left">' + lossPct.toFixed(1) + '%</span></div>' +
          '<div class="pp-row"><label>כמות</label>' +
          '<input type="number" data-pid="' + id + '" data-f="qty" value="' + (s.qty || 1) + '" step="1" min="1" /></div>' +
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
          if (field === 'qty') { sh.qty = Math.max(1, Math.round(val)); }
          else { sh[field] = val; }
          save(); scheduleDraw();
          // Debounced full refresh for R:R + % recalc
          clearTimeout(inp._ppTimer);
          inp._ppTimer = setTimeout(function() { ppRefresh(); }, 400);
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
    var yMid = pToY(midPrice);
    var tp50 = yToP(yMid - 50);
    var sl50 = yToP(yMid + 50);
    var sl, tp;
    if (dir === 'long') { tp = tp50 || midPrice * 1.02; sl = sl50 || midPrice * 0.98; }
    else { tp = sl50 || midPrice * 0.98; sl = tp50 || midPrice * 1.02; }
    var t = ts();
    var l = 0;
    if (t) { var r = t.getVisibleLogicalRange(); if (r) l = Math.round((r.from + r.to) / 2); }
    commit({ type: 'position', dir: dir, entry: midPrice, sl: sl, tp: tp, l: l, pxW: 100, qty: 1 });
    ppRefresh();
  }

  // Add a long/short position box at a specific price (used by the chart "+" quick menu).
  function addPositionAtPrice(dir, price) {
    if (!price || !isFinite(price)) return;
    ensureDom();
    var yMid = pToY(price);
    var tp50 = yMid != null ? yToP(yMid - 50) : null;
    var sl50 = yMid != null ? yToP(yMid + 50) : null;
    var sl, tp;
    if (dir === 'long') { tp = tp50 || price * 1.02; sl = sl50 || price * 0.98; }
    else { tp = sl50 || price * 0.98; sl = tp50 || price * 1.02; }
    var t = ts();
    var l = 0;
    if (t) { var r = t.getVisibleLogicalRange(); if (r) l = Math.round((r.from + r.to) / 2); }
    commit({ type: 'position', dir: dir, entry: price, sl: sl, tp: tp, l: l, pxW: 100, qty: 1 });
    ppRefresh();
  }

  // Add a horizontal line at a specific price (used by the chart "+" quick menu).
  function addHLine(price) {
    if (!price || !isFinite(price)) return;
    ensureDom();
    commit({ type: 'hline', p: price });
  }

  // Count of current drawings / clear-all (used by the chart right-click menu).
  function shapeCount() { return shapes.length; }
  function clearAllShapes() {
    shapes = []; selectedId = null; save(); hideActionBar(); scheduleDraw();
  }

  // ===== expose toggle for icon toolbar =====
  function openPositionPanel() {
    ensurePositionPanel();
    ppRefresh();
  }

  // ===== POSITION ACTION BAR (trash, lock, color pickers) =====
  var PAB_COLORS = [
    '#ef5350','#e53935','#c62828','#b71c1c','#d32f2f','#f44336','#ff5252','#ff1744',
    '#ff8a80','#ffcdd2','#e57373','#ef9a9a','#f48fb1','#f06292','#ec407a','#e91e63',
    '#ad1457','#880e4f','#ce93d8','#ba68c8','#ab47bc','#9c27b0','#7b1fa2','#6a1b9a',
    '#9575cd','#7e57c2','#673ab7','#512da8','#4527a0','#311b92','#7986cb','#5c6bc0',
    '#3f51b5','#3949ab','#283593','#1a237e','#64b5f6','#42a5f5','#2196f3','#1e88e5',
    '#1565c0','#0d47a1','#4fc3f7','#29b6f6','#03a9f4','#039be5','#0277bd','#01579b',
    '#4dd0e1','#26c6da','#00bcd4','#00acc1','#00838f','#006064','#80cbc4','#4db6ac',
    '#26a69a','#009688','#00796b','#004d40','#a5d6a7','#81c784','#66bb6a','#4caf50',
    '#388e3c','#1b5e20','#c5e1a5','#aed581','#8bc34a','#7cb342','#558b2f','#33691e',
    '#fff176','#ffee58','#ffeb3b','#fdd835','#f9a825','#f57f17','#ffcc80','#ffb74d',
    '#ffa726','#ff9800','#f57c00','#e65100','#ffffff','#bdbdbd','#757575','#212121'
  ];
  var posLocked = false;
  var posSLColor = '#ef5350', posTPColor = '#26a69a';
  var posSLOpacity = 22, posTPOpacity = 22;

  function initPosActionBar() {
    var bar = document.getElementById('posActionBar');
    if (!bar) return;
    // Trash
    document.getElementById('pabTrash').addEventListener('click', function() {
      if (selectedId != null) {
        var sh = shapeById(selectedId);
        if (sh && sh.type === 'position') { deleteSelected(); bar.classList.remove('open'); }
      }
    });
    // Lock
    document.getElementById('pabLock').addEventListener('click', function() {
      posLocked = !posLocked;
      this.classList.toggle('active', posLocked);
      var svgL = document.getElementById('svgLocked');
      var svgU = document.getElementById('svgUnlocked');
      if (svgL) svgL.style.display = posLocked ? 'none' : '';
      if (svgU) svgU.style.display = posLocked ? '' : 'none';
    });
    // Color pickers
    buildColorGrid('pabColorsSL', function(col, opacity) { posSLColor = col; posSLOpacity = opacity; applyPosColors(); });
    buildColorGrid('pabColorsTP', function(col, opacity) { posTPColor = col; posTPOpacity = opacity; applyPosColors(); });
    // Toggle color panels
    document.getElementById('pabColorSL').addEventListener('click', function(e) {
      e.stopPropagation();
      document.getElementById('pabColorsSL').classList.toggle('open');
      document.getElementById('pabColorsTP').classList.remove('open');
    });
    document.getElementById('pabColorTP').addEventListener('click', function(e) {
      e.stopPropagation();
      document.getElementById('pabColorsTP').classList.toggle('open');
      document.getElementById('pabColorsSL').classList.remove('open');
    });
    // Close color panels on outside click
    document.addEventListener('click', function() {
      document.getElementById('pabColorsSL').classList.remove('open');
      document.getElementById('pabColorsTP').classList.remove('open');
    });
  }

  function buildColorGrid(containerId, onPick) {
    var el = document.getElementById(containerId);
    if (!el) return;
    var html = PAB_COLORS.map(function(c) {
      return '<div class="pab-swatch" data-c="' + c + '" style="background:' + c + '"></div>';
    }).join('');
    html += '<div class="pab-opacity"><span style="font-size:.6rem;color:#aaa">Opacity:</span>' +
      '<input type="range" min="0" max="100" value="22" class="pab-opa-range" />' +
      '<input type="number" min="0" max="100" value="22" class="pab-opa-num" />%</div>';
    el.innerHTML = html;
    var rangeEl = el.querySelector('.pab-opa-range');
    var numEl = el.querySelector('.pab-opa-num');
    var selectedColor = null;
    el.querySelectorAll('.pab-swatch').forEach(function(sw) {
      sw.addEventListener('click', function(e) {
        e.stopPropagation();
        selectedColor = sw.getAttribute('data-c');
        onPick(selectedColor, parseInt(rangeEl.value, 10));
      });
    });
    rangeEl.addEventListener('input', function() {
      numEl.value = this.value;
      if (selectedColor) onPick(selectedColor, parseInt(this.value, 10));
    });
    numEl.addEventListener('input', function() {
      rangeEl.value = this.value;
      if (selectedColor) onPick(selectedColor, parseInt(this.value, 10));
    });
  }

  function applyPosColors() {
    // Apply colors to selected position shape
    var sh = shapeById(selectedId);
    if (!sh || sh.type !== 'position') return;
    sh.slColor = posSLColor;
    sh.tpColor = posTPColor;
    sh.slOpacity = posSLOpacity / 100;
    sh.tpOpacity = posTPOpacity / 100;
    save(); scheduleDraw();
  }

  function showPosActionBar() {
    var bar = document.getElementById('posActionBar');
    if (bar) bar.classList.add('open');
  }
  function hidePosActionBar() {
    var bar = document.getElementById('posActionBar');
    if (bar) bar.classList.remove('open');
  }

  // Override showActionBar to also show pos bar for position shapes
  var _origShowActionBar = showActionBar;
  showActionBar = function(s) {
    if (s && s.type === 'position') {
      // Position shapes: skip the generic drawActionBar, use posActionBar only
      if (actionBar) actionBar.style.display = 'none';
      showPosActionBar();
    } else {
      _origShowActionBar(s);
      hidePosActionBar();
    }
  };
  var _origHideActionBar = hideActionBar;
  hideActionBar = function() {
    _origHideActionBar();
    hidePosActionBar();
  };

  // Init pos action bar after DOM ready
  setTimeout(initPosActionBar, 500);

  // expose
  window.NTDraw = {
    toggle: toggle,
    onSymbolChanged: onSymbolChanged,
    redraw: scheduleDraw,
    ensure: ensureDom,
    openPositionPanel: openPositionPanel,
    addPositionAtPrice: addPositionAtPrice,
    addHLine: addHLine,
    shapeCount: shapeCount,
    clearAllShapes: clearAllShapes,
    toggleFloating: function () { ensureDom(); toggleFloating(); },
    showToolbar: function () { ensureDom(); showToolbar(); },
    hideToolbar: function () { ensureDom(); hideToolbar(); }
  };
})();
