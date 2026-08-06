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
const MAX_USERS  = 100;
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

// ── USER STORE (in-memory + file backup) ──────────────────────────
// Primary store is in-memory array — survives Render ephemeral disk wipes within a process.
// File is written as backup but never relied upon as sole source.
let _usersCache = null;

function loadUsers() {
  if (_usersCache) return _usersCache;
  try {
    _usersCache = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    console.log('[NexTrade] Loaded', _usersCache.length, 'users from file');
  } catch(e) {
    _usersCache = [];
    console.log('[NexTrade] No users.json found, starting fresh');
  }
  return _usersCache;
}

function saveUsers(users) {
  _usersCache = users;
  try { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); }
  catch(e) { console.error('[NexTrade] Failed to write users.json:', e.message); }
}

// ── SEED ADMIN + START SERVER ─────────────────────────────────────
// Must complete seeding BEFORE accepting requests
async function seedAndStart() {
  const adminUser  = process.env.ADMIN_USER;
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPass  = process.env.ADMIN_PASS;
  console.log('[NexTrade] Env check — ADMIN_USER:', adminUser ? '✓ set' : '✗ missing',
              'ADMIN_EMAIL:', adminEmail ? '✓ set' : '✗ missing',
              'ADMIN_PASS:', adminPass ? '✓ set' : '✗ missing');
  if (adminUser && adminEmail && adminPass) {
    let users = loadUsers();
    const existing = users.find(u => u.username === adminUser);
    if (!existing) {
      const hash = await bcrypt.hash(adminPass, 10);
      users.push({ id: 1, username: adminUser, email: adminEmail, hash, role: 'admin', createdAt: new Date().toISOString() });
      saveUsers(users);
      console.log('[NexTrade] ✓ Seeded admin user:', adminUser);
    } else {
      console.log('[NexTrade] Admin already exists:', adminUser, '(id:', existing.id, ')');
    }
  } else {
    console.log('[NexTrade] ⚠ No admin env vars — set ADMIN_USER, ADMIN_EMAIL, ADMIN_PASS');
  }
  app.listen(PORT, () => console.log('[NexTrade] ✓ Server ready on port', PORT, '— users:', loadUsers().length));
}

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
  console.log('[NexTrade] POST /api/register — body:', JSON.stringify({ username: req.body?.username, email: req.body?.email }));
  const { username, email, password } = req.body || {};
  if (!username || !email || !password) return res.status(400).json({ error: 'נא למלא שם משתמש, אימייל וסיסמה' });
  if (password.length < 6) return res.status(400).json({ error: 'סיסמה חייבת להכיל לפחות 6 תווים' });
  const users = loadUsers();
  console.log('[NexTrade] Current users:', users.length, '/', MAX_USERS);
  if (users.length >= MAX_USERS) return res.status(400).json({ error: 'מקסימום ' + MAX_USERS + ' משתמשים הושג' });
  if (users.find(u => u.username === username)) return res.status(400).json({ error: 'שם המשתמש כבר תפוס' });
  if (users.find(u => u.email === email))    return res.status(400).json({ error: 'האימייל כבר רשום' });
  const hash = await bcrypt.hash(password, 10);
  const role = users.length === 0 ? 'admin' : 'user'; // first user = admin
  const maxId = users.reduce((m, u) => Math.max(m, Number(u.id) || 0), 0);
  const newUser = { id: maxId + 1, username, email, hash, role, createdAt: new Date().toISOString() };
  users.push(newUser);
  saveUsers(users);
  console.log('[NexTrade] ✓ Registered:', username, 'id:', newUser.id, 'role:', role, '| Total:', users.length);
  res.json({ ok: true, message: role === 'admin' ? 'נרשמת כמנהל מערכת' : 'נרשמת בהצלחה' });
});

// Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  console.log('[NexTrade] POST /api/login — username:', username);
  if (!username || !password) return res.status(400).json({ error: 'נא למלא שם משתמש וסיסמה' });
  const users = loadUsers();
  console.log('[NexTrade] Users in DB:', users.length, '— searching for:', username);
  const user  = users.find(u => u.username === username || u.email === username);
  if (!user) {
    console.log('[NexTrade] ✗ User not found. Existing usernames:', users.map(u => u.username));
    return res.status(401).json({ error: 'משתמש לא נמצא' });
  }
  const ok = await bcrypt.compare(password, user.hash);
  if (!ok) {
    console.log('[NexTrade] ✗ Wrong password for:', username);
    return res.status(401).json({ error: 'סיסמה שגויה' });
  }
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
  console.log('[NexTrade] ✓ Login success:', user.username, 'role:', user.role);
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
  console.log('[NexTrade] GET /api/admin/users — returning', users.length, 'users');
  res.json({ count: users.length, max: MAX_USERS, users });
});

// Delete user
app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  let users = loadUsers();
  const targetId = req.params.id;
  console.log('[NexTrade] DELETE /api/admin/users/' + targetId, '— current users:', users.map(u => u.id + ':' + u.username));
  const before = users.length;
  users = users.filter(u => String(u.id) !== String(targetId));
  if (users.length === before) {
    console.log('[NexTrade] ✗ User not found for delete, id:', targetId);
    return res.status(404).json({ error: 'משתמש לא נמצא' });
  }
  saveUsers(users);
  console.log('[NexTrade] ✓ Deleted user id:', targetId, '— remaining:', users.length);
  res.json({ ok: true });
});

// Change role
app.patch('/api/admin/users/:id', requireAdmin, (req, res) => {
  const users = loadUsers();
  const targetId = req.params.id;
  console.log('[NexTrade] PATCH /api/admin/users/' + targetId, '— role:', req.body.role);
  const user  = users.find(u => String(u.id) === String(targetId));
  if (!user) {
    console.log('[NexTrade] ✗ User not found for role change, id:', targetId);
    return res.status(404).json({ error: 'משתמש לא נמצא' });
  }
  if (!['admin','user'].includes(req.body.role)) return res.status(400).json({ error: 'תפקיד לא תקין' });
  user.role = req.body.role;
  saveUsers(users);
  console.log('[NexTrade] ✓ Changed role:', user.username, '→', req.body.role);
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
  console.log('[NexTrade] Health check — users:', users.length);
  res.json({ status: 'ok', service: 'NexTrade API Proxy', users: users.length, uptime: Math.floor(process.uptime()) + 's' });
});

// Debug endpoint — see users without auth (no passwords/hashes)
app.get('/api/debug/users', (req, res) => {
  const users = loadUsers().map(u => ({ id: u.id, username: u.username, role: u.role }));
  res.json({ count: users.length, users });
});

// Debug endpoint — reset all users (for development only)
app.delete('/api/debug/reset', (req, res) => {
  saveUsers([]);
  console.log('[NexTrade] ⚠ All users deleted via debug reset');
  res.json({ ok: true, message: 'All users deleted' });
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

// ── START ──────────────────────────────────────────────────────────
seedAndStart().catch(err => {
  console.error('[NexTrade] FATAL startup error:', err);
  process.exit(1);
});
