// ============================================
//   AUTH
// ============================================
console.log('[NexTrade] Loading main.js...');

var USERS_KEY   = 'nt_users';
var SESSION_KEY = 'nt_session';
var API_BASE    = localStorage.getItem('nt_api_base') || 'https://nextrade-lending.onrender.com';

function getUsers()     { return JSON.parse(localStorage.getItem(USERS_KEY)   || '[]'); }
function getSession()   { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
function saveSession(s) { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }

// ============================================
//   PER-USER STORAGE SCOPING
//   Watchlist + colored lists are stored PER logged-in user so a new user on
//   the same device never inherits the previous user's list. Keys are suffixed
//   with a stable identifier (server username, else session email/name).
// ============================================
function _userScope() {
  try {
    var su = JSON.parse(localStorage.getItem('nt_user') || 'null');
    if (su && su.username) return 'u:' + String(su.username).toLowerCase();
  } catch (e) {}
  try {
    var s = getSession();
    if (s && (s.email || s.name)) return 'u:' + String(s.email || s.name).toLowerCase();
  } catch (e) {}
  return 'guest';
}
function _wlKey()       { return 'ml_watchlist::' + _userScope(); }
function _wlColorsKey() { return 'nt_wl_colors::' + _userScope(); }
function _wlNamesKey()  { return 'nt_wl_colornames::' + _userScope(); }

// A fresh user starts with their own editable copy of this default list.
var DEFAULT_WATCHLIST = ['TEVA.TA', 'ELBIT.TA', 'BEZQ.TA', 'POLI.TA', 'LUMI.TA', 'AZRG.TA'];

// Read the watchlist for the CURRENT user. One-time migration: if this user has
// no per-user list yet but a legacy global 'ml_watchlist' exists AND this is the
// very first scoped read on this device, adopt it once (keeps the original owner's
// list) — brand-new users still get their own default copy.
function _readUserWatchlist() {
  try {
    var raw = localStorage.getItem(_wlKey());
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  // No per-user list yet: migrate the legacy global list once (first user only).
  try {
    if (!localStorage.getItem('nt_wl_migrated')) {
      var legacy = localStorage.getItem('ml_watchlist');
      localStorage.setItem('nt_wl_migrated', '1');
      if (legacy) {
        var arr = JSON.parse(legacy);
        try { localStorage.setItem(_wlKey(), legacy); } catch (e2) {}
        return arr;
      }
    }
  } catch (e) {}
  return DEFAULT_WATCHLIST.slice();
}
function _readUserColors() {
  try { return JSON.parse(localStorage.getItem(_wlColorsKey()) || '{}') || {}; } catch (e) { return {}; }
}
function _readUserColorNames() {
  try { return JSON.parse(localStorage.getItem(_wlNamesKey()) || '{}') || {}; } catch (e) { return {}; }
}

// Re-load all per-user scoped data into the in-memory globals and re-render.
// Called after a login so switching users on the same device shows the right list.
function loadUserScopedData() {
  try {
    watchlist = _readUserWatchlist();
    wlColorMap = _readUserColors();
    wlColorNames = _readUserColorNames();
    if (typeof renderWatchlist === 'function') renderWatchlist();
    if (typeof renderColorBar === 'function') renderColorBar();
  } catch (e) {}
}
window.loadUserScopedData = loadUserScopedData;

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
  var btn      = e.target && e.target.querySelector ? e.target.querySelector('button[type="submit"]') : null;
  errEl.classList.remove('show');
  if (!email || !password) { errEl.textContent = 'נא למלא אימייל וסיסמה'; errEl.classList.add('show'); return; }
  if (btn && btn.disabled) return; // already signing in
  var btnLabel = btn ? btn.innerHTML : '';
  function resetBtn() { if (btn) { btn.disabled = false; btn.style.opacity = ''; btn.innerHTML = btnLabel; } }
  if (btn) { btn.disabled = true; btn.style.opacity = '.75'; btn.innerHTML = 'מתחבר…'; }

  fetch(API_BASE + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: email, password: password })
  }).then(function(r) { return r.json().then(function(data) { return { ok: r.ok, data: data }; }); })
  .then(function(result) {
    if (result.ok) {
      localStorage.setItem('nt_token', result.data.token);
      localStorage.setItem('nt_user', JSON.stringify({ username: result.data.username, role: result.data.role }));
      ntApplyServerMode(result.data.username, result.data.mode);
      // Apply the authoritative plan from the server (overrides local trial state).
      try {
        if (window.NTPlan && result.data.plan) {
          window.NTPlan.applyServerPlan({ plan: result.data.plan, tier: result.data.tier, limits: result.data.limits, premiumUntil: result.data.premiumUntil, trialUsed: result.data.trialUsed, onTrial: result.data.onTrial, admin: result.data.admin });
        }
      } catch (e2) {}
      // Deliberate 3-second entry transition after a successful manual login.
      // (Auto-restore of an existing session on refresh is NOT delayed.)
      if (btn) btn.innerHTML = '✓ נכנסים…';
      setTimeout(function() {
        resetBtn();
        loginSuccess({ name: result.data.username, email: email, role: result.data.role });
      }, LOGIN_ENTRY_DELAY_MS);
    } else {
      resetBtn();
      errEl.textContent = result.data.error || 'אימייל או סיסמה שגויים';
      errEl.classList.add('show');
    }
  }).catch(function() {
    resetBtn();
    errEl.textContent = 'השרת מתעורר... נסה שוב בעוד רגע (עד 30 שניות)';
    errEl.classList.add('show');
  });
}

var LOGIN_ENTRY_DELAY_MS = 3000;

// The usage mode ('signals' | 'analysis') belongs to the ACCOUNT, not the device. The server is
// authoritative; local keys are tagged with their owner so another user's choice on the same
// phone/browser is never inherited. Returns true if the effective mode changed.
function ntApplyServerMode(username, mode) {
  var before = localStorage.getItem('nt_user_plan');
  try {
    if (mode === 'signals' || mode === 'analysis') {
      localStorage.setItem('nt_user_plan', mode);
      localStorage.setItem('nt_user_mode', mode);
    } else if (localStorage.getItem('nt_mode_owner') !== username) {
      // server has no mode for this user and the local keys belong to someone else
      localStorage.removeItem('nt_user_plan');
      localStorage.removeItem('nt_user_mode');
    }
    localStorage.setItem('nt_mode_owner', username || '');
  } catch (e) {}
  return before !== localStorage.getItem('nt_user_plan');
}
// Body classes that decide which surface (feed vs regular site) a user can reach.
function ntRefreshModeUI(role) {
  try {
    var isAdminUser = role === 'admin';
    var uplan = localStorage.getItem('nt_user_plan') || localStorage.getItem('nt_user_mode');
    var isAnalysis = isAdminUser ? true : (uplan === 'analysis');
    document.body.classList.toggle('mode-signals', !isAnalysis);
    document.body.classList.toggle('mode-analysis', isAnalysis);
    document.body.classList.toggle('mode-admin', isAdminUser);
  } catch (e) {}
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

  // Register on server
  fetch(API_BASE + '/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: name, email: email, password: password })
  }).then(function(r) { return r.json().then(function(data) { return { ok: r.ok, data: data }; }); })
  .then(function(result) {
    if (!result.ok) {
      errEl.textContent = result.data.error || 'שגיאה בהרשמה';
      errEl.classList.add('show');
      return;
    }
    sucEl.textContent = 'ההרשמה הצליחה! מעביר לשאלון הכרות...';
    sucEl.classList.add('show');
    // Auto-login after registration, then redirect to onboarding — every new user must complete it
    fetch(API_BASE + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: name, password: password })
    }).then(function(r) { return r.json().then(function(data) { return { ok: r.ok, data: data }; }); })
    .then(function(loginResult) {
      if (loginResult.ok) {
        localStorage.setItem('nt_token', loginResult.data.token);
        localStorage.setItem('nt_user', JSON.stringify({ username: loginResult.data.username, role: loginResult.data.role }));
        localStorage.removeItem('nt_onboarding_done');
      }
      setTimeout(function() { window.location.href = 'onboarding.html'; }, 1200);
    }).catch(function() {
      setTimeout(function() { window.location.href = 'onboarding.html'; }, 1200);
    });
  }).catch(function(err) {
    errEl.textContent = 'השרת מתעורר... נסה שוב בעוד רגע (עד 30 שניות)';
    errEl.classList.add('show');
  });
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

  // Mobile avatar + profile (initials = first letter of first name + first letter of last name)
  var inits = userInitials(user.name);
  var mAvatar = document.getElementById('mHomeAvatar');
  var mProfAv = document.getElementById('mProfAvatar');
  var mProfNm = document.getElementById('mProfName');
  var mProfSb = document.getElementById('mProfSub');
  if (mAvatar) mAvatar.textContent = inits;
  if (mProfAv) mProfAv.textContent = inits;
  if (mProfNm) mProfNm.textContent = user.name || 'משתמש';
  if (mProfSb) mProfSb.textContent = (user.email || '') + (user.role === 'admin' ? ' · מנהל' : '');

  // Persistent mobile bottom bar
  var mbbAv = document.getElementById('mbbAvatar');
  var mbbNm = document.getElementById('mbbName');
  if (mbbAv) mbbAv.textContent = inits;
  if (mbbNm) mbbNm.textContent = user.name || 'משתמש';

  var backOfficeBtn = document.getElementById('backOfficeBtn');
  if (backOfficeBtn) backOfficeBtn.style.display = (user.role === 'admin') ? '' : 'none';

  // Mark the body for signal-oriented users so the mobile alerts bell shows (bottom-left).
  // Analysis users (chose "נתח בעצמי" in onboarding) get only the watchlists.
  try {
    // Admins get FULL access: they see the regular (analysis) site by default,
    // plus a button to open the signal feed — they are never locked to signals.
    var isAdminUser = user.role === 'admin';
    ntRefreshModeUI(user.role);
  } catch (e) {}

  // Load THIS user's own watchlist + colored lists (prevents a new user from
  // inheriting the previous user's list on the same device).
  loadUserScopedData();

  // Apply the monetization plan: admins get full access; new users get a trial.
  try { if (window.NTPlan) window.NTPlan.onLogin({ role: user.role }); } catch (e) {}

  console.log('[NexTrade] About to call init()...');
  // Pick the right surface (signal feed vs regular site) on EVERY login — including a second
  // login in the same page session (logout → login as another user), which used to skip this
  // and leave a signals user on the regular site.
  setTimeout(function() { if (window.NTSignals) window.NTSignals.onAppReady(); }, 200);
  // defer init so the browser finishes layout before the chart measures width.
  // Use setTimeout (fires even when tab is not focused) instead of requestAnimationFrame,
  // which is paused for background tabs and would leave the chart un-initialized.
  if (window.__ntInitDone) return;
  window.__ntInitDone = true;
  setTimeout(function() { init(); }, 60);
}

function handleLogout() {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem('nt_token');
  localStorage.removeItem('nt_user');
  // The usage mode belongs to the account — never leave it behind for the next user.
  localStorage.removeItem('nt_user_plan');
  localStorage.removeItem('nt_plan_state');
  localStorage.removeItem('nt_user_mode');
  localStorage.removeItem('nt_mode_owner');
  localStorage.removeItem('nt_server_signals');
  document.body.classList.remove('mode-signals', 'mode-analysis', 'mode-admin');
  // Reset in-memory user data so the next user doesn't see this user's lists.
  try {
    watchlist = DEFAULT_WATCHLIST.slice();
    wlColorMap = {};
    wlColorNames = {};
    if (typeof renderWatchlist === 'function') renderWatchlist();
    if (typeof renderColorBar === 'function') renderColorBar();
  } catch (e) {}
  document.getElementById('appContainer').style.display = 'none';
  document.getElementById('authOverlay').style.display  = 'flex';
  // Hide the fixed Signal Feed overlay (it sits above everything) on logout.
  var feed = document.getElementById('signalFeed');
  if (feed) feed.style.display = 'none';
  var sfMenu = document.getElementById('sfUserMenu');
  if (sfMenu) sfMenu.classList.remove('open');
  document.getElementById('loginEmail').value    = '';
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginError').classList.remove('show');
  var dd = document.getElementById('userDropdown');
  if (dd) dd.classList.remove('open');
  switchTab('login');
}

// ============================================
//   MOBILE PROFILE + COLORED FAVORITE LISTS
// ============================================
// Initials = first letter of first name + first letter of last name (like the website).
function userInitials(name) {
  if (!name) return 'U';
  var parts = String(name).trim().split(/\s+/);
  var a = parts[0] ? parts[0].charAt(0) : '';
  var b = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
  return (a + b).toUpperCase() || 'U';
}

// --- Profile screen ---
function openProfile() {
  var p = document.getElementById('mProfile');
  if (p) p.classList.add('open');
}
function closeProfile() {
  var p = document.getElementById('mProfile');
  if (p) p.classList.remove('open');
}
function mProfAbout() {
  ntToast('NexTrade — פלטפורמת איתותים ומסחר');
}
function mProfHelp() {
  ntToast('מרכז עזרה — צרו קשר: support@getnexttrade.com');
}
window.openProfile = openProfile;
window.closeProfile = closeProfile;
window.mProfAbout = mProfAbout;
window.mProfHelp = mProfHelp;

// --- Colored favorite lists (red/green/yellow/purple/blue) ---
var WL_COLORS = [
  { key: 'red',    label: 'אדום',  hex: '#ef5350' },
  { key: 'green',  label: 'ירוק',  hex: '#26a69a' },
  { key: 'yellow', label: 'צהוב',  hex: '#f5a623' },
  { key: 'purple', label: 'סגול',  hex: '#a855f7' },
  { key: 'blue',   label: 'כחול',  hex: '#2962ff' }
];
function wlColorHex(key) {
  for (var i = 0; i < WL_COLORS.length; i++) if (WL_COLORS[i].key === key) return WL_COLORS[i].hex;
  return '';
}
var wlColorMap = {};
try { wlColorMap = _readUserColors(); } catch (e) { wlColorMap = {}; }
var wlColorFilter = ''; // '' = show all; otherwise a color key
var _wlPickerSym = null; // symbol currently being colored

// Custom names for the colored watchlists (key -> user-chosen name).
var wlColorNames = {};
try { wlColorNames = _readUserColorNames(); } catch (e) { wlColorNames = {}; }
function saveWlColorNames() {
  try { localStorage.setItem(_wlNamesKey(), JSON.stringify(wlColorNames)); } catch (e) {}
}
function wlColorLabel(key) {
  if (wlColorNames[key]) return wlColorNames[key];
  for (var i = 0; i < WL_COLORS.length; i++) if (WL_COLORS[i].key === key) return WL_COLORS[i].label;
  return key;
}

function saveWlColors() {
  try { localStorage.setItem(_wlColorsKey(), JSON.stringify(wlColorMap)); } catch (e) {}
}

// Persistent bottom-bar "more" menu
function toggleBottomMore(ev) {
  if (ev) ev.stopPropagation();
  var m = document.getElementById('mbbMoreMenu');
  if (m) m.classList.toggle('open');
}
function closeBottomMore() {
  var m = document.getElementById('mbbMoreMenu');
  if (m) m.classList.remove('open');
}
document.addEventListener('click', function(ev) {
  var menu = document.getElementById('mbbMoreMenu');
  var btn  = document.getElementById('mbbMore');
  if (!menu || !menu.classList.contains('open')) return;
  if (menu.contains(ev.target) || (btn && btn.contains(ev.target))) return;
  menu.classList.remove('open');
});

function openFavLists() {
  renderFavLists();
  var m = document.getElementById('mFavLists');
  if (m) m.classList.add('open');
}
function closeFavLists() {
  var m = document.getElementById('mFavLists');
  if (m) m.classList.remove('open');
}
function favListsBackdrop(ev) {
  if (ev && ev.target && ev.target.id === 'mFavLists') closeFavLists();
}
function renderFavLists() {
  var box = document.getElementById('mFavRows');
  if (!box) return;
  var counts = {};
  (watchlist || []).forEach(function(s) {
    var c = wlColorMap[s];
    if (c) counts[c] = (counts[c] || 0) + 1;
  });
  var rows = '';
  rows += '<button class="mfav-row' + (wlColorFilter === '' ? ' active' : '') + '" onclick="setFavFilter(\'\')">'
    + '<span class="mfav-swatch all" style="background:linear-gradient(135deg,#ef5350,#26a69a,#2962ff)"></span>'
    + '<span class="mfav-name">הצג הכל</span>'
    + '<span class="mfav-count">' + (watchlist ? watchlist.length : 0) + '</span>'
    + '</button>';
  WL_COLORS.forEach(function(c) {
    rows += '<div class="mfav-row' + (wlColorFilter === c.key ? ' active' : '') + '" id="mfavRow-' + c.key + '">'
      + '<span class="mfav-swatch" style="background:' + c.hex + '" onclick="setFavFilter(\'' + c.key + '\')"></span>'
      + '<span class="mfav-name" onclick="setFavFilter(\'' + c.key + '\')">' + wlColorLabel(c.key) + '</span>'
      + '<span class="mfav-count" onclick="setFavFilter(\'' + c.key + '\')">' + (counts[c.key] || 0) + '</span>'
      + '<button class="mfav-edit" onclick="editFavRow(\'' + c.key + '\')" title="ערוך שם" aria-label="ערוך שם">✏️</button>'
      + '</div>';
  });
  box.innerHTML = rows;
}

