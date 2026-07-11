// ============================================
//   AUTH
// ============================================
console.log('[NexTrade] Loading main.js...');

var USERS_KEY   = 'nt_users';
var SESSION_KEY = 'nt_session';

function getUsers()     { return JSON.parse(localStorage.getItem(USERS_KEY)   || '[]'); }
function getSession()   { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
function saveSession(s) { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }

function switchTab(tab) {
  var tLogin  = document.getElementById('tabLogin');
  var tSignup = document.getElementById('tabSignup');
  var fLogin  = document.getElementById('loginForm');
  var fSignup = document.getElementById('signupForm');
  var fForgot = document.getElementById('forgotForm');
  if (tLogin)  tLogin.classList.toggle('active',  tab === 'login');
  if (tSignup) tSignup.classList.toggle('active', tab === 'signup');
  if (fLogin)  fLogin.classList.toggle('hidden',  tab !== 'login');
  if (fSignup) fSignup.classList.toggle('hidden', tab !== 'signup');
  if (fForgot) fForgot.classList.toggle('hidden', tab !== 'forgot');
  ['loginError','signupError','signupSuccess','forgotError','forgotSuccess'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('show');
  });
}

function toggleEye(inputId, btn) {
  var input = document.getElementById(inputId);
  if (!input) return;
  var isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  var svg = btn.querySelector('svg');
  if (!svg) return;
  if (isHidden) {
    svg.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>';
  } else {
    svg.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
  }
}

function checkStrength(password) {
  var fill = document.getElementById('strengthFill');
  var text = document.getElementById('strengthText');
  if (!fill || !text) return;
  var s = 0;
  if (password.length >= 6)           s++;
  if (password.length >= 10)          s++;
  if (/[A-Z]/.test(password))         s++;
  if (/[0-9]/.test(password))         s++;
  if (/[^A-Za-z0-9]/.test(password)) s++;
  var levels = [
    { w: '0%',   bg: 'transparent', label: '' },
    { w: '25%',  bg: '#ef5350',     label: 'חלשה' },
    { w: '50%',  bg: '#f5a623',     label: 'בינונית' },
    { w: '75%',  bg: '#26a69a',     label: 'חזקה' },
    { w: '100%', bg: '#2962ff',     label: 'חזקה מאוד' }
  ];
  var lvl = levels[Math.min(s, 4)];
  fill.style.width      = lvl.w;
  fill.style.background = lvl.bg;
  text.textContent      = lvl.label;
}

function handleLogin(e) {
  e.preventDefault();
  var email    = document.getElementById('loginEmail').value.trim().toLowerCase();
  var password = document.getElementById('loginPassword').value;
  var errEl    = document.getElementById('loginError');
  errEl.classList.remove('show');
  if (!email || !password) { errEl.textContent = 'נא למלא אימייל וסיסמה'; errEl.classList.add('show'); return; }
  var users = getUsers();
  var user  = users.find(function(u) { return u.email === email && u.password === password; });
  if (!user) { errEl.textContent = 'אימייל או סיסמה שגויים'; errEl.classList.add('show'); document.getElementById('loginPassword').value = ''; return; }
  loginSuccess(user);
}

