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

// ── BILLING (Stripe) ─────────────────────────────────────────────
// Set these env vars on Render to enable paid subscriptions:
//   STRIPE_SECRET_KEY        sk_live_... (or sk_test_...)
//   STRIPE_WEBHOOK_SECRET    whsec_...   (from the Stripe webhook endpoint)
//   STRIPE_PRICE_MONTHLY     price_...   (recurring monthly price id)
//   STRIPE_PRICE_YEARLY      price_...   (recurring yearly price id)  -> PREMIUM tier
//   STRIPE_PRICE_GOLD_MONTHLY / STRIPE_PRICE_GOLD_YEARLY               -> GOLD tier
//   BILLING_SUCCESS_URL      e.g. https://getnexttrade.com/?upgraded=1 (optional)
//   BILLING_CANCEL_URL       e.g. https://getnexttrade.com/            (optional)
const STRIPE_SECRET_KEY     = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const STRIPE_PRICE_MONTHLY  = process.env.STRIPE_PRICE_MONTHLY;
const STRIPE_PRICE_YEARLY   = process.env.STRIPE_PRICE_YEARLY;
const STRIPE_PRICE_GOLD_MONTHLY = process.env.STRIPE_PRICE_GOLD_MONTHLY;
const STRIPE_PRICE_GOLD_YEARLY  = process.env.STRIPE_PRICE_GOLD_YEARLY;
const BILLING_SUCCESS_URL   = process.env.BILLING_SUCCESS_URL || (ALLOWED[0] + '/?upgraded=1');
const BILLING_CANCEL_URL    = process.env.BILLING_CANCEL_URL  || ALLOWED[0];

let _stripe = null;
function getStripe() {
  if (_stripe) return _stripe;
  if (!STRIPE_SECRET_KEY) return null;
  try {
    const Stripe = require('stripe');
    _stripe = Stripe(STRIPE_SECRET_KEY);
    return _stripe;
  } catch (e) {
    console.error('[NexTrade] Stripe package not installed — run `npm i stripe`:', e.message);
    return null;
  }
}

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

// ── STRIPE WEBHOOK (must be BEFORE express.json — needs the raw body) ─────────
// Stripe calls this after a successful payment. We verify the signature, then
// flip the user to premium with the subscription's period end.
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const stripe = getStripe();
  if (!stripe || !STRIPE_WEBHOOK_SECRET) return res.status(503).json({ error: 'billing-not-configured' });
  let event;
  try {
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error('[NexTrade] Stripe webhook signature error:', e.message);
    return res.status(400).send('Webhook Error: ' + e.message);
  }
  try {
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object;
      const userId = s.client_reference_id || (s.metadata && s.metadata.userId);
      const boughtTier = (s.metadata && s.metadata.tier) === 'gold' ? 'gold' : 'premium';
      let premiumUntil = null;
      if (s.subscription) {
        const sub = await stripe.subscriptions.retrieve(s.subscription);
        if (sub && sub.current_period_end) premiumUntil = new Date(sub.current_period_end * 1000).toISOString();
      }
      if (userId) {
        await updateUserPlan(userId, { plan: boughtTier, premiumUntil, stripeCustomer: s.customer || undefined });
        console.log('[NexTrade] ✓', boughtTier, 'activated for user', userId, 'until', premiumUntil);
      }
    } else if (event.type === 'customer.subscription.deleted' || event.type === 'customer.subscription.updated') {
      const sub = event.data.object;
      const premiumUntil = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
      const active = sub.status === 'active' || sub.status === 'trialing';
      // find the user by stripe customer id
      let user = null;
      if (supabase) {
        const { data } = await supabase.from('users').select('*').eq('stripe_customer', sub.customer).maybeSingle();
        user = data ? rowToUser(data) : null;
      } else {
        user = loadUsersMem().find(u => u.stripeCustomer === sub.customer) || null;
      }
      if (user) {
        const keepTier = (sub.metadata && sub.metadata.tier === 'gold') ? 'gold'
          : (sub.metadata && sub.metadata.tier === 'premium') ? 'premium'
          : (user.plan === 'gold' ? 'gold' : 'premium');
        await updateUserPlan(user.id, { plan: active ? keepTier : 'free', premiumUntil: active ? premiumUntil : null });
        console.log('[NexTrade] Subscription', sub.status, 'for user', user.id);
      }
    }
    res.json({ received: true });
  } catch (e) {
    console.error('[NexTrade] Stripe webhook handler error:', e.message);
    res.status(500).json({ error: 'webhook-failed' });
  }
});

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
  return { id: row.id, username: row.username, email: row.email, hash: row.hash, role: row.role, createdAt: row.created_at, mode: row.mode || null, emailAlerts: row.email_alerts !== false, plan: row.plan || 'free', premiumUntil: row.premium_until || null, trialUsed: !!row.trial_used, stripeCustomer: row.stripe_customer || null };
}

// ── PLAN TIERS ───────────────────────────────────────────────────
// Three levels. DB value 'free' = Basic (kept for backward compatibility).
//   free (Basic) : 3 AI analyses/day, 3 favorites, 3 delayed signals
//   gold         : 15 AI analyses/day, 15 favorites, 15 real-time signals
//   premium      : everything unlimited
// Every number is overridable via env so pricing/limits can be tuned without a deploy.
function envInt(name, dflt) { const v = parseInt(process.env[name] || '', 10); return isNaN(v) ? dflt : v; }
const TIERS = {
  free:    { analysesPerDay: envInt('FREE_ANALYSES_PER_DAY', 3),  favMax: envInt('FREE_FAV_MAX', 3),  signalMax: envInt('FREE_SIGNAL_MAX', 3),  realtime: false },
  gold:    { analysesPerDay: envInt('GOLD_ANALYSES_PER_DAY', 15), favMax: envInt('GOLD_FAV_MAX', 15), signalMax: envInt('GOLD_SIGNAL_MAX', 15), realtime: true },
  premium: { analysesPerDay: Infinity, favMax: Infinity, signalMax: Infinity, realtime: true }
};
function limitsFor(tier) {
  const t = TIERS[tier] || TIERS.free;
  const j = (x) => (x === Infinity ? null : x); // null = unlimited (JSON-safe)
  return { analysesPerDay: j(t.analysesPerDay), favMax: j(t.favMax), signalMax: j(t.signalMax), realtime: t.realtime };
}

