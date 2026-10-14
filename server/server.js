const express = require('express');
const https   = require('https');
const fs      = require('fs');
const path    = require('path');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const nodemailer = require('nodemailer');
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

// ── EMAIL (provider-agnostic SMTP) ───────────────────────────────
// Set these env vars on Render to enable sending:
//   SMTP_HOST, SMTP_PORT (465 or 587), SMTP_USER, SMTP_PASS
//   MAIL_FROM   e.g. "NexTrade <alerts@getnexttrade.com>"  (defaults to SMTP_USER)
// Works with Gmail (app password), SendGrid, Mailgun, Resend SMTP, etc.
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const MAIL_FROM = process.env.MAIL_FROM || (SMTP_USER ? ('NexTrade <' + SMTP_USER + '>') : 'NexTrade <no-reply@getnexttrade.com>');

let _mailer = null;
function getMailer() {
  if (_mailer) return _mailer;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  _mailer = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465, // true for 465, false for 587 (STARTTLS)
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    // Fail fast instead of hanging if the SMTP host/credentials are wrong or blocked.
    connectionTimeout: 10000, // 10s to establish the TCP connection
    greetingTimeout: 10000,   // 10s to receive the SMTP greeting
    socketTimeout: 20000      // 20s overall socket inactivity
  });
  return _mailer;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Build a responsive, RTL weekly-signals email (Vardan-style: header, signal list,
// company details, Q&A, disclaimer). `data` = { intro, signals:[{sym,name,changePct,dir,about}], qa:[{q,a}] }
function buildSignalsEmail(data) {
  data = data || {};
  const signals = Array.isArray(data.signals) ? data.signals : [];
  const qa = Array.isArray(data.qa) ? data.qa : [];
  const dateTxt = new Date().toLocaleDateString('he-IL', { day: '2-digit', month: 'long', year: 'numeric' });
  const subject = data.subject || ('NexTrade — איתותים שהתפרסמו השבוע · ' + dateTxt);

  const rows = signals.map(function (s) {
    const pct = (s.changePct == null || isNaN(s.changePct)) ? null : Number(s.changePct);
    const up = pct == null ? (s.dir !== 'short') : pct >= 0;
    const color = up ? '#16a34a' : '#dc2626';
    const pctTxt = pct == null ? '' : ((pct >= 0 ? '+' : '') + pct.toFixed(2) + '%');
    const dirTxt = (s.dir === 'short') ? 'שורט' : 'לונג';
    const sym = esc((s.sym || '').replace('.TA', ''));
    const about = s.about ? ('<div style="font-size:13px;color:#64748b;line-height:1.6;margin-top:6px">' + esc(s.about) + '</div>') : '';
    return ''
      + '<tr>'
      + '<td style="padding:16px 18px;border-bottom:1px solid #eef2f7;">'
      +   '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
      +     '<td style="vertical-align:top;">'
      +       '<div style="font-size:17px;font-weight:800;color:#0f172a;">' + sym + '</div>'
      +       '<div style="font-size:13px;color:#64748b;margin-top:2px;">' + esc(s.name || '') + '</div>'
      +     '</td>'
      +     '<td style="text-align:left;vertical-align:top;white-space:nowrap;">'
      +       '<span style="display:inline-block;background:' + (up ? '#dcfce7' : '#fee2e2') + ';color:' + color + ';font-weight:800;font-size:14px;padding:4px 10px;border-radius:8px;">' + (pctTxt || dirTxt) + '</span>'
      +       '<div style="font-size:12px;color:#94a3b8;margin-top:4px;">' + dirTxt + '</div>'
      +     '</td>'
      +   '</tr></table>'
      +   about
      + '</td>'
      + '</tr>';
  }).join('');

  const signalsBlock = signals.length
    ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #eef2f7;border-radius:14px;overflow:hidden;">' + rows + '</table>'
    : '<div style="text-align:center;color:#94a3b8;padding:24px;">אין איתותים חדשים השבוע.</div>';

  const qaBlock = qa.length ? (''
    + '<div style="font-size:16px;font-weight:800;color:#0f172a;margin:28px 0 12px;">שאלות ותשובות</div>'
    + qa.map(function (item) {
        return '<div style="background:#f8fafc;border:1px solid #eef2f7;border-radius:12px;padding:14px 16px;margin-bottom:10px;">'
          + '<div style="font-size:14px;font-weight:700;color:#0f172a;margin-bottom:6px;">❓ ' + esc(item.q) + '</div>'
          + '<div style="font-size:13px;color:#475569;line-height:1.7;">' + esc(item.a) + '</div>'
          + '</div>';
      }).join('')
  ) : '';

  const introBlock = data.intro
    ? '<div style="font-size:15px;color:#334155;line-height:1.8;margin-bottom:22px;">' + esc(data.intro).replace(/\n/g, '<br>') + '</div>'
    : '';

  const html = ''
    + '<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="color-scheme" content="light"></head>'
    + '<body style="margin:0;padding:0;background:#eef2f7;font-family:Arial,Helvetica,sans-serif;">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:24px 12px;"><tr><td align="center">'
    +   '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 8px 30px rgba(15,23,42,.08);">'
    // header
    +     '<tr><td style="background:linear-gradient(135deg,#0b1020,#1e293b);padding:30px 28px;text-align:center;">'
    +       '<div style="font-size:26px;font-weight:900;letter-spacing:.5px;"><span style="color:#f5b301;">Nex</span><span style="color:#2962ff;">Trade</span></div>'
    +       '<div style="color:#cbd5e1;font-size:14px;margin-top:8px;">איתותים שהתפרסמו השבוע</div>'
    +       '<div style="color:#64748b;font-size:12px;margin-top:4px;">' + esc(dateTxt) + '</div>'
    +     '</td></tr>'
    // body
    +     '<tr><td style="padding:28px 24px;">'
    +       introBlock
    +       '<div style="font-size:16px;font-weight:800;color:#0f172a;margin-bottom:12px;">📈 האיתותים השבוע</div>'
    +       signalsBlock
    +       qaBlock
    +       '<div style="margin-top:28px;text-align:center;">'
    +         '<a href="https://getnexttrade.com" style="display:inline-block;background:#2962ff;color:#ffffff;text-decoration:none;font-weight:800;font-size:15px;padding:13px 30px;border-radius:12px;">כניסה לפלטפורמה ➤</a>'
    +       '</div>'
    +     '</td></tr>'
    // disclaimer
    +     '<tr><td style="padding:18px 24px 26px;background:#f8fafc;border-top:1px solid #eef2f7;">'
    +       '<div style="font-size:11px;color:#94a3b8;line-height:1.7;text-align:center;">'
    +         'המידע באיתותים אינו מהווה ייעוץ או שיווק השקעות ואינו תחליף לייעוץ אישי המתחשב בנתוניו וצרכיו של כל אדם. מסחר בשוק ההון כרוך בסיכון ואין ערובה לרווחים. אין באמור המלצה לביצוע פעולה כלשהי.'
    +       '</div>'
    +       '<div style="font-size:11px;color:#cbd5e1;text-align:center;margin-top:10px;">© NexTrade · getnexttrade.com</div>'
    +     '</td></tr>'
    +   '</table>'
    + '</td></tr></table></body></html>';

  const text = 'NexTrade — איתותים שהתפרסמו השבוע (' + dateTxt + ')\n\n'
    + (data.intro ? data.intro + '\n\n' : '')
    + signals.map(function (s) {
        const pct = (s.changePct == null || isNaN(s.changePct)) ? '' : ((Number(s.changePct) >= 0 ? '+' : '') + Number(s.changePct).toFixed(2) + '%');
        return '• ' + (s.sym || '').replace('.TA', '') + ' ' + (s.name || '') + ' ' + pct + ' (' + (s.dir === 'short' ? 'שורט' : 'לונג') + ')';
      }).join('\n')
    + '\n\nhttps://getnexttrade.com';

  return { subject: subject, html: html, text: text };
}

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
  return { id: row.id, username: row.username, email: row.email, hash: row.hash, role: row.role, createdAt: row.created_at, mode: row.mode || null, emailAlerts: row.email_alerts !== false };
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

// Save a user's onboarding/preferences: usage mode ('signals'|'analysis') and email opt-in.
async function updateUserPrefs(id, { mode, emailAlerts }) {
  const patch = {};
  if (mode === 'signals' || mode === 'analysis') patch.mode = mode;
  if (typeof emailAlerts === 'boolean') patch.email_alerts = emailAlerts;
  if (!Object.keys(patch).length) return null;
  if (supabase) {
    const { data, error } = await supabase.from('users').update(patch).eq('id', id).select().maybeSingle();
    if (error) throw error;
    return data ? rowToUser(data) : null;
  }
  const users = loadUsersMem();
  const user = users.find(u => String(u.id) === String(id));
  if (!user) return null;
  if (patch.mode != null) user.mode = patch.mode;
  if (patch.email_alerts != null) user.emailAlerts = patch.email_alerts;
  saveUsersMem(users);
  return user;
}

// Users who should receive the weekly-signals email: opted-in (default true) and NOT
// explicit "analysis-only" users — i.e. everyone except those who chose chart analysis.
async function getSignalSubscribers() {
  const all = await getAllUsers();
  return all.filter(u => u.email && u.emailAlerts !== false && u.mode !== 'analysis');
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

// ── WATCHLIST STORE ───────────────────────────────────────────────
// Per-user watchlist, so the list stays in sync across the website and the
// installed PWA (and across devices). Supabase when configured, file fallback for dev.
const WL_FILE = path.join(__dirname, 'watchlists.json');
let _wlCache = null;
function loadWlMem() {
  if (_wlCache) return _wlCache;
  try { _wlCache = JSON.parse(fs.readFileSync(WL_FILE, 'utf8')); }
  catch(e) { _wlCache = {}; }
  return _wlCache;
}
function saveWlMem(map) {
  _wlCache = map;
  try { fs.writeFileSync(WL_FILE, JSON.stringify(map, null, 2)); }
  catch(e) { console.error('[NexTrade] Failed to write watchlists.json:', e.message); }
}
async function getWatchlist(userId) {
  if (supabase) {
    const { data, error } = await supabase.from('watchlists').select('symbols').eq('user_id', userId).maybeSingle();
    if (error) { console.error('[NexTrade] getWatchlist error:', error.message); return null; }
    return data ? (data.symbols || []) : [];
  }
  const map = loadWlMem();
  return map[userId] || [];
}
async function setWatchlist(userId, symbols) {
  if (supabase) {
    const { error } = await supabase.from('watchlists')
      .upsert({ user_id: userId, symbols: symbols, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) { console.error('[NexTrade] setWatchlist error:', error.message); throw error; }
    return;
  }
  const map = loadWlMem();
  map[userId] = symbols;
  saveWlMem(map);
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
  console.log('[NexTrade] Mail check — SMTP:', getMailer() ? '✓ configured' : '✗ not set (emails disabled)');
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
    res.status(500).json({ error: 'שגיאת שרת בעת ההרשמה' });
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
    res.status(500).json({ error: 'שגיאת שרת בעת ההתחברות' });
  }
});

// Me
app.get('/api/me', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ username: req.user.username, role: req.user.role });
});