function handleSignup(e) {
  e.preventDefault();
  var name     = document.getElementById('signupName').value.trim();
  var email    = document.getElementById('signupEmail').value.trim().toLowerCase();
  var password = document.getElementById('signupPassword').value;
  var confirm  = document.getElementById('signupConfirm').value;
  var errEl    = document.getElementById('signupError');
  var sucEl    = document.getElementById('signupSuccess');
  errEl.classList.remove('show'); sucEl.classList.remove('show');
  if (!name || !email || !password || !confirm) { errEl.textContent = 'נא למלא את כל השדות'; errEl.classList.add('show'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { errEl.textContent = 'כתובת אימייל לא תקינה'; errEl.classList.add('show'); return; }
  if (password.length < 6) { errEl.textContent = 'הסיסמה חייבת להכיל לפחות 6 תווים'; errEl.classList.add('show'); return; }
  if (password !== confirm) { errEl.textContent = 'הסיסמאות אינן תואמות'; errEl.classList.add('show'); return; }
  var users = getUsers();
  if (users.find(function(u) { return u.email === email; })) { errEl.textContent = 'אימייל זה כבר רשום במערכת'; errEl.classList.add('show'); return; }
  users.push({ name: name, email: email, password: password });
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
  sucEl.textContent = 'ההרשמה הצליחה! ברוך הבא ' + name + '  מועבר לכניסה...';
  sucEl.classList.add('show');
  setTimeout(function() {
    document.getElementById('signupName').value = '';
    document.getElementById('signupEmail').value = '';
    document.getElementById('signupPassword').value = '';
    document.getElementById('signupConfirm').value = '';
    var fill = document.getElementById('strengthFill');
    var txt  = document.getElementById('strengthText');
    if (fill) fill.style.width = '0%';
    if (txt)  txt.textContent  = '';
    switchTab('login');
    document.getElementById('loginEmail').value = email;
  }, 2000);
}

function handleForgot(e) {
  e.preventDefault();
  var email = document.getElementById('forgotEmail').value.trim().toLowerCase();
  var errEl = document.getElementById('forgotError');
  var sucEl = document.getElementById('forgotSuccess');
  errEl.classList.remove('show'); sucEl.classList.remove('show');
  if (!email) { errEl.textContent = 'נא להכניס כתובת אימייל'; errEl.classList.add('show'); return; }
  var users = getUsers();
  var user  = users.find(function(u) { return u.email === email; });
  if (!user) { errEl.textContent = 'אימייל זה אינו רשום במערכת'; errEl.classList.add('show'); return; }
  sucEl.textContent = 'הסיסמה שלך: ' + user.password;
  sucEl.classList.add('show');
}

function demoLogin() {
  loginSuccess({ name: 'משתמש Demo', email: 'demo@nextrade.co.il' });
}

function loginSuccess(user) {
  console.log('[NexTrade] loginSuccess called with:', user);
  saveSession(user);
  var authEl = document.getElementById('authOverlay');
  var appEl = document.getElementById('appContainer');
  console.log('[NexTrade] authOverlay:', !!authEl, 'appContainer:', !!appEl);
  
  if (authEl) authEl.style.display  = 'none';
  if (appEl) appEl.style.display = 'block';
  
  var nameEl = document.getElementById('userNameDisplay');
  var avatarEl = document.getElementById('userAvatar');
  if (nameEl) nameEl.textContent = user.name;
  if (avatarEl) avatarEl.textContent = user.name.charAt(0).toUpperCase();
  
  console.log('[NexTrade] About to call init()...');
  // defer init so the browser finishes layout before the chart measures width.
  // Use setTimeout (fires even when tab is not focused) instead of requestAnimationFrame,
  // which is paused for background tabs and would leave the chart un-initialized.
  if (window.__ntInitDone) return;
  window.__ntInitDone = true;
  setTimeout(function() { init(); }, 60);
}

function handleLogout() {
  localStorage.removeItem(SESSION_KEY);
  document.getElementById('appContainer').style.display = 'none';
  document.getElementById('authOverlay').style.display  = 'flex';
  document.getElementById('loginEmail').value    = '';
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginError').classList.remove('show');
  var dd = document.getElementById('userDropdown');
  if (dd) dd.classList.remove('open');
  switchTab('login');
}

(function checkAutoLogin() {
  var session = getSession();
  if (session && session.name) {
    loginSuccess(session);
  }
  // אם אין session — האוברליי נשאר פתוח, המשתמש חייב להתחבר או ללחוץ Demo
})();

// ============================================
//   APP CONFIG  —  Twelve Data (https://twelvedata.com — חינמי, ללא proxy)
// ============================================
var TD_KEY  = 'c73725be3168443e88ac257aa9baa547';
var TD_BASE = 'https://api.twelvedata.com';

// ✓ כל המניות של בורסת תל אביב (ת"א)
var DEFAULT_SYMBOLS = ['TEVA.TA', 'ELBIT.TA', 'BEZQ.TA', 'POLI.TA', 'LUMI.TA', 'AZRG.TA'];

var NAMES = {
  // ✓ מניות בורסת תל אביב בלבד
  'TEVA.TA':    'טבע תעשיות',
  'ELBIT.TA':   'אלביט מערכות',
  'BEZQ.TA':    'בזק',
  'POLI.TA':    'בנק הפועלים',
  'LUMI.TA':    'בנק לאומי',
  'AZRG.TA':    'קבוצת אזריאלי',
  'BOB.TA':     'בנק דיסקונט',
  'TASE.TA':    'הבורסה (ת"א)',
  'BANK.TA':    'בנק הפועלים',
  'MGDL.TA':    'מגדל',
  'HAP.TA':     'מכבי שירותי בריאות',
  'NICE':       'נייס סיסטמס',
  'CHKP':       'CheckPoint',
  NVDA:   'NVIDIA Corp.',
};

// ============================================
//   TASE UNIVERSE  —  כל מניות בורסת תל אביב (נמשך מ-Twelve Data)
// ============================================
// Each entry: { sym: 'ABRA.TA', short: 'ABRA', name: '<Hebrew or English>' }
var TASE_UNIVERSE = [];
var TASE_UNIVERSE_KEY = 'tase_universe_v1';

function buildUniverseFromCache() {
  try {
    var raw = localStorage.getItem(TASE_UNIVERSE_KEY);
    if (!raw) return false;
    var obj = JSON.parse(raw);
    if (obj && obj.list && obj.list.length) {
      TASE_UNIVERSE = obj.list;
      return true;
    }
  } catch (e) {}
  return false;
}

async function loadTASEUniverse(force) {
  // Use cache (refreshed at most once every 7 days)
  if (!force) {
    try {
      var raw = localStorage.getItem(TASE_UNIVERSE_KEY);
      if (raw) {
        var obj = JSON.parse(raw);
        var fresh = obj && obj.ts && (Date.now() - obj.ts < 7 * 864e5);
        if (fresh && obj.list && obj.list.length) {
          TASE_UNIVERSE = obj.list;
          console.log('[NexTrade] TASE universe from cache:', TASE_UNIVERSE.length);
          return TASE_UNIVERSE;
        }
      }
    } catch (e) {}
  }

  try {
    var d = await tdFetch('/stocks', { exchange: 'TASE' });
    var arr = (d && d.data) ? d.data : [];
    var list = [];
    arr.forEach(function(s) {
      var sym = s.symbol || '';
      // keep ordinary equities only: letters/digits, no bond/option suffixes (e.g. ".B1")
      if (!sym || sym.indexOf('.') !== -1) return;
      // skip pure-numeric placeholder tickers with no real name
      if (/^\d+$/.test(sym) && (!s.name || s.name === sym)) return;
      var full = sym + '.TA';
      var hebrew = NAMES[full] || NAMES[sym];
      list.push({
        sym:   full,
        short: sym,
        name:  hebrew || s.name || sym,
      });
    });
    // de-duplicate by short symbol
    var seen = {};
    list = list.filter(function(it) {
      if (seen[it.short]) return false;
      seen[it.short] = true;
      return true;
    });
    list.sort(function(a, b) { return a.short < b.short ? -1 : a.short > b.short ? 1 : 0; });
    if (list.length) {
      TASE_UNIVERSE = list;
      try { localStorage.setItem(TASE_UNIVERSE_KEY, JSON.stringify({ ts: Date.now(), list: list })); } catch (e) {}
      console.log('[NexTrade] TASE universe loaded:', list.length);
    }
  } catch (e) {
    console.error('[NexTrade] loadTASEUniverse failed:', e.message || e);
  }
  // fall back to cache if the fetch returned nothing
  if (!TASE_UNIVERSE.length) buildUniverseFromCache();
  return TASE_UNIVERSE;
}

// ============================================
//   STATE
// ============================================
var currentSymbol   = 'TEVA.TA';
var currentTF       = '1D';
var chartInstance   = null;
var volInstance     = null;
var lineSeries      = null;
var candleSeries    = null;
var barSeries       = null;
var volumeSeries    = null;
var chartType       = 'candle';
var volumeVisible   = true;
var priceCache      = {};
var logoCache       = {};

function getStockLogo(sym) {
  var clean = sym.replace('.TA','').toUpperCase();
  if (logoCache[clean] !== undefined) return logoCache[clean];
  var cached = localStorage.getItem('nt_logo_' + clean);
  if (cached !== null) { logoCache[clean] = cached; return cached; }
  return null; // not yet fetched
}
async function fetchStockLogoAsync(sym) {
  var clean = sym.replace('.TA','').toUpperCase();
  if (logoCache[clean] !== undefined) return;
  logoCache[clean] = ''; // prevent double fetch
  try {
    var r = await fetch('https://api.twelvedata.com/logo?symbol=' + encodeURIComponent(clean) + '&apikey=c73725be3168443e88ac257aa9baa547');
    var j = await r.json();
    var url = (j && j.url) ? j.url : '';
    logoCache[clean] = url;
    if (url) localStorage.setItem('nt_logo_' + clean, url);
    document.querySelectorAll('.wl-logo[data-sym="' + clean + '"]').forEach(function(img) {
      if (url) { img.src = url; img.style.display = ''; }
    });
  } catch(e) { logoCache[clean] = ''; }
}
var candleCache     = {};   // candleCache[symbol][tf] = []
var watchlist       = JSON.parse(localStorage.getItem('ml_watchlist') || '["TEVA.TA","ELBIT.TA","BEZQ.TA","POLI.TA","LUMI.TA","AZRG.TA"]');
var portfolio       = JSON.parse(localStorage.getItem('ml_portfolio') || '[]');
var alerts          = JSON.parse(localStorage.getItem('ml_alerts')    || '[]');
var lastBars        = [];   // last loaded bars for MA computation

// ============================================
//   MOVING AVERAGES
// ============================================
var MA_CONFIGS = [
  { period:   5, color: '#FF6B6B', label: 'MA 5'   },
  { period:  10, color: '#FFD93D', label: 'MA 10'  },
  { period:  20, color: '#6BCB77', label: 'MA 20'  },
  { period:  30, color: '#4D96FF', label: 'MA 30'  },
  { period:  50, color: '#FF922B', label: 'MA 50'  },
  { period: 100, color: '#CC5DE8', label: 'MA 100' },
  { period: 200, color: '#F06595', label: 'MA 200' },
];
var maActive = {};   // period -> bool
var maSeries = {};   // period -> LightweightCharts line series

function computeMA(bars, period) {
  var result = [];
  for (var i = period - 1; i < bars.length; i++) {
    var sum = 0;
    for (var j = i - period + 1; j <= i; j++) sum += bars[j].close;
    result.push({ time: bars[i].time, value: parseFloat((sum / period).toFixed(4)) });
  }
  return result;
}

function renderMAs(bars) {
  if (!chartInstance) return;
  MA_CONFIGS.forEach(function(cfg) {
    if (!maActive[cfg.period]) return;
    var data = computeMA(bars, cfg.period);
    if (!maSeries[cfg.period]) {
      maSeries[cfg.period] = chartInstance.addLineSeries({
        color: cfg.color, lineWidth: 1,
        lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
      });
    }
    maSeries[cfg.period].setData(data);
  });
}

function clearMASeries() {
  if (!chartInstance) return;
  MA_CONFIGS.forEach(function(cfg) {
    if (maSeries[cfg.period]) {
      try { chartInstance.removeSeries(maSeries[cfg.period]); } catch(e) {}
      delete maSeries[cfg.period];
    }
  });
}

function toggleMA(period) {
  if (maActive[period]) {
    maActive[period] = false;
    if (maSeries[period]) {
      try { chartInstance.removeSeries(maSeries[period]); } catch(e) {}
      delete maSeries[period];
    }
  } else {
    maActive[period] = true;
    var cfg = MA_CONFIGS.find(function(c) { return c.period === period; });
    if (cfg && lastBars && lastBars.length >= period) {
      var data = computeMA(lastBars, period);
      if (!maSeries[period]) {
        maSeries[period] = chartInstance.addLineSeries({
          color: cfg.color, lineWidth: 1,
          lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
        });
      }
      maSeries[period].setData(data);
    }
  }
  renderMAPanel();
}

function renderMAPanel() {
  var list = document.getElementById('maList');
  if (!list) return;
  var volRow = '<div class="ma-item">'
    + '<span class="ma-swatch" style="background:#5b6472"></span>'
    + '<span class="ma-label">נפח עסקאות</span>'
    + '<button class="ma-toggle' + (volumeVisible ? ' on' : '') + '" onclick="toggleVolume()"></button>'
    + '</div>'
    + '<div style="height:1px;background:var(--border);margin:.25rem .3rem"></div>';
  var maRows = MA_CONFIGS.map(function(cfg) {
    var on = !!maActive[cfg.period];
    return '<div class="ma-item">'
      + '<span class="ma-swatch" style="background:' + cfg.color + '"></span>'
      + '<span class="ma-label">' + cfg.label + '</span>'
      + '<button class="ma-toggle' + (on ? ' on' : '') + '" onclick="toggleMA(' + cfg.period + ')"></button>'
      + '</div>';
  }).join('');
  list.innerHTML = volRow + maRows;
}

// ============================================
//   TASE MARKET HOURS (Israel time UTC+3)
// ============================================
function getTASEStatus() {
  var now = new Date();
  // Convert to Israel time (UTC+3)
  var utc   = now.getTime() + now.getTimezoneOffset() * 60000;
  var il    = new Date(utc + 3 * 3600000);
  var day   = il.getDay();   // 0=Sun,1=Mon,2=Tue,3=Wed,4=Thu,5=Fri,6=Sat
  var h     = il.getHours();
  var m     = il.getMinutes();
  var hm    = h * 60 + m;

  // Saturday = closed
  if (day === 6) return { status: 'closed', label: ' שבת  סגור' };

  // Friday = short session 09:00–13:25
  if (day === 5) {
    if (hm >= 9*60 && hm < 9*60+45)  return { status: 'pre',    label: ' טרום מסחר ו׳' };
    if (hm >= 9*60+45 && hm < 13*60+25) return { status: 'open', label: ' פתוח (ו׳ קצר)' };
    return { status: 'closed', label: ' סגור' };
  }

  // Sunday–Thursday = full session 09:00–17:25
  if (day >= 0 && day <= 4) {
    if (hm >= 9*60 && hm < 9*60+45)     return { status: 'pre',    label: ' טרום מסחר' };
    if (hm >= 9*60+45 && hm < 17*60+25) return { status: 'open',   label: ' שוק פתוח' };
    if (hm >= 17*60+25 && hm < 18*60)   return { status: 'pre',    label: ' אחרי מסחר' };
    return { status: 'closed', label: ' סגור' };
  }

  return { status: 'closed', label: ' סגור' };
}

function updateTASEBadge() {
  var badge = document.getElementById('taseBadge');
  if (!badge) return;
  var s = getTASEStatus();
  // Just show dot color
  badge.className = 'tase-dot ' + s.status;
  badge.title = s.status === 'open' ? 'שוק פתוח' : s.status === 'pre' ? 'טרום מסחר' : 'שוק סגור';
  // Update chart clock (Israel time)
  var now = new Date();
  var utc = now.getTime() + now.getTimezoneOffset() * 60000;
  var il = new Date(utc + 3 * 3600000);
  var hh = String(il.getHours()).padStart(2, '0');
  var mm = String(il.getMinutes()).padStart(2, '0');
  var ss = String(il.getSeconds()).padStart(2, '0');
  var clockEl = document.getElementById('chartClock');
  if (clockEl) clockEl.textContent = hh + ':' + mm + ':' + ss + ' IL';
}

// ============================================
//   TIMEFRAME CONFIG
// ============================================
var TF_CONFIG = {
  '1H': { label:'1H', tdInterval:'1h',     outputsize:120 },
  '4H': { label:'4H', tdInterval:'4h',     outputsize:120 },
  '8H': { label:'8H', tdInterval:'8h',     outputsize:120 },
  '1D': { label:'1D', tdInterval:'1day',   outputsize:500 },
  '1W': { label:'1W', tdInterval:'1week',  outputsize:260 },
  '1M': { label:'1M', tdInterval:'1month', outputsize:120 },
  '1Q': { label:'1Q', tdInterval:'1month', outputsize:120, aggregate:'quarter' },
  '6M': { label:'6M', tdInterval:'1month', outputsize:120, aggregate:'halfyear' },
};

// ============================================
//   DATA AGGREGATION
// ============================================
function aggregateBars(bars, period) {
  if (!bars || !bars.length) return [];
  if (period === 'week')     return aggregateByPeriod(bars, getWeekKey);
  if (period === 'month')    return aggregateByPeriod(bars, getMonthKey);
  if (period === 'quarter')  return aggregateByPeriod(bars, getQuarterKey);
  if (period === 'halfyear') return aggregateByPeriod(bars, getHalfYearKey);
  // numeric hour aggregation (4H, 8H)
  if (typeof period === 'number') return aggregateByN(bars, period);
  return bars;
}

function aggregateByN(bars, n) {
  var result = [];
  for (var i = 0; i < bars.length; i += n) {
    var chunk = bars.slice(i, i + n);
    result.push({
      time:   chunk[0].time,
      open:   chunk[0].open,
      high:   Math.max.apply(null, chunk.map(function(b) { return b.high; })),
      low:    Math.min.apply(null, chunk.map(function(b) { return b.low; })),
      close:  chunk[chunk.length - 1].close,
      volume: chunk.reduce(function(s, b) { return s + (b.volume || 0); }, 0),
    });
  }
  return result;
}

function aggregateByPeriod(bars, keyFn) {
  var map = {};
  var order = [];
  bars.forEach(function(b) {
    var k = keyFn(b.time);
    if (!map[k]) { map[k] = { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume || 0 }; order.push(k); }
    else {
      map[k].high   = Math.max(map[k].high, b.high);
      map[k].low    = Math.min(map[k].low,  b.low);
      map[k].close  = b.close;
      map[k].volume += (b.volume || 0);
    }
  });
  return order.map(function(k) { return map[k]; });
}

function getWeekKey(dateStr) {
  var d = new Date(dateStr);
  var day = d.getDay();
  var diff = d.getDate() - day + (day === 0 ? -6 : 1);
  var mon = new Date(d.setDate(diff));
  return mon.toISOString().slice(0, 10);
}
function getMonthKey(dateStr)    { return dateStr.slice(0, 7) + '-01'; }
function getQuarterKey(dateStr)  {
  var mo = parseInt(dateStr.slice(5, 7), 10);
  var yr = dateStr.slice(0, 4);
  var qStart = [1, 1, 1, 4, 4, 4, 7, 7, 7, 10, 10, 10][mo - 1];
  return yr + '-' + (qStart < 10 ? '0' : '') + qStart + '-01';
}
function getHalfYearKey(dateStr) {
  var mo = parseInt(dateStr.slice(5, 7), 10);
  var yr = dateStr.slice(0, 4);
  return yr + '-' + (mo <= 6 ? '01' : '07') + '-01';
}

// ============================================
//   TWELVE DATA FETCH  (CORS נתמך ישירות, ללא proxy)
// ============================================
async function tdFetch(endpoint, params) {
  params.apikey = TD_KEY;
  var qs  = Object.keys(params).map(function(k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
  }).join('&');
  var url = TD_BASE + endpoint + '?' + qs;
  console.log('[NexTrade] GET', endpoint, params.symbol || '', params.interval || '');
  try {
    var ctrl = new AbortController();
    var tid  = setTimeout(function() { ctrl.abort(); }, 12000);
    var r    = await fetch(url, { signal: ctrl.signal });
    clearTimeout(tid);
    if (!r.ok) { console.error('Twelve Data HTTP', r.status); return null; }
    var d = await r.json();
    if (d.status === 'error' || d.code) {
      console.error('Twelve Data error:', d.message || d.code);
      return null;
    }
    return d;
  } catch(e) {
    console.error('Twelve Data fetch failed:', e.message || e);
    return null;
  }
}

async function fetchTDChart(symbol, tf) {
  var cfg      = TF_CONFIG[tf];
  var cacheKey = symbol + '_' + tf;
  var ttl      = (tf === '1H' || tf === '4H' || tf === '8H') ? 300000 : 3600000;
  if (candleCache[cacheKey] && candleCache[cacheKey].ts > Date.now() - ttl) {
    return candleCache[cacheKey].data;
  }
  var d = await tdFetch('/time_series', {
    symbol:     symbol,
    interval:   cfg.tdInterval,
    outputsize: cfg.outputsize,
    order:      'ASC',
  });
  if (!d || !d.values || !d.values.length) return [];
  var isIntraday = (tf === '1H' || tf === '4H' || tf === '8H');
  var bars = d.values.map(function(v) {
    var time;
    if (isIntraday) {
      // datetime like "2025-04-14 10:00:00" — convert to unix for lightweight-charts
      time = Math.floor(new Date(v.datetime.replace(' ', 'T') + '+03:00').getTime() / 1000);
    } else {
      time = v.datetime;  // "YYYY-MM-DD" — used directly
    }
    return {
      time:   time,
      open:   parseFloat(v.open),
      high:   parseFloat(v.high),
      low:    parseFloat(v.low),
      close:  parseFloat(v.close),
      volume: parseFloat(v.volume) || 0,
    };
  });
  candleCache[cacheKey] = { ts: Date.now(), data: bars };
  return bars;
}

async function getBarsForTF(symbol, tf) {
  var cfg = TF_CONFIG[tf];
  var raw;

  // Yahoo first for live-like updates (avoids TwelveData quota throttling)
  raw = await fetchYahooChartDirect(symbol, tf);

  if (!raw || !raw.length) {
    // Fallback: TwelveData
    raw = await fetchTDChart(symbol, tf);
  }

  if (cfg.aggregate) raw = aggregateBars(raw, cfg.aggregate);
  return raw;
}

function extractJsonPayload(text) {
  if (!text) return null;
  var start = text.indexOf('{');
  if (start === -1) return null;
  try {
    return JSON.parse(text.slice(start));
  } catch (e) {
    return null;
  }
}

async function fetchYahooProxyJson(url) {
  try {
    var proxyUrl = 'https://r.jina.ai/http://' + url.replace(/^https?:\/\//, '');
    var response = await fetch(proxyUrl);
    if (!response.ok) return null;
    var text = await response.text();
    return extractJsonPayload(text);
  } catch (e) {
    return null;
  }
}

// Yahoo Finance direct — עובד בלי proxy כשנפתחים מ-localhost
async function fetchYahooChartDirect(symbol, tf) {
  var cfg      = TF_CONFIG[tf];
  var cacheKey = 'yf_' + symbol + '_' + tf;
  var ttl      = (tf === '1H' || tf === '4H' || tf === '8H') ? 15000 : 60000;
  if (candleCache[cacheKey] && candleCache[cacheKey].ts > Date.now() - ttl) {
    return candleCache[cacheKey].data;
  }
  var yfInterval = { '1H':'1h','4H':'1h','8H':'1h','1D':'1d','1W':'1wk','1M':'1mo','1Q':'1mo','6M':'1mo' }[tf];
  var yfRange    = { '1H':'5d','4H':'60d','8H':'60d','1D':'2y','1W':'5y','1M':'10y','1Q':'10y','6M':'10y' }[tf];
  try {
    var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' +
              encodeURIComponent(symbol) + '?interval=' + yfInterval + '&range=' + yfRange;
    var d = await fetchYahooProxyJson(url);
    if (!d.chart || !d.chart.result || !d.chart.result[0]) return [];
    var result = d.chart.result[0];
    var ts     = result.timestamp;
    var quote  = result.indicators.quote[0];
    if (!ts || !quote) return [];
    var intraday = (tf === '1H' || tf === '4H' || tf === '8H');
    var bars = [];
    for (var j = 0; j < ts.length; j++) {
      if (quote.open[j] == null) continue;
      var time = intraday ? ts[j] : (function(t) {
        var dt = new Date(t * 1000);
        return dt.getUTCFullYear() + '-' +
          String(dt.getUTCMonth()+1).padStart(2,'0') + '-' +
          String(dt.getUTCDate()).padStart(2,'0');
      })(ts[j]);
      bars.push({ time: time, open: quote.open[j], high: quote.high[j],
        low: quote.low[j], close: quote.close[j], volume: quote.volume[j] || 0 });
    }
    candleCache[cacheKey] = { ts: Date.now(), data: bars };
    return bars;
  } catch(e) { return []; }
}

async function resolveSymbolForData(symbol, tf) {
  var normalized = (symbol || '').trim().toUpperCase();
  if (!normalized) return null;

  var candidates = [normalized];
  if (normalized.indexOf('.') === -1) {
    candidates.push(normalized + '.TA');
  } else if (normalized.endsWith('.TA')) {
    candidates.push(normalized.slice(0, -3));
  }

  for (var i = 0; i < candidates.length; i++) {
    var candidate = candidates[i];
    var bars = await getBarsForTF(candidate, tf || currentTF);
    if (bars && bars.length) {
      return candidate;
    }
  }

  return null;
}

// ============================================
//   CHART INIT
// ============================================
function initChart() {
  var mainEl = document.getElementById('chart');

  chartInstance = LightweightCharts.createChart(mainEl, {
    autoSize: true,
    layout: { background: { color: '#0f1117' }, textColor: '#8899aa' },
    grid:   { vertLines: { color: 'transparent' }, horzLines: { color: 'transparent' } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: '#1e2533', autoScale: true },
    timeScale: { borderColor: '#1e2533', timeVisible: true, secondsVisible: false },
    handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
    handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: { time: true, price: true } },
  });

  // Restore saved background preference
  if (_ctxBgMode === 'solid') {
    chartInstance.applyOptions({ layout: { background: { type: 'solid', color: _ctxBgSolid } } });
  } else if (_ctxBgMode === 'gradient') {
    chartInstance.applyOptions({ layout: { background: { type: 'gradient', topColor: _ctxBgGradTop, bottomColor: _ctxBgGradBot } } });
  }

  lineSeries = chartInstance.addLineSeries({
    color: '#2962ff', lineWidth: 2,
    lastValueVisible: true, priceLineVisible: true,
    crosshairMarkerVisible: true,
  });
  lineSeries.applyOptions({ visible: false });

  candleSeries = chartInstance.addCandlestickSeries({
    upColor: '#26a69a',   downColor: '#ef5350',
    borderUpColor: '#26a69a', borderDownColor: '#ef5350',
    wickUpColor: '#26a69a',   wickDownColor: '#ef5350',
  });
  candleSeries.applyOptions({ visible: true });

  barSeries = chartInstance.addBarSeries({
    upColor: '#26a69a', downColor: '#ef5350',
  });
  barSeries.applyOptions({ visible: false });

  // Volume — overlay histogram anchored to the BOTTOM of the main chart (TradingView style).
  // Sits above the time/months axis and shares the same time scale, so it can never
  // "merge" into the candles and is always perfectly aligned.
  volumeSeries = chartInstance.addHistogramSeries({
    priceFormat: { type: 'volume' },
    priceScaleId: 'volume',
    lastValueVisible: false,
    priceLineVisible: false,
  });
  chartInstance.priceScale('volume').applyOptions({
    scaleMargins: { top: 0.84, bottom: 0 },
  });
  volumeSeries.applyOptions({ visible: volumeVisible });

  // Sync crosshair between charts
  chartInstance.subscribeCrosshairMove(function(param) {
    syncVolumeCrosshair(param);
    updateLegend(param);
    updateCrosshairAlertBtn(param);
  });

  // Force resize after layout settles (fixes 0-height init issue)
  setTimeout(function() {
    if (chartInstance) {
      var el = document.getElementById('chart');
      if (el && el.offsetWidth > 0 && el.offsetHeight > 0) {
        chartInstance.resize(el.offsetWidth, el.offsetHeight);
      }
    }
  }, 120);
}

// ============================================
//   CHART WHEEL HANDLER — slow pan + Ctrl zoom
// ============================================
var _priceMarginTop = 0.1, _priceMarginBottom = 0.1;
function initPriceAxisScroll() {
  var chartEl = document.getElementById('chart');
  if (!chartEl) return;
  chartEl.addEventListener('wheel', function(e) {
    if (!chartInstance) return;
    e.preventDefault();
    var rect = chartEl.getBoundingClientRect();
    var xFromRight = rect.right - e.clientX;

    // Ctrl + scroll = zoom in/out
    if (e.ctrlKey) {
      var ts = chartInstance.timeScale();
      var range = ts.getVisibleLogicalRange();
      if (!range) return;
      var center = (range.from + range.to) / 2;
      var span = range.to - range.from;
      var factor = e.deltaY > 0 ? 1.15 : 0.87; // zoom out / zoom in
      var newSpan = span * factor;
      ts.setVisibleLogicalRange({ from: center - newSpan / 2, to: center + newSpan / 2 });
      return;
    }

    // On price axis (right 65px) — vertical zoom (stretch/compress prices)
    if (xFromRight <= 65) {
      var dir = e.deltaY > 0 ? 1 : -1;
      var step = 0.03;
      _priceMarginTop    = Math.max(0.01, Math.min(0.88, _priceMarginTop    + dir * step));
      _priceMarginBottom = Math.max(0.01, Math.min(0.88, _priceMarginBottom + dir * step));
      chartInstance.applyOptions({
        rightPriceScale: { scaleMargins: { top: _priceMarginTop, bottom: _priceMarginBottom } }
      });
      return;
    }

    // Normal scroll — slow horizontal pan (reduced speed)
    var ts2 = chartInstance.timeScale();
    var range2 = ts2.getVisibleLogicalRange();
    if (!range2) return;
    var span2 = range2.to - range2.from;
    var shift = (e.deltaY * 0.08) / rect.width * span2;
    ts2.setVisibleLogicalRange({ from: range2.from + shift, to: range2.to + shift });
  }, { passive: false, capture: true });
}

// ============================================
//   VERTICAL PAN — drag chart canvas up/down
// ============================================
function initChartVerticalPan() {
  var chartEl = document.getElementById('chart');
  if (!chartEl) return;
  var dragging = false;
  var lastY = 0;

  chartEl.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return;
    var rect = chartEl.getBoundingClientRect();
    // Ignore clicks on the price axis itself
    if (rect.right - e.clientX <= 65) return;
    dragging = true;
    lastY = e.clientY;
  });

  window.addEventListener('mousemove', function(e) {
    if (!dragging || !chartInstance) return;
    var dy = e.clientY - lastY;
    lastY = e.clientY;
    if (Math.abs(dy) < 0.5) return;
    var h = chartEl.clientHeight || 600;
    // dy > 0 = drag down = pan to lower prices: top grows, bottom shrinks
    // dy < 0 = drag up   = pan to higher prices: top shrinks, bottom grows
    var step = dy / h * 0.9;
    var newTop    = Math.max(0.01, Math.min(0.93, _priceMarginTop    + step));
    var newBottom = Math.max(0.01, Math.min(0.93, _priceMarginBottom - step));
    // Guard: don't let top+bottom push content off screen entirely
    if (newTop + newBottom < 0.97) {
      _priceMarginTop    = newTop;
      _priceMarginBottom = newBottom;
      chartInstance.applyOptions({
        rightPriceScale: { scaleMargins: { top: _priceMarginTop, bottom: _priceMarginBottom } }
      });
    }
  });

  window.addEventListener('mouseup', function() { dragging = false; });
}