// Resolve the authoritative plan for a user: admins are always premium; otherwise
// a paid tier (gold|premium) is active only while premium_until is in the future.
function resolvePlan(user) {
  if (!user) return { plan: 'free', tier: 'free', premiumUntil: null, isPremium: false, isPaid: false };
  if (user.role === 'admin') return { plan: 'premium', tier: 'premium', premiumUntil: null, isPremium: true, isPaid: true };
  const paidTier = (user.plan === 'gold' || user.plan === 'premium') ? user.plan : null;
  const active = !!paidTier && (!user.premiumUntil || Date.now() < new Date(user.premiumUntil).getTime());
  const tier = active ? paidTier : 'free';
  return { plan: tier, tier: tier, premiumUntil: user.premiumUntil || null, isPremium: tier === 'premium', isPaid: active, trialUsed: user.trialUsed };
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

// Look up a single user by id (for plan/billing checks).
async function getUserById(id) {
  if (supabase) {
    const { data, error } = await supabase.from('users').select('*').eq('id', id).maybeSingle();
    if (error) { console.error('[NexTrade] getUserById error:', error.message); return null; }
    return data ? rowToUser(data) : null;
  }
  return loadUsersMem().find(u => String(u.id) === String(id)) || null;
}

// Update the plan/subscription fields for a user.
async function updateUserPlan(id, { plan, premiumUntil, trialUsed, stripeCustomer }) {
  const patch = {};
  if (plan === 'free' || plan === 'gold' || plan === 'premium') patch.plan = plan;
  if (premiumUntil !== undefined) patch.premium_until = premiumUntil;
  if (typeof trialUsed === 'boolean') patch.trial_used = trialUsed;
  if (stripeCustomer !== undefined) patch.stripe_customer = stripeCustomer;
  if (!Object.keys(patch).length) return null;
  if (supabase) {
    const { data, error } = await supabase.from('users').update(patch).eq('id', id).select().maybeSingle();
    if (error) throw error;
    return data ? rowToUser(data) : null;
  }
  const users = loadUsersMem();
  const user = users.find(u => String(u.id) === String(id));
  if (!user) return null;
  if (patch.plan != null) user.plan = patch.plan;
  if (patch.premium_until !== undefined) user.premiumUntil = patch.premium_until;
  if (patch.trial_used != null) user.trialUsed = patch.trial_used;
  if (patch.stripe_customer !== undefined) user.stripeCustomer = patch.stripe_customer;
  saveUsersMem(users);
  return user;
}

// Grant the one-time 7-day premium trial (used at registration).
const TRIAL_DAYS = parseInt(process.env.TRIAL_DAYS || '7', 10);
async function startTrialForUser(id) {
  const until = new Date(Date.now() + TRIAL_DAYS * 86400000).toISOString();
  try {
    return await updateUserPlan(id, { plan: 'premium', premiumUntil: until, trialUsed: true });
  } catch (e) {
    console.error('[NexTrade] startTrialForUser error:', e.message);
    return null;
  }
}

async function deleteUserById(id) {
  if (supabase) {
    // Remove rows that reference this user first, so a missing/old ON DELETE CASCADE
    // foreign key can never block the delete. Best-effort: a missing table is ignored.
    for (const t of ['watchlists', 'analysis_usage']) {
      const r = await supabase.from(t).delete().eq('user_id', id);
      if (r.error && !/does not exist|schema cache|Could not find/i.test(r.error.message || '')) {
        console.error('[NexTrade] cleanup', t, 'for user', id, ':', r.error.message);
      }
    }
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

  // Start the server-side signal scanner: load any persisted signals, then scan
  // the universe in rotating chunks on a schedule (also woken on-demand by /api/signals).
  if (NTScanner) {
    await loadSignalsFromDB();
    setTimeout(() => { scanSignalsChunk().catch(e => console.error('[Signals] first scan:', e.message)); }, 8000);
    setInterval(() => { scanSignalsChunk().catch(e => console.error('[Signals] cycle:', e.message)); }, SIG_CYCLE_MS);
    console.log('[NexTrade] ✓ Signal scanner scheduled every', Math.round(SIG_CYCLE_MS / 60000), 'min · universe', scanUniverse().length, 'symbols');
  }
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
    // Grant every new user a one-time 7-day premium trial.
    if (role !== 'admin') { await startTrialForUser(newUser.id); }
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
    const planInfo = resolvePlan(user);
    res.json({ token, username: user.username, role: user.role, plan: planInfo.plan, tier: planInfo.tier, limits: limitsFor(planInfo.tier), premiumUntil: planInfo.premiumUntil, trialUsed: !!user.trialUsed });
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

// ── BILLING ROUTES ────────────────────────────────────────────────
// Authoritative plan status for the logged-in user (client mirrors this).
app.get('/api/billing/status', requireAuth, async (req, res) => {
  try {
    const user = await getUserById(req.user.id);
    const info = resolvePlan(user);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ plan: info.plan, tier: info.tier, limits: limitsFor(info.tier), premiumUntil: info.premiumUntil, isPremium: info.isPremium, trialUsed: !!(user && user.trialUsed) });
  } catch (e) {
    console.error('[NexTrade] GET /api/billing/status error:', e.message);
    res.status(500).json({ error: 'שגיאה בבדיקת המנוי' });
  }
});

// Create a hosted Stripe Checkout session and return its URL.
app.post('/api/billing/checkout', requireAuth, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: 'מערכת התשלומים עדיין לא מחוברת' });
  const cycle = (req.body && req.body.cycle) === 'yearly' ? 'yearly' : 'monthly';
  const tier = (req.body && req.body.tier) === 'gold' ? 'gold' : 'premium';
  const price = tier === 'gold'
    ? (cycle === 'yearly' ? STRIPE_PRICE_GOLD_YEARLY : STRIPE_PRICE_GOLD_MONTHLY)
    : (cycle === 'yearly' ? STRIPE_PRICE_YEARLY : STRIPE_PRICE_MONTHLY);
  if (!price) return res.status(503).json({ error: 'מחיר לא הוגדר בשרת' });
  try {
    const user = await getUserById(req.user.id);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: price, quantity: 1 }],
      client_reference_id: String(req.user.id),
      metadata: { userId: String(req.user.id), tier: tier },
      subscription_data: { metadata: { userId: String(req.user.id), tier: tier } },
      customer_email: (user && user.email) || undefined,
      success_url: BILLING_SUCCESS_URL,
      cancel_url: BILLING_CANCEL_URL,
      allow_promotion_codes: true
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error('[NexTrade] POST /api/billing/checkout error:', e.message);
    res.status(500).json({ error: 'שגיאה ביצירת עמוד התשלום' });
  }
});