// Inline rename editor for a colored watchlist row.
function editFavRow(key) {
  var row = document.getElementById('mfavRow-' + key);
  if (!row) return;
  var current = wlColorLabel(key);
  var def = (WL_COLORS.filter(function(c){ return c.key === key; })[0] || {}).label || key;
  var hex = wlColorHex(key);
  row.innerHTML =
      '<span class="mfav-swatch" style="background:' + hex + '"></span>'
    + '<div class="mfav-editwrap">'
    +   '<input class="mfav-editinp" id="mfavInp-' + key + '" value="' + current.replace(/"/g, '&quot;') + '" maxlength="22" placeholder="שם הרשימה" />'
    +   '<button class="mfav-editbtn save" onclick="saveFavName(\'' + key + '\')" title="שמור">✓</button>'
    +   '<button class="mfav-editbtn del" onclick="resetFavName(\'' + key + '\')" title="אפס לברירת מחדל (' + def + ')">🗑</button>'
    +   '<button class="mfav-editbtn" onclick="renderFavLists()" title="ביטול">✕</button>'
    + '</div>';
  var inp = document.getElementById('mfavInp-' + key);
  if (inp) {
    inp.focus();
    inp.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') saveFavName(key);
      if (e.key === 'Escape') renderFavLists();
    });
  }
}
function saveFavName(key) {
  var inp = document.getElementById('mfavInp-' + key);
  var v = inp ? inp.value.trim() : '';
  if (v) wlColorNames[key] = v; else delete wlColorNames[key];
  saveWlColorNames();
  renderFavLists();
  if (typeof renderColorBar === 'function') renderColorBar();
}
function resetFavName(key) {
  delete wlColorNames[key];
  saveWlColorNames();
  renderFavLists();
  if (typeof renderColorBar === 'function') renderColorBar();
}
function setFavFilter(key) {
  wlColorFilter = key;
  closeFavLists();
  renderWatchlist();
  if (typeof ntToast === 'function') {
    var lbl = key ? ('מציג רשימת ' + wlColorLabel(key)) : 'מציג את כל הרשימה';
    ntToast(lbl);
  }
}

// Inline color-bookmark filter bar shown ABOVE the watchlist (desktop + mobile).
function renderColorBar() {
  var box = document.getElementById('wlColorBar');
  if (!box) return;
  var counts = {};
  (watchlist || []).forEach(function(s) {
    var c = wlColorMap[s];
    if (c) counts[c] = (counts[c] || 0) + 1;
  });
  var html = '';
  html += '<button class="wlcb-chip' + (wlColorFilter === '' ? ' active' : '') + '" onclick="setFavFilter(\'\')" title="הצג הכל" aria-label="הצג הכל">'
    + '<span class="wlcb-ring"><span class="wlcb-bm all"></span></span>'
    + '<span class="wlcb-count">' + (watchlist ? watchlist.length : 0) + '</span>'
    + '</button>';
  WL_COLORS.forEach(function(c) {
    html += '<button class="wlcb-chip' + (wlColorFilter === c.key ? ' active' : '') + '" onclick="setFavFilter(\'' + c.key + '\')" title="' + wlColorLabel(c.key) + '" aria-label="' + wlColorLabel(c.key) + '">'
      + '<span class="wlcb-ring"><svg class="wlcb-flag" viewBox="0 0 20 20" width="17" height="17"><path d="M4.5 3.5 H15.5 L12 8.5 L15.5 13.5 H4.5 Z" fill="' + c.hex + '" stroke="' + c.hex + '" stroke-width="2" stroke-linejoin="round"/></svg></span>'
      + '<span class="wlcb-count">' + (counts[c.key] || 0) + '</span>'
      + '</button>';
  });
  box.innerHTML = html;
}
window.renderColorBar = renderColorBar;

// --- Per-symbol color assignment (inline palette popup) ---
function openColorPicker(ev, sym) {
  if (ev) { ev.stopPropagation(); ev.preventDefault(); }
  _wlPickerSym = sym;
  var pk = document.getElementById('wlColorPicker');
  if (!pk) return;
  pk.classList.add('open');
  // position near the clicked dot
  var rect = ev && ev.currentTarget ? ev.currentTarget.getBoundingClientRect() : null;
  var pw = 220, ph = 46;
  var left = rect ? Math.min(Math.max(8, rect.left - pw + rect.width), window.innerWidth - pw - 8) : 20;
  var top  = rect ? (rect.bottom + 6) : 80;
  if (top + ph > window.innerHeight) top = rect.top - ph - 6;
  pk.style.left = left + 'px';
  pk.style.top  = top + 'px';
}
function setSymColor(color) {
  if (_wlPickerSym) {
    if (color) wlColorMap[_wlPickerSym] = color;
    else delete wlColorMap[_wlPickerSym];
    saveWlColors();
  }
  var pk = document.getElementById('wlColorPicker');
  if (pk) pk.classList.remove('open');
  _wlPickerSym = null;
  renderWatchlist();
}
window.openFavLists = openFavLists;
window.closeFavLists = closeFavLists;
window.favListsBackdrop = favListsBackdrop;
window.setFavFilter = setFavFilter;
window.openColorPicker = openColorPicker;
window.setSymColor = setSymColor;

// --- Technical Tools window (all drawing tools as labeled category cards) ---
function renderTechTools() {
  var box = document.getElementById('ttBody');
  if (!box) return;
  var cats = (window.NTDraw && typeof window.NTDraw.getToolCatalog === 'function')
    ? window.NTDraw.getToolCatalog() : [];
  if (!cats.length) { box.innerHTML = '<div style="color:var(--text-muted);padding:1rem;text-align:center">הכלים נטענים…</div>'; return; }
  var html = '';
  cats.forEach(function(group) {
    html += '<div class="tt-group"><div class="tt-group-title">' + group.title + '</div><div class="tt-grid">';
    (group.items || []).forEach(function(it) {
      var danger = (it.id === 'clear') ? ' danger' : '';
      html += '<button class="tt-tool' + danger + '" onclick="pickTechTool(\'' + it.id + '\')">'
        + '<span class="tt-ic">' + it.icon + '</span>'
        + '<span class="tt-name">' + it.name + '</span>'
        + '</button>';
    });
    html += '</div></div>';
  });
  box.innerHTML = html;
}
function openTechTools() {
  if (window.NTDraw && typeof window.NTDraw.ensure === 'function') window.NTDraw.ensure();
  renderTechTools();
  var m = document.getElementById('techToolsModal');
  if (m) m.classList.add('open');
}
function closeTechTools() {
  var m = document.getElementById('techToolsModal');
  if (m) m.classList.remove('open');
}
function techToolsBackdrop(ev) {
  if (ev && ev.target && ev.target.id === 'techToolsModal') closeTechTools();
}
function pickTechTool(id) {
  if (window.NTDraw && typeof window.NTDraw.pickTool === 'function') window.NTDraw.pickTool(id);
  closeTechTools();
  if (typeof closeTechDropdown === 'function') closeTechDropdown();
  if (typeof ntToast === 'function' && id !== 'clear') {
    var cats = (window.NTDraw && window.NTDraw.getToolCatalog) ? window.NTDraw.getToolCatalog() : [];
    var name = id;
    cats.forEach(function(g){ (g.items||[]).forEach(function(it){ if (it.id === id) name = it.name; }); });
    ntToast('נבחר: ' + name);
  }
}
window.openTechTools = openTechTools;
window.closeTechTools = closeTechTools;
window.techToolsBackdrop = techToolsBackdrop;
window.pickTechTool = pickTechTool;

// --- Technical Tools FAVORITES dropdown (combo list) + floating bottom bar ---
var TECH_STAR_SVG = '<svg viewBox="0 0 24 24"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 18.9 6.1 21l1.2-6.5L2.5 9.9l6.6-.9z"/></svg>';
// Eye icons for indicator show/hide toggle (open = visible on chart, slashed = hidden)
var TECH_EYE_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>';
var TECH_EYE_OFF  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 12S5 5 12 5c2.2 0 4.1.7 5.7 1.7M22.5 12S19 19 12 19c-2.2 0-4.1-.7-5.7-1.7"/><path d="M9.6 9.6a3 3 0 0 0 4.2 4.2"/><path d="M3 3l18 18"/></svg>';

// Drawing tools that belong in the "Technical Tools" combo (per user spec)
var TECH_TOOL_WHITELIST = ['trend','hline','vline','ray','rect','ellipse','arrow','text','brush','fib'];
// Advanced drawing tools (second section) — gann family + trade rulers
var TECH_TOOL_ADVANCED = ['gann','gannbox','gannsq','gannfix','long','short'];

function getTechFavs() {
  try { var a = JSON.parse(localStorage.getItem('nt_tech_favs') || '[]'); return Array.isArray(a) ? a : []; }
  catch (e) { return []; }
}
function saveTechFavs(arr) {
  try { localStorage.setItem('nt_tech_favs', JSON.stringify(arr)); } catch (e) {}
}
function flattenTechTools() {
  var out = [];
  getTechCatalog().forEach(function(g) { (g.items || []).forEach(function(it) { out.push(it); }); });
  return out;
}
function techToolById(id) {
  var all = flattenTechTools();
  for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
  return null;
}

// Small line-wave icon used for indicator entries (colored per indicator)
function indIconSvg(color) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="2" '
    + 'stroke-linecap="round" stroke-linejoin="round"><path d="M3 16l4-5 4 3 4-7 6 7"/></svg>';
}

// Unified catalog for the tech-tools dropdown.
// Section 1: the technical DRAWING tools (whitelist, star → floating fav bar).
// Section 2+: INDICATORS (MA / overlay / oscillators, eye → show/hide on chart).
function getTechCatalog() {
  var cats = [];
  // --- Drawing tools (filtered to the technical-analysis subset) ---
  var draw = (window.NTDraw && typeof window.NTDraw.getToolCatalog === 'function') ? window.NTDraw.getToolCatalog() : [];
  var byId = {};
  draw.forEach(function(g) { (g.items || []).forEach(function(it) { byId[it.id] = it; }); });
  var toolItems = [];
  TECH_TOOL_WHITELIST.forEach(function(id) {
    var it = byId[id];
    if (it) toolItems.push({ id: it.id, name: it.name, icon: it.icon, type: 'tool' });
  });
  if (toolItems.length) cats.push({ title: 'כלים טכניים', items: toolItems });
  // Advanced drawing tools (gann + trade rulers)
  var advItems = [];
  TECH_TOOL_ADVANCED.forEach(function(id) {
    var it = byId[id];
    if (it) advItems.push({ id: it.id, name: it.name, icon: it.icon, type: 'tool' });
  });
  if (advItems.length) cats.push({ title: 'כלים מתקדמים', items: advItems });

  // --- Indicators (only present once the indicator engine has loaded) ---
  if (typeof MA_CONFIGS !== 'undefined') {
    var maItems = [];
    if (typeof toggleVolume === 'function') {
      maItems.push({ id: 'ind_vol', name: 'נפח עסקאות', icon: indIconSvg('#5b6472'), type: 'indicator', kind: 'vol' });
    }
    MA_CONFIGS.forEach(function(cfg) {
      maItems.push({ id: 'ind_ma_' + cfg.period, name: cfg.label, icon: indIconSvg(cfg.color), type: 'indicator', kind: 'ma', period: cfg.period });
    });
    cats.push({ title: 'ממוצעים נעים (MA)', items: maItems });
  }
  if (typeof INDICATORS !== 'undefined') {
    var overlay = INDICATORS.filter(function(c) { return c.kind === 'overlay'; }).map(function(c) {
      return { id: 'ind_' + c.id, name: c.label, icon: indIconSvg(c.colors[0]), type: 'indicator', kind: 'ind', indId: c.id };
    });
    var osc = INDICATORS.filter(function(c) { return c.kind === 'osc'; }).map(function(c) {
      return { id: 'ind_' + c.id, name: c.label, icon: indIconSvg(c.colors[0]), type: 'indicator', kind: 'ind', indId: c.id };
    });
    if (overlay.length) cats.push({ title: 'אינדיקטורים על הגרף', items: overlay });
    if (osc.length)     cats.push({ title: 'אוסצילטורים', items: osc });
  }
  return cats;
}

// Is an indicator item currently active on the chart?
function isTechItemActive(it) {
  if (!it || it.type !== 'indicator') return false;
  if (it.kind === 'vol') return (typeof volumeVisible !== 'undefined') && !!volumeVisible;
  if (it.kind === 'ma')  return (typeof maActive !== 'undefined') && !!maActive[it.period];
  if (it.kind === 'ind') return (typeof indActive !== 'undefined') && !!indActive[it.indId];
  return false;
}

// Run a tech item: drawing tool → activate it; indicator → toggle on/off
function runTechItem(id) {
  var it = techToolById(id);
  if (!it) return;
  if (it.type === 'indicator') {
    if (it.kind === 'vol' && typeof toggleVolume === 'function') toggleVolume();
    else if (it.kind === 'ma' && typeof toggleMA === 'function') toggleMA(it.period);
    else if (it.kind === 'ind' && typeof toggleIndicator === 'function') toggleIndicator(it.indId);
    if (typeof ntToast === 'function') ntToast((isTechItemActive(it) ? 'הופעל: ' : 'הוסר: ') + it.name);
    renderTechDropdown();
    renderTechFavBar();
  } else {
    pickTechTool(id);
  }
}

// Toggle an indicator from its eye button (stops the row click from double-firing)
function techIndicatorEye(id, ev) {
  if (ev) { ev.stopPropagation(); ev.preventDefault(); }
  runTechItem(id);
}

function renderTechDropdown() {
  var box = document.getElementById('ttdList');
  if (!box) return;
  var cats = getTechCatalog();
  if (!cats.length) { box.innerHTML = '<div style="color:var(--text-muted);padding:.8rem;text-align:center">הכלים נטענים…</div>'; return; }
  var favs = getTechFavs();
  var html = '';
  cats.forEach(function(group) {
    html += '<div class="ttd-group-title">' + group.title + '</div>';
    (group.items || []).forEach(function(it) {
      if (it.type === 'indicator') {
        // Indicators use an EYE toggle: open = visible on chart, slashed = hidden
        var vis = isTechItemActive(it);
        html += '<div class="ttd-row' + (vis ? ' on' : '') + '" onclick="runTechItem(\'' + it.id + '\')">'
          + '<span class="ttd-ic">' + it.icon + '</span>'
          + '<span class="ttd-name">' + it.name + '</span>'
          + '<button class="ttd-eye' + (vis ? ' on' : '') + '" onclick="techIndicatorEye(\'' + it.id + '\',event)" '
          + 'title="' + (vis ? 'הסתר מהגרף' : 'הצג על הגרף') + '" aria-label="הצג/הסתר">' + (vis ? TECH_EYE_OPEN : TECH_EYE_OFF) + '</button>'
          + '</div>';
      } else {
        // Drawing tools use a STAR toggle → floating favorites bar
        var isFav = favs.indexOf(it.id) !== -1;
        html += '<div class="ttd-row" onclick="pickTechTool(\'' + it.id + '\')">'
          + '<span class="ttd-ic">' + it.icon + '</span>'
          + '<span class="ttd-name">' + it.name + '</span>'
          + '<button class="ttd-star' + (isFav ? ' fav' : '') + '" onclick="toggleTechFav(\'' + it.id + '\',event)" '
          + 'title="' + (isFav ? 'הסר ממועדפים' : 'הוסף למועדפים') + '" aria-label="מועדפים">' + TECH_STAR_SVG + '</button>'
          + '</div>';
      }
    });
  });
  box.innerHTML = html;
}
function toggleTechDropdown(ev) {
  if (ev) { ev.stopPropagation(); ev.preventDefault(); }
  if (window.NTDraw && typeof window.NTDraw.ensure === 'function') window.NTDraw.ensure();
  var dd = document.getElementById('techToolsDropdown');
  var btn = document.getElementById('techToolsBtn');
  if (!dd || !btn) return;
  if (dd.classList.contains('open')) { dd.classList.remove('open'); return; }
  renderTechDropdown();
  // Position relative to the button (flip up if not enough room below)
  dd.classList.add('open');
  var r = btn.getBoundingClientRect();
  var ddw = dd.offsetWidth || 300;
  var ddh = dd.offsetHeight || 320;
  var left = Math.max(8, Math.min(r.left, window.innerWidth - ddw - 8));
  var top;
  if (r.bottom + ddh + 8 <= window.innerHeight) top = r.bottom + 6;        // below
  else top = Math.max(8, r.top - ddh - 6);                                  // above
  dd.style.left = left + 'px';
  dd.style.top = top + 'px';
}
function closeTechDropdown() {
  var dd = document.getElementById('techToolsDropdown');
  if (dd) dd.classList.remove('open');
}
function toggleTechFav(id, ev) {
  if (ev) { ev.stopPropagation(); ev.preventDefault(); }
  var favs = getTechFavs();
  var i = favs.indexOf(id);
  if (i === -1) favs.push(id); else favs.splice(i, 1);
  saveTechFavs(favs);
  renderTechDropdown();
  renderTechFavBar();
}
function renderTechFavBar() {
  var bar = document.getElementById('techFavBar');
  if (!bar) return;
  var favs = getTechFavs();
  if (!favs.length) { bar.classList.remove('show'); bar.innerHTML = ''; return; }
  // Drag grip (six dots) + the favorited tool buttons (drawing tools only)
  var html = '<span class="tfav-grip" title="גרור את הסרגל" aria-label="גרור">'
    + '<i></i><i></i><i></i><i></i><i></i><i></i></span>';
  var shown = 0;
  favs.forEach(function(id) {
    var it = techToolById(id);
    if (!it || it.type !== 'tool') return;   // indicators use the eye toggle, not the fav bar
    html += '<button class="tfav-btn" onclick="runTechItem(\'' + id + '\')" '
      + 'title="' + it.name + '" aria-label="' + it.name + '">' + it.icon + '</button>';
    shown++;
  });
  if (!shown) { bar.classList.remove('show'); bar.innerHTML = ''; return; }
  // Close button clears the whole favorites bar
  html += '<button class="tfav-close" onclick="clearTechFavs(event)" title="סגור סרגל" aria-label="סגור">✕</button>';
  bar.innerHTML = html;
  bar.classList.add('show');
}
function clearTechFavs(ev) {
  if (ev) { ev.stopPropagation(); ev.preventDefault(); }
  saveTechFavs([]);
  renderTechFavBar();
  renderTechDropdown();
}
window.runTechItem = runTechItem;
window.clearTechFavs = clearTechFavs;
window.toggleTechDropdown = toggleTechDropdown;
window.closeTechDropdown = closeTechDropdown;
window.toggleTechFav = toggleTechFav;
window.techIndicatorEye = techIndicatorEye;
window.renderTechFavBar = renderTechFavBar;