// ============================================
//   CHART RIGHT-CLICK CONTEXT MENU
// ============================================
var CTX_COLORS = [
  '#000000','#121212','#1a1a2e','#0f1117','#0d1b2a','#111827','#1f2937','#374151',
  '#4b5563','#6b7280','#9ca3af','#d1d5db','#f3f4f6','#ffffff','#fafafa','#e5e7eb',
  '#dc2626','#ef4444','#f87171','#fca5a5','#b91c1c','#7f1d1d','#991b1b','#450a0a',
  '#d97706','#f59e0b','#fbbf24','#fcd34d','#92400e','#78350f','#451a03','#fde68a',
  '#16a34a','#22c55e','#4ade80','#86efac','#14532d','#166534','#15803d','#dcfce7',
  '#2563eb','#3b82f6','#60a5fa','#93c5fd','#1d4ed8','#1e40af','#1e3a8a','#dbeafe',
  '#7c3aed','#8b5cf6','#a78bfa','#c4b5fd','#5b21b6','#4c1d95','#3b0764','#ede9fe',
  '#db2777','#ec4899','#f472b6','#fbcfe8','#9d174d','#831843','#500724','#fce7f3',
  '#0891b2','#06b6d4','#67e8f9','#a5f3fc','#164e63','#155e75','#083344','#cffafe',
  '#059669','#10b981','#6ee7b7','#a7f3d0','#064e3b','#065f46','#022c22','#d1fae5'
];
var _ctxBgSolid = '#0f1117';
var _ctxBgGradTop = '#0f1117', _ctxBgGradBot = '#1a1f2e';
var _ctxBgMode = 'solid';
(function loadBgPref() {
  try {
    var s = JSON.parse(localStorage.getItem('nt_chartBg'));
    if (s) { _ctxBgMode = s.mode || 'solid'; _ctxBgSolid = s.solid || '#0f1117'; _ctxBgGradTop = s.top || '#0f1117'; _ctxBgGradBot = s.bot || '#1a1f2e'; }
  } catch(e) {}
})();
function _saveBgPref() {
  localStorage.setItem('nt_chartBg', JSON.stringify({ mode: _ctxBgMode, solid: _ctxBgSolid, top: _ctxBgGradTop, bot: _ctxBgGradBot }));
}

function initChartContextMenu() {
  var menu    = document.getElementById('chartCtxMenu');
  var chartEl = document.getElementById('chart');
  if (!menu || !chartEl) return;

  function applyBg() {
    if (!chartInstance) return;
    if (_ctxBgMode === 'solid') {
      chartInstance.applyOptions({ layout: { background: { type: 'solid', color: _ctxBgSolid } } });
    } else {
      chartInstance.applyOptions({ layout: { background: { type: 'gradient', topColor: _ctxBgGradTop, bottomColor: _ctxBgGradBot } } });
    }
    _saveBgPref();
  }

  function buildSwatches(containerId, onPick) {
    var el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = CTX_COLORS.map(function(c) {
      return '<div class="ctxm-swatch" style="background:' + c + '" title="' + c + '"></div>';
    }).join('');
    el.querySelectorAll('.ctxm-swatch').forEach(function(sw) {
      sw.addEventListener('click', function(e) {
        e.stopPropagation();
        el.querySelectorAll('.ctxm-swatch').forEach(function(s) { s.classList.remove('selected'); });
        sw.classList.add('selected');
        onPick(sw.title);
      });
    });
  }

  buildSwatches('ctxSolidColors', function(col) { _ctxBgSolid = col; _ctxBgMode = 'solid'; applyBg(); });
  buildSwatches('ctxGradTopColors', function(col) { _ctxBgGradTop = col; _ctxBgMode = 'gradient'; var d = document.getElementById('ctxGradTopDot'); if (d) d.style.background = col; applyBg(); });
  buildSwatches('ctxGradBotColors', function(col) { _ctxBgGradBot = col; _ctxBgMode = 'gradient'; var d = document.getElementById('ctxGradBotDot'); if (d) d.style.background = col; applyBg(); });

  document.getElementById('ctxTabSolid').addEventListener('click', function(e) {
    e.stopPropagation(); this.classList.add('active');
    document.getElementById('ctxTabGrad').classList.remove('active');
    document.getElementById('ctxSolidPanel').style.display = '';
    document.getElementById('ctxGradPanel').style.display = 'none';
    _ctxBgMode = 'solid';
  });
  document.getElementById('ctxTabGrad').addEventListener('click', function(e) {
    e.stopPropagation(); this.classList.add('active');
    document.getElementById('ctxTabSolid').classList.remove('active');
    document.getElementById('ctxSolidPanel').style.display = 'none';
    document.getElementById('ctxGradPanel').style.display = '';
    _ctxBgMode = 'gradient';
  });

  chartEl.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    var x = e.clientX, y = e.clientY;
    // Hide inline form on new open
    var ctxForm = document.getElementById('ctxAlertForm');
    if (ctxForm) ctxForm.style.display = 'none';
    // Reset positioning
    menu.style.left = ''; menu.style.right = ''; menu.style.top = ''; menu.style.bottom = '';
    // Show temporarily to measure height
    menu.style.visibility = 'hidden'; menu.classList.add('open');
    var mw = menu.offsetWidth  || 190;
    var mh = menu.offsetHeight || 300;
    menu.classList.remove('open'); menu.style.visibility = '';
    // Position exactly at click point, flip if near edge
    if (x + mw + 4 > window.innerWidth)  menu.style.left = (x - mw) + 'px';
    else                                   menu.style.left = x + 'px';
    if (y + mh + 4 > window.innerHeight)  menu.style.top  = (y - mh) + 'px';
    else                                   menu.style.top  = y + 'px';
    menu.classList.add('open');
  });

  document.addEventListener('click', function() { menu.classList.remove('open'); });
  menu.addEventListener('click', function(e) { e.stopPropagation(); });
}

// ============================================
//   LEGEND UPDATE on crosshair
// ============================================
function updateLegend(param) {
  var legend = document.getElementById('chartLegend'); // kept for compat
  var ciOhlcv = document.getElementById('ciOhlcv');
  var ohlcvSep = document.querySelector('.ci-ohlcv-sep');
  if (!param || !param.time) {
    if (ciOhlcv) ciOhlcv.classList.remove('visible');
    if (ohlcvSep) ohlcvSep.style.visibility = 'hidden';
    return;
  }
  if (ciOhlcv) ciOhlcv.classList.add('visible');
  if (ohlcvSep) ohlcvSep.style.visibility = 'visible';

  var activeSeries = chartType === 'line' ? lineSeries : (chartType === 'candle' ? candleSeries : barSeries);
  var barData = param.seriesData && param.seriesData.get(activeSeries);
  var volData = param.seriesData && param.seriesData.get(volumeSeries);

  // Symbol in overlay
  var symEl = document.getElementById('ciOhlcvSym');
  if (symEl) symEl.textContent = (currentSymbol || '').replace('.TA', '');

  if (chartType === 'line' && barData) {
    var candleCol = '#fff';
    if (ciOhlcv) ciOhlcv.style.color = candleCol;
    document.getElementById('lgO').textContent = formatPrice(barData.value);
    document.getElementById('lgH').textContent = '';
    document.getElementById('lgL').textContent = '';
    document.getElementById('lgC').textContent = '';
  } else if (barData) {
    var isUp = barData.close >= barData.open;
    var candleCol = isUp ? '#26a69a' : '#ef5350';
    if (ciOhlcv) ciOhlcv.style.color = candleCol;
    document.getElementById('lgO').textContent = formatPrice(barData.open);
    document.getElementById('lgH').textContent = formatPrice(barData.high);
    document.getElementById('lgL').textContent = formatPrice(barData.low);
    document.getElementById('lgC').textContent = formatPrice(barData.close);
    var chgPct = barData.open ? ((barData.close - barData.open) / barData.open * 100) : 0;
    var pctEl  = document.getElementById('lgPct');
    pctEl.textContent = (chgPct >= 0 ? '+' : '') + chgPct.toFixed(2) + '%';
    pctEl.className   = 'legend-pct ' + (chgPct >= 0 ? 'up' : 'down');
  }

  if (volData) {
    document.getElementById('lgV').textContent = formatVolume(volData.value);
    var volLeg = document.getElementById('volLegendText');
    if (volLeg) volLeg.textContent = formatVolume(volData.value);
  }
}