// ── SIGNALS ROUTE (plan-enforced delivery) ────────────────────────
// The authoritative signal feed. Free users get delayed + capped signals;
// premium users get everything in real time. Enforcement lives HERE, on the
// server, so editing localStorage in the browser cannot unlock more.
app.get('/api/signals', requireAuth, async (req, res) => {
  try {
    const user = await getUserById(req.user.id);
    const info = resolvePlan(user);
    // Kick a refresh if the store is stale (wakes a sleeping free-tier instance).
    if (NTScanner && Date.now() - _lastSigScan > SIG_CYCLE_MS) { scanSignalsChunk().catch(() => {}); }
    const payload = signalsForPlan(info.tier);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      plan: info.plan,
      tier: info.tier,
      limits: limitsFor(info.tier),
      isPremium: info.isPremium,
      total: payload.total,       // how many exist overall (for the upsell count)
      shown: payload.signals.length,
      delayedMs: payload.delayedMs,
      lastScan: _lastSigScan,
      scannerResting: isWeekendIL(),
      signals: payload.signals
    });
  } catch (e) {
    console.error('[NexTrade] GET /api/signals error:', e.message);
    res.status(500).json({ error: 'שגיאה בטעינת האיתותים' });
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
  if (!/^\d{1,18}$/.test(String(targetId))) return res.status(400).json({ error: 'מזהה משתמש לא תקין' });
  try {
    const deleted = await deleteUserById(targetId);
    if (!deleted) {
      console.log('[NexTrade] ✗ User not found for delete, id:', targetId);
      return res.status(404).json({ error: 'משתמש לא נמצא' });
    }
    console.log('[NexTrade] ✓ Deleted user id:', targetId);
    res.json({ ok: true });
  } catch(e) {
    console.error('[NexTrade] ✗ Delete user error:', e.message, e.details || '', e.hint || '');
    // Admin-only route: return the real DB reason so the cause is visible in the UI.
    res.status(500).json({ error: 'שגיאת שרת במחיקה: ' + (e.message || 'לא ידועה') });
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

// ── SERVER-SIDE SIGNAL SCANNER (real paywall enforcement) ─────────────────────
// Runs Yosi's SMA30 method ON THE SERVER so signal DELIVERY can be gated by plan.
// Produces the same signal objects the browser used to store in `ib_alerts2`;
// the feed now reads these via the plan-gated GET /api/signals endpoint.
let NTScanner = null, SYMS = null;
try {
  NTScanner = require(path.join(__dirname, '..', 'scanner-engine.js'));
  SYMS = require(path.join(__dirname, '..', 'scanner-symbols.js'));
  console.log('[NexTrade] ✓ Signal scanner engine loaded');
} catch (e) {
  console.error('[NexTrade] ⚠ Could not load scanner engine — server signals disabled:', e.message);
}

// Which universe to scan on the server. US list is ~5000 symbols — too heavy for a
// free tier + Yahoo limits — so default to TASE + commodities (~250). Override with
// SCAN_UNIVERSE=all to include US.
function scanUniverse() {
  if (!SYMS) return [];
  // Default: TASE + US stocks + the two indices. Rotates SIG_CHUNK symbols per cycle.
  // Set SCAN_UNIVERSE=tase to restrict to Tel Aviv only.
  if ((process.env.SCAN_UNIVERSE || 'all') === 'tase') return SYMS.TASE_SYMBOLS.concat(SYMS.COMMODITIES_SYMBOLS || []);
  return SYMS.ALL_SCANNER_SYMBOLS;
}
const INDEX_SYMS = ['^GSPC', 'TA35.TA'];
function isIndexSym(sym) { return INDEX_SYMS.indexOf(sym) !== -1; }

// ---- liquidity rules ----
// Only tradable names are scanned: average daily turnover over the last ~3 months must be
// at least 1M ₪ on TASE and $2M on US. Indices are exempt (and shown without turnover).
// TASE shorts on individual stocks are never signalled.
const MIN_TURNOVER_TASE = parseFloat(process.env.MIN_TURNOVER_TASE || '1000000');
const MIN_TURNOVER_US   = parseFloat(process.env.MIN_TURNOVER_US   || '2000000');
function minTurnoverFor(sym) { return sym.endsWith('.TA') ? MIN_TURNOVER_TASE : MIN_TURNOVER_US; }
function isTaseStock(sym) { return sym.endsWith('.TA') && !isIndexSym(sym); }
// Yahoo quotes TASE stocks in agorot (currency ILA) — divide by 100 to get ₪ turnover.
function currencyDivisor(sym, currency) { return (sym.endsWith('.TA') && currency !== 'ILS') ? 100 : 1; }
// bars: weekly (daysPerBar=5) or daily (1). Averages the last `count` COMPLETE bars
// (the newest, possibly still-forming bar is excluded when there are enough).
function turnoverStats(sym, bars, currency, daysPerBar, count) {
  if (!bars || !bars.length) return null;
  const div = currencyDivisor(sym, currency);
  const src = bars.length > count + 1 ? bars.slice(-(count + 1), -1) : bars.slice(-count);
  let t = 0, v = 0, n = 0;
  src.forEach(b => {
    if (b.volume == null || b.close == null) return;
    t += (b.volume * b.close) / div; v += b.volume; n++;
  });
  if (!n) return null;
  const days = n * daysPerBar;
  return { avgTurnover: t / days, avgVolume: v / days, bars: n };
}

const SIG_CHUNK      = parseInt(process.env.SCAN_CHUNK || '60', 10);   // symbols per cycle
const SIG_CONCURRENCY= parseInt(process.env.SCAN_CONCURRENCY || '6', 10);
const SIG_CYCLE_MS   = parseInt(process.env.SCAN_CYCLE_MS || String(5 * 60 * 1000), 10);
const SIG_MAX_AGE_MS = parseInt(process.env.SIGNAL_MAX_AGE_MS || String(7 * 24 * 3600 * 1000), 10);

let _sigStore   = [];   // authoritative signals, newest-first
let _sigByKey   = {};   // key -> signal (dedupe one per symbol/day)
const _sigDismissed = new Set();   // keys an admin deleted — scanner must not recreate them
let _scanOffset = 0;    // rotates through the universe across cycles
let _scanBusy   = false;
let _lastSigScan= 0;

function barsFromYahoo(json) {
  const r = json && json.chart && json.chart.result && json.chart.result[0];
  if (!r || !r.timestamp || !r.indicators || !r.indicators.quote || !r.indicators.quote[0]) return [];
  const ts = r.timestamp, q = r.indicators.quote[0], out = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.open[i] == null || q.close[i] == null) continue;
    const d = new Date(ts[i] * 1000);
    const time = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
    out.push({ time: time, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] || 0 });
  }
  return out;
}