// Close the favorites dropdown when clicking/tapping outside it
document.addEventListener('pointerdown', function(e) {
  var dd = document.getElementById('techToolsDropdown');
  if (!dd || !dd.classList.contains('open')) return;
  var caret = document.getElementById('techToolsCaret');
  if (!dd.contains(e.target) && e.target !== caret && (!caret || !caret.contains(e.target))) {
    closeTechDropdown();
  }
}, true);

// Build the favorites bar once the drawing module is ready
setTimeout(function() { try { renderTechFavBar(); initTechFavDrag(); } catch (e) {} }, 800);

// --- Make the floating favorites bar draggable anywhere on screen (via the grip) ---
var _tfavDrag = null;
function initTechFavDrag() {
  var bar = document.getElementById('techFavBar');
  if (!bar || bar._dragInit) return;
  bar._dragInit = true;
  // Restore a saved position
  try {
    var pos = JSON.parse(localStorage.getItem('nt_techfav_pos') || 'null');
    if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
      bar.style.left = pos.left + 'px';
      bar.style.top = pos.top + 'px';
      bar.style.right = 'auto';
      bar.style.bottom = 'auto';
      bar.classList.add('moved');
    }
  } catch (e) {}

  function down(e) {
    var grip = e.target.closest ? e.target.closest('.tfav-grip') : null;
    if (!grip) return;
    e.preventDefault();
    var pt = e.touches ? e.touches[0] : e;
    var r = bar.getBoundingClientRect();
    _tfavDrag = { dx: pt.clientX - r.left, dy: pt.clientY - r.top };
    bar.classList.add('dragging');
    document.addEventListener('mousemove', move);
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('mouseup', up);
    document.addEventListener('touchend', up);
  }
  function move(e) {
    if (!_tfavDrag) return;
    e.preventDefault();
    var pt = e.touches ? e.touches[0] : e;
    var w = bar.offsetWidth, h = bar.offsetHeight;
    var left = Math.min(Math.max(4, pt.clientX - _tfavDrag.dx), window.innerWidth - w - 4);
    var top  = Math.min(Math.max(4, pt.clientY - _tfavDrag.dy), window.innerHeight - h - 4);
    bar.style.left = left + 'px';
    bar.style.top = top + 'px';
    bar.style.right = 'auto';
    bar.style.bottom = 'auto';
    bar.classList.add('moved');
  }
  function up() {
    if (!_tfavDrag) return;
    _tfavDrag = null;
    bar.classList.remove('dragging');
    document.removeEventListener('mousemove', move);
    document.removeEventListener('touchmove', move);
    document.removeEventListener('mouseup', up);
    document.removeEventListener('touchend', up);
    try {
      var r = bar.getBoundingClientRect();
      localStorage.setItem('nt_techfav_pos', JSON.stringify({ left: r.left, top: r.top }));
    } catch (e) {}
  }
  bar.addEventListener('mousedown', down);
  bar.addEventListener('touchstart', down, { passive: false });
}
window.initTechFavDrag = initTechFavDrag;

// Close the color picker when clicking elsewhere
document.addEventListener('click', function(e) {
  var pk = document.getElementById('wlColorPicker');
  if (pk && pk.classList.contains('open') && !pk.contains(e.target)) {
    pk.classList.remove('open');
    _wlPickerSym = null;
  }
});

(function checkAutoLogin() {
  // Check server-based auth first (from login.html)
  var serverToken = localStorage.getItem('nt_token');
  var serverUser  = null;
  try { serverUser = JSON.parse(localStorage.getItem('nt_user') || 'null'); } catch(e) {}
  if (serverToken && serverUser && serverUser.username) {
    console.log('[NexTrade] Found server token for:', serverUser.username);
    loginSuccess({ name: serverUser.username, email: '', role: serverUser.role });
    // Re-sync the account's usage mode from the server (e.g. changed on another device,
    // or this device holds a previous user's leftovers).
    try {
      fetch(API_BASE + '/api/me', { headers: { 'Authorization': 'Bearer ' + serverToken }, cache: 'no-store' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(me) {
          if (!me) return;
          // Authoritative plan from the server (session restore never passes through /api/login).
          try {
            if (window.NTPlan && me.plan) {
              window.NTPlan.applyServerPlan({ plan: me.plan, tier: me.tier, limits: me.limits, premiumUntil: me.premiumUntil, trialUsed: me.trialUsed, onTrial: me.onTrial, admin: me.admin });
              if (window.NTSignals && window.NTSignals.render) window.NTSignals.render();
            }
          } catch (e3) {}
          if (ntApplyServerMode(me.username || serverUser.username, me.mode)) {
            ntRefreshModeUI(serverUser.role);
            if (window.NTSignals) window.NTSignals.onAppReady();
          }
        }).catch(function() {});
    } catch (e) {}
    return;
  }
  // Fallback to old localStorage session
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
  'WGS':  'GeneDx Holdings Corp.',
  'RELY': 'Remitly Global, Inc.',
  'AGM':  'Federal Agricultural Mortgage',
  'ACMR': 'ACM Research, Inc.',
  'SCHD': 'Schwab US Dividend Equity ETF',
  'AMGN': 'Amgen Inc.',
  'AMG':  'Affiliated Managers Group',
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
var currentSymbol   = localStorage.getItem('nt_lastSymbol') || '';
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
var watchlist       = _readUserWatchlist();
var portfolio       = JSON.parse(localStorage.getItem('ml_portfolio') || '[]');
var alerts          = JSON.parse(localStorage.getItem('ml_alerts')    || '[]');
var lastBars        = [];   // last loaded bars for MA computation

// ============================================
//   WATCHLIST CLOUD SYNC  (website <-> installed app)
//   Stores the list per logged-in user on the server so adding/removing a
//   symbol on one client propagates to all others.
// ============================================
function _ntToken() { return localStorage.getItem('nt_token'); }
var _wlSyncTimer = null;

// Save locally (instant/offline) and push to the server (debounced).
function saveWatchlist() {
  try { localStorage.setItem(_wlKey(), JSON.stringify(watchlist)); } catch (e) {}
  pushWatchlistToServer();
}

function pushWatchlistToServer() {
  var token = _ntToken();
  if (!token) return; // demo/not-logged-in → local only
  clearTimeout(_wlSyncTimer);
  var snapshot = watchlist.slice();
  _wlSyncTimer = setTimeout(function () {
    fetch(API_BASE + '/api/watchlist', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ symbols: snapshot })
    }).catch(function () {});
  }, 500);
}

// Pull the server copy on load. Server is the source of truth once logged in.
// If the server is empty but we have a local list, seed the server with it.
async function syncWatchlistFromServer() {
  var token = _ntToken();
  if (!token) return; // demo/not-logged-in → keep local list
  try {
    var r = await fetch(API_BASE + '/api/watchlist', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!r.ok) return;
    var data = await r.json();
    var serverList = Array.isArray(data.symbols) ? data.symbols : null;
    if (serverList === null) return;
    if (serverList.length === 0) {
      // First time for this user → upload whatever is on this device
      if (watchlist.length) pushWatchlistToServer();
      return;
    }
    // Adopt the server list (handles deletions made on another device)
    watchlist = serverList;
    try { localStorage.setItem(_wlKey(), JSON.stringify(watchlist)); } catch (e) {}
    if (typeof renderWatchlist === 'function') renderWatchlist();
  } catch (e) {}
}
window.syncWatchlistFromServer = syncWatchlistFromServer;

// Re-sync whenever the user returns to this client (switches back to the tab or
// re-opens the installed app), so a change made elsewhere shows up promptly.
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible' && _ntToken()) {
    syncWatchlistFromServer();
  }
});
window.addEventListener('focus', function () {
  if (_ntToken()) syncWatchlistFromServer();
});

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
        color: cfg.color, lineWidth: 2,
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
          color: cfg.color, lineWidth: 2,
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
  list.innerHTML = volRow + maRows + renderIndicatorRows();
}

// ============================================
//   TECHNICAL INDICATORS ENGINE
//   Standard, public-domain indicator math (SMA/EMA/BB/VWAP/RSI/MACD/ATR/CCI/Zigzag).
//   Each line gets its own color; overlays share the main price scale, oscillators
//   use a dedicated bottom scale — so their colored last-value labels show on the
//   right vertical axis (like TradingView).
//   NOTE: proprietary/community TradingView scripts (e.g. "Pro Dashboard", "D9",
//   "Moon phases") are copyrighted and are NOT copied here.
// ============================================
var indActive = {};   // id -> bool
var indSeries = {};    // id -> [series,...]
var _oscScaleReady = false;

function computeEMA(bars, period) {
  if (bars.length < period) return [];
  var k = 2 / (period + 1), out = [], ema = null, seed = 0;
  for (var i = 0; i < bars.length; i++) {
    var c = bars[i].close;
    if (i < period) { seed += c; if (i === period - 1) { ema = seed / period; out.push({ time: bars[i].time, value: +ema.toFixed(4) }); } continue; }
    ema = c * k + ema * (1 - k);
    out.push({ time: bars[i].time, value: +ema.toFixed(4) });
  }
  return out;
}

function computeBB(bars, period, mult) {
  var up = [], mid = [], lo = [];
  for (var i = period - 1; i < bars.length; i++) {
    var sum = 0, j;
    for (j = i - period + 1; j <= i; j++) sum += bars[j].close;
    var m = sum / period, sq = 0;
    for (j = i - period + 1; j <= i; j++) sq += Math.pow(bars[j].close - m, 2);
    var sd = Math.sqrt(sq / period);
    mid.push({ time: bars[i].time, value: +m.toFixed(4) });
    up.push({ time: bars[i].time, value: +(m + mult * sd).toFixed(4) });
    lo.push({ time: bars[i].time, value: +(m - mult * sd).toFixed(4) });
  }
  return [up, mid, lo];
}

function computeVWAP(bars) {
  var out = [], cumPV = 0, cumV = 0;
  for (var i = 0; i < bars.length; i++) {
    var tp = (bars[i].high + bars[i].low + bars[i].close) / 3;
    var v = bars[i].volume || 0;
    cumPV += tp * v; cumV += v;
    if (cumV > 0) out.push({ time: bars[i].time, value: +(cumPV / cumV).toFixed(4) });
  }
  return out;
}

function computeRSI(bars, period) {
  if (bars.length < period + 1) return [];
  var out = [], gain = 0, loss = 0, i;
  for (i = 1; i <= period; i++) {
    var d = bars[i].close - bars[i - 1].close;
    if (d >= 0) gain += d; else loss -= d;
  }
  var ag = gain / period, al = loss / period;
  out.push({ time: bars[period].time, value: +(100 - 100 / (1 + (al === 0 ? 100 : ag / al))).toFixed(2) });
  for (i = period + 1; i < bars.length; i++) {
    var ch = bars[i].close - bars[i - 1].close;
    var g = ch > 0 ? ch : 0, l = ch < 0 ? -ch : 0;
    ag = (ag * (period - 1) + g) / period;
    al = (al * (period - 1) + l) / period;
    out.push({ time: bars[i].time, value: +(100 - 100 / (1 + (al === 0 ? 100 : ag / al))).toFixed(2) });
  }
  return out;
}

function computeMACD(bars, fast, slow, signal) {
  var emaF = computeEMA(bars, fast), emaS = computeEMA(bars, slow);
  var mapF = {}; emaF.forEach(function(p) { mapF[p.time] = p.value; });
  var macd = [];
  emaS.forEach(function(p) { if (mapF[p.time] != null) macd.push({ time: p.time, value: +(mapF[p.time] - p.value).toFixed(4) }); });
  // signal = EMA(signal) of macd line
  var k = 2 / (signal + 1), sig = [], e = null, seed = 0;
  for (var i = 0; i < macd.length; i++) {
    if (i < signal) { seed += macd[i].value; if (i === signal - 1) { e = seed / signal; sig.push({ time: macd[i].time, value: +e.toFixed(4) }); } continue; }
    e = macd[i].value * k + e * (1 - k);
    sig.push({ time: macd[i].time, value: +e.toFixed(4) });
  }
  return [macd, sig];
}

function computeATR(bars, period) {
  if (bars.length < period + 1) return [];
  var trs = [], i;
  for (i = 1; i < bars.length; i++) {
    var tr = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close)
    );
    trs.push({ time: bars[i].time, tr: tr });
  }
  var out = [], atr = 0;
  for (i = 0; i < period; i++) atr += trs[i].tr;
  atr /= period;
  out.push({ time: trs[period - 1].time, value: +atr.toFixed(4) });
  for (i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i].tr) / period;
    out.push({ time: trs[i].time, value: +atr.toFixed(4) });
  }
  return out;
}

function computeCCI(bars, period) {
  var out = [];
  for (var i = period - 1; i < bars.length; i++) {
    var sum = 0, j, tps = [];
    for (j = i - period + 1; j <= i; j++) { var tp = (bars[j].high + bars[j].low + bars[j].close) / 3; tps.push(tp); sum += tp; }
    var mean = sum / period, md = 0;
    for (j = 0; j < tps.length; j++) md += Math.abs(tps[j] - mean);
    md /= period;
    var tpNow = (bars[i].high + bars[i].low + bars[i].close) / 3;
    var cci = md === 0 ? 0 : (tpNow - mean) / (0.015 * md);
    out.push({ time: bars[i].time, value: +cci.toFixed(2) });
  }
  return out;
}

var INDICATORS = [
  { id: 'sma20', label: 'SMA 20',               kind: 'overlay', colors: ['#00BCD4'],          compute: function(b){ return [computeMA(b, 20)]; } },
  { id: 'ema20', label: 'EMA 20',               kind: 'overlay', colors: ['#FFD54F'],          compute: function(b){ return [computeEMA(b, 20)]; } },
  { id: 'bb',    label: 'Bollinger Bands 20,2', kind: 'overlay', colors: ['#26C6DA','#90A4AE','#26C6DA'], compute: function(b){ return computeBB(b, 20, 2); } },
  { id: 'vwap',  label: 'VWAP',                 kind: 'overlay', colors: ['#AB47BC'],          compute: function(b){ return [computeVWAP(b)]; } },
  { id: 'rsi',   label: 'RSI 14',               kind: 'osc',     colors: ['#F06595'],          compute: function(b){ return [computeRSI(b, 14)]; } },
  { id: 'macd',  label: 'MACD 12,26,9',         kind: 'osc',     colors: ['#2962ff','#FF9800'], compute: function(b){ return computeMACD(b, 12, 26, 9); } },
  { id: 'atr',   label: 'ATR 14',               kind: 'osc',     colors: ['#8D6E63'],          compute: function(b){ return [computeATR(b, 14)]; } },
  { id: 'cci',   label: 'CCI 20',               kind: 'osc',     colors: ['#66BB6A'],          compute: function(b){ return [computeCCI(b, 20)]; } },
];

function indCfg(id) { return INDICATORS.find(function(c){ return c.id === id; }); }

function ensureOscScale() {
  if (_oscScaleReady || !chartInstance) return;
  try {
    chartInstance.priceScale('osc').applyOptions({ scaleMargins: { top: 0.78, bottom: 0 }, borderColor: '#1e2533' });
    _oscScaleReady = true;
  } catch (e) {}
}

function createIndSeries(cfg) {
  var arr = [];
  cfg.colors.forEach(function(col) {
    var opts = { color: col, lineWidth: 2, lastValueVisible: true, priceLineVisible: false, crosshairMarkerVisible: false };
    if (cfg.kind === 'osc') { opts.priceScaleId = 'osc'; opts.lineWidth = 1; }
    arr.push(chartInstance.addLineSeries(opts));
  });
  return arr;
}

function renderIndicators(bars) {
  if (!chartInstance || !bars || !bars.length) return;
  ensureOscScale();
  INDICATORS.forEach(function(cfg) {
    if (!indActive[cfg.id]) return;
    if (!indSeries[cfg.id]) indSeries[cfg.id] = createIndSeries(cfg);
    var datasets = cfg.compute(bars);
    datasets.forEach(function(d, idx) { if (indSeries[cfg.id][idx]) indSeries[cfg.id][idx].setData(d); });
  });
}

function clearIndicatorSeries() {
  if (!chartInstance) return;
  Object.keys(indSeries).forEach(function(id) {
    indSeries[id].forEach(function(s) { try { chartInstance.removeSeries(s); } catch (e) {} });
    delete indSeries[id];
  });
}

function toggleIndicator(id) {
  var cfg = indCfg(id); if (!cfg) return;
  if (indActive[id]) {
    indActive[id] = false;
    if (indSeries[id]) { indSeries[id].forEach(function(s){ try { chartInstance.removeSeries(s); } catch(e){} }); delete indSeries[id]; }
  } else {
    indActive[id] = true;
    if (lastBars && lastBars.length) {
      ensureOscScale();
      indSeries[id] = createIndSeries(cfg);
      var datasets = cfg.compute(lastBars);
      datasets.forEach(function(d, idx){ if (indSeries[id][idx]) indSeries[id][idx].setData(d); });
    }
  }
  renderMAPanel();
}