// ============================================
//   CROSSHAIR ALERT BUTTON (+) on horizontal line
// ============================================
var _crosshairAlertPrice = null;

function updateCrosshairAlertBtn(param) {
  var btn = document.getElementById('crosshairAlertBtn');
  if (!btn) return;
  var popup = document.getElementById('crosshairAlertPopup');
  // If popup is open, keep button visible but don't reposition
  if (popup && popup.style.display === 'block') return;
  // If mouse is hovering on button itself, don't hide it
  if (btn.matches(':hover')) return;
  if (!param || !param.point || param.point.x < 0 || param.point.y < 0) {
    btn.style.display = 'none';
    return;
  }
  var chartEl = document.getElementById('chart');
  if (!chartEl) return;
  var rect = chartEl.getBoundingClientRect();
  var wrapEl = chartEl.parentElement;
  if (!wrapEl) return;
  var wrapRect = wrapEl.getBoundingClientRect();
  // Get price at crosshair Y
  var series = candleSeries || lineSeries;
  if (!series) return;
  try {
    _crosshairAlertPrice = series.coordinateToPrice(param.point.y);
  } catch(e) { return; }
  if (!_crosshairAlertPrice || !isFinite(_crosshairAlertPrice)) { btn.style.display = 'none'; return; }
  // Position button on right side of chart area (just left of price axis)
  var btnY = (rect.top - wrapRect.top) + param.point.y - 11;
  var btnX = rect.width - 76; // just left of the price axis (~65px wide)
  btn.style.top  = btnY + 'px';
  btn.style.left = btnX + 'px';
  btn.style.display = 'flex';
}

function openCrosshairAlertPopup() {
  var popup = document.getElementById('crosshairAlertPopup');
  var btn   = document.getElementById('crosshairAlertBtn');
  if (!popup || !btn) return;
  var priceLabel = document.getElementById('crosshairAlertPriceLabel');
  var priceInput = document.getElementById('crosshairAlertPriceInp');
  if (_crosshairAlertPrice && isFinite(_crosshairAlertPrice)) {
    var rounded = parseFloat(_crosshairAlertPrice.toFixed(2));
    if (priceLabel) priceLabel.textContent = 'מחיר: ' + formatPrice(rounded);
    if (priceInput) priceInput.value = rounded;
  }
  // Position popup near the button
  var btnTop = parseInt(btn.style.top) || 0;
  var btnLeft = parseInt(btn.style.left) || 0;
  popup.style.top  = Math.max(5, btnTop - 30) + 'px';
  popup.style.left = Math.max(5, btnLeft - 225) + 'px';
  popup.style.display = 'block';
  // Keep button visible while popup is open
  btn.style.display = 'flex';
}

function closeCrosshairAlertPopup() {
  var popup = document.getElementById('crosshairAlertPopup');
  if (popup) popup.style.display = 'none';
}

function crosshairAddAlert() {
  var price = parseFloat(document.getElementById('crosshairAlertPriceInp').value);
  var cond  = document.getElementById('crosshairAlertCond').value;
  var email = (document.getElementById('crosshairAlertEmail').value || '').trim().toLowerCase();
  var sym   = currentSymbol;
  if (!sym || !price || isNaN(price)) return;
  alerts.push({ symbol: sym, condition: cond, price: price, email: email || null });
  localStorage.setItem('ml_alerts', JSON.stringify(alerts));
  renderAlerts();
  closeCrosshairAlertPopup();
  // Confirmation banner
  var banner = document.createElement('div');
  banner.textContent = '✅ התראה נוספה: ' + sym + ' ' + (cond === 'above' ? 'מעל' : 'מתחת') + ' ' + formatPrice(price);
  banner.style.cssText = 'position:fixed;bottom:70px;left:50%;transform:translateX(-50%);background:#0a3020;border:1px solid #26a69a;color:#26a69a;padding:.4rem 1rem;border-radius:8px;font-size:.78rem;z-index:9999;font-family:Heebo,sans-serif;';
  document.body.appendChild(banner);
  setTimeout(function() { banner.remove(); }, 2500);
}

// Close crosshair popup when clicking outside
document.addEventListener('click', function(e) {
  var popup = document.getElementById('crosshairAlertPopup');
  var btn   = document.getElementById('crosshairAlertBtn');
  if (popup && popup.style.display === 'block') {
    if (!popup.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
      closeCrosshairAlertPopup();
    }
  }
});

function syncVolumeCrosshair(param) {
  if (!param || !param.point) return;
  // move volume crosshair to same logical time
  // (LightweightCharts doesn't support direct crosshair sync in standalone, but scroll/scale are synced below)
}

