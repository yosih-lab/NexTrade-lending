const express = require('express');
const https   = require('https');
const fs      = require('fs');
const path    = require('path');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const app     = express();

// ── CONFIG ──────────────────────────────────────────────────────
const TD_KEY     = process.env.TD_KEY || 'c73725be3168443e88ac257aa9baa547';
const TD_ORIGIN  = 'https://api.twelvedata.com';
const PORT       = process.env.PORT || 3000;
const ALLOWED    = ['https://getnexttrade.com','https://www.getnexttrade.com'];
const JWT_SECRET = process.env.JWT_SECRET || 'nexttrade_jwt_secret_change_me';
const MAX_USERS  = 20;
const USERS_FILE = path.join(__dirname, 'users.json');

// ── BODY PARSER ──────────────────────────────────────────────────
app.use(express.json());

// ── CORS ─────────────────────────────────────────────────────────
app.use(function(req, res, next) {
  const origin = req.headers.origin || '';
  const dev    = origin.startsWith('http://localhost') || origin.startsWith('http://127.');
  if (ALLOWED.includes(origin) || dev) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── USER STORE (JSON file) ────────────────────────────────────────
function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
  catch(e) { return []; }
}
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// ── SEED ADMIN on startup (Render ephemeral disk fix) ────────────
// Set env vars ADMIN_USER, ADMIN_EMAIL, ADMIN_PASS on Render to guarantee admin exists after sleep
(async function seedAdmin() {
  const adminUser = process.env.ADMIN_USER;
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPass = process.env.ADMIN_PASS;
  if (!adminUser || !adminEmail || !adminPass) return;
  let users = loadUsers();
  if (users.find(u => u.username === adminUser)) return; // already exists
  const hash = await bcrypt.hash(adminPass, 10);
  users.push({ id: 1, username: adminUser, email: adminEmail, hash, role: 'admin', createdAt: new Date().toISOString() });
  saveUsers(users);
  console.log('[NexTrade] Seeded admin user:', adminUser);
})();

// ── AUTH MIDDLEWARE ───────────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'לא מחובר' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch(e) {
    res.status(401).json({ error: 'טוקן לא תקין' });
  }
}
function requireAdmin(req, res, next) {
  requireAuth(req, res, function() {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'הרשאות אדמין נדרשות' });
    next();
  });
}

// ── AUTH ROUTES ───────────────────────────────────────────────────

// Register
app.post('/api/register', async (req, res) => {
  const { username, email, password } = req.body || {};
  if (!username || !email || !password) return res.status(400).json({ error: 'נא למלא שם משתמש, אימייל וסיסמה' });
  if (password.length < 6) return res.status(400).json({ error: 'סיסמה חייבת להכיל לפחות 6 תווים' });
  const users = loadUsers();
  if (users.length >= MAX_USERS) return res.status(400).json({ error: 'מקסימום ' + MAX_USERS + ' משתמשים הושג' });
  if (users.find(u => u.username === username)) return res.status(400).json({ error: 'שם המשתמש כבר תפוס' });
  if (users.find(u => u.email === email))    return res.status(400).json({ error: 'האימייל כבר רשום' });
  const hash = await bcrypt.hash(password, 10);
  const role = users.length === 0 ? 'admin' : 'user'; // first user = admin
  const maxId = users.reduce((m, u) => Math.max(m, Number(u.id) || 0), 0);
  users.push({ id: maxId + 1, username, email, hash, role, createdAt: new Date().toISOString() });
  saveUsers(users);
  console.log('[NexTrade] User registered:', username, '| Total users:', users.length);
  res.json({ ok: true, message: role === 'admin' ? 'נרשמת כמנהל מערכת' : 'נרשמת בהצלחה' });
});

// Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'נא למלא שם משתמש וסיסמה' });
  const users = loadUsers();
  const user  = users.find(u => u.username === username || u.email === username);
  if (!user) return res.status(401).json({ error: 'משתמש לא נמצא' });
  const ok = await bcrypt.compare(password, user.hash);
  if (!ok) return res.status(401).json({ error: 'סיסמה שגויה' });
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, username: user.username, role: user.role });
});

// Me
app.get('/api/me', requireAuth, (req, res) => {
  res.json({ username: req.user.username, role: req.user.role });
});