function renderIndicatorRows() {
  var overlay = INDICATORS.filter(function(c){ return c.kind === 'overlay'; });
  var osc = INDICATORS.filter(function(c){ return c.kind === 'osc'; });
  function row(cfg) {
    var on = !!indActive[cfg.id];
    var sw = cfg.colors.length > 1
      ? '<span class="ma-swatch" style="background:linear-gradient(90deg,' + cfg.colors.join(',') + ')"></span>'
      : '<span class="ma-swatch" style="background:' + cfg.colors[0] + '"></span>';
    return '<div class="ma-item">' + sw
      + '<span class="ma-label">' + cfg.label + '</span>'
      + '<button class="ma-toggle' + (on ? ' on' : '') + '" onclick="toggleIndicator(\'' + cfg.id + '\')"></button>'
      + '</div>';
  }
  return '<div class="ind-head">אינדיקטורים על הגרף</div>' + overlay.map(row).join('')
    + '<div class="ind-head">אוסצילטורים (סקאלה תחתונה)</div>' + osc.map(row).join('');
}

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
  '3M': { label:'3M', tdInterval:'1month', outputsize:120, aggregate:'quarter' },
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

  // Some "spot" tickers don't exist on Yahoo's chart API (e.g. XAUUSD=X / XAGUSD=X
  // return "No data found, symbol may be delisted"). Map them to the equivalent
  // continuous futures symbol, which Yahoo DOES serve, so the chart shows real data
  // instead of falling back to synthetic demo bars.
  var fetchSym = (YAHOO_FETCH_ALIAS[symbol] || symbol);

  // Yahoo first for live-like updates (avoids TwelveData quota throttling)
  raw = await fetchYahooChartDirect(fetchSym, tf);

  if (!raw || !raw.length) {
    // Fallback: TwelveData
    raw = await fetchTDChart(fetchSym, tf);
  }

  if (cfg.aggregate) raw = aggregateBars(raw, cfg.aggregate);
  return raw;
}
// Data-source aliases: display symbol (left) → symbol actually fetched (right).
var YAHOO_FETCH_ALIAS = {
  'XAUUSD=X': 'GC=F',  // Gold spot → Gold futures (Yahoo has data)
  'XAGUSD=X': 'SI=F'   // Silver spot → Silver futures
};

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
  var yfInterval = { '1H':'1h','4H':'1h','8H':'1h','1D':'1d','1W':'1wk','1M':'1mo','3M':'1mo','6M':'1mo' }[tf];
  var yfRange    = { '1H':'5d','4H':'60d','8H':'60d','1D':'2y','1W':'5y','1M':'10y','3M':'10y','6M':'10y' }[tf];
  try {
    var d = null;
    // Prefer our own server-side Yahoo proxy (reliable, works for indices/forex/futures
    // like ^GSPC, XAUUSD=X, XAGUSD=X, ES=F). Fall back to the public text proxy.
    try {
      var sr = await fetch(API_BASE + '/yahoo/chart?symbol=' + encodeURIComponent(symbol) +
                           '&interval=' + yfInterval + '&range=' + yfRange, { cache: 'no-store' });
      if (sr.ok) d = await sr.json();
    } catch (e1) { d = null; }
    if (!d || !d.chart || !d.chart.result) {
      var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' +
                encodeURIComponent(symbol) + '?interval=' + yfInterval + '&range=' + yfRange;
      d = await fetchYahooProxyJson(url);
    }
    if (!d || !d.chart || !d.chart.result || !d.chart.result[0]) return [];
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
    layout: { background: { color: '#131722' }, textColor: '#8899aa', fontSize: 11.5 },
    grid:   { vertLines: { color: 'transparent' }, horzLines: { color: 'transparent' } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: '#2a2e39', autoScale: true, entireTextOnly: true, minimumWidth: 66 },
    timeScale: { borderColor: '#2a2e39', timeVisible: true, secondsVisible: false },
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
    borderVisible: true,
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
    scaleMargins: { top: 0.78, bottom: 0 },
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
        chartInstance.timeScale().fitContent();
      }
    }
  }, 120);
}

// ============================================
//   CHART WHEEL HANDLER — slow pan + Ctrl zoom
// ============================================
var _priceMarginTop = 0.1, _priceMarginBottom = 0.1;
var _zoomAutoScaleTimer = null;
function initPriceAxisScroll() {
  var chartEl = document.getElementById('chart');
  if (!chartEl) return;
  chartEl.addEventListener('wheel', function(e) {
    if (!chartInstance) return;
    e.preventDefault();
    var rect = chartEl.getBoundingClientRect();
    var xFromRight = rect.right - e.clientX;

    // Ctrl + scroll = zoom in/out — anchored to the mouse cursor's horizontal position
    // (computed with plain arithmetic only — no reliance on possibly-unavailable API
    // methods — so this can never silently throw and "do nothing").
    if (e.ctrlKey) {
      try {
        var ts = chartInstance.timeScale();
        var range = ts.getVisibleLogicalRange();
        if (!range) return;
        var span = range.to - range.from;
        if (!(span > 0)) return;
        // Fraction of the plot width (excludes the price-scale strip on the right)
        // where the cursor sits, used to keep that same point fixed while zooming.
        var plotWidth = Math.max(1, (ts.width && ts.width()) || (rect.width - 94));
        var mouseX = e.clientX - rect.left;
        var frac = Math.max(0, Math.min(1, mouseX / plotWidth));
        var anchor = range.from + frac * span;
        if (ts.coordinateToLogical) {
          var exactAnchor = ts.coordinateToLogical(Math.max(0, Math.min(plotWidth, mouseX)));
          if (exactAnchor !== null && isFinite(exactAnchor)) anchor = exactAnchor;
        }
        // Exact reciprocal factors → zooming in then out returns to the identical range (no drift).
        var ZOOM_STEP = 1.15;
        var factor = e.deltaY > 0 ? ZOOM_STEP : (1 / ZOOM_STEP); // scroll down = contract(zoom out), scroll up = expand(zoom in)
        var newSpan = span * factor;
        // Clamp so it can never "over-approach" (too few bars) or explode unbounded.
        var MIN_SPAN = 5, MAX_SPAN = 3000;
        newSpan = Math.max(MIN_SPAN, Math.min(MAX_SPAN, newSpan));
        var newFrom = anchor - frac * newSpan;
        var newTo = newFrom + newSpan;
        // The price scale is left exactly as it is (no auto-scale toggling) so nothing
        // "snaps" back after the zoom gesture ends.
        ts.setVisibleLogicalRange({ from: newFrom, to: newTo });
      } catch (zoomErr) {
        console.warn('[Chart] ctrl+wheel zoom failed:', zoomErr);
      }
      return;
    }

    // On price axis (right ~94px) — vertical zoom (stretch/compress prices)
    if (xFromRight <= 94) {
      var dir = e.deltaY > 0 ? 1 : -1;
      var step = 0.009; // 70% slower than original 0.03
      _priceMarginTop    = Math.max(0.01, Math.min(0.88, _priceMarginTop    + dir * step));
      _priceMarginBottom = Math.max(0.01, Math.min(0.88, _priceMarginBottom + dir * step));
      chartInstance.applyOptions({
        rightPriceScale: { scaleMargins: { top: _priceMarginTop, bottom: _priceMarginBottom } }
      });
      return;
    }

    // Normal scroll — slow horizontal pan. Handles trackpad horizontal swipes (deltaX) too,
    // and applies the accumulated movement once per frame (no per-event jitter).
    var unit = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? rect.height : 1);
    var dx = e.deltaX * unit, dy = e.deltaY * unit;
    _wheelPanAcc += (Math.abs(dx) > Math.abs(dy) ? dx : dy);
    if (!_wheelPanRaf) {
      _wheelPanRaf = requestAnimationFrame(function() {
        _wheelPanRaf = 0;
        var acc = _wheelPanAcc; _wheelPanAcc = 0;
        if (!chartInstance || !acc) return;
        var ts2 = chartInstance.timeScale();
        var range2 = ts2.getVisibleLogicalRange();
        if (!range2) return;
        var spacing = (ts2.options && ts2.options().barSpacing) || 0;
        var shift = spacing > 0 ? (acc * 0.038) / spacing
          : (acc * 0.038) / Math.max(1, rect.width) * (range2.to - range2.from);
        ts2.setVisibleLogicalRange({ from: range2.from + shift, to: range2.to + shift });
      });
    }
  }, { passive: false, capture: true });
}
var _wheelPanAcc = 0, _wheelPanRaf = 0;
// True while the user is pressing/dragging on the chart (background refresh waits).
var _chartInteracting = false;
function initChartInteractionFlag() {
  var el = document.getElementById('chart');
  if (!el) return;
  var on = function() { _chartInteracting = true; };
  var off = function() { setTimeout(function() { _chartInteracting = false; }, 400); };
  el.addEventListener('mousedown', on, true);
  el.addEventListener('touchstart', on, { passive: true, capture: true });
  window.addEventListener('mouseup', off);
  window.addEventListener('touchend', off);
  window.addEventListener('touchcancel', off);
}