function getSavedBars(symbol, tf) {
  try {
    var raw = localStorage.getItem('ml_lastbars_' + symbol + '_' + tf);
    if (!raw) return [];
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function saveBars(symbol, tf, bars) {
  try {
    if (!bars || !bars.length) return;
    var compact = bars.slice(Math.max(0, bars.length - 220));
    localStorage.setItem('ml_lastbars_' + symbol + '_' + tf, JSON.stringify(compact));
  } catch (e) {
    // ignore storage failures
  }
}

function buildDemoBars(tf, basePrice) {
  var countMap = { '1H': 120, '4H': 120, '8H': 120, '1D': 160, '1W': 160, '1M': 120, '1Q': 80, '6M': 80 };
  var count = countMap[tf] || 120;
  var intraday = (tf === '1H' || tf === '4H' || tf === '8H');
  var ts = Math.floor(Date.now() / 1000);
  var step = intraday ? 3600 : 86400;
  var price = isNaN(basePrice) ? 100 : basePrice;
  var out = [];
  for (var i = count - 1; i >= 0; i--) {
    var wave = Math.sin((count - i) / 8) * 0.9;
    var drift = (Math.random() - 0.48) * 0.7;
    var open = price;
    var close = Math.max(0.1, open + wave + drift);
    var high = Math.max(open, close) + Math.random() * 0.9;
    var low = Math.min(open, close) - Math.random() * 0.9;
    var volume = Math.floor(150000 + Math.random() * 650000);
    var t = ts - i * step;
    var time = intraday ? t : (function(sec) {
      var d = new Date(sec * 1000);
      return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
    })(t);
    out.push({ time: time, open: open, high: high, low: low, close: close, volume: volume });
    price = close;
  }
  return out;
}

// ============================================
//   LOAD CHART (with TF)
// ============================================
async function loadChart(symbol, tf, preserveZoom) {
  tf = tf || currentTF;
  var targetSymbol = (symbol || '').trim().toUpperCase();
  if (!targetSymbol) return;
  if (targetSymbol.indexOf('.') === -1) {
    var resolved = await resolveSymbolForData(targetSymbol, tf);
    targetSymbol = resolved || targetSymbol;
  }

  currentSymbol = targetSymbol;
  currentTF     = tf;

  document.getElementById('chartTitle').textContent    = targetSymbol + '  ' + (NAMES[targetSymbol] || (priceCache[targetSymbol] && priceCache[targetSymbol].name) || targetSymbol);
  document.getElementById('chartSubtitle').innerHTML =
    '<span id="loadDots" style="color:var(--accent)">&#9679;&#9679;&#9679; מחפש נתונים מ-Yahoo Finance...</span>';
  // Populate overlay sym + name immediately
  var _name = NAMES[targetSymbol] || (priceCache[targetSymbol] && priceCache[targetSymbol].name) || '';
  var ciSym = document.getElementById('ciSym');
  var ciName = document.getElementById('ciName');
  var ciChange = document.getElementById('ciChange');
  var ciPrice  = document.getElementById('ciPrice');
  var ciVol    = document.getElementById('ciVol');
  if (ciSym)    ciSym.textContent    = targetSymbol.replace('.TA','');
  if (ciName)   ciName.textContent   = _name;
  if (ciChange) ciChange.textContent = '';
  if (ciPrice)  ciPrice.textContent  = '';
  if (ciVol)    ciVol.textContent    = '';
  document.getElementById('newsSymbol').textContent    = ' ' + targetSymbol;
  // spinner pulse on the 3 dots
  var dotEl = document.getElementById('loadDots');
  if (dotEl) {
    var dotCount = 0;
    var dotTimer = setInterval(function() {
      if (!document.getElementById('loadDots')) { clearInterval(dotTimer); return; }
      dotCount = (dotCount + 1) % 4;
      document.getElementById('loadDots').textContent = '⬤'.repeat(dotCount + 1) + ' מחפש נתונים...';
    }, 400);
  }

  document.querySelectorAll('.stock-card').forEach(function(c) { c.classList.remove('active'); });
  var activeCard = document.getElementById('card-' + targetSymbol);
  if (activeCard) activeCard.classList.add('active');

  var bars = await getBarsForTF(targetSymbol, tf);
  console.log('[NexTrade] bars received:', bars ? bars.length : 0, 'symbol:', targetSymbol, 'tf:', tf);
  if (bars && bars.length) console.log('[NexTrade] first bar:', JSON.stringify(bars[0]));

  var usingFallback = false;
  if (!bars || !bars.length) {
    bars = getSavedBars(targetSymbol, tf);
    if (bars && bars.length) {
      usingFallback = true;
    }
  }
  if (!bars || !bars.length) {
    var base = priceCache[targetSymbol] && priceCache[targetSymbol].price;
    bars = buildDemoBars(tf, base);
    usingFallback = true;
  }

  // Deduplicate and sort bars by time (prevents LightweightCharts errors)
  var seen = {};
  bars = bars.filter(function(b) {
    var k = String(b.time);
    if (seen[k]) return false;
    seen[k] = true;
    return true;
  });
  // Drop bars with missing/invalid OHLC (e.g. today's unclosed bar where close=null).
  // LightweightCharts throws "Value is null" and stops rendering candles otherwise.
  bars = bars.filter(function(b) {
    return b
      && b.open  != null && !isNaN(b.open)
      && b.high  != null && !isNaN(b.high)
      && b.low   != null && !isNaN(b.low)
      && b.close != null && !isNaN(b.close);
  });
  bars.sort(function(a, b) {
    var ta = typeof a.time === 'string' ? a.time : a.time;
    var tb = typeof b.time === 'string' ? b.time : b.time;
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });

  saveBars(targetSymbol, tf, bars);

  // Store for MA computation
  lastBars = bars;

  // Build volume data with colors
  var volData = bars.map(function(b) {
    var isUp = b.close >= b.open;
    return {
      time:  b.time,
      value: b.volume || 0,
      color: isUp ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)',
    };
  });

  // Set all series data
  var lineData = bars.map(function(b) { return { time: b.time, value: b.close }; });
  lineSeries.setData(lineData);
  candleSeries.setData(bars);
  barSeries.setData(bars);
  volumeSeries.setData(volData);

  // Update / re-render active MAs with new data
  clearMASeries();
  renderMAs(bars);

  // Fit time scale only on initial load (not on background refresh)
  if (!preserveZoom) {
    chartInstance.timeScale().fitContent();
  }

  // Subtitle
  var last = bars[bars.length - 1];
  var prev = bars[bars.length - 2];
  if (last && prev) {
    var chg    = last.close - prev.close;
    var chgPct = (chg / prev.close) * 100;
    var sign   = chg >= 0 ? '+' : '';
    var col    = chg >= 0 ? '#26a69a' : '#ef5350';
    document.getElementById('chartSubtitle').innerHTML =
      '<span style="color:' + col + '">' + sign + chg.toFixed(2) + ' (' + sign + chgPct.toFixed(2) + '%)</span>  מחיר: ' + formatPrice(last.close) +
      '  <span style="color:var(--text-muted);font-size:.72rem">Vol: ' + formatVolume(last.volume) + '</span>' +
      (usingFallback ? '  <span style="color:var(--gold);font-size:.72rem">(תצוגת גיבוי זמנית - מגבלת API)</span>' : '');
    // Update floating overlay
    var ciChange = document.getElementById('ciChange');
    var ciPrice  = document.getElementById('ciPrice');
    var ciVol    = document.getElementById('ciVol');
    if (ciChange) { ciChange.textContent = sign + chg.toFixed(2) + ' (' + sign + chgPct.toFixed(2) + '%)'; ciChange.style.color = col; }
    if (ciPrice)  ciPrice.textContent  = formatPrice(last.close);
    if (ciVol)    ciVol.textContent    = 'Vol ' + formatVolume(last.volume);
  }

  // Refresh drawing-tools overlay + advanced feature panels for this symbol
  try { if (window.NTDraw)     window.NTDraw.onSymbolChanged(); }     catch (e) {}
  try { if (window.NTFeatures) window.NTFeatures.onSymbolChanged(); } catch (e) {}
}

// ============================================
//   TIMEFRAME SWITCHER
// ============================================
function setTimeframe(tf, btn) {
  currentTF = tf;
  document.querySelectorAll('.tf-btn').forEach(function(b) { b.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  // sync both topbar and mobile strip
  var b2 = document.getElementById('tf-' + tf);
  if (b2) b2.classList.add('active');
  var mb = document.getElementById('mtf-' + tf);
  if (mb) mb.classList.add('active');
  loadChart(currentSymbol, tf);
}

// ============================================
//   CHART TYPE SWITCHER
// ============================================
function setChartType(type, btn) {
  chartType = type;

  var iconMap = { line: '📈', candle: '🕯️', bar: '📊' };
  var current = document.getElementById('chartTypeCurrent');
  if (current) current.textContent = iconMap[type] || '🕯️';

  ['optLine','optCandle','optBar'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  var activeId = type === 'line' ? 'optLine' : type === 'bar' ? 'optBar' : 'optCandle';
  var activeEl = document.getElementById(activeId);
  if (activeEl) activeEl.classList.add('active');

  lineSeries.applyOptions({    visible: type === 'line'   });
  candleSeries.applyOptions({ visible: type === 'candle' });
  barSeries.applyOptions({    visible: type === 'bar'    });

  var menu = document.getElementById('chartTypeMenu');
  if (menu) menu.classList.remove('open');
}

function toggleChartTypeMenu() {
  var btn = document.getElementById('chartTypeBtn');
  var menu = document.getElementById('chartTypeMenu');
  var panel = document.querySelector('.chart-panel');
  if (!menu || !btn) return;
  var willOpen = !menu.classList.contains('open');
  if (!willOpen) {
    menu.classList.remove('open');
    return;
  }

  if (menu.parentElement !== document.body) {
    document.body.appendChild(menu);
  }

  var rect = btn.getBoundingClientRect();
  var bounds = panel ? panel.getBoundingClientRect() : { left: 8, right: window.innerWidth - 8 };
  var menuWidth = menu.offsetWidth || 170;
  var minLeft = Math.max(8, bounds.left + 8);
  var maxLeft = Math.max(minLeft, bounds.right - menuWidth - 8);
  menu.style.left = Math.max(minLeft, Math.min(maxLeft, rect.left)) + 'px';
  menu.style.top = (rect.bottom + 4) + 'px';
  menu.classList.add('open');
}

// ============================================
//   VOLUME TOGGLE
// ============================================
function toggleVolume() {
  volumeVisible = !volumeVisible;
  if (volumeSeries) volumeSeries.applyOptions({ visible: volumeVisible });
  if (typeof renderMAPanel === 'function') renderMAPanel();
}

// ============================================
//   KEYBOARD SHORTCUTS
// ============================================
document.addEventListener('keydown', function(e) {
  if (e.altKey) {
    var tfMap = { '1':'1H', '2':'4H', '3':'8H', '4':'1D', '5':'1W', '6':'1M', '7':'1Q', '8':'6M' };
    if (tfMap[e.key]) { e.preventDefault(); setTimeframe(tfMap[e.key], null); return; }
  }
  if (e.key === 'Enter' && document.activeElement.id === 'searchInput')    searchStock();
});

// ============================================
//   QUOTE & CARDS
// ============================================
async function fetchQuote(symbol) {
  try {
    var chartUrl = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?interval=1d&range=1mo';
    var j = await fetchYahooProxyJson(chartUrl);
    var result = j && j.chart && j.chart.result && j.chart.result[0];
    var meta = result && result.meta;
    var quote = result && result.indicators && result.indicators.quote && result.indicators.quote[0];
    if (meta && quote && quote.close && quote.close.length) {
      var lastClose = quote.close[quote.close.length - 1];
      var previousClose = meta.previousClose || quote.close[Math.max(0, quote.close.length - 2)] || lastClose;
      var change = lastClose - previousClose;
      return {
        price: lastClose,
        change: change,
        changePct: previousClose ? (change / previousClose) * 100 : 0,
        name: (NAMES[symbol] || meta.symbol || symbol)
      };
    }
  } catch(e) { /* fallback */ }
  try {
    var d = await tdFetch('/quote', { symbol: symbol });
    if (d && d.close) {
      var price  = parseFloat(d.close);
      var open   = parseFloat(d.open);
      var change2 = price - open;
      return { price: price, change: change2, changePct: open ? (change2/open)*100 : 0, name: d.name || symbol };
    }
  } catch(e) { /* silent */ }
  return null;
}

async function loadCard(symbol) {
  var el = document.getElementById('card-' + symbol);
  if (!el) {
    var grid = document.getElementById('cardsGrid');
    if (!grid) {
      var dataOnly = await fetchQuote(symbol);
      if (dataOnly) priceCache[symbol] = dataOnly;
      return;
    }
    var div  = document.createElement('div');
    div.className = 'stock-card skeleton';
    div.id = 'card-' + symbol;
    grid.appendChild(div);
  }
  var data = await fetchQuote(symbol);
  if (!data) return;
  priceCache[symbol] = data;
  renderCard(symbol, data);
}

function renderCard(symbol, data) {
  var el = document.getElementById('card-' + symbol);
  if (!el) return;
  el.classList.remove('skeleton');
  el.onclick = function() { selectSymbol(symbol); };
  var chgClass = data.change >= 0 ? 'up' : 'down';
  var chgSign  = data.change >= 0 ? '+' : '';
  var name     = NAMES[symbol] || data.name || symbol;
  el.innerHTML =
    '<div class="card-symbol">' + symbol + '</div>' +
    '<div class="card-name">'   + name   + '</div>' +
    '<div class="card-price">'  + formatPrice(data.price, symbol) + '</div>' +
    '<div class="card-change '  + chgClass + '">' + chgSign + data.change.toFixed(2) + ' (' + chgSign + data.changePct.toFixed(2) + '%)</div>';
  if (symbol === currentSymbol) el.classList.add('active');
  else el.classList.remove('active');
}

// ============================================
//   NEWS
// ============================================
async function fetchNews(symbol) {
  try {
    var url = 'https://query2.finance.yahoo.com/v1/finance/search?q=' +
              encodeURIComponent(symbol) + '&newsCount=10&quotesCount=0';
    var d = await yfFetch(url);
    if (!d || !d.news) return [];
    return d.news;
  } catch(e) { return []; }
}

async function loadNews(symbol) {
  // תעדכן את הסמל בכותרת ה-popup
  var symEl = document.getElementById('newsSymbol');
  if (symEl) symEl.textContent = symbol;
  // סמן שיש חדשות
  var btn = document.getElementById('newsFloatBtn');
  var el  = document.getElementById('newsPopupList');
  if (!el) return;
  el.innerHTML = '<div style="padding:1rem;color:var(--text-muted);font-size:.82rem">טוען חדשות...</div>';
  var articles = await fetchNews(symbol);
  if (!articles.length) {
    el.innerHTML = '<div style="padding:1rem;color:var(--text-muted);font-size:.82rem">לא נמצאו חדשות. ' +
      '<a href="https://finance.yahoo.com/quote/' + encodeURIComponent(symbol) + '/news" ' +
      'target="_blank" rel="noopener" style="color:var(--accent)">פתח Yahoo Finance &#8599;</a></div>';
    return;
  }
  if (btn) btn.classList.add('has-news');
  el.innerHTML = articles.slice(0, 8).map(function(a) {
    var date = a.providerPublishTime
      ? new Date(a.providerPublishTime * 1000).toLocaleDateString('he-IL')
      : '';
    return '<div class="news-item">' +
      '<a href="' + (a.link || '#') + '" target="_blank" rel="noopener">' + (a.title || '') + '</a>' +
      '<div class="news-meta">' + (a.publisher || 'Yahoo Finance') + '&nbsp;&nbsp;' + date + '</div>' +
      '</div>';
  }).join('');
}

function toggleNewsPopup() {
  var popup = document.getElementById('newsPopup');
  var btn   = document.getElementById('newsFloatBtn');
  if (!popup) return;
  var isOpen = popup.classList.toggle('open');
  if (btn) btn.style.borderColor = isOpen ? 'var(--accent)' : '';
}

function togglePortfolioPopup() {
  var popup = document.getElementById('portfolioPopup');
  var btn   = document.getElementById('portfolioFloatBtn');
  if (!popup) return;
  var isOpen = popup.classList.toggle('open');
  if (btn) {
    btn.style.borderColor = isOpen ? 'var(--gold)' : 'rgba(245,166,35,.45)';
  }
}

function toggleAlertPopup() {
  var popup = document.getElementById('alertPopup');
  var btn   = document.getElementById('alertFloatBtn');
  if (!popup) return;
  var isOpen = popup.classList.toggle('open');
  if (btn) {
    btn.style.borderColor = isOpen ? 'var(--gold)' : 'rgba(245,166,35,.45)';
  }
}

function toggleUserMenu() {
  var dd = document.getElementById('userDropdown');
  if (!dd) return;
  dd.classList.toggle('open');
}

document.addEventListener('click', function(e) {
  var userMenu = document.querySelector('.user-menu');
  var userDd = document.getElementById('userDropdown');
  if (userDd && userDd.classList.contains('open') && userMenu && !userMenu.contains(e.target)) {
    userDd.classList.remove('open');
  }

  var chartTypeWrap = document.querySelector('.chart-type-wrap');
  var chartTypeMenu = document.getElementById('chartTypeMenu');
  if (chartTypeMenu && chartTypeMenu.classList.contains('open') && chartTypeWrap && !chartTypeWrap.contains(e.target) && !chartTypeMenu.contains(e.target)) {
    chartTypeMenu.classList.remove('open');
  }
});
// ============================================
//   WATCHLIST
// ============================================
function renderWatchlist() {
  var symFilter = ((document.getElementById('wlSymFilter') || {}).value || '').trim().toUpperCase();
  var pctFilter = ((document.getElementById('wlPctFilter') || {}).value || '');
  var ul = document.getElementById('watchlist');
  var toShow = watchlist.filter(function(sym) {
    if (symFilter && sym.replace('.TA','').indexOf(symFilter) === -1) return false;
    if (pctFilter) {
      var d = priceCache[sym];
      if (d) {
        var pct = d.changePct;
        if (pctFilter === 'up' && pct < 0) return false;
        if (pctFilter === 'down' && pct >= 0) return false;
        var thresh = parseFloat(pctFilter);
        if (!isNaN(thresh)) {
          if (thresh > 0 && pct < thresh) return false;
          if (thresh < 0 && pct > thresh) return false;
        }
      }
    }
    return true;
  });
  ul.innerHTML = toShow.map(function(sym) {
    var d   = priceCache[sym];
    var cls = d ? (d.change >= 0 ? 'up' : 'down') : '';
    var pct = d ? (d.change >= 0 ? '+' : '') + d.changePct.toFixed(2) + '%' : '';
    var name = (NAMES[sym] || (d && d.name) || sym).replace(/\s*\(.*?\)\s*/g, '').trim();
    var shortSym = sym.replace('.TA','');
    var logoUrl = getStockLogo(sym);
    if (logoUrl === null) fetchStockLogoAsync(sym);
    var logoImg = '<img class="wl-logo" data-sym="' + shortSym + '" src="' + (logoUrl || '') + '"'
      + (logoUrl ? '' : ' style="display:none"')
      + ' width="18" height="18" onerror="this.style.display=\'none\'">';
    return '<li class="watch-item" onclick="selectSymbol(\'' + sym + '\')">'
      + logoImg
      + '<div class="watch-main">'
      + '<span class="watch-sym">' + shortSym + '</span>'
      + '<span class="watch-name">' + name + '</span>'
      + '</div>'
      + (pct ? '<span class="watch-chg ' + cls + '">' + pct + '</span>' : '')
      + '<button class="watch-remove-btn" title="מחק" onclick="removeFromWatchlist(event,\'' + sym + '\')">✕</button>'
      + '</li>';
  }).join('');
}

async function addToWatchlist() {
  var input = document.getElementById('searchInput');
  var sym   = (input ? input.value : '').trim().toUpperCase();
  if (!sym) return;

  var resolved = await resolveSymbolForData(sym, currentTF);
  var finalSym = resolved || sym;
  if (watchlist.includes(finalSym)) return;

  watchlist.push(finalSym);
  localStorage.setItem('ml_watchlist', JSON.stringify(watchlist));
  await loadCard(finalSym);
  renderWatchlist();
}

function removeFromWatchlist(e, sym) {
  e.stopPropagation();
  watchlist = watchlist.filter(function(s) { return s !== sym; });
  localStorage.setItem('ml_watchlist', JSON.stringify(watchlist));
  renderWatchlist();
}

// ============================================
//   PORTFOLIO
// ============================================
function renderPortfolio() {
  var ul = document.getElementById('portfolioList');
  if (!portfolio.length) { ul.innerHTML = ''; document.getElementById('portfolioTotal').textContent = ''; return; }
  var totalPnl = 0;
  ul.innerHTML = portfolio.map(function(p, i) {
    var current = (priceCache[p.symbol] && priceCache[p.symbol].price) || p.buyPrice;
    var pnl     = (current - p.buyPrice) * p.shares;
    var pnlPct  = ((current - p.buyPrice) / p.buyPrice) * 100;
    totalPnl += pnl;
    var cls  = pnl >= 0 ? 'up' : 'down';
    var sign = pnl >= 0 ? '+' : '';
    return '<li class="port-item">'
      + '<div style="display:flex;justify-content:space-between">'
      + '<span class="port-sym">' + p.symbol + '</span>'
      + '<button class="remove-btn" onclick="removeFromPortfolio(' + i + ')"></button></div>'
      + '<span class="port-detail">' + p.shares + ' מניות @ ' + formatPrice(p.buyPrice) + '</span>'
      + '<span class="port-pnl ' + cls + '">' + sign + formatPrice(pnl) + ' (' + sign + pnlPct.toFixed(2) + '%)</span>'
      + '</li>';
  }).join('');
  var col  = totalPnl >= 0 ? '#26a69a' : '#ef5350';
  var sign = totalPnl >= 0 ? '+' : '';
  document.getElementById('portfolioTotal').innerHTML = 'רווח/הפסד כולל: <span style="color:' + col + '">' + sign + formatPrice(totalPnl) + '</span>';
}

async function addToPortfolio() {
  var sym    = document.getElementById('portSymbol').value.trim().toUpperCase();
  var shares = parseFloat(document.getElementById('portShares').value);
  var price  = parseFloat(document.getElementById('portPrice').value);
  if (!sym || !shares || !price) return;
  portfolio.push({ symbol: sym, shares: shares, buyPrice: price });
  localStorage.setItem('ml_portfolio', JSON.stringify(portfolio));
  document.getElementById('portSymbol').value = '';
  document.getElementById('portShares').value = '';
  document.getElementById('portPrice').value  = '';
  await loadCard(sym);
  renderPortfolio();
}

function removeFromPortfolio(i) {
  portfolio.splice(i, 1);
  localStorage.setItem('ml_portfolio', JSON.stringify(portfolio));
  renderPortfolio();
}

// ============================================
//   ALERTS
// ============================================
// ============================================
//   EMAILJS — email alerts
// ============================================
var EJS_KEY = 'nt_emailjs_cfg';
var _ejsCfg = null;

(function loadEJSConfig() {
  try { _ejsCfg = JSON.parse(localStorage.getItem(EJS_KEY)) || null; } catch(e) {}
  if (_ejsCfg && _ejsCfg.publicKey) {
    try { emailjs.init({ publicKey: _ejsCfg.publicKey }); } catch(e) {}
  }
  updateEJSStatusUI();
})();

function updateEJSStatusUI() {
  var el = document.getElementById('ejsStatus');
  if (!el) return;
  if (_ejsCfg && _ejsCfg.serviceId && _ejsCfg.templateId && _ejsCfg.publicKey) {
    el.textContent = '✅ EmailJS מוגדר — מיילים ישלחו';
    el.style.color = '#26a69a';
  } else {
    el.textContent = '⚠️ EmailJS לא מוגדר — מיילים לא ישלחו';
    el.style.color = '#8b9ab5';
  }
}

function toggleEmailJSForm() {
  var f = document.getElementById('alertEmailJSForm');
  if (!f) return;
  var visible = f.style.display !== 'none';
  f.style.display = visible ? 'none' : '';
  if (!visible && _ejsCfg) {
    if (_ejsCfg.serviceId)  document.getElementById('ejsServiceId').value  = _ejsCfg.serviceId;
    if (_ejsCfg.templateId) document.getElementById('ejsTemplateId').value = _ejsCfg.templateId;
    if (_ejsCfg.publicKey)  document.getElementById('ejsPublicKey').value  = _ejsCfg.publicKey;
  }
}

function saveEmailJSConfig() {
  var svc  = (document.getElementById('ejsServiceId').value  || '').trim();
  var tmpl = (document.getElementById('ejsTemplateId').value || '').trim();
  var key  = (document.getElementById('ejsPublicKey').value  || '').trim();
  if (!svc || !tmpl || !key) { alert('נא למלא את כל שלושת השדות'); return; }
  _ejsCfg = { serviceId: svc, templateId: tmpl, publicKey: key };
  localStorage.setItem(EJS_KEY, JSON.stringify(_ejsCfg));
  try { emailjs.init({ publicKey: key }); } catch(e) {}
  updateEJSStatusUI();
  document.getElementById('alertEmailJSForm').style.display = 'none';
}

function ctxAddAlert() {
  var price = parseFloat(document.getElementById('ctxAlertPriceInp').value);
  var cond  = document.getElementById('ctxAlertCond').value;
  var email = (document.getElementById('ctxAlertEmail').value || '').trim().toLowerCase();
  var sym   = currentSymbol;
  if (!sym || !price || isNaN(price)) return;
  alerts.push({ symbol: sym, condition: cond, price: price, email: email || null });
  localStorage.setItem('ml_alerts', JSON.stringify(alerts));
  renderAlerts();
  // Close menu and show quick confirmation
  document.getElementById('chartCtxMenu').classList.remove('open');
  var banner = document.createElement('div');
  banner.textContent = '✅ התראה נוספה: ' + sym + ' ' + (cond === 'above' ? 'מעל' : 'מתחת') + ' ' + formatPrice(price);
  banner.style.cssText = 'position:fixed;bottom:70px;left:50%;transform:translateX(-50%);background:#0a3020;border:1px solid #26a69a;color:#26a69a;padding:.4rem 1rem;border-radius:8px;font-size:.78rem;z-index:9999;font-family:Heebo,sans-serif;';
  document.body.appendChild(banner);
  setTimeout(function() { banner.remove(); }, 2500);
}

var _alertFired = {};  // track already-sent alerts to avoid spam

async function sendAlertEmail(a, currentPrice) {
  if (!_ejsCfg || !_ejsCfg.serviceId || !a.email) return;
  var fireKey = a.symbol + '_' + a.condition + '_' + a.price;
  if (_alertFired[fireKey]) return; // already sent this session
  _alertFired[fireKey] = true;
  var condLabel = a.condition === 'above' ? 'עלה מעל' : 'ירד מתחת ל';
  try {
    await emailjs.send(_ejsCfg.serviceId, _ejsCfg.templateId, {
      to_email:    a.email,
      symbol:      a.symbol,
      condition:   condLabel,
      target:      formatPrice(a.price, a.symbol),
      current:     formatPrice(currentPrice, a.symbol),
      time:        new Date().toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem' }),
    });
    console.log('[NexTrade] Alert email sent for', a.symbol);
  } catch(e) {
    console.error('[NexTrade] EmailJS error:', e);
    _alertFired[fireKey] = false; // allow retry
  }
}

function renderAlerts() {
  var ul = document.getElementById('alertsList');
  if (!ul) return;
  if (!alerts.length) { ul.innerHTML = ''; drawAlertLines(); return; }
  ul.innerHTML = alerts.map(function(a, i) {
    var triggered = checkAlert(a);
    return '<li class="watch-item">'
      + '<div style="flex:1;min-width:0">'
      + '<span class="watch-sym">' + a.symbol + '</span>'
      + ' <span style="font-size:.72rem;color:var(--text-muted)">' + (a.condition === 'above' ? 'מעל' : 'מתחת') + ' ' + formatPrice(a.price) + '</span>'
      + (a.email ? '<div style="font-size:.64rem;color:var(--text-muted);margin-top:.1rem">✉️ ' + a.email + '</div>' : '')
      + (triggered ? ' <span style="font-size:.68rem;background:rgba(245,166,35,.15);color:#f5a623;padding:.1rem .4rem;border-radius:4px;font-weight:700">הופעל</span>' : '')
      + '</div>'
      + '<button class="watch-remove-btn" onclick="removeAlert(' + i + ')" style="visibility:visible">✕</button>'
      + '</li>';
  }).join('');
  drawAlertLines();
}

function addAlert() {
  var sym   = document.getElementById('alertSymbol').value.trim().toUpperCase();
  var cond  = document.getElementById('alertCondition').value;
  var price = parseFloat(document.getElementById('alertPrice').value);
  var email = (document.getElementById('alertEmail').value || '').trim().toLowerCase();
  if (!sym || !price) return;
  alerts.push({ symbol: sym, condition: cond, price: price, email: email || null });
  localStorage.setItem('ml_alerts', JSON.stringify(alerts));
  document.getElementById('alertSymbol').value = '';
  document.getElementById('alertPrice').value  = '';
  document.getElementById('alertEmail').value  = '';
  renderAlerts();
}

function removeAlert(i) {
  var a = alerts[i];
  if (a) { var k = a.symbol + '_' + a.condition + '_' + a.price; delete _alertFired[k]; }
  alerts.splice(i, 1);
  localStorage.setItem('ml_alerts', JSON.stringify(alerts));
  renderAlerts();
}

function checkAlert(a) {
  var current = priceCache[a.symbol] && priceCache[a.symbol].price;
  if (!current) return false;
  var triggered = (a.condition === 'above' && current > a.price) || (a.condition === 'below' && current < a.price);
  if (triggered) {
    sendAlertEmail(a, current);
    // Add triggered alert to bell panel
    addTriggeredToBell(a, current);
  }
  return triggered;
}

function addTriggeredToBell(a, currentPrice) {
  var key = a.symbol + '_' + a.condition + '_' + a.price;
  // Check if already in bell panel
  var ibAlerts2 = JSON.parse(localStorage.getItem('ib_alerts2') || '[]');
  var exists = ibAlerts2.some(function(b) { return b.key === key; });
  if (exists) return;
  ibAlerts2.push({
    sym: a.symbol,
    price: a.price,
    current: currentPrice,
    condition: a.condition,
    time: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
    key: key
  });
  localStorage.setItem('ib_alerts2', JSON.stringify(ibAlerts2));
  // Update global and UI
  if (typeof window.ibAlerts2 !== 'undefined') window.ibAlerts2 = ibAlerts2;
  if (typeof ibRenderAlerts2 === 'function') ibRenderAlerts2();
  // Flash bell icon
  var bellBtn = document.getElementById('ib-alerts');
  if (bellBtn) {
    bellBtn.style.animation = 'none';
    bellBtn.offsetHeight; // reflow
    bellBtn.style.animation = 'bellPulse 0.6s ease 3';
  }
}

// ============================================
//   ALERT LINES ON CHART
// ============================================
var _alertPriceLines = []; // { idx, priceLine, color }
var _alertLineColors = ['#f5a623','#e91e63','#00bcd4','#8bc34a','#9c27b0','#ff5722','#03a9f4','#cddc39'];
var _alertOverlayContainer = null;

function getAlertLineColor(idx) {
  return _alertLineColors[idx % _alertLineColors.length];
}

function drawAlertLines() {
  // Remove old price lines
  var series = candleSeries || lineSeries || barSeries;
  if (!series) return;
  _alertPriceLines.forEach(function(item) {
    try { series.removePriceLine(item.priceLine); } catch(e) {}
  });
  _alertPriceLines = [];

  // Draw price lines for alerts matching current symbol
  var symbolAlerts = [];
  alerts.forEach(function(a, i) {
    if (a.symbol === currentSymbol) symbolAlerts.push({ alert: a, idx: i });
  });

  symbolAlerts.forEach(function(item, colorIdx) {
    var color = getAlertLineColor(colorIdx);
    var pl = series.createPriceLine({
      price: item.alert.price,
      color: color,
      lineWidth: 2,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true,
      title: (item.alert.condition === 'above' ? '▲' : '▼') + ' ' + formatPrice(item.alert.price),
    });
    _alertPriceLines.push({ idx: item.idx, priceLine: pl, color: color });
  });

  // Update overlay icons
  updateAlertOverlays();
}

function updateAlertOverlays() {
  if (!_alertOverlayContainer) {
    _alertOverlayContainer = document.createElement('div');
    _alertOverlayContainer.id = 'alertLinesOverlay';
    _alertOverlayContainer.style.cssText = 'position:absolute;top:0;left:0;right:65px;bottom:0;pointer-events:none;z-index:20;overflow:hidden;';
    var chartEl = document.getElementById('chart');
    if (chartEl) {
      chartEl.style.position = 'relative';
      chartEl.appendChild(_alertOverlayContainer);
    }
  }
  _alertOverlayContainer.innerHTML = '';

  var series = candleSeries || lineSeries || barSeries;
  if (!series || !chartInstance) return;

  _alertPriceLines.forEach(function(item) {
    var a = alerts[item.idx];
    if (!a) return;
    var y = series.priceToCoordinate(a.price);
    if (y === null || y === undefined) return;

    var row = document.createElement('div');
    row.className = 'alert-line-icons';
    row.style.cssText = 'position:absolute;left:8px;top:' + (y - 12) + 'px;pointer-events:auto;display:flex;gap:4px;align-items:center;cursor:ns-resize;';
    row.dataset.alertIdx = item.idx;

    // Clock icon
    var clock = document.createElement('span');
    clock.textContent = '⏰';
    clock.style.cssText = 'font-size:14px;opacity:0.9;';
    clock.title = 'התראה פעילה';
    row.appendChild(clock);

    // Trash icon
    var trash = document.createElement('span');
    trash.textContent = '🗑️';
    trash.style.cssText = 'font-size:14px;opacity:0.9;cursor:pointer;';
    trash.title = 'מחק התראה';
    trash.onclick = function(e) {
      e.stopPropagation();
      removeAlert(item.idx);
      drawAlertLines();
    };
    row.appendChild(trash);

    // Drag to move alert line — smooth, no chart pan, no flickering
    row.onmousedown = function(e) {
      if (e.target === trash) return;
      e.preventDefault();
      e.stopPropagation();

      // Freeze chart scroll/pan for the duration of the drag
      if (chartInstance) {
        chartInstance.applyOptions({ handleScroll: { pressedMouseMove: false, horzTouchDrag: false, vertTouchDrag: false } });
      }

      var chartEl = document.getElementById('chart');
      var rect = chartEl.getBoundingClientRect();
      var capturedRow = row;
      var capturedPl  = item.priceLine;
      var capturedIdx = item.idx;
      var capturedCond = a.condition;

      function onMove(ev) {
        var localY = ev.clientY - rect.top;
        var newPrice = series.coordinateToPrice(localY);
        if (newPrice !== null && newPrice > 0) {
          var rounded = Math.round(newPrice * 100) / 100;
          // Move the icon row visually (no DOM rebuild)
          capturedRow.style.top = (localY - 12) + 'px';
          // Slide the price line in-place (no remove/create → no flicker)
          try {
            capturedPl.applyOptions({
              price: rounded,
              title: (capturedCond === 'above' ? '▲' : '▼') + ' ' + rounded.toFixed(2)
            });
          } catch(ex) {}
        }
      }

      function onUp(ev) {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        // Restore chart interaction
        if (chartInstance) {
          chartInstance.applyOptions({ handleScroll: { pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true } });
        }
        // Commit final price
        var localY = ev.clientY - rect.top;
        var newPrice = series.coordinateToPrice(localY);
        if (newPrice !== null && newPrice > 0) {
          alerts[capturedIdx].price = Math.round(newPrice * 100) / 100;
          localStorage.setItem('ml_alerts', JSON.stringify(alerts));
        }
        // Full rebuild only once at the end
        drawAlertLines();
        renderAlerts();
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };

    _alertOverlayContainer.appendChild(row);
  });
}

// Re-position overlays on crosshair/scale changes
function initAlertLineUpdater() {
  if (!chartInstance) return;
  chartInstance.subscribeCrosshairMove(function() {
    if (_alertPriceLines.length) updateAlertOverlays();
  });
  chartInstance.timeScale().subscribeVisibleLogicalRangeChange(function() {
    if (_alertPriceLines.length) updateAlertOverlays();
  });
}

// ============================================
//   SEARCH & SELECT
// ============================================
async function searchStock() {
  var sym = document.getElementById('searchInput').value.trim().toUpperCase();
  if (!sym) return;
  document.getElementById('searchInput').value = '';
  var resolved = await resolveSymbolForData(sym, currentTF);
  if (!resolved) {
    document.getElementById('chartTitle').textContent = sym;
    document.getElementById('chartSubtitle').textContent = 'לא נמצאו נתוני גרף עבור הסימבול. נסה סימבול אחר או פורמט .TA';
    return;
  }
  await selectSymbol(resolved);
}

async function selectSymbol(symbol) {
  var resolved = await resolveSymbolForData(symbol, currentTF);
  if (!resolved) {
    document.getElementById('chartTitle').textContent = symbol;
    document.getElementById('chartSubtitle').textContent = 'לא נמצאו נתונים ב-Yahoo Finance. נסה פורמט XXXX.TA למניות תא';
    return;
  }

  currentSymbol = resolved;
  await loadChart(resolved, currentTF);
  await loadNews(resolved);
  if (!priceCache[resolved]) await loadCard(resolved);
  renderWatchlist();
  renderPortfolio();
  renderAlerts();
}

// ============================================
//   TICKER
// ============================================
async function buildTicker() {
  var all   = Array.from(new Set(DEFAULT_SYMBOLS.concat(watchlist)));
  var parts = await Promise.all(all.map(async function(sym) {
    var d = priceCache[sym] || await fetchQuote(sym);
    if (!d) return sym + ': N/A';
    var sign = d.change >= 0 ? '' : '';
    var col  = d.change >= 0 ? 'up' : 'down';
    return '<span>' + sym + ': ' + formatPrice(d.price) + ' </span><span class="' + col + '">' + sign + ' ' + Math.abs(d.changePct).toFixed(2) + '%</span>';
  }));
  var text = parts.join('<span style="color:var(--border)">    </span>');
  document.getElementById('tickerInner').innerHTML = text + '<span style="color:var(--border)">    </span>' + text;
}

async function refreshPrices() {
  var all = Array.from(new Set(DEFAULT_SYMBOLS.concat(watchlist).concat(portfolio.map(function(p) { return p.symbol; }))));
  await Promise.all(all.map(async function(sym) {
    var d = await fetchQuote(sym);
    if (d) { priceCache[sym] = d; renderCard(sym, d); }
  }));
  renderWatchlist();
  renderPortfolio();
  renderAlerts();
  buildTicker();
  updateTASEBadge();
  runAutoScanner(); // auto scan after each price refresh
}

// ============================================
//   FORMATTERS
// ============================================
function formatPrice(p, sym) {
  if (p === null || p === undefined || isNaN(p)) return '';
  var s    = (sym || currentSymbol || '').toUpperCase();
  var curr = s.endsWith('.TA') ? '\u20AA' : '$';
  if (p >= 1000) return curr + p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1)    return curr + p.toFixed(2);
  return curr + p.toFixed(4);
}

function formatVolume(v) {
  if (!v || isNaN(v)) return '';
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return v.toString();
}

// ============================================
//   INIT
// ============================================
async function init() {
  try {
    console.log('[NexTrade] init() starting...');
    initChart();
    initPriceAxisScroll();
    initChartVerticalPan();
    initChartContextMenu();
    initAlertLineUpdater();
    renderMAPanel();
    console.log('[NexTrade] Chart initialized.');
    
    updateTASEBadge();
    setInterval(updateTASEBadge, 1000); // clock updates every second
    
    renderWatchlist();
    renderPortfolio();
    renderAlerts();

    // Load the full TASE stock universe for the search box (cached for 7 days).
    // Use cache immediately if present so search works instantly; refresh in background.
    buildUniverseFromCache();
    loadTASEUniverse();

    console.log('[NexTrade] Loading cards for symbols:', DEFAULT_SYMBOLS);
    await Promise.all(DEFAULT_SYMBOLS.map(function(s) { return loadCard(s); }));
    console.log('[NexTrade] Cards loaded.');
    
    console.log('[NexTrade] Loading chart for:', currentSymbol, currentTF);
    var resolvedInitial = await resolveSymbolForData(currentSymbol, currentTF);
    if (resolvedInitial) {
      currentSymbol = resolvedInitial;
    } else if (watchlist.length) {
      for (var i = 0; i < watchlist.length; i++) {
        var candidate = await resolveSymbolForData(watchlist[i], currentTF);
        if (candidate) {
          currentSymbol = candidate;
          break;
        }
      }
    }
    await loadChart(currentSymbol, currentTF);
    console.log('[NexTrade] Chart loaded.');
    
    await loadNews(currentSymbol);
    buildTicker();
    setInterval(refreshPrices, 60000);
    // Refresh chart data every 60s (price updates) WITHOUT resetting zoom
    setInterval(function() {
      delete candleCache[currentSymbol + '_' + currentTF];
      delete candleCache['yf_' + currentSymbol + '_' + currentTF];
      loadChart(currentSymbol, currentTF, true); // true = preserve zoom
    }, 60000);
    
    console.log('[NexTrade] ✅ init() completed successfully!');
    runScanner();
  } catch(e) {
    console.error('[NexTrade] ❌ init() failed:', e.message || e, e.stack);
  }
}

// ============================================
//   SCANNER RULES — ניתן לערוך / להוסיף כללים
// ============================================
// כל כלל: { id, name, check(data) → bool, message(data) → string, severity: 'green'|'red'|'yellow' }
// data = { sym, price, changePct, change, high, low }
var SCANNER_RULES = [
  {
    id: 'big_up',
    name: '📈 עלייה חדה',
    check:   function(d) { return d.changePct >= 3; },
    message: function(d) { return '📈 ' + d.sym.replace('.TA','') + ' +' + d.changePct.toFixed(1) + '% — עלייה חדה'; },
    severity: 'green'
  },
  {
    id: 'big_down',
    name: '📉 ירידה חדה',
    check:   function(d) { return d.changePct <= -3; },
    message: function(d) { return '📉 ' + d.sym.replace('.TA','') + ' ' + d.changePct.toFixed(1) + '% — ירידה חדה'; },
    severity: 'red'
  },
  {
    id: 'moderate_up',
    name: '↑ עלייה מתונה',
    check:   function(d) { return d.changePct >= 1.5 && d.changePct < 3; },
    message: function(d) { return '↑ ' + d.sym.replace('.TA','') + ' +' + d.changePct.toFixed(1) + '% — עלייה מתונה'; },
    severity: 'green'
  },
  {
    id: 'moderate_down',
    name: '↓ ירידה מתונה',
    check:   function(d) { return d.changePct <= -1.5 && d.changePct > -3; },
    message: function(d) { return '↓ ' + d.sym.replace('.TA','') + ' ' + d.changePct.toFixed(1) + '% — ירידה מתונה'; },
    severity: 'yellow'
  }
  // ← הוסף כאן כללים נוספים לפי הצורך
];

// Tracks which rules already fired today (per symbol) to avoid spam
var _scannerFiredKeys = {};

function runAutoScanner() {
  var syms = Array.from(new Set(SCANNER_SYMS.concat(watchlist)));
  var fired = false;

  syms.forEach(function(sym) {
    var d = priceCache[sym];
    if (!d || !d.price) return;
    var data = { sym: sym, price: d.price, changePct: d.changePct || 0, change: d.change || 0 };

    SCANNER_RULES.forEach(function(rule) {
      if (!rule.check(data)) return;
      // Fire at most once per calendar day per (rule, symbol)
      var key = rule.id + '_' + sym + '_' + new Date().toDateString();
      if (_scannerFiredKeys[key]) return;
      _scannerFiredKeys[key] = true;
      fired = true;

      var time = new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
      var msg  = rule.message(data);

      // Push to bell panel
      var stored = JSON.parse(localStorage.getItem('ib_alerts2') || '[]');
      stored.unshift({ sym: sym, price: d.price, condition: 'scanner', time: time, key: key, msg: msg, severity: rule.severity });
      if (stored.length > 50) stored = stored.slice(0, 50);
      localStorage.setItem('ib_alerts2', JSON.stringify(stored));
    });
  });

  if (fired) {
    // Flash the bell icon
    var bellBtn = document.getElementById('ib-alerts');
    if (bellBtn) {
      bellBtn.style.animation = 'none';
      bellBtn.offsetHeight; // reflow
      bellBtn.style.animation = 'bellPulse 0.6s ease 3';
    }
    if (typeof ibRenderAlerts2 === 'function') ibRenderAlerts2();
  }
}

// ============================================
//   SMART SCANNER — התראות מהסורק החכם
// ============================================
var SCANNER_SYMS = [
  'TEVA.TA','ELBIT.TA','BEZQ.TA','POLI.TA','LUMI.TA','AZRG.TA',
  'BOB.TA','TASE.TA','MGDL.TA','HAP.TA','NICE','CHKP',
  'ENLT.TA','KDST.TA','ONE.TA','SPEN.TA','ICL.TA','FIBI.TA'
];

var SCANNER_SIGNAL_NAMES = [
  'פריצת התנגדות','מומנטום חיובי','נר בולי חזק','RSI עולה','נפח גבוה מהרגיל','מגמת עלייה'
];

async function runScanner() {
  var el = document.getElementById('scannerList');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--text-muted);font-size:.78rem;text-align:center;padding:1.2rem 0">&#128270; סורק מניות...</div>';

  var results = [];
  var syms = Array.from(new Set(SCANNER_SYMS.concat(watchlist)));

  await Promise.all(syms.map(async function(sym) {
    try {
      var bars = await fetchYahooChartDirect(sym, '1D');
      if (!bars || bars.length < 5) return;
      var last  = bars[bars.length - 1];
      var prev  = bars[bars.length - 2];
      var prev3 = bars[bars.length - 4];
      if (!last || !prev || !prev3) return;

      var isBullishCandle = last.close > last.open;
      var hasMomentum     = last.close > prev3.close;
      var aboveOpen       = last.close > prev.close;
      var bodyPct         = Math.abs(last.close - last.open) / last.open * 100;
      var changePct       = (last.close - prev.close) / prev.close * 100;

      // קריטריון: נר ירוק + מומנטום חיובי + שינוי > 0.2%
      if (isBullishCandle && hasMomentum && aboveOpen && bodyPct > 0.2) {
        var signalIdx = (sym.charCodeAt(0) + sym.charCodeAt(1)) % SCANNER_SIGNAL_NAMES.length;
        results.push({
          sym:      sym,
          name:     NAMES[sym] || sym.replace('.TA',''),
          price:    last.close,
          pct:      changePct,
          signal:   SCANNER_SIGNAL_NAMES[signalIdx],
          strength: bodyPct + (hasMomentum ? 1 : 0)
        });
      }
    } catch(e) {}
  }));

  var el2 = document.getElementById('scannerList');
  if (!el2) return;

  if (!results.length) {
    el2.innerHTML = '<div style="color:var(--text-muted);font-size:.78rem;text-align:center;padding:1.2rem 0">אין התראות פעילות כרגע</div>';
    return;
  }

  results.sort(function(a, b) { return b.strength - a.strength; });

  el2.innerHTML = results.slice(0, 8).map(function(r) {
    var isTASE = r.sym.endsWith('.TA');
    var curr   = isTASE ? '\u20AA' : '$';
    var pctStr = (r.pct >= 0 ? '+' : '') + r.pct.toFixed(2) + '%';
    var shortSym = r.sym.replace('.TA','');
    return '<div class="index-item" onclick="loadChart(\'' + r.sym + '\')" style="display:flex;flex-direction:row;align-items:center;justify-content:space-between;gap:.4rem;padding:.42rem .6rem;cursor:pointer;">'
      + '<span style="font-size:.8rem;font-weight:700;color:var(--green);min-width:40px">' + shortSym + '</span>'
      + '<span style="font-size:.7rem;color:var(--text-muted);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + r.name + '</span>'
      + '<span class="badge up" style="flex-shrink:0">' + pctStr + '</span>'
      + '</div>';
  }).join('');
}

// ============================================
//   SEARCH AUTOCOMPLETE
// ============================================
(function initSearchAutocomplete() {
  var ddActiveIdx = -1;

  function getDD()  { return document.getElementById('searchDropdown'); }
  function getInp() { return document.getElementById('searchInput'); }

  function closeDD() {
    var dd = getDD(); if (dd) { dd.innerHTML = ''; dd.classList.remove('open'); }
    ddActiveIdx = -1;
  }

  function pickSym(sym) {
    var inp = getInp(); if (inp) inp.value = sym.replace('.TA','');
    closeDD();
    selectSymbol(sym);
  }

  function buildDD(q) {
    var dd = getDD(); if (!dd) return;
    if (!q) { closeDD(); return; }
    var qu = q.toUpperCase();
    var matches = [];

    // Primary source: full TASE universe (pulled from Twelve Data)
    if (typeof TASE_UNIVERSE !== 'undefined' && TASE_UNIVERSE.length) {
      var starts = [];
      var contains = [];
      for (var i = 0; i < TASE_UNIVERSE.length; i++) {
        var it = TASE_UNIVERSE[i];
        var symU = it.short.toUpperCase();
        if (symU.indexOf(qu) === 0) {
          starts.push(it);                                   // symbol prefix → top
        } else if (symU.indexOf(qu) !== -1 || (it.name && it.name.indexOf(q) !== -1)) {
          contains.push(it);                                 // symbol/name contains
        }
        if (starts.length >= 12) break;
      }
      matches = starts.concat(contains).slice(0, 12).map(function(it) {
        return { sym: it.sym, short: it.short, name: it.name };
      });
    }

    // Fallback to the small built-in NAMES map if universe isn't loaded yet
    if (!matches.length) {
      matches = Object.keys(NAMES).filter(function(sym) {
        return sym.replace('.TA', '').toUpperCase().indexOf(qu) === 0 || NAMES[sym].indexOf(q) !== -1;
      }).slice(0, 10).map(function(sym) {
        return { sym: sym, short: sym.replace('.TA', ''), name: NAMES[sym] };
      });
    }

    if (!matches.length) { closeDD(); return; }
    dd.innerHTML = matches.map(function(m) {
      return '<div class="sd-item" data-sym="' + m.sym + '">'
        + '<span class="sd-sym">' + m.short + '</span>'
        + '<span class="sd-name">' + m.name + '</span>'
        + '</div>';
    }).join('');
    dd.querySelectorAll('.sd-item').forEach(function(el) {
      el.addEventListener('mousedown', function(e) { e.preventDefault(); });
      el.addEventListener('click', function() { pickSym(this.dataset.sym); });
    });
    ddActiveIdx = -1;
    dd.classList.add('open');
  }

  document.addEventListener('DOMContentLoaded', function() {
    var inp = getInp(); if (!inp) return;
    inp.addEventListener('input', function() { buildDD(this.value.trim()); });
    inp.addEventListener('keydown', function(e) {
      var dd = getDD();
      var items = dd ? Array.from(dd.querySelectorAll('.sd-item')) : [];
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        ddActiveIdx = Math.min(ddActiveIdx + 1, items.length - 1);
        items.forEach(function(el, i) { el.classList.toggle('active', i === ddActiveIdx); });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        ddActiveIdx = Math.max(ddActiveIdx - 1, 0);
        items.forEach(function(el, i) { el.classList.toggle('active', i === ddActiveIdx); });
      } else if (e.key === 'Enter') {
        if (ddActiveIdx >= 0 && items[ddActiveIdx]) {
          e.stopPropagation();
          pickSym(items[ddActiveIdx].dataset.sym);
        }
      } else if (e.key === 'Escape') { closeDD(); }
    });
    inp.addEventListener('blur', function() { setTimeout(closeDD, 160); });
  });
})();

// ============================================
//   SEARCH MODAL (centered overlay with tabs)
// ============================================
var smCurrentTab = 'stocks';

var SM_INDICES = [
  { sym: 'TA35.TA', short: 'TA35', name: 'מדד ת״א-35', cat: 'indices' },
  { sym: 'TA90.TA', short: 'TA90', name: 'מדד ת״א-90', cat: 'indices' },
  { sym: 'TA125.TA', short: 'TA125', name: 'מדד ת״א-125', cat: 'indices' },
  { sym: 'TABANK.TA', short: 'TABANK', name: 'מדד ת״א-בנקים', cat: 'indices' },
  { sym: 'TAREAL.TA', short: 'TAREAL', name: 'מדד ת״א-נדל"ן', cat: 'indices' },
  { sym: 'TATEC.TA', short: 'TATEC', name: 'מדד ת״א-טכנולוגיה', cat: 'indices' },
  { sym: 'TAFINANCE.TA', short: 'TAFINANCE', name: 'מדד ת״א-פיננסים', cat: 'indices' },
  { sym: 'TADUAL.TA', short: 'TADUAL', name: 'מדד ת״א-דואל ליסטד', cat: 'indices' },
  { sym: 'TASMALL.TA', short: 'TASMALL', name: 'מדד ת״א-Small', cat: 'indices' },
  { sym: 'TAGROWTH.TA', short: 'TAGROWTH', name: 'מדד ת״א-צמיחה', cat: 'indices' },
  { sym: 'TAOIL.TA', short: 'TAOIL', name: 'מדד ת״א-נפט וגז', cat: 'indices' },
  { sym: 'TAINSUR.TA', short: 'TAINSUR', name: 'מדד ת״א-ביטוח', cat: 'indices' },
];

var SM_GENERAL = [
  { sym: 'NVDA', short: 'NVDA', name: 'NVIDIA Corp.', cat: 'general' },
  { sym: 'AAPL', short: 'AAPL', name: 'Apple Inc.', cat: 'general' },
  { sym: 'MSFT', short: 'MSFT', name: 'Microsoft Corp.', cat: 'general' },
  { sym: 'GOOGL', short: 'GOOGL', name: 'Alphabet (Google)', cat: 'general' },
  { sym: 'AMZN', short: 'AMZN', name: 'Amazon.com', cat: 'general' },
  { sym: 'TSLA', short: 'TSLA', name: 'Tesla Inc.', cat: 'general' },
  { sym: 'META', short: 'META', name: 'Meta Platforms', cat: 'general' },
  { sym: 'NFLX', short: 'NFLX', name: 'Netflix Inc.', cat: 'general' },
  { sym: 'AMD', short: 'AMD', name: 'Advanced Micro Devices', cat: 'general' },
  { sym: 'INTC', short: 'INTC', name: 'Intel Corp.', cat: 'general' },
  { sym: 'NICE', short: 'NICE', name: 'NICE Systems', cat: 'general' },
  { sym: 'CHKP', short: 'CHKP', name: 'Check Point Software', cat: 'general' },
  { sym: 'MNDY', short: 'MNDY', name: 'Monday.com', cat: 'general' },
  { sym: 'GLBE', short: 'GLBE', name: 'Global-E Online', cat: 'general' },
  { sym: 'BTC-USD', short: 'BTC', name: 'Bitcoin USD', cat: 'general' },
  { sym: 'ETH-USD', short: 'ETH', name: 'Ethereum USD', cat: 'general' },
  { sym: 'GC=F', short: 'GOLD', name: 'Gold Futures', cat: 'general' },
  { sym: 'CL=F', short: 'OIL', name: 'Crude Oil Futures', cat: 'general' },
];

function openSearchModal() {
  var modal = document.getElementById('searchModal');
  if (!modal) return;
  modal.classList.add('open');
  var inp = document.getElementById('smInput');
  if (inp) { inp.value = ''; inp.focus(); }
  smSetTab(smCurrentTab);
}

function closeSearchModal() {
  var modal = document.getElementById('searchModal');
  if (modal) modal.classList.remove('open');
}

function smSetTab(tab) {
  smCurrentTab = tab;
  document.querySelectorAll('.sm-tab').forEach(function(el) {
    el.classList.toggle('active', el.getAttribute('data-cat') === tab);
  });
  smRender(document.getElementById('smInput') ? document.getElementById('smInput').value.trim() : '');
}

function smRender(q) {
  var body = document.getElementById('smBody');
  if (!body) return;
  var items = smGetItems(smCurrentTab, q);
  if (!items.length) {
    body.innerHTML = '<div class="sm-empty">' + (q ? 'לא נמצאו תוצאות עבור "' + q + '"' : 'אין פריטים') + '</div>';
    return;
  }
  var wl = watchlist || [];
  body.innerHTML = items.map(function(it) {
    var initials = smInitials(it.short);
    var bgCol = smColor(it.short);
    var inWL = wl.indexOf(it.sym) !== -1;
    return '<div class="sm-item">'
      + '<div class="sm-icon" style="background:' + bgCol + '" onclick="smPick(\'' + it.sym + '\')">' + initials + '</div>'
      + '<span class="sm-sym" onclick="smPick(\'' + it.sym + '\')">' + it.short + '</span>'
      + '<span class="sm-name" onclick="smPick(\'' + it.sym + '\')">' + it.name + '</span>'
      + '<button class="sm-wl-btn' + (inWL ? ' added' : '') + '" data-sym="' + it.sym + '" onclick="smToggleWL(this,\'' + it.sym + '\')">'
      + (inWL ? '✓' : '+') + '</button>'
      + '</div>';
  }).join('');
}

function smInitials(sym) {
  if (!sym) return '?';
  return sym.slice(0, 2).toUpperCase();
}
function smColor(sym) {
  var colors = ['#1a3a5c','#2d4a22','#4a2545','#3d3520','#1e3a3a','#3b2050','#2a3a10','#40252a','#1a3050','#2e2e4a'];
  var h = 0; for (var i = 0; i < sym.length; i++) h = (h * 31 + sym.charCodeAt(i)) & 0xffff;
  return colors[h % colors.length];
}

function smGetItems(tab, q) {
  var source;
  if (tab === 'indices') source = SM_INDICES;
  else if (tab === 'general') source = SM_GENERAL;
  else {
    // Israeli stocks from TASE universe
    source = (typeof TASE_UNIVERSE !== 'undefined' && TASE_UNIVERSE.length)
      ? TASE_UNIVERSE.map(function(it) { return { sym: it.sym, short: it.short, name: it.name }; })
      : Object.keys(NAMES).filter(function(s) { return s.endsWith('.TA'); }).map(function(s) { return { sym: s, short: s.replace('.TA',''), name: NAMES[s] }; });
  }
  if (!q) return source.slice(0, 40);
  var qu = q.toUpperCase();
  var starts = [], contains = [];
  for (var i = 0; i < source.length; i++) {
    var it = source[i];
    var su = it.short.toUpperCase();
    if (su.indexOf(qu) === 0) starts.push(it);
    else if (su.indexOf(qu) !== -1 || (it.name && it.name.indexOf(q) !== -1)) contains.push(it);
    if (starts.length >= 20) break;
  }
  return starts.concat(contains).slice(0, 30);
}

function smPick(sym) {
  closeSearchModal();
  selectSymbol(sym);
}

function smToggleWL(btn, sym) {
  var idx = watchlist.indexOf(sym);
  if (idx === -1) {
    watchlist.push(sym);
    btn.textContent = '✓';
    btn.classList.add('added');
  } else {
    watchlist.splice(idx, 1);
    btn.textContent = '+';
    btn.classList.remove('added');
  }
  localStorage.setItem('ml_watchlist', JSON.stringify(watchlist));
  renderWatchlist();
}

// Bind modal input + escape
document.addEventListener('DOMContentLoaded', function() {
  var smInp = document.getElementById('smInput');
  if (smInp) {
    smInp.addEventListener('input', function() { smRender(this.value.trim()); });
    smInp.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeSearchModal();
      if (e.key === 'Enter') {
        var first = document.querySelector('.sm-item');
        if (first) first.click();
      }
    });
  }
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeSearchModal();
  });
});