// Save onboarding preferences (usage mode + email opt-in) for the logged-in user.
app.patch('/api/me/prefs', requireAuth, async (req, res) => {
  const { mode, emailAlerts } = req.body || {};
  try {
    const user = await updateUserPrefs(req.user.id, { mode: mode, emailAlerts: emailAlerts });
    if (!user) return res.status(400).json({ error: 'אין העדפות לעדכון' });
    res.json({ ok: true, mode: user.mode, emailAlerts: user.emailAlerts });
  } catch (e) {
    console.error('[NexTrade] PATCH /api/me/prefs error:', e.message);
    res.status(500).json({ error: 'שגיאה בשמירת ההעדפות' });
  }
});

// ── WATCHLIST ROUTES ──────────────────────────────────────────────
// Read the current user's watchlist (symbols array).
app.get('/api/watchlist', requireAuth, async (req, res) => {
  try {
    const symbols = await getWatchlist(req.user.id);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ symbols: Array.isArray(symbols) ? symbols : [] });
  } catch (e) {
    console.error('[NexTrade] GET /api/watchlist error:', e.message);
    res.status(500).json({ error: 'שגיאה בטעינת רשימת המעקב' });
  }
});
// Replace the current user's watchlist. Deleting on one client propagates to all.
app.put('/api/watchlist', requireAuth, async (req, res) => {
  const raw = req.body && req.body.symbols;
  if (!Array.isArray(raw)) return res.status(400).json({ error: 'symbols חייב להיות מערך' });
  // sanitize: unique strings only, reasonable caps
  const seen = {};
  const clean = [];
  for (let i = 0; i < raw.length && clean.length < 500; i++) {
    const s = raw[i];
    if (typeof s === 'string' && s.length > 0 && s.length <= 24 && !seen[s]) { seen[s] = 1; clean.push(s); }
  }
  try {
    await setWatchlist(req.user.id, clean);
    res.json({ ok: true, count: clean.length });
  } catch (e) {
    console.error('[NexTrade] PUT /api/watchlist error:', e.message);
    res.status(500).json({ error: 'שגיאה בשמירת רשימת המעקב' });
  }
});