// ============================================
//   VERTICAL PAN — drag chart canvas up/down
// ============================================
function initChartVerticalPan() {
  // Disabled: the chart library already pans in BOTH directions 1:1 with the pointer.
  // The old custom margin-based pan ran in parallel with it and caused double movement/jumps.
  return;
  var chartEl = document.getElementById('chart');
  if (!chartEl) return;
  var dragging = false;
  var lastY = 0;

  chartEl.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return;
    var rect = chartEl.getBoundingClientRect();
    // Ignore clicks on the price axis itself
    if (rect.right - e.clientX <= 94) return;
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
//   SIDEBAR DYNAMIC WIDTH (mouse-wheel resize, trades off against chart size)
// ============================================
function initSidebarResize() {
  var sidebar = document.querySelector('aside.sidebar');
  if (!sidebar) return;
  var MIN_W = 130, MAX_W = 380;

  var saved = parseInt(localStorage.getItem('nt_sidebar_w') || '0', 10);
  if (saved && saved >= MIN_W && saved <= MAX_W) {
    document.documentElement.style.setProperty('--sidebar-w', saved + 'px');
  }

  function applyDelta(delta) {
    var current = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w')) || 210;
    // Positive delta (scrolling right / down) shrinks the sidebar (more room for the chart).
    // Negative delta (scrolling left / up) grows the sidebar.
    var next = current - delta;
    next = Math.max(MIN_W, Math.min(MAX_W, next));
    document.documentElement.style.setProperty('--sidebar-w', next + 'px');
    localStorage.setItem('nt_sidebar_w', String(Math.round(next)));
    if (chartInstance) {
      var el = document.getElementById('chart');
      if (el && el.offsetWidth > 0 && el.offsetHeight > 0) chartInstance.resize(el.offsetWidth, el.offsetHeight);
    }
  }

  sidebar.addEventListener('wheel', function(e) {
    // True horizontal scroll (trackpad swipe, or Shift+wheel which browsers report as deltaX).
    if (Math.abs(e.deltaX) >= 2) { e.preventDefault(); applyDelta(e.deltaX); return; }
    // Shift+wheel on setups that don't auto-convert deltaY -> deltaX.
    if (e.shiftKey && Math.abs(e.deltaY) >= 2) { e.preventDefault(); applyDelta(e.deltaY); return; }
    // Plain vertical wheel over a non-scrollable part of the sidebar (header/filters bar,
    // not the watchlist itself) also resizes, so an ordinary mouse wheel works too.
    var overScrollableList = !!(e.target.closest && e.target.closest('#watchlist, .sidebar-view'));
    if (!overScrollableList && Math.abs(e.deltaY) >= 2) { e.preventDefault(); applyDelta(e.deltaY); return; }
    // Otherwise: plain vertical wheel over the watchlist list -> let it scroll normally.
  }, { passive: false });
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
var _ctxBgSolid = '#131722';
var _ctxBgGradTop = '#131722', _ctxBgGradBot = '#1e222d';
var _ctxBgMode = 'solid';
(function loadBgPref() {
  try {
    var s = JSON.parse(localStorage.getItem('nt_chartBg'));
    if (s) { _ctxBgMode = s.mode || 'solid'; _ctxBgSolid = s.solid || '#131722'; _ctxBgGradTop = s.top || '#131722'; _ctxBgGradBot = s.bot || '#1e222d'; }
    // Migrate the previous near-black defaults to the TradingView-style matte dark
    var _old = { '#0f1117': 1, '#05070a': 1, '#000000': 1, '#000': 1 };
    if (_old[_ctxBgSolid]) _ctxBgSolid = '#131722';
    if (_old[_ctxBgGradTop]) _ctxBgGradTop = '#131722';
    if (_ctxBgGradBot === '#1a1f2e' || _ctxBgGradBot === '#12161f') _ctxBgGradBot = '#1e222d';
  } catch(e) {}
})();
function _saveBgPref() {
  localStorage.setItem('nt_chartBg', JSON.stringify({ mode: _ctxBgMode, solid: _ctxBgSolid, top: _ctxBgGradTop, bot: _ctxBgGradBot }));
}

// ============================================
//   CHART WATERMARK (symbol name behind chart)
// ============================================
var _wmVisible = true;
var _wmStrength = 'medium';
var _WM_STRENGTH = {
  weak:   { alpha: 0.05, fontSize: 56 },
  medium: { alpha: 0.11, fontSize: 76 },
  strong: { alpha: 0.20, fontSize: 96 }
};
(function loadWmPref() {
  try {
    var s = JSON.parse(localStorage.getItem('nt_watermark'));
    if (s) {
      if (typeof s.visible === 'boolean') _wmVisible = s.visible;
      if (s.strength && _WM_STRENGTH[s.strength]) _wmStrength = s.strength;
    }
  } catch(e) {}
})();
function _saveWmPref() {
  localStorage.setItem('nt_watermark', JSON.stringify({ visible: _wmVisible, strength: _wmStrength }));
}
function applyWatermark() {
  if (!chartInstance) return;
  var cfg = _WM_STRENGTH[_wmStrength] || _WM_STRENGTH.medium;
  var txt = (currentSymbol || '').replace('.TA', '');
  try {
    chartInstance.applyOptions({
      watermark: {
        visible: _wmVisible && !!txt,
        text: txt,
        color: 'rgba(255,255,255,' + cfg.alpha + ')',
        fontSize: cfg.fontSize,
        fontStyle: 'bold',
        horzAlign: 'center',
        vertAlign: 'center'
      }
    });
  } catch(e) {}
}
function wmToggle() {
  _wmVisible = !_wmVisible;
  _saveWmPref();
  applyWatermark();
  wmSyncUI();
}
function wmSetStrength(s) {
  if (!_WM_STRENGTH[s]) return;
  _wmStrength = s;
  _saveWmPref();
  applyWatermark();
  wmSyncUI();
}
function wmSyncUI() {
  var row = document.getElementById('wmToggleRow');
  if (row) row.classList.toggle('checked', _wmVisible);
  var tabs = document.getElementById('wmStrengthTabs');
  if (tabs) tabs.querySelectorAll('.ctxm-tab').forEach(function(b) {
    b.classList.toggle('active', b.getAttribute('data-wm') === _wmStrength);
  });
}

function initChartContextMenu() {
  var chartEl = document.getElementById('chart');
  if (!chartEl) return;

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

  cstApplyInitialState();

  // Watermark: reflect saved prefs in UI + apply to chart
  wmSyncUI();
  applyWatermark();

  chartEl.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    var series = candleSeries || lineSeries;
    if (series) {
      try {
        var chartRect = chartEl.getBoundingClientRect();
        var priceAtClick = series.coordinateToPrice(e.clientY - chartRect.top);
        if (priceAtClick != null && isFinite(priceAtClick)) _crosshairAlertPrice = priceAtClick;
      } catch (err) {}
    }
    openChartCtxMenuAt(e.clientX, e.clientY);
  });

  // Alt+R / Alt+A / Alt+Shift+B / Alt+Shift+S / Shift+T / Alt+H / Alt+E chart shortcuts
  document.addEventListener('keydown', function(e) {
    var tag = (document.activeElement && document.activeElement.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (e.altKey && !e.shiftKey && (e.key === 'r' || e.key === 'R')) { ctxResetView(); e.preventDefault(); }
    else if (e.altKey && !e.shiftKey && (e.key === 'a' || e.key === 'A')) { crosshairMenuAddAlert(false); e.preventDefault(); }
    else if (e.altKey && e.shiftKey && (e.key === 'b' || e.key === 'B')) { crosshairMenuOrder('long', 'stop'); e.preventDefault(); }
    else if (e.altKey && e.shiftKey && (e.key === 's' || e.key === 'S')) { crosshairMenuOrder('short', 'limit'); e.preventDefault(); }
    else if (!e.altKey && e.shiftKey && (e.key === 't' || e.key === 'T')) { crosshairMenuShowOrderForm(); e.preventDefault(); }
    else if (e.altKey && !e.shiftKey && (e.key === 'h' || e.key === 'H')) { crosshairMenuDrawHLine(); e.preventDefault(); }
    else if (e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey && (e.key === 'e' || e.key === 'E' || e.code === 'KeyE')) { addCurrentToWatchlist(); e.preventDefault(); }
  });
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

function buildCrosshairMenuHtml() {
  var sym = (currentSymbol || '').replace('.TA', '');
  var price = (_crosshairAlertPrice && isFinite(_crosshairAlertPrice)) ? parseFloat(_crosshairAlertPrice.toFixed(2)) : null;
  var priceTxt = price != null ? formatPrice(price) : '';
  return ''
    + '<div class="cm-item" onclick="crosshairMenuAddAlert(false)"><span class="cm-ic">🔔</span><span class="cm-txt">הוסף התראה על ' + sym + ' במחיר ' + priceTxt + '</span><span class="cm-key">Alt+A</span></div>'
    + '<div class="cm-item" onclick="crosshairMenuAddAlert(true)"><span class="cm-ic">🔔</span><span class="cm-txt">הוסף התראה על SMA במחיר ' + priceTxt + '</span><span class="cm-key">Alt+A</span></div>'
    + '<div class="cm-sep"></div>'
    + '<div class="cm-item" onclick="crosshairMenuOrder(\'long\',\'limit\')"><span class="cm-ic cm-buy">⌃</span><span class="cm-txt">קנה 1 ' + sym + ' במחיר ' + priceTxt + ' לימיט</span><span class="cm-key">Alt+Shift+B</span></div>'
    + '<div class="cm-item" onclick="crosshairMenuOrder(\'short\',\'stop\')"><span class="cm-ic cm-sell">⌄</span><span class="cm-txt">מכור 1 ' + sym + ' במחיר ' + priceTxt + ' סטופ</span></div>'
    + '<div class="cm-item" onclick="crosshairMenuOrder(\'short\',\'stoplimit\')"><span class="cm-ic cm-sell">⌄</span><span class="cm-txt">מכור 1 ' + sym + ' סטופ ' + priceTxt + ' לימיט</span></div>'
    + '<div class="cm-item" onclick="crosshairMenuShowOrderForm()"><span class="cm-ic">✎</span><span class="cm-txt">הוסף פקודה על ' + sym + ' במחיר ' + priceTxt + '…</span><span class="cm-key">Shift+T</span></div>'
    + '<div class="cm-sep"></div>'
    + '<div class="cm-item" onclick="crosshairMenuDrawHLine()"><span class="cm-ic">—</span><span class="cm-txt">צייר קו אופקי במחיר ' + priceTxt + '</span><span class="cm-key">Alt+H</span></div>';
}

function openCrosshairAlertPopup() {
  var popup = document.getElementById('crosshairAlertPopup');
  var btn   = document.getElementById('crosshairAlertBtn');
  if (!popup || !btn) return;
  var list = document.getElementById('crosshairMenuList');
  var form = document.getElementById('crosshairOrderForm');
  _crosshairMenuMode = 'short';
  if (list) { list.innerHTML = buildCrosshairMenuHtml(); list.style.display = 'flex'; }
  if (form) form.style.display = 'none';
  // Position popup near the button
  var btnTop = parseInt(btn.style.top) || 0;
  var btnLeft = parseInt(btn.style.left) || 0;
  popup.style.top  = Math.max(5, btnTop - 30) + 'px';
  popup.style.left = Math.max(5, btnLeft - 285) + 'px';
  popup.classList.remove('closing');
  if (popup._closeTimer) { clearTimeout(popup._closeTimer); popup._closeTimer = null; }
  popup.style.display = 'block';
  // Keep button visible while popup is open
  btn.style.display = 'flex';
}

function closeCrosshairAlertPopup() {
  var popup = document.getElementById('crosshairAlertPopup');
  if (!popup) return;
  if (popup.style.display === 'none' || popup.style.display === '') return;
  // Smooth fade-out, then hide
  popup.classList.add('closing');
  var p = popup;
  if (p._closeTimer) clearTimeout(p._closeTimer);
  p._closeTimer = setTimeout(function() {
    p.style.display = 'none';
    p.classList.remove('closing');
    p._closeTimer = null;
  }, 160);
}

function showCrosshairBanner(msg) {
  var banner = document.createElement('div');
  banner.textContent = msg;
  banner.style.cssText = 'position:fixed;bottom:70px;left:50%;transform:translateX(-50%);background:#0a3020;border:1px solid #26a69a;color:#26a69a;padding:.4rem 1rem;border-radius:8px;font-size:.78rem;z-index:9999;font-family:Heebo,sans-serif;';
  document.body.appendChild(banner);
  setTimeout(function() { banner.remove(); }, 2500);
}

function crosshairMenuAddAlert(isSma) {
  var price = (_crosshairAlertPrice && isFinite(_crosshairAlertPrice)) ? parseFloat(_crosshairAlertPrice.toFixed(2)) : null;
  var sym = currentSymbol;
  if (!sym || price == null) return;
  var live = priceCache[sym] ? priceCache[sym].price : null;
  var cond = (live != null && price < live) ? 'below' : 'above';
  alerts.push({ symbol: sym, condition: cond, price: price, email: null, kind: isSma ? 'sma' : 'price' });
  localStorage.setItem('ml_alerts', JSON.stringify(alerts));
  renderAlerts();
  closeCrosshairAlertPopup();
  if (typeof incrementAlertBadge === 'function') incrementAlertBadge();
  var label = isSma ? 'SMA' : sym.replace('.TA', '');
  showCrosshairBanner('✅ התראה נוספה: ' + label + ' ' + (cond === 'above' ? 'מעל' : 'מתחת') + ' ' + formatPrice(price));
}

function crosshairMenuOrder(dir, kind) {
  var price = (_crosshairAlertPrice && isFinite(_crosshairAlertPrice)) ? parseFloat(_crosshairAlertPrice.toFixed(2)) : null;
  var sym = currentSymbol;
  if (!sym || price == null) return;
  if (window.NTDraw && typeof window.NTDraw.addPositionAtPrice === 'function') {
    window.NTDraw.addPositionAtPrice(dir, price);
  }
  closeCrosshairAlertPopup();
  var verb = dir === 'long' ? 'קניית' : 'מכירת';
  var kindTxt = kind === 'limit' ? 'לימיט' : kind === 'stop' ? 'סטופ' : 'סטופ-לימיט';
  showCrosshairBanner('✅ סומנה ' + verb + ' 1 ' + sym.replace('.TA', '') + ' (' + kindTxt + ') במחיר ' + formatPrice(price));
}

function crosshairMenuShowOrderForm() {
  var list = document.getElementById('crosshairMenuList');
  var form = document.getElementById('crosshairOrderForm');
  if (list) list.style.display = 'none';
  if (form) form.style.display = 'block';
  var priceLabel = document.getElementById('crosshairAlertPriceLabel');
  var priceInput = document.getElementById('crosshairAlertPriceInp');
  if (_crosshairAlertPrice && isFinite(_crosshairAlertPrice)) {
    var rounded = parseFloat(_crosshairAlertPrice.toFixed(2));
    if (priceLabel) priceLabel.textContent = 'מחיר: ' + formatPrice(rounded);
    if (priceInput) priceInput.value = rounded;
  }
}

function crosshairMenuBackToList() {
  var list = document.getElementById('crosshairMenuList');
  var form = document.getElementById('crosshairOrderForm');
  if (form) form.style.display = 'none';
  if (list) {
    list.innerHTML = _crosshairMenuMode === 'full' ? buildChartCtxMenuHtml() : buildCrosshairMenuHtml();
    list.style.display = 'flex';
  }
}

function crosshairMenuDrawHLine() {
  var price = (_crosshairAlertPrice && isFinite(_crosshairAlertPrice)) ? parseFloat(_crosshairAlertPrice.toFixed(2)) : null;
  if (price == null) return;
  if (window.NTDraw && typeof window.NTDraw.addHLine === 'function') {
    window.NTDraw.addHLine(price);
  }
  closeCrosshairAlertPopup();
  showCrosshairBanner('✅ קו אופקי צויר במחיר ' + formatPrice(price));
}

// ============================================
//   CHART RIGHT-CLICK FULL CONTEXT MENU
// ============================================
var _crosshairMenuMode = 'short'; // 'short' (from the chart '+' button) | 'full' (from right-click)
var _ctxLockCursor = false;

function buildChartCtxMenuHtml() {
  var sym = (currentSymbol || '').replace('.TA', '');
  var price = (_crosshairAlertPrice && isFinite(_crosshairAlertPrice)) ? parseFloat(_crosshairAlertPrice.toFixed(2)) : null;
  var priceTxt = price != null ? formatPrice(price) : '';
  var drawCount = (window.NTDraw && typeof window.NTDraw.shapeCount === 'function') ? window.NTDraw.shapeCount() : 0;
  var indCount = Object.keys(maActive).filter(function(p) { return maActive[p]; }).length;
  return ''
    + '<div class="cm-item" onclick="ctxResetView()"><span class="cm-ic">↺</span><span class="cm-txt">איפוס תצוגת גרף</span><span class="cm-key">Alt+R</span></div>'
    + '<div class="cm-item" onclick="ctxCopyPrice()"><span class="cm-ic"></span><span class="cm-txt">העתק מחיר' + (priceTxt ? (' ' + priceTxt) : '') + '</span></div>'
    + '<div class="cm-item" onclick="ctxPaste()"><span class="cm-ic"></span><span class="cm-txt">הדבק</span><span class="cm-key">Ctrl+V</span></div>'
    + '<div class="cm-sep"></div>'
    + '<div class="cm-item" onclick="crosshairMenuAddAlert(false)"><span class="cm-ic">🔔</span><span class="cm-txt">הוסף התראה על ' + sym + ' במחיר ' + priceTxt + '…</span><span class="cm-key">Alt+A</span></div>'
    + '<div class="cm-item" onclick="crosshairMenuOrder(\'short\',\'limit\')"><span class="cm-ic cm-sell">⌄</span><span class="cm-txt">מכור 1 ' + sym + ' ב-' + priceTxt + ' לימיט</span><span class="cm-key">Alt+Shift+S</span></div>'
    + '<div class="cm-item" onclick="crosshairMenuOrder(\'long\',\'stop\')"><span class="cm-ic cm-buy">⌃</span><span class="cm-txt">קנה 1 ' + sym + ' ב-' + priceTxt + ' סטופ</span><span class="cm-key">Alt+Shift+B</span></div>'
    + '<div class="cm-item" onclick="crosshairMenuShowOrderForm()"><span class="cm-ic">✎</span><span class="cm-txt">הוסף פקודה על ' + sym + ' במחיר ' + priceTxt + '…</span><span class="cm-key">Shift+T</span></div>'
    + '<div class="cm-sep"></div>'
    + '<div class="cm-item" onclick="ctxToggleLockCursor()"><span class="cm-ic cm-check">' + (_ctxLockCursor ? '✓' : '') + '</span><span class="cm-txt">נעל קו סמן אנכי לפי זמן</span></div>'
    + '<div class="cm-sep"></div>'
    + '<div class="cm-item" onclick="ctxStub()"><span class="cm-ic"></span><span class="cm-txt">תצוגת טבלה</span></div>'
    + '<div class="cm-item" onclick="ctxStub()"><span class="cm-ic"></span><span class="cm-txt">עץ אובייקטים</span></div>'
    + '<div class="cm-item" onclick="ctxStub()"><span class="cm-ic"></span><span class="cm-txt">תבנית גרף</span><span class="cm-key">›</span></div>'
    + '<div class="cm-sep"></div>'
    + '<div class="cm-item" onclick="ctxRemoveDrawings()"><span class="cm-ic">🗑</span><span class="cm-txt">הסר ' + drawCount + ' ציורים</span></div>'
    + '<div class="cm-item" onclick="ctxRemoveIndicators()"><span class="cm-ic">🗑</span><span class="cm-txt">הסר ' + indCount + ' אינדיקטורים</span></div>'
    + '<div class="cm-sep"></div>'
    + '<div class="cm-item" onclick="ctxOpenSettings()"><span class="cm-ic">⚙</span><span class="cm-txt">הגדרות...</span></div>';
}

function openChartCtxMenuAt(clientX, clientY) {
  var popup = document.getElementById('crosshairAlertPopup');
  var list  = document.getElementById('crosshairMenuList');
  var form  = document.getElementById('crosshairOrderForm');
  if (!popup || !list) return;
  _crosshairMenuMode = 'full';
  list.innerHTML = buildChartCtxMenuHtml();
  list.style.display = 'flex';
  if (form) form.style.display = 'none';
  var wrap = document.querySelector('.chart-wrap');
  if (!wrap) return;
  var wrapRect = wrap.getBoundingClientRect();
  var mw = 270, approxH = 480;
  var left = clientX - wrapRect.left;
  var top  = clientY - wrapRect.top;
  if (left + mw > wrapRect.width)      left = Math.max(4, wrapRect.width - mw - 4);
  if (top + approxH > wrapRect.height) top  = Math.max(4, wrapRect.height - approxH - 4);
  popup.style.left = left + 'px';
  popup.style.top  = top + 'px';
  popup.classList.remove('closing');
  if (popup._closeTimer) { clearTimeout(popup._closeTimer); popup._closeTimer = null; }
  popup.style.display = 'block';
}

function ctxResetView() {
  closeCrosshairAlertPopup();
  if (!chartInstance) return;
  try {
    var ts = chartInstance.timeScale();
    ts.resetTimeScale();        // reset zoom/scroll to default
    ts.fitContent();            // fit all bars into view
  } catch (e) {
    try { chartInstance.timeScale().fitContent(); } catch (e2) {}
  }
  // Re-enable auto price scaling so the Y axis fits the data again
  try {
    var series = candleSeries || lineSeries;
    if (series && series.priceScale) series.priceScale().applyOptions({ autoScale: true });
  } catch (e) {}
}

function ctxCopyPrice() {
  var price = (_crosshairAlertPrice && isFinite(_crosshairAlertPrice)) ? _crosshairAlertPrice : null;
  closeCrosshairAlertPopup();
  if (price == null) return;
  var txt = String(parseFloat(price.toFixed(5)));
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).catch(function() {});
  }
  showCrosshairBanner('📋 המחיר ' + txt + ' הועתק');
}

function ctxPaste() {
  closeCrosshairAlertPopup();
  showCrosshairBanner('ℹ️ פעולת הדבקה אינה נתמכת כרגע');
}

function ctxToggleLockCursor() {
  _ctxLockCursor = !_ctxLockCursor;
  crosshairMenuBackToList();
}

function ctxStub() {
  closeCrosshairAlertPopup();
  showCrosshairBanner('🔧 האפשרות הזו תהיה זמינה בקרוב');
}

function ctxRemoveDrawings() {
  closeCrosshairAlertPopup();
  if (!(window.NTDraw && typeof window.NTDraw.shapeCount === 'function')) return;
  var n = window.NTDraw.shapeCount();
  if (!n) return;
  if (confirm('להסיר את כל ' + n + ' הציורים מהגרף?')) {
    window.NTDraw.clearAllShapes();
    showCrosshairBanner('🗑️ הציורים הוסרו');
  }
}

function ctxRemoveIndicators() {
  closeCrosshairAlertPopup();
  var removed = 0;
  MA_CONFIGS.forEach(function(cfg) {
    if (maActive[cfg.period]) { toggleMA(cfg.period); removed++; }
  });
  if (removed) showCrosshairBanner('🗑️ ' + removed + ' אינדיקטורים הוסרו');
}

function ctxOpenSettings() {
  closeCrosshairAlertPopup();
  var overlay = document.getElementById('chartSettingsOverlay');
  if (!overlay) return;
  overlay.classList.add('open');
  switchSettingsTab('trading');
}

function closeChartSettings() {
  var overlay = document.getElementById('chartSettingsOverlay');
  if (overlay) overlay.classList.remove('open');
}

function switchSettingsTab(tab) {
  document.querySelectorAll('.cst-nav-item').forEach(function(el) {
    el.classList.toggle('active', el.getAttribute('data-tab') === tab);
  });
  document.querySelectorAll('.cst-pane').forEach(function(el) {
    el.classList.toggle('active', el.getAttribute('data-pane') === tab);
  });
}

// ---- Settings > Trading tab toggles (persisted, visual state only) ----
var CST_DEFAULTS = {
  buySellBtns: false, oneTap: false, execSound: true, rejectOnly: false,
  positionsOrders: true, reversePos: true, projectOrder: false,
  pnlValue: true, pnlPositions: true, pnlBrackets: true, execMarks: true
};
var CST_SETTINGS = (function() {
  try { return JSON.parse(localStorage.getItem('nt_chart_trade_settings') || '{}'); } catch (e) { return {}; }
})();

function cstToggle(key) {
  var cur = CST_SETTINGS[key] != null ? CST_SETTINGS[key] : CST_DEFAULTS[key];
  var next = !cur;
  CST_SETTINGS[key] = next;
  localStorage.setItem('nt_chart_trade_settings', JSON.stringify(CST_SETTINGS));
  var row = document.getElementById('cstRow_' + key);
  if (row) row.classList.toggle('checked', next);
}