// ============================================
//   PORTFOLIO PAGE
// ============================================
var portHoldings = JSON.parse(localStorage.getItem('nxt_portfolio') || '[]');

function savePortfolio() {
  localStorage.setItem('nxt_portfolio', JSON.stringify(portHoldings));
}

function openPortPage() {
  document.getElementById('portPage').classList.add('open');
  renderPortPage();
  // fetch live prices for all holdings
  portHoldings.forEach(function(h) {
    fetchQuote(h.sym).then(function(d) {
      if (d) { priceCache[h.sym] = d; renderPortPage(); }
    });
  });
}

function closePortPage() {
  document.getElementById('portPage').classList.remove('open');
}

function portAddStock() {
  var symEl    = document.getElementById('portSymInput');
  var sharesEl = document.getElementById('portSharesInput');
  var priceEl  = document.getElementById('portPriceInput');
  var rawSym   = (symEl.value || '').trim().toUpperCase();
  var shares   = parseFloat(sharesEl.value) || 0;
  var buyPrice = parseFloat(priceEl.value)  || 0;
  if (!rawSym || shares <= 0) return;

  // Auto-append .TA for Israeli stocks if typed without dot
  var sym = rawSym;

  var existing = portHoldings.find(function(h) { return h.sym === sym; });
  if (existing) {
    // weighted average buy price
    var totalShares = existing.shares + shares;
    existing.buyPrice = ((existing.buyPrice * existing.shares) + (buyPrice * shares)) / totalShares;
    existing.shares   = totalShares;
  } else {
    portHoldings.push({ sym: sym, shares: shares, buyPrice: buyPrice });
  }
  savePortfolio();
  symEl.value = ''; sharesEl.value = ''; priceEl.value = '';
  renderPortPage();
  fetchQuote(sym).then(function(d) {
    if (d) { priceCache[sym] = d; renderPortPage(); }
  });
}

