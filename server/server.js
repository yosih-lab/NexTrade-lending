const express = require('express');
const https   = require('https');
const fs      = require('fs');
const path    = require('path');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
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

// ── USER STORE ──────────────────────────────────────────────────
// Persistent storage: Supabase (Postgres) when SUPABASE_URL + SUPABASE_SERVICE_KEY are set.
// Fallback: in-memory array + file backup — ONLY for local dev. On Render's free tier this
// is wiped on every restart/redeploy, so production MUST use Supabase.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const supabase = (SUPABASE_URL && SUPABASE_KEY) ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

if (supabase) {
  console.log('[NexTrade] ✓ Supabase configured — using persistent Postgres storage');
} else {
  console.log('[NexTrade] ⚠ SUPABASE_URL/SUPABASE_SERVICE_KEY not set — falling back to in-memory storage (NOT persistent on Render!)');
}

let _usersCache = null; // only used by the in-memory fallback

function loadUsersMem() {
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

function saveUsersMem(users) {
  _usersCache = users;
  try { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); }
  catch(e) { console.error('[NexTrade] Failed to write users.json:', e.message); }
}

function rowToUser(row) {
  return { id: row.id, username: row.username, email: row.email, hash: row.hash, role: row.role, createdAt: row.created_at };
}

// Get all users (id/username/email/role/createdAt/hash)
async function getAllUsers() {
  if (supabase) {
    const { data, error } = await supabase.from('users').select('*').order('id', { ascending: true });
    if (error) { console.error('[NexTrade] Supabase getAllUsers error:', error.message); return []; }
    return data.map(rowToUser);
  }
  return loadUsersMem();
}

async function findByUsername(username) {
  if (supabase) {
    const { data, error } = await supabase.from('users').select('*').eq('username', username).maybeSingle();
    if (error) { console.error('[NexTrade] Supabase findByUsername error:', error.message); return null; }
    return data ? rowToUser(data) : null;
  }
  return loadUsersMem().find(u => u.username === username) || null;
}

async function findByEmail(email) {
  if (supabase) {
    const { data, error } = await supabase.from('users').select('*').eq('email', email).maybeSingle();
    if (error) { console.error('[NexTrade] Supabase findByEmail error:', error.message); return null; }
    return data ? rowToUser(data) : null;
  }
  return loadUsersMem().find(u => u.email === email) || null;
}

// Login lookup — accepts either username or email in one field
async function findByUsernameOrEmail(value) {
  const byUsername = await findByUsername(value);
  if (byUsername) return byUsername;
  return findByEmail(value);
}

async function createUser({ username, email, hash, role }) {
  if (supabase) {
    const { data, error } = await supabase.from('users')
      .insert({ username, email, hash, role })
      .select().single();
    if (error) throw error;
    return rowToUser(data);
  }
  const users = loadUsersMem();
  const maxId = users.reduce((m, u) => Math.max(m, Number(u.id) || 0), 0);
  const newUser = { id: maxId + 1, username, email, hash, role, createdAt: new Date().toISOString() };
  users.push(newUser);
  saveUsersMem(users);
  return newUser;
}

async function updateUserRole(id, role) {
  if (supabase) {
    const { data, error } = await supabase.from('users').update({ role }).eq('id', id).select().maybeSingle();
    if (error) throw error;
    return data ? rowToUser(data) : null;
  }
  const users = loadUsersMem();
  const user = users.find(u => String(u.id) === String(id));
  if (!user) return null;
  user.role = role;
  saveUsersMem(users);
  return user;
}

async function deleteUserById(id) {
  if (supabase) {
    const { data, error } = await supabase.from('users').delete().eq('id', id).select();
    if (error) throw error;
    return data && data.length > 0;
  }
  let users = loadUsersMem();
  const before = users.length;
  users = users.filter(u => String(u.id) !== String(id));
  saveUsersMem(users);
  return users.length < before;
}

async function countUsers() {
  if (supabase) {
    const { count, error } = await supabase.from('users').select('*', { count: 'exact', head: true });
    if (error) { console.error('[NexTrade] Supabase countUsers error:', error.message); return 0; }
    return count || 0;
  }
  return loadUsersMem().length;
}