function cstApplyInitialState() {
  Object.keys(CST_DEFAULTS).forEach(function(key) {
    var val = CST_SETTINGS[key] != null ? CST_SETTINGS[key] : CST_DEFAULTS[key];
    var row = document.getElementById('cstRow_' + key);
    if (row) row.classList.toggle('checked', val);
  });
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
  if (typeof incrementAlertBadge === 'function') incrementAlertBadge();
  showCrosshairBanner('✅ התראה נוספה: ' + sym.replace('.TA', '') + ' ' + (cond === 'above' ? 'מעל' : 'מתחת') + ' ' + formatPrice(price));
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

// Mobile: dismiss the chart context menu smoothly when tapping anywhere outside it
document.addEventListener('pointerdown', function(e) {
  var popup = document.getElementById('crosshairAlertPopup');
  if (!popup || popup.style.display !== 'block') return;
  if (popup.classList.contains('closing')) return;
  var btn = document.getElementById('crosshairAlertBtn');
  if (!popup.contains(e.target) && e.target !== btn && (!btn || !btn.contains(e.target))) {
    closeCrosshairAlertPopup();
  }
}, true);

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
  var countMap = { '1H': 120, '4H': 120, '8H': 120, '1D': 160, '1W': 160, '1M': 120, '3M': 80, '6M': 80 };
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
  try { if (window.NTStockPanel) window.NTStockPanel.show(targetSymbol); } catch (e) {}

  document.getElementById('chartTitle').textContent    = targetSymbol + '  ' + (NAMES[targetSymbol] || (priceCache[targetSymbol] && priceCache[targetSymbol].name) || targetSymbol);
  document.getElementById('chartSubtitle').innerHTML =
    '<span id="loadDots" style="color:var(--accent)">&#9679;&#9679;&#9679; מחפש נתונים מ-Yahoo Finance...</span>';
  if (typeof updateMSymSwitch === 'function') updateMSymSwitch();
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
      color: isUp ? 'rgba(38,166,154,0.82)' : 'rgba(239,83,80,0.82)',
    };
  });

  // Background refresh: remember the exact visible window so the view never shifts.
  var keepRange = null;
  if (preserveZoom) {
    try { keepRange = chartInstance.timeScale().getVisibleLogicalRange(); } catch (e) {}
  } else {
    // New symbol / timeframe: go back to auto price scaling (a manual vertical drag disables it)
    try {
      _priceMarginTop = 0.1; _priceMarginBottom = 0.1;
      chartInstance.applyOptions({ rightPriceScale: { autoScale: true, scaleMargins: { top: 0.1, bottom: 0.1 } } });
    } catch (e) {}
  }

  // Set all series data
  var lineData = bars.map(function(b) { return { time: b.time, value: b.close }; });
  lineSeries.setData(lineData);
  candleSeries.setData(bars);
  barSeries.setData(bars);
  volumeSeries.setData(volData);
  if (keepRange) {
    try { chartInstance.timeScale().setVisibleLogicalRange(keepRange); } catch (e) {}
  }

  // Update / re-render active MAs with new data
  clearMASeries();
  renderMAs(bars);

  // Update / re-render active technical indicators
  clearIndicatorSeries();
  renderIndicators(bars);

  // Keep the chart watermark text in sync with the current symbol
  applyWatermark();

  // Fit time scale only on initial load (not on background refresh)
  // Also re-fit after a short delay: the chart container can still be mid-resize
  // (e.g. right after page load / first paint) when this first runs, which would
  // fit the view to a too-small width and make the chart look overly zoomed in
  // once the container reaches its real size. Re-fitting once the layout settles
  // guarantees the full history is shown clearly, matching TradingView-style overview.
  if (!preserveZoom) {
    chartInstance.timeScale().fitContent();
    var fitSym = currentSymbol, fitTf = currentTF;
    setTimeout(function() {
      // only re-fit if the user hasn't started interacting and the chart is still the same one
      if (chartInstance && !_chartInteracting && fitSym === currentSymbol && fitTf === currentTF) {
        chartInstance.timeScale().fitContent();
      }
    }, 200);
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
  if (typeof updateMSymSwitch === 'function') updateMSymSwitch();
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
    var tfMap = { '1':'1H', '2':'4H', '3':'1D', '4':'1W', '5':'1M', '6':'3M', '7':'6M' };
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
    if (wlColorFilter && wlColorMap[sym] !== wlColorFilter) return false;
    if (symFilter && sym.replace('.TA','').indexOf(symFilter) === -1) return false;
    if (pctFilter) {
      var d = priceCache[sym];
      if (d) {
        var pct = d.changePct;
        if (pctFilter === 'up' && pct < 0) return false;
        if (pctFilter === 'down' && pct >= 0) return false;
      }
    }
    return true;
  });
  // Sort by % change if requested
  if (pctFilter === 'sort-desc' || pctFilter === 'sort-asc') {
    toShow.sort(function(a, b) {
      var da = priceCache[a], db = priceCache[b];
      var pa = da ? da.changePct : 0, pb = db ? db.changePct : 0;
      return pctFilter === 'sort-desc' ? pb - pa : pa - pb;
    });
  }
  ul.innerHTML = toShow.map(function(sym) {
    var d   = priceCache[sym];
    var cls = d ? (d.change >= 0 ? 'up' : 'down') : '';
    var pct = d ? (d.change >= 0 ? '+' : '') + d.changePct.toFixed(2) + '%' : '';
    var priceText = d ? formatPrice(d.price, sym) : '';
    var name = (NAMES[sym] || (d && d.name) || sym).replace(/\s*\(.*?\)\s*/g, '').trim();
    var shortSym = sym.replace('.TA','');
    var logoUrl = getStockLogo(sym);
    if (logoUrl === null) fetchStockLogoAsync(sym);
    var initials = shortSym.slice(0, 2).toUpperCase();
    var iconBg = (typeof smColor === 'function') ? smColor(shortSym) : '#2a3040';
    var logoImg = '<img class="wl-logo" data-sym="' + shortSym + '" src="' + (logoUrl || '') + '"'
      + (logoUrl ? '' : ' style="display:none"')
      + ' width="20" height="20" onerror="this.style.display=\'none\'">';
    var favCol = wlColorMap[sym] || '';
    var favStyle = favCol ? ('background:' + wlColorHex(favCol) + ';border-color:' + wlColorHex(favCol)) : '';
    return '<li class="watch-item" onclick="selectSymbol(\'' + sym + '\')">'
      + '<button class="watch-bookmark-dot" style="' + favStyle + '" title="סמן בצבע מועדפים" onclick="openColorPicker(event,\'' + sym + '\')"></button>'
      + '<div class="watch-icon-wrap">'
      + '<div class="watch-icon" style="background:' + iconBg + '">' + initials + '</div>'
      + logoImg
      + '<span class="watch-dot ' + cls + '" style="background:' + (cls === 'up' ? 'var(--green)' : cls === 'down' ? 'var(--red)' : 'var(--accent)') + '"></span>'
      + '</div>'
      + '<div class="watch-main">'
      + '<span class="watch-sym">' + shortSym + '</span>'
      + '<span class="watch-name">' + name + '</span>'
      + '</div>'
      + '<div class="watch-price-wrap">'
      + (priceText ? '<span class="watch-price">' + priceText + '</span>' : '')
      + (pct ? '<span class="watch-chg ' + cls + '">' + pct + '</span>' : '')
      + '</div>'
      + '<button class="watch-remove-btn" title="מחק" onclick="removeFromWatchlist(event,\'' + sym + '\')">✕</button>'
      + '</li>';
  }).join('');
  renderColorBar();
}

async function addToWatchlist() {
  var input = document.getElementById('searchInput');
  var sym   = (input ? input.value : '').trim().toUpperCase();
  if (!sym) return;

  var resolved = await resolveSymbolForData(sym, currentTF);
  var finalSym = resolved || sym;
  if (watchlist.includes(finalSym)) return;

  watchlist.push(finalSym);
  saveWatchlist();
  await loadCard(finalSym);
  renderWatchlist();
}

function removeFromWatchlist(e, sym) {
  e.stopPropagation();
  watchlist = watchlist.filter(function(s) { return s !== sym; });
  saveWatchlist();
  renderWatchlist();
}

// Lightweight transient toast (self-contained, no HTML/CSS needed)
function ntToast(msg) {
  var t = document.getElementById('ntToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'ntToast';
    t.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%) translateY(16px);' +
      'background:#111722;color:#fff;font-family:Heebo,sans-serif;font-size:.85rem;font-weight:700;' +
      'padding:.6rem 1.1rem;border-radius:10px;border:1px solid #2962ff;box-shadow:0 8px 28px rgba(0,0,0,.5);' +
      'z-index:99999;opacity:0;transition:opacity .2s,transform .2s;pointer-events:none;direction:rtl;';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  requestAnimationFrame(function() {
    t.style.opacity = '1';
    t.style.transform = 'translateX(-50%) translateY(0)';
  });
  clearTimeout(ntToast._t);
  ntToast._t = setTimeout(function() {
    t.style.opacity = '0';
    t.style.transform = 'translateX(-50%) translateY(16px)';
  }, 2000);
}

// Add the symbol currently shown on the chart to the watchlist (Ctrl+E shortcut)
function addCurrentToWatchlist() {
  var sym = currentSymbol;
  if (!sym) { ntToast('אין נייר פעיל על הגרף'); return; }
  var label = sym.replace('.TA', '');
  if (watchlist.includes(sym)) { ntToast(label + ' כבר ברשימת המעקב'); return; }
  watchlist.push(sym);
  saveWatchlist();
  renderWatchlist();
  ntToast('✓ ' + label + ' נוסף לרשימת המעקב');
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
  if (typeof incrementAlertBadge === 'function') incrementAlertBadge();
}

// Price alert at a signal's entry level (used by the AI-analysis popup). The direction is
// inferred from where the live price is: below the level -> alert when it crosses up, else down.
function ntAddEntryAlert(sym, level, curPrice) {
  if (!sym || !(level > 0)) return null;
  var cond = (curPrice != null && curPrice > level) ? 'below' : 'above';
  var dup = alerts.some(function(a) { return a.symbol === sym && a.condition === cond && Math.abs(a.price - level) < 1e-9; });
  if (!dup) {
    alerts.push({ symbol: sym, condition: cond, price: level, email: null });
    localStorage.setItem('ml_alerts', JSON.stringify(alerts));
  }
  try {
    fetchQuote(sym).then(function(d) { if (d) priceCache[sym] = d; renderAlerts(); }).catch(function() {});
  } catch (e) {}
  try { renderAlerts(); } catch (e) {}
  return { cond: cond, dup: dup };
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
  try {
    var _lbl = a.symbol.replace('.TA', '') + (a.condition === 'above' ? ' עלתה מעל ' : ' ירדה מתחת ל') + formatPrice(a.price, a.symbol);
    ntToast('🔔 ' + _lbl);
    if (window.Notification && Notification.permission === 'granted') new Notification('NexTrade', { body: _lbl });
  } catch (e) {}
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
  // Show the chart screen immediately on mobile so the tap feels instant
  // (the loading indicator is shown while data streams in).
  mobileShowChart();

  // loadChart resolves the symbol itself (and falls back to saved/demo bars),
  // so we skip the extra resolveSymbolForData round-trip that used to run here.
  await loadChart(symbol, currentTF);
  var resolved = currentSymbol;
  localStorage.setItem('nt_lastSymbol', resolved);

  // Non-blocking: news + card details load after the chart is already visible.
  loadNews(resolved);
  if (!priceCache[resolved]) loadCard(resolved);
  renderWatchlist();
  renderPortfolio();
  renderAlerts();
}

// ============================================
//   MOBILE DRILL-DOWN NAVIGATION
//   Home screen = watchlist only. Tapping a stock opens the chart screen.
//   Controlled by body.m-chart (added only on phones).
// ============================================
function _isMobileNav() {
  try { return window.matchMedia('(max-width:768px)').matches; } catch (e) { return false; }
}
function mobileShowChart() {
  if (!_isMobileNav()) return;
  document.body.classList.add('m-chart');
  if (typeof updateMSymSwitch === 'function') updateMSymSwitch();
  // The chart had 0 size while hidden — force it to re-measure now it's visible.
  setTimeout(function() {
    try { window.dispatchEvent(new Event('resize')); } catch (e) {}
    if (chartInstance) {
      try {
        var el = document.getElementById('chart');
        if (el && el.offsetWidth > 0 && el.offsetHeight > 0) {
          chartInstance.resize(el.offsetWidth, el.offsetHeight);
          chartInstance.timeScale().fitContent();
        }
      } catch (e) {}
    }
  }, 70);
}
function mobileBackToList() {
  document.body.classList.remove('m-chart');
  // Always return to the watchlist view (not indicators/etc.)
  if (typeof sidebarOpen === 'function') { try { sidebarOpen('watchlist'); } catch (e) {} }
}
window.mobileShowChart = mobileShowChart;
window.mobileBackToList = mobileBackToList;

// ============================================
//   MOBILE SYMBOL SWITCHER (bottom bar + scrollable watchlist sheet)
//   Flip between watchlist charts without leaving the chart screen.
// ============================================
var _tfLabels = { '1H':'1H','4H':'4H','8H':'8H','1D':'D','1W':'W','1M':'M','1Q':'1Q','6M':'6M' };

function updateMSymSwitch() {
  var symEl = document.getElementById('mSymSwitchSym');
  var tfEl  = document.getElementById('mSymSwitchTf');
  var icoEl = document.getElementById('mSymSwitchIco');
  if (symEl) symEl.textContent = (currentSymbol || '—').replace('.TA', '');
  if (tfEl)  tfEl.textContent  = _tfLabels[currentTF] || currentTF;
  if (icoEl) {
    var logo = (typeof getStockLogo === 'function') ? getStockLogo(currentSymbol) : null;
    if (logo) { icoEl.style.backgroundImage = 'url(' + logo + ')'; }
    else { icoEl.style.backgroundImage = 'none'; }
  }
}

function renderMSymList() {
  var list = document.getElementById('mSymSheetList');
  if (!list) return;
  list.innerHTML = watchlist.map(function(sym) {
    var d = priceCache[sym];
    var cls = d ? (d.change >= 0 ? 'up' : 'down') : '';
    var pct = d ? (d.change >= 0 ? '+' : '') + d.changePct.toFixed(2) + '%' : '';
    var priceText = d ? formatPrice(d.price, sym) : '';
    var name = (NAMES[sym] || (d && d.name) || sym).replace(/\s*\(.*?\)\s*/g, '').trim();
    var shortSym = sym.replace('.TA', '');
    var logoUrl = (typeof getStockLogo === 'function') ? getStockLogo(sym) : null;
    var initials = shortSym.slice(0, 2).toUpperCase();
    var iconBg = (typeof smColor === 'function') ? smColor(shortSym) : '#2a3040';
    var icoStyle = logoUrl ? ('background-image:url(' + logoUrl + ');background-color:' + iconBg) : ('background-color:' + iconBg);
    var icoInner = logoUrl ? '' : initials;
    var active = (sym === currentSymbol) ? ' active' : '';
    return '<div class="m-sym-row' + active + '" onclick="selectSymbolFromSheet(\'' + sym + '\')">'
      + '<div class="m-row-ico" style="' + icoStyle + '">' + icoInner + '</div>'
      + '<div class="m-row-main"><span class="m-row-sym">' + shortSym + '</span>'
      + '<span class="m-row-name">' + name + '</span></div>'
      + '<div style="text-align:left"><div class="m-row-price">' + priceText + '</div>'
      + (pct ? '<div class="m-row-chg ' + cls + '">' + pct + '</div>' : '') + '</div>'
      + '</div>';
  }).join('');
}

function toggleMSymSheet() {
  var sheet = document.getElementById('mSymSheet');
  var caret = document.getElementById('mSymCaret');
  if (!sheet) return;
  var open = sheet.classList.toggle('open');
  if (caret) caret.textContent = open ? '▴' : '▾';
  if (open) {
    renderMSymList();
    // scroll active row into view
    var active = sheet.querySelector('.m-sym-row.active');
    if (active) setTimeout(function() { active.scrollIntoView({ block: 'center' }); }, 30);
  }
}

function closeMSymSheet(e) {
  if (e) e.stopPropagation();
  var sheet = document.getElementById('mSymSheet');
  var caret = document.getElementById('mSymCaret');
  if (sheet) sheet.classList.remove('open');
  if (caret) caret.textContent = '▾';
}

function selectSymbolFromSheet(sym) {
  closeMSymSheet();
  selectSymbol(sym);
}

// Swipe up/down on the switcher bar = previous/next watchlist symbol
function mobileStepSymbol(dir) {
  if (!watchlist.length) return;
  var idx = watchlist.indexOf(currentSymbol);
  if (idx === -1) idx = 0;
  var next = (idx + dir + watchlist.length) % watchlist.length;
  selectSymbol(watchlist[next]);
}

function initMSymSwitchGestures() {
  var bar = document.getElementById('mSymSwitch');
  if (!bar) return;
  var startY = 0, startX = 0, tracking = false;
  bar.addEventListener('touchstart', function(e) {
    if (!e.touches || !e.touches.length) return;
    startY = e.touches[0].clientY; startX = e.touches[0].clientX; tracking = true;
  }, { passive: true });
  bar.addEventListener('touchend', function(e) {
    if (!tracking) return; tracking = false;
    var t = (e.changedTouches && e.changedTouches[0]) || null;
    if (!t) return;
    var dy = t.clientY - startY, dx = t.clientX - startX;
    if (Math.abs(dy) > 34 && Math.abs(dy) > Math.abs(dx)) {
      // swipe up = next, swipe down = previous
      mobileStepSymbol(dy < 0 ? 1 : -1);
      e.preventDefault();
    }
  }, { passive: false });
}

window.updateMSymSwitch = updateMSymSwitch;
window.toggleMSymSheet = toggleMSymSheet;
window.closeMSymSheet = closeMSymSheet;
window.selectSymbolFromSheet = selectSymbolFromSheet;

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
  var all = Array.from(new Set(DEFAULT_SYMBOLS.concat(watchlist).concat(portfolio.map(function(p) { return p.symbol; })).concat(alerts.map(function(a) { return a.symbol; }))));
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
  // Keep the mobile symbol sheet prices fresh while it's open
  var _sheet = document.getElementById('mSymSheet');
  if (_sheet && _sheet.classList.contains('open') && typeof renderMSymList === 'function') renderMSymList();
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
    initChartInteractionFlag();
    initChartContextMenu();
    initAlertLineUpdater();
    initSidebarResize();
    renderMAPanel();
    console.log('[NexTrade] Chart initialized.');
    
    updateTASEBadge();
    setInterval(updateTASEBadge, 1000); // clock updates every second
    
    renderWatchlist();
    renderPortfolio();
    renderAlerts();
    initMSymSwitchGestures();

    // Pull this user's saved watchlist from the server so the list stays in
    // sync between the website and the installed app (handles remote deletions).
    await syncWatchlistFromServer();

    // Load the full TASE stock universe for the search box (cached for 7 days).
    // Use cache immediately if present so search works instantly; refresh in background.
    buildUniverseFromCache();
    loadTASEUniverse();

    console.log('[NexTrade] Loading cards for symbols:', DEFAULT_SYMBOLS);
    await Promise.all(DEFAULT_SYMBOLS.map(function(s) { return loadCard(s); }));
    console.log('[NexTrade] Cards loaded.');
    
    console.log('[NexTrade] Loading chart for:', currentSymbol, currentTF);
    if (!currentSymbol && watchlist.length) {
      currentSymbol = watchlist[0];
    }
    if (!currentSymbol) {
      currentSymbol = DEFAULT_SYMBOLS[0] || '';
    }
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
      if (_chartInteracting) return; // never touch the data while the user is dragging
      delete candleCache[currentSymbol + '_' + currentTF];
      delete candleCache['yf_' + currentSymbol + '_' + currentTF];
      loadChart(currentSymbol, currentTF, true); // true = preserve zoom
    }, 60000);
    
    console.log('[NexTrade] ✅ init() completed successfully!');
    startBackgroundScanner();
  } catch(e) {
    console.error('[NexTrade] ❌ init() failed:', e.message || e, e.stack);
  }
}

// ============================================
//   BACKGROUND SCANNER — SMA30 method (scanner-engine.js)
//   Runs silently every 5 minutes, scans TASE + US + Commodities
// ============================================