const SETUP_HE = {
  pullback: 'Pullback לתמיכה', breakout_retest: 'פריצה + ריטסט',
  breakdown_retest: 'שבירה + ריטסט', range_breakout: 'פריצת Range',
  sma30_reclaim: 'החזרת SMA30', sma30_rejection: 'דחייה מ-SMA30'
};

// Build the stored signal object from an analyze() result (mirrors main.js).
function buildSignalObject(sym, a, liq) {
  const isTASE = sym.endsWith('.TA');
  const curr = isIndexSym(sym) ? '' : (isTASE ? '₪' : '$');
  const isShort = a.direction === 'short';
  const trendType = a.trend === 'up' ? 'עלייה' : (a.trend === 'down' ? 'ירידה' : 'דישדוש');
  const now = new Date();
  const key = (isShort ? 'sell_' : 'buy_') + sym + '_' + now.toDateString();
  const statusWord = a.status === 'entry' ? 'כניסה' : 'מתקרב';
  const setupTxt = SETUP_HE[a.setup] || a.setup || '';
  const fmtN = (x) => (x == null ? '' : (Math.round(x * 100) / 100));
  let lvls = '';
  if (a.entry != null) lvls = ' | כניסה ' + curr + fmtN(a.entry) + ' · סטופ ' + curr + fmtN(a.stop) + ' · יעד ' + curr + fmtN(a.target) + ' (1:' + a.rr + ')';
  const msg = (isShort ? '🔴' : '🟢') + ' ' + (isShort ? 'שורט' : 'לונג') + ' (' + statusWord + '): ' +
              sym.replace('.TA', '') + ' — ' + setupTxt + ' | מגמה ' + trendType + lvls;
  return {
    sym: sym, name: a.name || sym.replace('.TA', ''), price: a.price, curr: curr,
    condition: isShort ? 'sell_signal' : 'buy_signal', direction: a.direction,
    setup: a.setup, status: a.status, trendType: trendType,
    sma30: a.sma30, atr: a.atr, level: a.level, levelTouches: a.levelTouches,
    entry: a.entry, stop: a.stop, target: a.target, rr: a.rr,
    alertLevel: a.alertLevel, alertSide: a.alertSide, reasons: a.reasons,
    avgTurnover: liq ? liq.avgTurnover : null, avgVolume: liq ? liq.avgVolume : null,
    lastWeekTurnover: liq ? (liq.lastWeekTurnover == null ? null : liq.lastWeekTurnover) : null,
    ma16: a.sma30, maGain: '0', support5: a.stop,
    supportDistPct: a.level ? ((a.price - a.level) / a.level * 100) : 0,
    distPct: a.level ? (((a.price - a.level) / a.level) * 100).toFixed(1) : '0',
    date: now.toLocaleDateString('he-IL'), time: now.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
    ts: now.getTime(), key: key, msg: msg, severity: isShort ? 'red' : 'green'
  };
}