function portDeleteStock(sym) {
  portHoldings = portHoldings.filter(function(h) { return h.sym !== sym; });
  savePortfolio();
  renderPortPage();
}

function portEditShares(sym) {
  var h = portHoldings.find(function(x) { return x.sym === sym; });
  if (!h) return;
  var v = prompt('עדכן כמות מניות עבור ' + sym + ':', h.shares);
  if (v === null) return;
  var n = parseFloat(v);
  if (!isNaN(n) && n > 0) { h.shares = n; savePortfolio(); renderPortPage(); }
}

function portEditPrice(sym) {
  var h = portHoldings.find(function(x) { return x.sym === sym; });
  if (!h) return;
  var v = prompt('עדכן מחיר קנייה עבור ' + sym + ':', h.buyPrice || 0);
  if (v === null) return;
  var n = parseFloat(v);
  if (!isNaN(n) && n >= 0) { h.buyPrice = n; savePortfolio(); renderPortPage(); }
}

function renderPortPage() {
  var ul      = document.getElementById('portStockList');
  var totalEl = document.getElementById('portTotalVal');
  if (!ul || !totalEl) return;

  if (!portHoldings.length) {
    ul.innerHTML = '<li class="port-empty">אין ניירות בתיק — הוסף מניה למעלה</li>';
    totalEl.textContent = '$0.00';
    return;
  }

  var grandTotal = 0;
  ul.innerHTML = portHoldings.map(function(h) {
    var d         = priceCache[h.sym];
    var livePrice = d ? d.price : null;
    var value     = livePrice ? livePrice * h.shares : (h.buyPrice ? h.buyPrice * h.shares : null);
    if (value) grandTotal += value;

    var isTASE   = h.sym.endsWith('.TA');
    var curr     = isTASE ? '\u20AA' : '$';
    var shortSym = h.sym.replace('.TA', '');

    var valueStr = value
      ? curr + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '—';

    var livePriceStr = livePrice
      ? curr + (livePrice >= 100 ? livePrice.toFixed(2) : livePrice.toFixed(3))
      : '—';

    var chgStr = ''; var chgCls = '';
    if (d && d.changePct !== undefined) {
      chgStr = (d.changePct >= 0 ? '+' : '') + d.changePct.toFixed(2) + '%';
      chgCls = d.changePct >= 0 ? 'up' : 'down';
    }

    var pnlStr = ''; var pnlCls = '';
    if (livePrice && h.buyPrice) {
      var pnl    = (livePrice - h.buyPrice) * h.shares;
      var pnlPct = ((livePrice - h.buyPrice) / h.buyPrice) * 100;
      pnlCls = pnl >= 0 ? 'up' : 'down';
      pnlStr = (pnl >= 0 ? '+' : '') + curr + Math.abs(pnl).toFixed(2)
        + ' (' + (pnlPct >= 0 ? '+' : '') + pnlPct.toFixed(2) + '%)';
    }

    return '<li class="port-stock-item">'
      + '<div class="port-stock-top">'
      + '<span class="port-stock-sym" onclick="(function(){closePortPage();selectSymbol(\'' + h.sym + '\');})()" title="\u05e4\u05ea\u05d7 \u05d2\u05e8\u05e3">' + shortSym + '</span>'
      + '<span class="port-stock-value">' + valueStr + '</span>'
      + '</div>'
      + '<div class="port-stock-meta">'
      + '<span>' + h.shares + ' \u05de\u05e0\u05d9\u05d5\u05ea</span>'
      + '<span>\u05de\u05d7\u05d9\u05e8 \u05e2\u05db\u05e9\u05d5\u05d5: ' + livePriceStr + '</span>'
      + (chgStr ? '<span class="port-chg ' + chgCls + '">' + chgStr + '</span>' : '')
      + (pnlStr ? '<span class="port-chg ' + pnlCls + '">\u05e8\u05d5\u05d5\u05d7: ' + pnlStr + '</span>' : '')
      + '<span style="flex:1"></span>'
      + '<button class="port-act" onclick="portEditShares(\'' + h.sym + '\')">\u05e2\u05e8\u05d5\u05da \u05db\u05de\u05d5\u05ea</button>'
      + '<button class="port-act" onclick="portEditPrice(\'' + h.sym + '\')">\u05e2\u05e8\u05d5\u05da \u05de\u05d7\u05d9\u05e8</button>'
      + '<button class="port-act del" onclick="portDeleteStock(\'' + h.sym + '\')">\u05de\u05d7\u05e7</button>'
      + '</div>'
      + '</li>';
  }).join('');

  totalEl.textContent = '$' + grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}