// Symbol lists loaded from scanner-symbols.js (TASE_SYMBOLS, US_SYMBOLS, COMMODITIES_SYMBOLS, ALL_SCANNER_SYMBOLS)

// Scanner state
var _scannerFiredToday = {};
var _scannerRunning = false;
var _scannerInterval = null;

// ── MA16 SCANNER LOGIC ──────────────
// A stock gets a BUY SIGNAL when:
// 1. Price is ABOVE its 16-week Moving Average (MA16) — confirms uptrend
// 2. MA16 is RISING (current MA > MA 4 weeks ago) — confirms trend strength
// 3. Price has pulled back CLOSE to MA16 (within 2% above, or touching) — entry point
//
// This is much more realistic than strict higher-highs/higher-lows.

// ── TREND STRUCTURE / REVERSAL DETECTION (swing highs & lows) ──────
// Implements classic Dow-theory trend structure:
//   מגמת עלייה  = שיאים עולים + שפלים עולים (higher highs + higher lows)
//   מגמת ירידה  = שיאים יורדים + שפלים יורדים (lower highs + lower lows)
//   דישדוש      = לא עומד בתנאי עלייה/ירידה (טווח נעילה בין תמיכה להתנגדות)
// ותבנית ה"מוטציה" להיפוך מגמה:
//   היפוך שורי (ירידה→עלייה) = שני שפלים יורדים ואז פריצה מעל השיא האחרון
//   היפוך דובי (עלייה→ירידה) = שני שיאים עולים ואז שבירה מתחת לשפל האחרון

// Finds actual swing highs/lows using a fractal method: a bar is a confirmed
// swing high/low only if `wing` bars on BOTH sides are lower/higher respectively.
// This avoids repainting — only fully-confirmed swings are returned.
function findSwingPoints(bars, wing) {
  wing = wing || 2;
  var swings = [];
  for (var i = wing; i < bars.length - wing; i++) {
    var isHigh = true, isLow = true;
    for (var j = 1; j <= wing; j++) {
      if (bars[i].high <= bars[i - j].high || bars[i].high <= bars[i + j].high) isHigh = false;
      if (bars[i].low  >= bars[i - j].low  || bars[i].low  >= bars[i + j].low)  isLow = false;
    }
    if (isHigh) swings.push({ idx: i, type: 'high', price: bars[i].high });
    if (isLow)  swings.push({ idx: i, type: 'low',  price: bars[i].low });
  }
  return swings;
}

// Classifies trend structure from the last two confirmed swing highs and lows.
function classifyTrendStructure(swings) {
  var highs = swings.filter(function(s) { return s.type === 'high'; });
  var lows  = swings.filter(function(s) { return s.type === 'low'; });
  if (highs.length < 2 || lows.length < 2) return 'דישדוש';
  var h1 = highs[highs.length - 2], h2 = highs[highs.length - 1];
  var l1 = lows[lows.length - 2],   l2 = lows[lows.length - 1];
  if (h2.price >= h1.price && l2.price >= l1.price) return 'עלייה';
  if (h2.price <= h1.price && l2.price <= l1.price) return 'ירידה';
  return 'דישדוש';
}

// Detects the trend-reversal "mutation" pattern (see comment block above).
// Returns { type: 'bullish'|'bearish', breakoutLevel } or null.
function detectTrendReversal(bars, swings) {
  var highs = swings.filter(function(s) { return s.type === 'high'; });
  var lows  = swings.filter(function(s) { return s.type === 'low'; });
  var currentPrice = bars[bars.length - 1].close;

  // Bullish reversal: two lower lows (downtrend structure) → breakout above last swing high
  if (lows.length >= 2 && highs.length >= 1) {
    var dl1 = lows[lows.length - 2], dl2 = lows[lows.length - 1];
    var lastHigh = highs[highs.length - 1];
    if (dl2.price <= dl1.price && currentPrice > lastHigh.price) {
      return { type: 'bullish', breakoutLevel: lastHigh.price };
    }
  }
  // Bearish reversal: two higher highs (uptrend structure) → breakdown below last swing low
  if (highs.length >= 2 && lows.length >= 1) {
    var uh1 = highs[highs.length - 2], uh2 = highs[highs.length - 1];
    var lastLow = lows[lows.length - 1];
    if (uh2.price >= uh1.price && currentPrice < lastLow.price) {
      return { type: 'bearish', breakoutLevel: lastLow.price };
    }
  }
  return null;
}

function calcMA(bars, period) {
  // Calculate simple moving average of closing prices
  if (bars.length < period) return null;
  var sum = 0;
  for (var i = bars.length - period; i < bars.length; i++) {
    sum += bars[i].close;
  }
  return sum / period;
}

// Compact price formatter for scanner alert messages.
function fmtNum(x) {
  if (x == null || isNaN(x)) return '-';
  var abs = Math.abs(x);
  var dp = abs >= 100 ? 2 : (abs >= 1 ? 2 : 4);
  return (Math.round(x * Math.pow(10, dp)) / Math.pow(10, dp)).toFixed(dp);
}

// Saturday/Sunday (Israel time): no TASE/US trading → auto-scanners rest.
function ntIsWeekendIL() {
  try {
    var d = new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Jerusalem', weekday: 'short' });
    return d === 'Sat' || d === 'Sun';
  } catch (e) { var g = new Date().getDay(); return g === 0 || g === 6; }
}

async function runBackgroundScanner() {
  if (_scannerRunning) return;
  _scannerRunning = true;
  var today = new Date().toDateString();
  var results = [];
  var reversalResults = [];
  var scanned = 0;
  var errors = 0;
  var symbols = (typeof ALL_SCANNER_SYMBOLS !== 'undefined') ? ALL_SCANNER_SYMBOLS : TASE_SYMBOLS;

  console.log('[Scanner] Starting background scan of', symbols.length, 'symbols (SMA30 method engine)...');

  // Process in batches of 10
  for (var batch = 0; batch < symbols.length; batch += 10) {
    var batchSyms = symbols.slice(batch, batch + 10);
    await Promise.all(batchSyms.map(async function(sym) {
      try {
        var bars = await fetchYahooChartDirect(sym, '1W');
        scanned++;
        if (!bars || bars.length < 21) { errors++; return; }

        var currentPrice = bars[bars.length - 1].close;

        // Skip penny/junk symbols (unreliable price action)
        var isIndexSym = (sym.charAt(0) === '^' || sym === 'TA35.TA');
        if (currentPrice < 1) return;

        // Filter out dead/illiquid symbols (avg weekly volume too low = unreliable data)
        var last8 = bars.slice(-8);
        var avgVol8 = last8.reduce(function(s, b) { return s + (b.volume || 0); }, 0) / last8.length;
        if (!isIndexSym && avgVol8 < 1000) return;

        // Determine currency (indices are quoted in points)
        var isTASE = sym.endsWith('.TA');
        var curr = isIndexSym ? '' : (isTASE ? '₪' : '$');

        // ===== SMA30 METHOD ENGINE (scanner-engine.js) =====
        // Runs Yosi's weekly method: SMA30 + S/R flips + 5-candle breakout/retest +
        // volume health + ATR stops + 1:2 targets + pre-entry alert timing.
        if (typeof window.NTScanner === 'undefined') return;
        var a = window.NTScanner.analyze(bars, {
          symbol: sym,
          name: NAMES[sym] || sym.replace('.TA', ''),
          curr: curr
        });
        if (a && a.direction && a.entry != null) {
          // Rules: no TASE-stock shorts; only liquid names (≥1M ₪/day TASE, ≥$2M/day US; 3-month avg).
          // Yahoo quotes TASE in agorot, so TASE turnover = volume × price / 100.
          var taseStockShort = isTASE && !isIndexSym && a.direction === 'short';
          var liqOk = true, liqAvg = null, liqVol = null, liqWeek = null;
          if (!isIndexSym) {
            var liqBars = bars.length > 14 ? bars.slice(-14, -1) : bars.slice(-13);
            var tSum = 0, vSum = 0, nB = 0;
            liqBars.forEach(function(b) { if (b.volume != null && b.close != null) { tSum += b.volume * b.close / (isTASE ? 100 : 1); vSum += b.volume; nB++; } });
            liqAvg = nB ? tSum / (nB * 5) : 0;
            liqVol = nB ? vSum / (nB * 5) : 0;
            var lwBar = bars[bars.length - 2];
            liqWeek = lwBar && lwBar.volume != null ? lwBar.volume * lwBar.close / (isTASE ? 100 : 1) / 5 : null;
            liqOk = liqAvg >= (isTASE ? 1000000 : 2000000);
          }
        if (!taseStockShort && liqOk) {
          // "armed" = price has reached the pre-entry alert buffer near the level.
          var armed = a.alertLevel != null && Math.abs(a.price - a.alertLevel) / a.alertLevel <= 0.015;
          if (a.status === 'entry' || armed) {
            var trendType = a.trend === 'up' ? 'עלייה' : (a.trend === 'down' ? 'ירידה' : 'דישדוש');
            results.push({
              sym: sym,
              name: a.name,
              price: a.price,
              curr: curr,
              direction: a.direction,        // 'long' | 'short'
              setup: a.setup,
              status: a.status,              // 'entry' | 'watch'
              trendType: trendType,
              sma30: a.sma30,
              atr: a.atr,
              level: a.level,
              levelTouches: a.levelTouches,
              entry: a.entry,
              stop: a.stop,
              target: a.target,
              rr: a.rr,
              alertLevel: a.alertLevel,
              alertSide: a.alertSide,
              reasons: a.reasons,
              avgTurnover: liqAvg, avgVolume: liqVol, lastWeekTurnover: liqWeek,
              ma16: a.sma30,
              maGain: '0',
              support5: a.stop,
              supportDistPct: a.level ? ((a.price - a.level) / a.level * 100) : 0,
              distPct: a.level ? (((a.price - a.level) / a.level) * 100).toFixed(1) : '0'
            });
          }
          }
        }

        // ===== TREND STRUCTURE REVERSAL (swing highs/lows — Dow-theory structure) =====
        // Reuses the already-fetched weekly bars — no extra network calls.
        var swingBars = bars.slice(-30);
        var swings = findSwingPoints(swingBars, 2);
        var reversal = detectTrendReversal(swingBars, swings);
        if (reversal) {
          reversalResults.push({
            sym: sym,
            name: NAMES[sym] || sym.replace('.TA', ''),
            price: currentPrice,
            curr: curr,
            direction: reversal.type, // 'bullish' | 'bearish'
            breakoutLevel: reversal.breakoutLevel
          });
        }
      } catch(e) { errors++; }
    }));
  }

  console.log('[Scanner] Done. Scanned:', scanned, '| Errors:', errors, '| Signals:', results.length);

  // Fire buy/sell signals
  if (results.length) {
    // Prioritise ready entries over watch/armed setups, then stronger levels.
    results.sort(function(a, b) {
      var sa = a.status === 'entry' ? 0 : 1, sb = b.status === 'entry' ? 0 : 1;
      if (sa !== sb) return sa - sb;
      return (b.levelTouches || 0) - (a.levelTouches || 0);
    });

    results.forEach(function(r) {
      var isShort = r.direction === 'short';
      var fireKey = (isShort ? 'sell_' : 'buy_') + r.sym + '_' + today;
      if (_scannerFiredToday[fireKey]) return;
      _scannerFiredToday[fireKey] = true;

      var now = new Date();
      var time = now.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
      var date = now.toLocaleDateString('he-IL');
      var ts = now.getTime();
      var sideIcon = isShort ? '🔴' : '🟢';
      var sideWord = isShort ? 'שורט' : 'לונג';
      var statusWord = r.status === 'entry' ? 'כניסה' : 'מתקרב';
      var setupMap = {
        pullback: 'Pullback לתמיכה',
        breakout_retest: 'פריצה + ריטסט',
        breakdown_retest: 'שבירה + ריטסט',
        range_breakout: 'פריצת Range',
        sma30_reclaim: 'החזרת SMA30',
        sma30_rejection: 'דחייה מ-SMA30'
      };
      var setupTxt = setupMap[r.setup] || r.setup || '';
      var lvls = '';
      if (r.entry != null) {
        lvls = ' | כניסה ' + r.curr + fmtNum(r.entry) + ' · סטופ ' + r.curr + fmtNum(r.stop) + ' · יעד ' + r.curr + fmtNum(r.target) + ' (1:' + r.rr + ')';
      }
      var msg = sideIcon + ' ' + sideWord + ' (' + statusWord + '): ' + r.sym.replace('.TA', '') + ' — ' + setupTxt + ' | מגמה ' + r.trendType + lvls;
      var stored = JSON.parse(localStorage.getItem('ib_alerts2') || '[]');
      stored.unshift({
        sym: r.sym,
        name: r.name,
        price: r.price,
        curr: r.curr,
        condition: isShort ? 'sell_signal' : 'buy_signal',
        direction: r.direction,
        setup: r.setup,
        status: r.status,
        trendType: r.trendType,
        sma30: r.sma30,
        atr: r.atr,
        level: r.level,
        levelTouches: r.levelTouches,
        entry: r.entry,
        stop: r.stop,
        target: r.target,
        rr: r.rr,
        alertLevel: r.alertLevel,
        alertSide: r.alertSide,
        reasons: r.reasons,
        avgTurnover: r.avgTurnover, avgVolume: r.avgVolume, lastWeekTurnover: r.lastWeekTurnover,
        // back-compat fields consumed by signals.js computeLevels / cards
        ma16: r.ma16,
        maGain: r.maGain,
        support5: r.support5,
        supportDistPct: r.supportDistPct,
        distPct: r.distPct,
        date: date,
        time: time,
        ts: ts,
        key: fireKey,
        msg: msg,
        severity: isShort ? 'red' : 'green'
      });
      if (stored.length > 200) stored = stored.slice(0, 200);
      localStorage.setItem('ib_alerts2', JSON.stringify(stored));

      showBuySignalPopup(r);
      if (typeof incrementAlertBadge === 'function') incrementAlertBadge();
    });

    // Flash bell
    var bellBtn = document.getElementById('ib-alerts');
    if (bellBtn) {
      bellBtn.style.animation = 'none';
      bellBtn.offsetHeight;
      bellBtn.style.animation = 'bellPulse 0.6s ease 3';
    }
    if (typeof ibRenderAlerts2 === 'function') ibRenderAlerts2();
  }

  // Fire trend-reversal signals (swing-structure based — separate from MA16 buy/sell)
  if (reversalResults.length) {
    reversalResults.forEach(function(r) {
      var isBearish = r.direction === 'bearish';
      var fireKey = 'rev_' + r.direction + '_' + r.sym + '_' + today;
      if (_scannerFiredToday[fireKey]) return;
      _scannerFiredToday[fireKey] = true;

      var now = new Date();
      var time = now.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
      var date = now.toLocaleDateString('he-IL');
      var ts = now.getTime();
      var msg = isBearish
        ? ('🔄🔴 היפוך מגמה: ' + r.sym.replace('.TA', '') + ' — מעלייה לירידה | שבירת שפל אחרון')
        : ('🔄🟢 היפוך מגמה: ' + r.sym.replace('.TA', '') + ' — מירידה לעלייה | פריצת שיא אחרון');
      var stored = JSON.parse(localStorage.getItem('ib_alerts2') || '[]');
      stored.unshift({
        sym: r.sym,
        name: r.name,
        price: r.price,
        curr: r.curr,
        condition: 'reversal_signal',
        direction: r.direction,
        breakoutLevel: r.breakoutLevel,
        date: date,
        time: time,
        ts: ts,
        key: fireKey,
        msg: msg,
        severity: isBearish ? 'red' : 'green'
      });
      if (stored.length > 200) stored = stored.slice(0, 200);
      localStorage.setItem('ib_alerts2', JSON.stringify(stored));

      if (typeof incrementAlertBadge === 'function') incrementAlertBadge();
    });

    // Flash bell
    var bellBtn2 = document.getElementById('ib-alerts');
    if (bellBtn2) {
      bellBtn2.style.animation = 'none';
      bellBtn2.offsetHeight;
      bellBtn2.style.animation = 'bellPulse 0.6s ease 3';
    }
    if (typeof ibRenderAlerts2 === 'function') ibRenderAlerts2();
  }

  console.log('[Scanner] Results:', results, 'Reversals:', reversalResults);
  _scannerRunning = false;
  return results;
}

function showBuySignalPopup(r) {
  // No popup toast — signals go to bell panel only
  // The bell badge increments and user clicks bell to see all signals
}

// Start scanner on init + every 5 minutes
function startBackgroundScanner() {
  setTimeout(function() { if (!ntIsWeekendIL()) runBackgroundScanner(); }, 15000);
  _scannerInterval = setInterval(function() { if (!ntIsWeekendIL()) runBackgroundScanner(); }, 5 * 60 * 1000);
}

// Manual test
async function testScanner() {
  console.log('[Scanner] === MANUAL TEST (MA16) ===');
  _scannerFiredToday = {};
  _scannerRunning = false;
  var results = await runBackgroundScanner();
  var symbols = (typeof ALL_SCANNER_SYMBOLS !== 'undefined') ? ALL_SCANNER_SYMBOLS : TASE_SYMBOLS;
  var summary = '\n=== SCANNER RESULTS (MA16) ===\n'
    + 'Total symbols scanned: ' + symbols.length + '\n'
    + 'Buy signals found: ' + (results ? results.length : 0) + '\n'
    + (results && results.length ? results.map(function(r) {
        return '  🟢 ' + r.sym + ' — ' + r.curr + r.price.toFixed(2) + ' (MA16: ' + r.curr + r.ma16.toFixed(2) + ', trend: +' + r.maGain + '%)';
      }).join('\n') : '  (no signals)');
  console.log(summary);
  alert(summary);
  return results;
}