function pruneSignals() {
  const cutoff = Date.now() - SIG_MAX_AGE_MS;
  _sigStore = _sigStore.filter(s => s.ts >= cutoff && !_sigDismissed.has(s.key) && !/=[FX]$|-USD$/i.test(s.sym || '') &&
    !(s.direction === 'short' && isTaseStock(s.sym || '')) &&
    (isIndexSym(s.sym || '') || (s.avgTurnover != null && s.avgTurnover >= minTurnoverFor(s.sym || ''))));
  _sigByKey = {};
  _sigStore.forEach(s => { _sigByKey[s.key] = s; });
  _sigStore.sort((a, b) => b.ts - a.ts);
  if (_sigStore.length > 400) _sigStore = _sigStore.slice(0, 400);
}

// No trading on Saturday/Sunday (TASE and US both trade Mon–Fri) → the scanner rests.
// Day is evaluated in Israel time. Override with SCAN_WEEKENDS=1 (e.g. for testing).
function isWeekendIL() {
  if (process.env.SCAN_WEEKENDS === '1') return false;
  try {
    const d = new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Jerusalem', weekday: 'short' });
    return d === 'Sat' || d === 'Sun';
  } catch (e) { const g = new Date().getUTCDay(); return g === 0 || g === 6; }
}

// Scan the next chunk of the universe. Called on a schedule and on-demand.
async function scanSignalsChunk() {
  if (_scanBusy || !NTScanner) return;
  if (isWeekendIL()) return;
  _scanBusy = true;
  try {
    const universe = scanUniverse();
    if (!universe.length) return;
    const chunk = [];
    for (let i = 0; i < SIG_CHUNK; i++) chunk.push(universe[(_scanOffset + i) % universe.length]);
    // the two indices are checked on every cycle
    INDEX_SYMS.forEach(s => { if (chunk.indexOf(s) === -1) chunk.push(s); });
    _scanOffset = (_scanOffset + SIG_CHUNK) % universe.length;

    let added = 0;
    for (let i = 0; i < chunk.length; i += SIG_CONCURRENCY) {
      const group = chunk.slice(i, i + SIG_CONCURRENCY);
      await Promise.all(group.map(async (sym) => {
        try {
          const json = await fetchYahoo(sym, '1wk', '5y');
          const bars = barsFromYahoo(json);
          if (!bars || bars.length < 21) return;
          const price = bars[bars.length - 1].close;
          if (price < 1) return;
          const last8 = bars.slice(-8);
          const avgVol8 = last8.reduce((s, b) => s + (b.volume || 0), 0) / last8.length;
          if (avgVol8 < 1000 && !isIndexSym(sym)) return;
          // liquidity gate (3 months ≈ 13 weekly bars)
          let liq = null;
          if (!isIndexSym(sym)) {
            const cur = json.chart.result[0].meta && json.chart.result[0].meta.currency;
            liq = turnoverStats(sym, bars, cur, 5, 13);
            if (!liq || liq.avgTurnover < minTurnoverFor(sym)) return;
            const lw = turnoverStats(sym, bars.slice(0, -1), cur, 5, 1);
            liq.lastWeekTurnover = lw ? lw.avgTurnover : null;
          }
          const a = NTScanner.analyze(bars, { symbol: sym, name: sym.replace('.TA', ''), curr: sym.endsWith('.TA') ? '₪' : '$' });
          if (!a || !a.direction || a.entry == null) return;
          if (a.direction === 'short' && isTaseStock(sym)) return;   // no TASE stock shorts
          const armed = a.alertLevel != null && Math.abs(a.price - a.alertLevel) / a.alertLevel <= 0.015;
          if (a.status !== 'entry' && !armed) return;
          const sig = buildSignalObject(sym, a, liq);
          if (_sigDismissed.has(sig.key)) return;
          if (!_sigByKey[sig.key]) added++;
          _sigByKey[sig.key] = sig;
        } catch (e) { /* skip symbol on error */ }
      }));
    }
    // rebuild store from the dedupe map
    _sigStore = Object.keys(_sigByKey).map(k => _sigByKey[k]);
    pruneSignals();
    _lastSigScan = Date.now();
    if (added) console.log('[Signals] +' + added + ' new · total', _sigStore.length, '· offset', _scanOffset);
    // best-effort persistence
    if (supabase && added) { persistSignals().catch(() => {}); }
  } finally {
    _scanBusy = false;
  }
}

// ---- optional Supabase persistence (durable across restarts) ----
async function persistSignals() {
  if (!supabase) return;
  try {
    const rows = _sigStore.slice(0, 300).map(s => ({ key: s.key, ts: s.ts, sym: s.sym, payload: s }));
    await supabase.from('signals').upsert(rows, { onConflict: 'key' });
  } catch (e) { console.error('[Signals] persist error:', e.message); }
}
async function loadSignalsFromDB() {
  if (!supabase) return;
  try {
    const cutoff = Date.now() - SIG_MAX_AGE_MS;
    const { data, error } = await supabase.from('signals').select('payload,ts').gte('ts', cutoff).order('ts', { ascending: false }).limit(400);
    if (error) { console.error('[Signals] load error:', error.message); return; }
    (data || []).forEach(r => {
      const s = r.payload;
      if (!s || !s.key) return;
      if (s.dismissed) { _sigDismissed.add(s.key); delete _sigByKey[s.key]; return; }
      if (!_sigDismissed.has(s.key)) _sigByKey[s.key] = s;
    });
    _sigStore = Object.keys(_sigByKey).map(k => _sigByKey[k]);
    pruneSignals();
    console.log('[Signals] loaded', _sigStore.length, 'from DB');
  } catch (e) { console.error('[Signals] load exception:', e.message); }
}