// ── ADMIN ROUTES ──────────────────────────────────────────────────

// List all users
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = loadUsers().map(u => ({
    id: u.id, username: u.username, email: u.email,
    role: u.role, createdAt: u.createdAt
  }));
  res.json({ count: users.length, max: MAX_USERS, users });
});

// Delete user
app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  let users = loadUsers();
  const before = users.length;
  users = users.filter(u => String(u.id) !== String(req.params.id));
  if (users.length === before) return res.status(404).json({ error: 'משתמש לא נמצא' });
  saveUsers(users);
  res.json({ ok: true });
});

// Change role
app.patch('/api/admin/users/:id', requireAdmin, (req, res) => {
  const users = loadUsers();
  const user  = users.find(u => String(u.id) === String(req.params.id));
  if (!user) return res.status(404).json({ error: 'משתמש לא נמצא' });
  if (!['admin','user'].includes(req.body.role)) return res.status(400).json({ error: 'תפקיד לא תקין' });
  user.role = req.body.role;
  saveUsers(users);
  res.json({ ok: true });
});

// ── SCANNER CACHE ─────────────────────────────────────────────────
// Holds last scan result so all users share it (1 API call per scan cycle)
let scannerCache = { ts: 0, data: [] };
const SCAN_TTL   = 5 * 60 * 1000; // 5 minutes

async function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { reject(e); } });
    }).on('error', reject).setTimeout(12000, function() { this.destroy(); reject(new Error('timeout')); });
  });
}

async function runScan(symbols) {
  if (Date.now() - scannerCache.ts < SCAN_TTL && scannerCache.data.length) {
    return scannerCache.data;
  }
  // Batch request — TwelveData accepts comma-separated symbols
  const batch = symbols.slice(0, 50).join(',');
  const url   = `${TD_ORIGIN}/quote?symbol=${encodeURIComponent(batch)}&apikey=${TD_KEY}`;
  try {
    const raw = await fetchJSON(url);
    // raw is either { SYM: {…} } (multiple) or { …single… }
    const entries = Array.isArray(raw) ? raw
      : typeof raw === 'object' && raw.symbol ? [raw]
      : Object.values(raw);
    scannerCache = {
      ts:   Date.now(),
      data: entries.filter(e => e && e.symbol && e.close).map(e => ({
        sym:       e.symbol,
        name:      e.name || e.symbol,
        price:     parseFloat(e.close)     || 0,
        change:    parseFloat(e.change)    || 0,
        changePct: parseFloat(e.percent_change) || 0,
        volume:    parseInt(e.volume)      || 0,
        high:      parseFloat(e.high)      || 0,
        low:       parseFloat(e.low)       || 0,
      }))
    };
    return scannerCache.data;
  } catch(e) {
    console.error('[scan error]', e.message);
    return scannerCache.data; // return stale data on error
  }
}

// ── ROUTES ────────────────────────────────────────────────────────

// Health check
app.get('/', (req, res) => {
  const users = loadUsers();
  res.json({ status: 'ok', service: 'NexTrade API Proxy', users: users.length });
});

// Scanner endpoint — shared cache for all users
// GET /scan?symbols=TEVA.TA,ELBIT.TA,...
app.get('/scan', async (req, res) => {
  const syms = (req.query.symbols || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!syms.length) return res.status(400).json({ error: 'symbols required' });
  try {
    const data = await runScan(syms);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ts: scannerCache.ts, data });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Generic TwelveData proxy — hides API key
// GET /td/time_series?symbol=TEVA.TA&interval=1day&...
app.get('/td/*', async (req, res) => {
  const endpoint = req.params[0]; // e.g. "time_series"
  const params   = new URLSearchParams(req.query);
  params.set('apikey', TD_KEY);
  const tdURL = `${TD_ORIGIN}/${endpoint}?${params.toString()}`;
  try {
    const data = await fetchJSON(tdURL);
    res.setHeader('Cache-Control', 'no-store');
    res.json(data);
  } catch(e) {
    res.status(502).json({ error: 'upstream error', detail: e.message });
  }
});

app.listen(PORT, () => console.log(`[NexTrade] proxy running on port ${PORT}`));