async function deleteAllUsers() {
  if (supabase) {
    const { error } = await supabase.from('users').delete().gte('id', 0);
    if (error) throw error;
    return;
  }
  saveUsersMem([]);
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
    const existing = await findByUsername(adminUser);
    if (!existing) {
      const hash = await bcrypt.hash(adminPass, 10);
      const created = await createUser({ username: adminUser, email: adminEmail, hash, role: 'admin' });
      console.log('[NexTrade] ✓ Seeded admin user:', adminUser, '(id:', created.id, ')');
    } else {
      console.log('[NexTrade] Admin already exists:', adminUser, '(id:', existing.id, ')');
    }
  } else {
    console.log('[NexTrade] ⚠ No admin env vars — set ADMIN_USER, ADMIN_EMAIL, ADMIN_PASS');
  }
  const total = await countUsers();
  app.listen(PORT, () => console.log('[NexTrade] ✓ Server ready on port', PORT, '— users:', total));
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
  try {
    const total = await countUsers();
    console.log('[NexTrade] Current users:', total, '/', MAX_USERS);
    if (total >= MAX_USERS) return res.status(400).json({ error: 'מקסימום ' + MAX_USERS + ' משתמשים הושג' });
    if (await findByUsername(username)) return res.status(400).json({ error: 'שם המשתמש כבר תפוס' });
    if (await findByEmail(email))    return res.status(400).json({ error: 'האימייל כבר רשום' });
    const hash = await bcrypt.hash(password, 10);
    const role = total === 0 ? 'admin' : 'user'; // first user = admin
    const newUser = await createUser({ username, email, hash, role });
    console.log('[NexTrade] ✓ Registered:', username, 'id:', newUser.id, 'role:', role, '| Total:', total + 1);
    res.json({ ok: true, message: role === 'admin' ? 'נרשמת כמנהל מערכת' : 'נרשמת בהצלחה' });
  } catch(e) {
    console.error('[NexTrade] ✗ Register error:', e.message);
    res.status(500).json({ error: 'שגיאת שרת בעת ההרשמה', detail: e.message });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  console.log('[NexTrade] POST /api/login — username:', username);
  if (!username || !password) return res.status(400).json({ error: 'נא למלא שם משתמש וסיסמה' });
  try {
    const user = await findByUsernameOrEmail(username);
    if (!user) {
      console.log('[NexTrade] ✗ User not found:', username);
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
  } catch(e) {
    console.error('[NexTrade] ✗ Login error:', e.message);
    res.status(500).json({ error: 'שגיאת שרת בעת ההתחברות', detail: e.message });
  }
});

// Me
app.get('/api/me', requireAuth, (req, res) => {
  res.json({ username: req.user.username, role: req.user.role });
});

// ── ADMIN ROUTES ──────────────────────────────────────────────────

// List all users
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const users = (await getAllUsers()).map(u => ({
      id: u.id, username: u.username, email: u.email,
      role: u.role, createdAt: u.createdAt
    }));
    console.log('[NexTrade] GET /api/admin/users — returning', users.length, 'users');
    res.json({ count: users.length, max: MAX_USERS, users });
  } catch(e) {
    console.error('[NexTrade] ✗ List users error:', e.message);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// Delete user
app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const targetId = req.params.id;
  try {
    const deleted = await deleteUserById(targetId);
    if (!deleted) {
      console.log('[NexTrade] ✗ User not found for delete, id:', targetId);
      return res.status(404).json({ error: 'משתמש לא נמצא' });
    }
    console.log('[NexTrade] ✓ Deleted user id:', targetId);
    res.json({ ok: true });
  } catch(e) {
    console.error('[NexTrade] ✗ Delete user error:', e.message);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// Change role
app.patch('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const targetId = req.params.id;
  console.log('[NexTrade] PATCH /api/admin/users/' + targetId, '— role:', req.body.role);
  if (!['admin','user'].includes(req.body.role)) return res.status(400).json({ error: 'תפקיד לא תקין' });
  try {
    const user = await updateUserRole(targetId, req.body.role);
    if (!user) {
      console.log('[NexTrade] ✗ User not found for role change, id:', targetId);
      return res.status(404).json({ error: 'משתמש לא נמצא' });
    }
    console.log('[NexTrade] ✓ Changed role:', user.username, '→', req.body.role);
    res.json({ ok: true });
  } catch(e) {
    console.error('[NexTrade] ✗ Role change error:', e.message);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
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
app.get('/', async (req, res) => {
  const total = await countUsers();
  console.log('[NexTrade] Health check — users:', total);
  res.json({ status: 'ok', service: 'NexTrade API Proxy', storage: supabase ? 'supabase' : 'in-memory', users: total, uptime: Math.floor(process.uptime()) + 's' });
});

// Debug endpoint — see users without auth (no passwords/hashes)
app.get('/api/debug/users', async (req, res) => {
  const users = (await getAllUsers()).map(u => ({ id: u.id, username: u.username, role: u.role }));
  res.json({ count: users.length, users });
});

// Debug endpoint — reset all users (for development only)
app.delete('/api/debug/reset', async (req, res) => {
  await deleteAllUsers();
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