// Admin: delete signals from the feed. Body: { all:true } | { sym, direction } | { key }.
// Deleted keys become tombstones (persisted) so the scanner does not recreate them today.
app.post('/api/admin/signals/delete', requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    let targets;
    if (b.all === true) targets = _sigStore.slice();
    else if (typeof b.key === 'string' && b.key) targets = _sigStore.filter(s => s.key === b.key);
    else if (typeof b.sym === 'string' && b.sym) {
      const dir = b.direction === 'short' ? 'short' : (b.direction === 'long' ? 'long' : null);
      targets = _sigStore.filter(s => s.sym === b.sym && (!dir || s.direction === dir));
    } else return res.status(400).json({ error: 'חסר מזהה איתות' });
    const now = Date.now();
    const rows = [];
    targets.forEach(s => {
      _sigDismissed.add(s.key);
      rows.push({ key: s.key, ts: now, sym: s.sym, payload: { key: s.key, dismissed: true, ts: now, sym: s.sym } });
    });
    pruneSignals();
    if (supabase && rows.length) {
      const { error } = await supabase.from('signals').upsert(rows, { onConflict: 'key' });
      if (error) console.error('[Signals] tombstone persist error:', error.message);
    }
    res.json({ ok: true, deleted: targets.length, remaining: _sigStore.length });
  } catch (e) {
    console.error('[NexTrade] POST /api/admin/signals/delete error:', e.message);
    res.status(500).json({ error: 'שגיאה במחיקת האיתותים' });
  }
});

// Return signals a user is ENTITLED to, by tier:
//   premium → everything, real-time.
//   gold    → real-time, capped to GOLD_SIGNAL_MAX.
//   free    → only signals older than FREE_DELAY (default 24h) AND capped to FREE_MAX,
//             so tampering with the client cannot unlock fresh/extra signals.
const FREE_DELAY_MS = parseInt(process.env.FREE_SIGNAL_DELAY_MS || String(24 * 3600 * 1000), 10);
function signalsForPlan(tier) {
  pruneSignals();
  const total = _sigStore.length;
  if (tier === 'premium') return { signals: _sigStore, total: total, delayedMs: 0, capped: false };
  if (tier === 'gold') {
    const max = TIERS.gold.signalMax;
    return { signals: _sigStore.slice(0, max), total: total, delayedMs: 0, capped: total > max };
  }
  const cutoff = Date.now() - FREE_DELAY_MS;
  const eligible = _sigStore.filter(s => s.ts <= cutoff);
  const max = TIERS.free.signalMax;
  return { signals: eligible.slice(0, max), total: total, delayedMs: FREE_DELAY_MS, capped: eligible.length > max || total > eligible.length };
}

// ── ROUTES ────────────────────────────────────────────────────────

// ── AI STOCK ANALYSIS (on-demand, quota-gated by tier) ────────────────────────
// POST /api/analyze { symbol } → full technical profile of one symbol using the SAME
// SMA30 / S-R / 5-candle engine as the scanner (NTScanner.describe). Daily quota is
// enforced HERE (Basic 3/day, Gold 15/day, Premium unlimited). Re-analysing a symbol
// already analysed today is free. Failed lookups never consume quota.
const NAME_ALIASES = {
  'אפל': 'AAPL', 'apple': 'AAPL', 'גוגל': 'GOOGL', 'google': 'GOOGL', 'אלפבית': 'GOOGL',
  'מיקרוסופט': 'MSFT', 'microsoft': 'MSFT', 'אמזון': 'AMZN', 'amazon': 'AMZN',
  'טסלה': 'TSLA', 'tesla': 'TSLA', 'אנבידיה': 'NVDA', 'nvidia': 'NVDA',
  'מטא': 'META', 'פייסבוק': 'META', 'נטפליקס': 'NFLX', 'netflix': 'NFLX',
  'אינטל': 'INTC', 'intel': 'INTC', 'אמד': 'AMD',
  'טבע': 'TEVA.TA', 'נייס': 'NICE.TA', 'אלביט': 'ESLT.TA', 'לאומי': 'LUMI.TA', 'פועלים': 'POLI.TA',
  'דיסקונט': 'DSCT.TA', 'בזק': 'BEZQ.TA', 'כיל': 'ICL.TA',
  'זהב': 'GC=F', 'gold': 'GC=F', 'כסף': 'SI=F', 'silver': 'SI=F', 'נפט': 'CL=F', 'oil': 'CL=F',
  'ביטקוין': 'BTC-USD', 'bitcoin': 'BTC-USD'
};

let _symIndex = null;
function symIndex() {
  if (_symIndex) return _symIndex;
  _symIndex = new Map();
  const all = (SYMS && SYMS.ALL_SCANNER_SYMBOLS) || [];
  for (const s of all) {
    const u = String(s).toUpperCase();
    if (!_symIndex.has(u)) _symIndex.set(u, s);
    const bare = u.replace(/\.TA$/, '');
    if (!_symIndex.has(bare)) _symIndex.set(bare, s);   // TASE listed first → wins ties, like the client
  }
  return _symIndex;
}