// Diagnose individual symbols
async function diagnoseScannerData(howMany, startFrom) {
  howMany = howMany || 20;
  startFrom = startFrom || 0;
  var symbols = (typeof ALL_SCANNER_SYMBOLS !== 'undefined') ? ALL_SCANNER_SYMBOLS : TASE_SYMBOLS;
  var syms = symbols.slice(startFrom, startFrom + howMany);
  console.log('[Scanner] Diagnosing ' + syms.length + ' symbols (MA16 logic)...');
  var results = [];

  for (var s = 0; s < syms.length; s++) {
    var sym = syms[s];
    try {
      var bars = await fetchYahooChartDirect(sym, '1W');
      if (!bars || bars.length < 20) {
        results.push({ sym: sym, status: 'NO DATA (' + (bars ? bars.length : 0) + ' bars)' });
        continue;
      }
      var ma16now = calcMA(bars, 16);
      var bars4ago = bars.slice(0, -4);
      var ma16prev = calcMA(bars4ago, 16);
      var price = bars[bars.length - 1].close;
      var aboveMA = price >= ma16now ? '✅' : '❌';
      var maRising = ma16now > ma16prev ? '✅' : '❌';
      var dist = ((price - ma16now) / ma16now * 100).toFixed(1);
      var pullback = (price - ma16now) / ma16now <= 0.02 && price >= ma16now ? '✅' : '❌';
      var signal = (price >= ma16now && ma16now > ma16prev && (price - ma16now) / ma16now <= 0.02) ? '🟢' : '⚪';
      results.push({
        sym: sym, status: 'OK', bars: bars.length,
        price: price.toFixed(2), MA16: ma16now.toFixed(2),
        aboveMA: aboveMA, maRising: maRising,
        distFromMA: dist + '%', pullback: pullback, signal: signal
      });
    } catch(e) {
      results.push({ sym: sym, status: 'ERROR: ' + e.message });
    }
  }
  console.table(results);
  console.log('\n[Scanner] MA16 Legend:');
  console.log('  aboveMA: price > MA16 (uptrend)');
  console.log('  maRising: MA16 today > MA16 from 4 weeks ago');
  console.log('  distFromMA: how far above MA16 (0-2% = pullback zone)');
  console.log('  All three ✅ = 🟢 BUY SIGNAL');
  return results;
}

// Dummy test with synthetic data
function testScannerDummy() {
  console.log('[Scanner] === MA16 DUMMY TEST ===');

  function makeBars(basePrice, weeklyGain, count) {
    var bars = [];
    for (var i = 0; i < count; i++) {
      var p = basePrice * Math.pow(1 + weeklyGain, i);
      bars.push({ open: p * 0.99, close: p, high: p * 1.02, low: p * 0.98 });
    }
    return bars;
  }

  // Scenario A: steady uptrend, price pulls back to MA → SIGNAL
  var barsA = makeBars(100, 0.01, 20); // 1% weekly gain
  var ma16A = calcMA(barsA, 16);
  barsA[19].close = ma16A * 1.01; // 1% above MA
  var ma16A_now = calcMA(barsA, 16);
  var ma16A_prev = calcMA(barsA.slice(0, -4), 16);
  var passA = barsA[19].close >= ma16A_now && ma16A_now > ma16A_prev && (barsA[19].close - ma16A_now) / ma16A_now <= 0.02;

  // Scenario B: uptrend, price FAR above MA → NO signal
  var barsB = makeBars(100, 0.02, 20); // strong uptrend
  // Price stays at last close (way above MA)
  var ma16B = calcMA(barsB, 16);
  var passB = (barsB[19].close - ma16B) / ma16B <= 0.02; // will be false

  // Scenario C: downtrend → NO signal
  var barsC = makeBars(100, -0.01, 20); // declining
  var ma16C = calcMA(barsC, 16);
  var passC = barsC[19].close >= ma16C;

  var summary = '\n====== MA16 DUMMY TEST ======\n'
    + 'A) Uptrend + pullback to MA => ' + (passA ? '🟢 PASS' : '❌ FAIL') + '\n'
    + '   Price: ' + barsA[19].close.toFixed(2) + ' | MA16: ' + ma16A_now.toFixed(2) + ' | dist: ' + ((barsA[19].close - ma16A_now) / ma16A_now * 100).toFixed(1) + '%\n'
    + 'B) Uptrend + far from MA => ' + (!passB ? '🟢 PASS (no signal)' : '❌ FAIL') + '\n'
    + '   Price: ' + barsB[19].close.toFixed(2) + ' | MA16: ' + ma16B.toFixed(2) + ' | dist: ' + ((barsB[19].close - ma16B) / ma16B * 100).toFixed(1) + '%\n'
    + 'C) Downtrend => ' + (!passC ? '🟢 PASS (no signal)' : '❌ FAIL') + '\n'
    + '   Price: ' + barsC[19].close.toFixed(2) + ' | MA16: ' + ma16C.toFixed(2) + '\n';
  console.log(summary);
  alert(summary);
}

// Compatibility stubs
function runScanner() {}
function runAutoScanner() {}
function runUptrendScanner() { runBackgroundScanner(); }
function testUptrendScanner() { return testScanner(); }
var SCANNER_SYMS = (typeof ALL_SCANNER_SYMBOLS !== 'undefined') ? ALL_SCANNER_SYMBOLS : [];

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
var smCurrentTab = 'all';

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
  // Indices / Forex / Commodities (Yahoo Finance tickers)
  { sym: '^GSPC',     short: 'SPX',    name: 'S&P 500 Index', cat: 'general' },
  { sym: 'ES=F',      short: 'ES1!',   name: 'E-mini S&P 500 Futures', cat: 'general' },
  { sym: 'XAUUSD=X',  short: 'XAUUSD', name: 'Gold Spot / U.S. Dollar', cat: 'general' },
  { sym: 'XAGUSD=X',  short: 'XAGUSD', name: 'Silver / U.S. Dollar', cat: 'general' },
  { sym: 'SI=F',      short: 'SILVER', name: 'Silver Futures', cat: 'general' },
  { sym: 'EURUSD=X',  short: 'EURUSD', name: 'Euro / U.S. Dollar', cat: 'general' },
  { sym: 'CLV25.NYM', short: 'CLV2025', name: 'Crude Oil Futures (Oct 2025)', cat: 'general' },
];

function openSearchModal() {
  var modal = document.getElementById('searchModal');
  if (!modal) return;
  modal.classList.add('open');
  var inp = document.getElementById('smInput');
  if (inp) { inp.value = ''; inp.focus(); }
  var clearBtn = document.getElementById('smClearBtn');
  if (clearBtn) clearBtn.classList.remove('show');
  smSetTab(smCurrentTab);
}

function smOnInput() {
  var inp = document.getElementById('smInput');
  var clearBtn = document.getElementById('smClearBtn');
  var q = inp ? inp.value.trim() : '';
  if (clearBtn) clearBtn.classList.toggle('show', !!q);
  smRender(q);
}

function smClearInput() {
  var inp = document.getElementById('smInput');
  if (inp) { inp.value = ''; inp.focus(); }
  var clearBtn = document.getElementById('smClearBtn');
  if (clearBtn) clearBtn.classList.remove('show');
  smRender('');
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
    var typeLabel = it.typeLabel || 'מניה';
    var exchLabel = it.exch || '';
    return '<div class="sm-item">'
      + '<div class="sm-icon" style="background:' + bgCol + '" onclick="smPick(\'' + it.sym + '\')">' + initials + '</div>'
      + '<div class="sm-item-main" onclick="smPick(\'' + it.sym + '\')">'
      + '<div class="sm-sym-row"><span class="sm-sym">' + it.short + '</span></div>'
      + '<span class="sm-name">' + it.name + '</span>'
      + '</div>'
      + '<div class="sm-meta">'
      + '<div class="sm-meta-badges"><span class="sm-meta-type">' + typeLabel + '</span>' + (exchLabel ? '<span class="sm-meta-exch">' + exchLabel + '</span>' : '') + '</div>'
      + (exchLabel ? '<span class="sm-exch-dot">' + exchLabel.slice(0,1) + '</span>' : '')
      + '</div>'
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
  var taseSrc = function() {
    return (typeof TASE_UNIVERSE !== 'undefined' && TASE_UNIVERSE.length)
      ? TASE_UNIVERSE.map(function(it) { return { sym: it.sym, short: it.short, name: it.name, typeLabel: 'מניה', exch: 'TASE' }; })
      : Object.keys(NAMES).filter(function(s) { return s.endsWith('.TA'); }).map(function(s) { return { sym: s, short: s.replace('.TA',''), name: NAMES[s], typeLabel: 'מניה', exch: 'TASE' }; });
  };
  var usSrc = function() {
    return (typeof US_SYMBOLS !== 'undefined' ? US_SYMBOLS : [])
      .map(function(s) { return { sym: s, short: s, name: NAMES[s] || s, typeLabel: 'מניה', exch: 'US' }; });
  };
  var idxSrc = function() {
    var tase = SM_INDICES.map(function(it) { return { sym: it.sym, short: it.short, name: it.name, typeLabel: 'מדד', exch: 'TASE' }; });
    // Also surface the global markets (S&P/SPX, futures, gold/silver, forex, crypto)
    // under the "מדדים" tab so they aren't buried only under "הכל".
    var markets = genSrc().filter(function(it) { return it.typeLabel !== 'מניה'; });
    return markets.concat(tase);
  };
  var genSrc = function() {
    return SM_GENERAL.map(function(it) {
      var s = it.sym;
      var isCrypto = s.indexOf('-USD') !== -1;
      var isIndex  = s.charAt(0) === '^';
      var isForex  = s.indexOf('=X') !== -1;
      var isFuture = s.indexOf('=F') !== -1 || /\.(NYM|CMX|CBT|NYB)$/.test(s);
      var typeLabel = isCrypto ? 'קריפטו' : isIndex ? 'מדד' : isForex ? 'מט"ח' : isFuture ? 'סחורה' : 'מניה';
      var exch = isCrypto ? 'CRYPTO' : isIndex ? 'INDEX' : isForex ? 'FX' : isFuture ? 'FUT' : 'US';
      return { sym: it.sym, short: it.short, name: it.name, typeLabel: typeLabel, exch: exch };
    });
  };

  if (tab === 'indices') source = idxSrc();
  else if (tab === 'general') source = genSrc();
  else if (tab === 'us') source = usSrc();
  else if (tab === 'all') {
    var taseIdx = SM_INDICES.map(function(it) { return { sym: it.sym, short: it.short, name: it.name, typeLabel: 'מדד', exch: 'TASE' }; });
    source = taseSrc().concat(usSrc()).concat(taseIdx).concat(genSrc());
  }
  else source = taseSrc();

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
  saveWatchlist();
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
var portColOrder = JSON.parse(localStorage.getItem('nxt_port_cols') || 'null') || ['num','sym','dir','qty','entry','tp','sl','pnl','fee','net','actions'];

function savePortfolio() {
  localStorage.setItem('nxt_portfolio', JSON.stringify(portHoldings));
}

function openPortPage() {
  document.getElementById('portPage').classList.add('open');
  renderPortPage();
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
  var dirEl    = document.getElementById('portDirInput');
  var sharesEl = document.getElementById('portSharesInput');
  var priceEl  = document.getElementById('portPriceInput');
  var tpEl     = document.getElementById('portTPInput');
  var slEl     = document.getElementById('portSLInput');
  var feeEl    = document.getElementById('portFeeInput');
  var rawSym   = (symEl.value || '').trim().toUpperCase();
  var dir      = dirEl.value || 'long';
  var shares   = parseFloat(sharesEl.value) || 0;
  var entry    = parseFloat(priceEl.value)  || 0;
  var tp       = parseFloat(tpEl.value)     || 0;
  var sl       = parseFloat(slEl.value)     || 0;
  var fee      = parseFloat(feeEl.value)    || 0;
  if (!rawSym || shares <= 0) return;

  var sym = rawSym;
  var tradeNum = portHoldings.length > 0 ? Math.max.apply(null, portHoldings.map(function(h){return h.num||0})) + 1 : 1;
  portHoldings.push({ num: tradeNum, sym: sym, dir: dir, shares: shares, entry: entry, tp: tp, sl: sl, fee: fee });
  savePortfolio();
  symEl.value = ''; sharesEl.value = ''; priceEl.value = ''; tpEl.value = ''; slEl.value = ''; feeEl.value = '';
  renderPortPage();
  fetchQuote(sym).then(function(d) {
    if (d) { priceCache[sym] = d; renderPortPage(); }
  });
}

function portDeleteStock(idx) {
  portHoldings.splice(idx, 1);
  savePortfolio();
  renderPortPage();
}

function portEditField(idx, field) {
  var h = portHoldings[idx];
  if (!h) return;
  var labels = {shares:'כמות',entry:'מחיר כניסה',tp:'Take Profit',sl:'Stop Loss',fee:'עמלה'};
  var v = prompt('עדכן ' + (labels[field]||field) + ' עבור ' + h.sym + ':', h[field] || 0);
  if (v === null) return;
  var n = parseFloat(v);
  if (!isNaN(n) && n >= 0) { h[field] = n; savePortfolio(); renderPortPage(); }
}

function renderPortPage() {
  var tbody   = document.getElementById('portTableBody');
  var totalEl = document.getElementById('portTotalVal');
  if (!tbody || !totalEl) return;

  // Render header in correct column order
  var headTr = document.querySelector('#portTableHead tr');
  if (headTr) {
    var colLabels = {num:'#',sym:'סמל',dir:'כיוון',qty:'כמות',entry:'מחיר כניסה',tp:'TP',sl:'SL',pnl:'רווח',fee:'עמלה',net:'Net P/L',actions:'פעולות'};
    headTr.innerHTML = portColOrder.map(function(col){
      return '<th data-col="' + col + '" draggable="true">' + colLabels[col] + '</th>';
    }).join('');
    initPortColDrag();
  }

  if (!portHoldings.length) {
    tbody.innerHTML = '<tr><td colspan="' + portColOrder.length + '" style="text-align:center;color:var(--text-muted);padding:1.5rem">אין עסקאות — הוסף מניה למעלה</td></tr>';
    totalEl.textContent = '$0.00';
    return;
  }

  var grandNetPL = 0;
  tbody.innerHTML = portHoldings.map(function(h, idx) {
    var d         = priceCache[h.sym];
    var livePrice = d ? d.price : null;
    var isTASE    = h.sym.endsWith('.TA');
    var curr      = isTASE ? '₪' : '$';

    // Calculate P/L
    var pnl = 0;
    if (livePrice && h.entry) {
      if (h.dir === 'long') pnl = (livePrice - h.entry) * h.shares;
      else pnl = (h.entry - livePrice) * h.shares;
    }
    var fee = h.fee || 0;
    var netPL = pnl - fee;
    grandNetPL += netPL;

    var pnlCls = pnl >= 0 ? 'pnl-up' : 'pnl-down';
    var netCls = netPL >= 0 ? 'pnl-up' : 'pnl-down';
    var dirCls = h.dir === 'long' ? 'long' : 'short';

    var cells = {
      num: '<td>' + (h.num || idx+1) + '</td>',
      sym: '<td style="font-weight:800;cursor:pointer" onclick="(function(){closePortPage();selectSymbol(\'' + h.sym + '\');})()">' + h.sym.replace('.TA','') + '</td>',
      dir: '<td class="' + dirCls + '">' + (h.dir === 'long' ? 'Long' : 'Short') + '</td>',
      qty: '<td ondblclick="portEditField(' + idx + ',\'shares\')">' + h.shares + '</td>',
      entry: '<td ondblclick="portEditField(' + idx + ',\'entry\')">' + (h.entry ? curr + h.entry.toFixed(2) : '—') + '</td>',
      tp: '<td ondblclick="portEditField(' + idx + ',\'tp\')">' + (h.tp ? curr + h.tp.toFixed(2) : '—') + '</td>',
      sl: '<td ondblclick="portEditField(' + idx + ',\'sl\')">' + (h.sl ? curr + h.sl.toFixed(2) : '—') + '</td>',
      pnl: '<td class="' + pnlCls + '">' + (livePrice ? (pnl>=0?'+':'') + curr + Math.abs(pnl).toFixed(2) : '—') + '</td>',
      fee: '<td ondblclick="portEditField(' + idx + ',\'fee\')">' + (fee ? curr + fee.toFixed(2) : '—') + '</td>',
      net: '<td class="' + netCls + '" style="font-weight:800">' + (livePrice ? (netPL>=0?'+':'') + curr + Math.abs(netPL).toFixed(2) : '—') + '</td>',
      actions: '<td><button class="port-act del" onclick="portDeleteStock(' + idx + ')">מחק</button></td>'
    };

    return '<tr>' + portColOrder.map(function(col){ return cells[col] || '<td></td>'; }).join('') + '</tr>';
  }).join('');

  var curr2 = '$';
  totalEl.textContent = (grandNetPL >= 0 ? '+' : '-') + curr2 + Math.abs(grandNetPL).toFixed(2);
  totalEl.style.color = grandNetPL >= 0 ? 'var(--green)' : 'var(--red)';
}

// Column drag-and-drop reorder
function initPortColDrag() {
  var ths = document.querySelectorAll('#portTableHead th');
  var dragIdx = null;
  ths.forEach(function(th, i) {
    th.addEventListener('dragstart', function(e) {
      dragIdx = i;
      th.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    th.addEventListener('dragend', function() {
      th.classList.remove('dragging');
      ths.forEach(function(t){ t.classList.remove('drag-over'); });
    });
    th.addEventListener('dragover', function(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      th.classList.add('drag-over');
    });
    th.addEventListener('dragleave', function() {
      th.classList.remove('drag-over');
    });
    th.addEventListener('drop', function(e) {
      e.preventDefault();
      th.classList.remove('drag-over');
      if (dragIdx === null || dragIdx === i) return;
      var moved = portColOrder.splice(dragIdx, 1)[0];
      portColOrder.splice(i, 0, moved);
      localStorage.setItem('nxt_port_cols', JSON.stringify(portColOrder));
      renderPortPage();
    });
  });
}