// ── ADMIN ROUTES ──────────────────────────────────────────────────

// List all users
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const users = (await getAllUsers()).map(u => ({
      id: u.id, username: u.username, email: u.email,
      role: u.role, createdAt: u.createdAt, mode: u.mode, emailAlerts: u.emailAlerts
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

// How many users would receive the weekly-signals email + whether SMTP is configured.
app.get('/api/admin/signal-subscribers', requireAdmin, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const subs = await getSignalSubscribers();
    res.json({ count: subs.length, mailReady: !!getMailer() });
  } catch (e) {
    console.error('[NexTrade] signal-subscribers error:', e.message);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// Send the weekly-signals email to all subscribers.
// Body: { subject?, intro?, signals:[{sym,name,changePct,dir,about}], qa:[{q,a}], test? }
app.post('/api/admin/send-signals', requireAdmin, async (req, res) => {
  const mailer = getMailer();
  if (!mailer) {
    return res.status(503).json({ error: 'שירות המייל לא מוגדר. יש להגדיר SMTP_HOST / SMTP_USER / SMTP_PASS בשרת.' });
  }
  const body = req.body || {};
  const signals = Array.isArray(body.signals) ? body.signals : [];
  if (!signals.length) return res.status(400).json({ error: 'יש להוסיף לפחות איתות אחד' });

  const mail = buildSignalsEmail(body);

  try {
    // Test mode: send only to the admin's own email.
    if (body.test) {
      const admin = await findByUsername(req.user.username);
      const to = admin && admin.email;
      if (!to) return res.status(400).json({ error: 'לא נמצאה כתובת מייל למנהל' });
      // Verify the SMTP connection first so we return a clear error (auth/host) fast
      // instead of appearing to hang.
      try {
        await mailer.verify();
      } catch (ve) {
        console.error('[NexTrade] SMTP verify failed:', ve.message);
        return res.status(502).json({ error: 'החיבור לשרת המייל נכשל: ' + ve.message + ' — בדוק SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS.' });
      }
      await mailer.sendMail({ from: MAIL_FROM, to: to, subject: '[בדיקה] ' + mail.subject, html: mail.html, text: mail.text });
      return res.json({ ok: true, test: true, sent: 1, to: to });
    }

    const subs = await getSignalSubscribers();
    if (!subs.length) return res.json({ ok: true, sent: 0, message: 'אין נמענים רשומים לאיתותים' });

    let sent = 0;
    const failed = [];
    // Send sequentially to stay within SMTP rate limits.
    for (const u of subs) {
      try {
        await mailer.sendMail({ from: MAIL_FROM, to: u.email, subject: mail.subject, html: mail.html, text: mail.text });
        sent++;
      } catch (err) {
        console.error('[NexTrade] send-signals mail fail to', u.email, '-', err.message);
        failed.push(u.email);
      }
    }
    console.log('[NexTrade] ✓ Weekly signals sent:', sent, '/', subs.length);
    res.json({ ok: true, sent: sent, total: subs.length, failed: failed });
  } catch (e) {
    console.error('[NexTrade] send-signals error:', e.message);
    res.status(500).json({ error: 'שגיאה בשליחת המיילים: ' + e.message });
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
  res.setHeader('Cache-Control', 'no-store');
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

// Yahoo Finance chart proxy — server-side so it works for ALL symbols
// (indices ^GSPC, forex XAUUSD=X/XAGUSD=X/EURUSD=X, futures ES=F/CL=F) without
// browser CORS limits or flaky third-party text proxies.
// GET /yahoo/chart?symbol=XAGUSD=X&interval=1wk&range=5y
function fetchYahoo(symbol, interval, range) {
  return new Promise((resolve, reject) => {
    const host = 'query1.finance.yahoo.com';
    const path = '/v8/finance/chart/' + encodeURIComponent(symbol) +
                 '?interval=' + encodeURIComponent(interval) + '&range=' + encodeURIComponent(range);
    const opts = {
      host: host, path: path, method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
        'Accept': 'application/json'
      }
    };
    const r = https.request(opts, resp => {
      let body = '';
      resp.on('data', d => body += d);
      resp.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    r.on('error', reject);
    r.setTimeout(12000, function () { r.destroy(); reject(new Error('timeout')); });
    r.end();
  });
}

app.get('/yahoo/chart', async (req, res) => {
  const symbol   = (req.query.symbol || '').trim();
  const interval = (req.query.interval || '1d').trim();
  const range    = (req.query.range || '1y').trim();
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  try {
    const data = await fetchYahoo(symbol, interval, range);
    res.setHeader('Cache-Control', 'no-store');
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'upstream error', detail: e.message });
  }
});

// ── START ──────────────────────────────────────────────────────────
seedAndStart().catch(err => {
  console.error('[NexTrade] FATAL startup error:', err);
  process.exit(1);
});