// Map what the user typed (ticker or a well-known name) to a Yahoo symbol.
function resolveAnalysisSymbol(q) {
  q = String(q == null ? '' : q).trim();
  if (!q || q.length > 40) return null;
  const alias = NAME_ALIASES[q.toLowerCase()];
  if (alias) return alias;
  const u = q.toUpperCase();
  const hit = symIndex().get(u);
  if (hit) return hit;
  // Any other plausible ticker — Yahoo decides if it exists. Strictly charset-limited
  // (it is URL-encoded into a fixed Yahoo host path, never used as a host or file path).
  if (/^[A-Z0-9.\-^=]{1,15}$/.test(u)) return u;
  return null;
}

// ---- per-user, per-day usage (symbols analysed today) ----
const _usageMem = new Map();      // 'userId|day' -> string[]
let _usageTableOk = true;         // flips off if the Supabase table is missing
function usageDay() {
  try { return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }); }
  catch (e) { return new Date().toISOString().slice(0, 10); }
}
async function getUsage(userId, day) {
  if (supabase && _usageTableOk) {
    const { data, error } = await supabase.from('analysis_usage').select('syms').eq('user_id', userId).eq('day', day).maybeSingle();
    if (!error) return Array.isArray(data && data.syms) ? data.syms : [];
    console.error('[Analyze] usage read error:', error.message, '— using in-memory quota (run supabase-schema.sql to persist)');
    _usageTableOk = false;
  }
  return (_usageMem.get(userId + '|' + day) || []).slice();
}
async function setUsage(userId, day, syms) {
  _usageMem.set(userId + '|' + day, syms.slice());
  if (_usageMem.size > 5000) {
    for (const k of Array.from(_usageMem.keys())) { if (k.split('|')[1] !== day) _usageMem.delete(k); }
  }
  if (supabase && _usageTableOk) {
    const { error } = await supabase.from('analysis_usage')
      .upsert({ user_id: userId, day: day, syms: syms, updated_at: new Date().toISOString() }, { onConflict: 'user_id,day' });
    if (error) { console.error('[Analyze] usage write error:', error.message); _usageTableOk = false; }
  }
}
function quotaFor(tier, usedCount) {
  const limit = (TIERS[tier] || TIERS.free).analysesPerDay;
  const unlimited = limit === Infinity;
  return { tier: tier, used: usedCount, limit: unlimited ? null : limit, remaining: unlimited ? null : Math.max(0, limit - usedCount) };
}

// ---- tiny HTTPS helper + Yahoo crumb auth (needed for the earnings calendar) ----
const YH_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
function httpsGetRaw(host, pathStr, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const r = https.request({ host: host, path: pathStr, method: 'GET', headers: headers || {} }, resp => {
      let body = '';
      resp.on('data', d => { body += d; if (body.length > 2e6) r.destroy(new Error('too-large')); });
      resp.on('end', () => resolve({ status: resp.statusCode, headers: resp.headers, body: body }));
    });
    r.on('error', reject);
    r.setTimeout(timeoutMs || 8000, function () { r.destroy(); reject(new Error('timeout')); });
    r.end();
  });
}
let _yh = { cookie: '', crumb: '', ts: 0 };
async function yahooAuth(force) {
  if (!force && _yh.crumb && Date.now() - _yh.ts < 6 * 3600 * 1000) return _yh;
  const r1 = await httpsGetRaw('fc.yahoo.com', '/', { 'User-Agent': YH_UA }, 6000);
  const cookie = (r1.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  const r2 = await httpsGetRaw('query1.finance.yahoo.com', '/v1/test/getcrumb', { 'User-Agent': YH_UA, 'Cookie': cookie }, 6000);
  const crumb = (r2.body || '').trim();
  if (r2.status !== 200 || !crumb || crumb.length > 64 || /[<\s]/.test(crumb)) throw new Error('no-crumb');
  _yh = { cookie: cookie, crumb: crumb, ts: Date.now() };
  return _yh;
}

// Next earnings date (YYYY-MM-DD) or null. Best-effort: Yahoo may refuse; never throws.
const _earnCache = new Map();   // sym -> { ts, ttl, val }
async function fetchEarningsDate(sym) {
  if (sym.indexOf('=') !== -1 || sym.charAt(0) === '^' || sym.indexOf('-USD') !== -1) return null; // no earnings for commodities/indices/crypto
  const c = _earnCache.get(sym);
  if (c && Date.now() - c.ts < c.ttl) return c.val;
  let val = null, ok = false;
  try {
    let auth = await yahooAuth(false);
    for (let attempt = 0; attempt < 2; attempt++) {
      const p = '/v10/finance/quoteSummary/' + encodeURIComponent(sym) + '?modules=calendarEvents&crumb=' + encodeURIComponent(auth.crumb);
      const r = await httpsGetRaw('query2.finance.yahoo.com', p, { 'User-Agent': YH_UA, 'Cookie': auth.cookie, 'Accept': 'application/json' }, 7000);
      if (r.status === 401 || r.status === 403) { auth = await yahooAuth(true); continue; }
      if (r.status === 200) {
        ok = true;
        const j = JSON.parse(r.body);
        const res = j.quoteSummary && j.quoteSummary.result && j.quoteSummary.result[0];
        const arr = res && res.calendarEvents && res.calendarEvents.earnings && res.calendarEvents.earnings.earningsDate;
        if (arr && arr.length && arr[0].raw) val = new Date(arr[0].raw * 1000).toISOString().slice(0, 10);
      }
      break;
    }
  } catch (e) { /* best-effort */ }
  _earnCache.set(sym, { ts: Date.now(), ttl: ok ? 12 * 3600 * 1000 : 20 * 60 * 1000, val: val });
  return val;
}

const _analysisCache = new Map();  // sym -> { ts, data }  (shared across users; 10 min)
const ANALYSIS_TTL = 10 * 60 * 1000;
const CURR_SYMBOL = { ILS: '₪', ILA: '₪', USD: '$', EUR: '€', GBP: '£' };

// Daily trading volume + turnover (volume × price) for the last session and the 3-month average.
async function fetchLiquidity(sym, rawCurrency, currSym) {
  if (isIndexSym(sym) || /^\^|=[FX]$/.test(sym)) return { isIndex: true };
  try {
    const json = await fetchYahoo(sym, '1d', '3mo');
    const bars = barsFromYahoo(json).filter(b => b.volume != null);
    if (bars.length < 5) return null;
    const div = currencyDivisor(sym, rawCurrency);
    const last = bars[bars.length - 1];
    const hist = bars.slice(0, -1);              // complete sessions only
    let t = 0, v = 0;
    hist.forEach(b => { t += (b.volume * b.close) / div; v += b.volume; });
    const avgTurnover = t / hist.length, avgVolume = v / hist.length;
    const lastTurnover = (last.volume * last.close) / div;
    const min = minTurnoverFor(sym);
    return {
      isIndex: false, curr: currSym, lastDate: last.time,
      lastVolume: last.volume, lastTurnover: lastTurnover,
      avgVolume: avgVolume, avgTurnover: avgTurnover, days: hist.length,
      ratio: avgTurnover > 0 ? lastTurnover / avgTurnover : null,
      min: min, meetsMin: avgTurnover >= min
    };
  } catch (e) { return null; }
}

async function buildAnalysis(sym) {
  const cached = _analysisCache.get(sym);
  if (cached && Date.now() - cached.ts < ANALYSIS_TTL) return cached.data;
  const json = await fetchYahoo(sym, '1wk', '5y');
  const r = json && json.chart && json.chart.result && json.chart.result[0];
  if (!r) return null;                                   // unknown symbol
  const bars = barsFromYahoo(json);
  if (!bars || bars.length < NTScanner.config.minBars) return { insufficient: true };
  const meta = r.meta || {};
  const name = meta.longName || meta.shortName || sym.replace('.TA', '');
  const curr = sym.endsWith('.TA') ? '₪' : (CURR_SYMBOL[meta.currency] || meta.currency || '');
  const d = NTScanner.describe(bars, { symbol: sym, name: name, curr: curr });
  if (!d || !d.ok) return { insufficient: true };
  d.symbol = sym; d.name = name; d.curr = curr;
  d.lastBar = bars[bars.length - 1].time;
  d.asOf = Date.now();
  const edate = await fetchEarningsDate(sym);
  let days = null;
  if (edate) {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    days = Math.round((new Date(edate + 'T00:00:00') - t) / 86400000);
  }
  d.earnings = { date: edate, days: days, available: !!edate };
  d.liquidity = await fetchLiquidity(sym, meta.currency, curr);
  _analysisCache.set(sym, { ts: Date.now(), data: d });
  if (_analysisCache.size > 300) { _analysisCache.delete(_analysisCache.keys().next().value); }
  return d;
}

const _analyzeBusy = new Set();   // one in-flight analysis per user (prevents quota races)

// How many analyses the user has left today.
app.get('/api/analyze/quota', requireAuth, async (req, res) => {
  try {
    const user = await getUserById(req.user.id);
    const info = resolvePlan(user);
    const used = await getUsage(req.user.id, usageDay());
    res.setHeader('Cache-Control', 'no-store');
    res.json({ quota: quotaFor(info.tier, used.length), symbols: used });
  } catch (e) {
    console.error('[Analyze] quota error:', e.message);
    res.status(500).json({ error: 'שגיאה בבדיקת המכסה' });
  }
});

app.post('/api/analyze', requireAuth, async (req, res) => {
  if (!NTScanner || typeof NTScanner.describe !== 'function') {
    return res.status(503).json({ error: 'מנוע הניתוח לא זמין כרגע', code: 'engine_unavailable' });
  }
  const sym = resolveAnalysisSymbol(req.body && req.body.symbol);
  if (!sym) return res.status(400).json({ error: 'לא זוהתה מניה. הקלד סימול (לדוגמה AAPL) או שם מוכר.', code: 'bad_symbol' });
  const uid = req.user.id;
  if (_analyzeBusy.has(uid)) return res.status(429).json({ error: 'ניתוח קודם עדיין רץ — נסה שוב בעוד רגע', code: 'busy' });
  _analyzeBusy.add(uid);
  try {
    const user = await getUserById(uid);
    const info = resolvePlan(user);
    const limit = (TIERS[info.tier] || TIERS.free).analysesPerDay;
    const day = usageDay();
    const used = await getUsage(uid, day);
    const already = used.indexOf(sym) !== -1;
    if (!already && used.length >= limit) {
      return res.status(429).json({
        error: 'ניצלת את מכסת הניתוחים היומית (' + limit + ')',
        code: 'quota', quota: quotaFor(info.tier, used.length)
      });
    }
    const analysis = await buildAnalysis(sym);
    if (!analysis) return res.status(404).json({ error: 'המניה "' + sym.replace('.TA', '') + '" לא נמצאה', code: 'not_found' });
    if (analysis.insufficient) return res.status(422).json({ error: 'אין מספיק היסטוריה שבועית למניה זו לניתוח', code: 'no_data' });
    let usedAfter = used;
    if (!already) { usedAfter = used.concat(sym); await setUsage(uid, day, usedAfter); }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, analysis: analysis, quota: quotaFor(info.tier, usedAfter.length), charged: !already });
  } catch (e) {
    console.error('[Analyze] error:', e.message);
    res.status(502).json({ error: 'שגיאה בשליפת נתוני המניה — נסה שוב', code: 'upstream' });
  } finally {
    _analyzeBusy.delete(uid);
  }
});

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
