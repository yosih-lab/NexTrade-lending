// ============================================================
//  NexTrade — Plan / Monetization layer (window.NTPlan)
//  Three tiers:
//    - free ("Basic") : 3 AI analyses/day, 3 favorites, 3 delayed signals
//    - gold            : 15 AI analyses/day, 15 favorites, 15 real-time signals
//    - premium         : everything unlimited
//    - trial           : every new user gets 7 days of premium automatically
//  NOTE: client-side gating is UX only. Real enforcement of WHO receives
//  which signals / how many analyses lives on the server (server/server.js).
//  The server's limits (sent in /api/signals, /api/login, /api/billing/status)
//  override the defaults below so both sides always agree.
// ============================================================
(function () {
  'use strict';

  var STATE_KEY = 'nt_plan_state';

  // Default per-tier limits (null = unlimited). Overridden by the server's `limits`.
  var TIER_LIMITS = {
    free:    { analysesPerDay: 3,    favMax: 3,    signalMax: 3 },
    gold:    { analysesPerDay: 15,   favMax: 15,   signalMax: 15 },
    premium: { analysesPerDay: null, favMax: null, signalMax: null }
  };
  var TIER_RANK = { free: 0, gold: 1, premium: 2 };
  var TIER_NAME = { free: 'בסיסי', gold: 'גולד', premium: 'פרימיום' };

  var LIMITS = {
    FREE_SIGNAL_MAX: 3,   // kept for backward compatibility
    FREE_FAV_MAX:    3,
    TRIAL_DAYS:      7     // auto trial length on first use
  };

  // Minimum tier required per feature. Used by canUse(feature).
  var FEATURE_TIER = {
    unlimitedSignals: 'premium',
    unlimitedFavs:    'premium',
    alertsLog:        'gold',
    perf:             'gold',
    earnings:         'premium',
    realtimePush:     'premium'
  };

  function nowMs() { return Date.now(); }

  function defaultState() {
    return { plan: 'free', premiumUntil: null, trialUsed: false, onTrial: null, admin: false, limits: null };
  }

  function loadState() {
    try {
      var s = JSON.parse(localStorage.getItem(STATE_KEY) || 'null');
      if (!s || typeof s !== 'object') return defaultState();
      return {
        plan: (s.plan === 'premium' || s.plan === 'gold') ? s.plan : 'free',
        premiumUntil: s.premiumUntil || null,
        trialUsed: !!s.trialUsed,
        onTrial: (typeof s.onTrial === 'boolean') ? s.onTrial : null,
        admin: !!s.admin,
        limits: (s.limits && typeof s.limits === 'object') ? s.limits : null
      };
    } catch (e) { return defaultState(); }
  }

  function saveState(s) {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (e) {}
  }

  // The ACTIVE tier: admin = premium; a paid tier counts only until it expires.
  function tier() {
    var s = loadState();
    if (s.admin) return 'premium';
    if (s.plan !== 'gold' && s.plan !== 'premium') return 'free';
    if (!s.premiumUntil) return s.plan; // lifetime / unset expiry
    return nowMs() < new Date(s.premiumUntil).getTime() ? s.plan : 'free';
  }
  function tierName() { return TIER_NAME[tier()]; }
  function atLeast(t) { return TIER_RANK[tier()] >= TIER_RANK[t]; }

  // Top tier (premium) active? (admin = always)
  function isPremium() { return tier() === 'premium'; }
  function isGold() { return tier() === 'gold'; }
  // Any paid tier active (gold or premium, incl. trial)
  function isPaid() { return tier() !== 'free'; }

  function isTrialActive() {
    var s = loadState();
    if (s.admin || s.plan !== 'premium' || !s.premiumUntil) return false;
    if (nowMs() >= new Date(s.premiumUntil).getTime()) return false;
    // The server tells us whether this premium window is a free trial (vs. paid).
    if (s.onTrial !== null) return s.onTrial;
    return false;
  }

  // Whole days left on the current paid window (0 if none / expired).
  function daysLeft() {
    var s = loadState();
    if (s.admin) return Infinity;
    if ((s.plan !== 'premium' && s.plan !== 'gold') || !s.premiumUntil) return 0;
    var ms = new Date(s.premiumUntil).getTime() - nowMs();
    return ms <= 0 ? 0 : Math.ceil(ms / 86400000);
  }

  // Exact milliseconds left on the current paid/trial window (0 if none / expired).
  function msLeft() {
    var s = loadState();
    if (s.admin) return Infinity;
    if ((s.plan !== 'premium' && s.plan !== 'gold') || !s.premiumUntil) return 0;
    return Math.max(0, new Date(s.premiumUntil).getTime() - nowMs());
  }

  function planName() { return tier(); }
  function canUse(feature) {
    var need = FEATURE_TIER[feature];
    if (!need) return true; // not gated
    return atLeast(need);
  }

  // Limit for the current tier. null/Infinity => unlimited. Server limits win.
  function limitFor(key) {
    var t = tier();
    var s = loadState();
    var v;
    if (s.limits && s.limits.tier === t && s.limits[key] !== undefined) v = s.limits[key];
    else v = TIER_LIMITS[t][key];
    return v == null ? Infinity : v;
  }
  function signalLimit()   { return limitFor('signalMax'); }
  function favLimit()      { return limitFor('favMax'); }
  function analysisLimit() { return limitFor('analysesPerDay'); }

  // Give admins full access without consuming a trial.
  function grantAdmin() {
    var s = loadState();
    s.admin = true;
    saveState(s);
  }

  // Apply an authoritative plan coming from the server.
  // shape: { plan:'free'|'gold'|'premium', tier?, limits?, premiumUntil: ISO|null, trialUsed?:bool }
  function applyServerPlan(info) {
    if (!info) return;
    var s = loadState();
    if (info.plan === 'premium' || info.plan === 'gold' || info.plan === 'free') s.plan = info.plan;
    if (info.premiumUntil !== undefined) s.premiumUntil = info.premiumUntil || null;
    if (typeof info.trialUsed === 'boolean') s.trialUsed = info.trialUsed;
    if (typeof info.onTrial === 'boolean') s.onTrial = info.onTrial;
    if (typeof info.admin === 'boolean') s.admin = info.admin;
    if (info.limits && typeof info.limits === 'object') {
      s.limits = {
        tier: info.tier || info.plan || 'free',
        analysesPerDay: info.limits.analysesPerDay,
        favMax: info.limits.favMax,
        signalMax: info.limits.signalMax
      };
    }
    saveState(s);
    refreshUI();
  }

  // Start the automatic 7-day trial once, on first use.
  function maybeStartTrial() {
    var s = loadState();
    if (s.admin || s.trialUsed || s.plan !== 'free') return false;
    var until = new Date(nowMs() + LIMITS.TRIAL_DAYS * 86400000).toISOString();
    s.plan = 'premium';
    s.premiumUntil = until;
    s.trialUsed = true;
    saveState(s);
    try {
      if (typeof window.ntToast === 'function') {
        window.ntToast('🎁 קיבלת ' + LIMITS.TRIAL_DAYS + ' ימי פרימיום חינם!');
      }
    } catch (e) {}
    return true;
  }

  // ---------- Upgrade modal ----------
  function openUpgrade(context) {
    var modal = document.getElementById('ntUpgradeModal');
    if (!modal) return;
    var sub = document.getElementById('ntUpgradeSub');
    if (sub && context) sub.textContent = context;
    modal.classList.add('open');
    document.body.classList.add('nt-modal-open');
  }
  function closeUpgrade() {
    var modal = document.getElementById('ntUpgradeModal');
    if (modal) modal.classList.remove('open');
    document.body.classList.remove('nt-modal-open');
  }

  // Kick off a hosted-checkout flow. Requires the server billing endpoint to be
  // configured with a Stripe/Paddle key. Degrades gracefully when offline/unset.
  function startCheckout(cycle, tierId) {
    var token = null;
    try { token = localStorage.getItem('nt_token'); } catch (e) {}
    var base = (typeof window.API_BASE === 'string' && window.API_BASE) ||
               (function () { try { return localStorage.getItem('nt_api_base'); } catch (e) { return ''; } })() ||
               'https://nextrade-lending.onrender.com';
    fetch(base + '/api/billing/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? ('Bearer ' + token) : ''
      },
      body: JSON.stringify({ cycle: cycle || 'monthly', tier: tierId === 'gold' ? 'gold' : 'premium' })
    }).then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.url) { window.location.href = d.url; return; }
        throw new Error(d && d.error ? d.error : 'billing-unavailable');
      })
      .catch(function () {
        try {
          if (typeof window.ntToast === 'function') {
            window.ntToast('התשלום עדיין לא מחובר. חזור בקרוב 🙏');
          } else {
            alert('מערכת התשלומים עדיין לא מחוברת.');
          }
        } catch (e) {}
      });
  }

  // Update any plan-dependent chrome (badges, upgrade buttons).
  function refreshUI() {
    var badge = document.getElementById('ntPlanBadge');
    if (badge) {
      if (isPaid()) {
        var d = daysLeft();
        badge.textContent = isTrialActive() ? ('⭐ ניסוי · ' + d + ' ימים') : (isGold() ? '🥇 גולד' : '⭐ פרימיום');
        badge.className = 'nt-plan-badge premium';
      } else {
        badge.textContent = 'בסיסי';
        badge.className = 'nt-plan-badge free';
      }
    }
    var upBtn = document.getElementById('ntUpgradeBtn');
    if (upBtn) upBtn.style.display = isPremium() ? 'none' : '';
    // let the feed re-render with the new gating
    try { if (window.NTSignals && window.NTSignals.render) window.NTSignals.render(); } catch (e) {}
  }

  // Called after login. Admin gets full access; everyone else is governed by the
  // server's plan (applied via applyServerPlan) -- no client-side fake trial.
  function onLogin(opts) {
    opts = opts || {};
    if (opts.role === 'admin') grantAdmin();
    refreshUI();
  }

  window.NTPlan = {
    LIMITS: LIMITS,
    TIER_NAME: TIER_NAME,
    tier: tier,
    tierName: tierName,
    atLeast: atLeast,
    isPremium: isPremium,
    isGold: isGold,
    isPaid: isPaid,
    isTrialActive: isTrialActive,
    daysLeft: daysLeft,
    msLeft: msLeft,
    planName: planName,
    canUse: canUse,
    signalLimit: signalLimit,
    favLimit: favLimit,
    analysisLimit: analysisLimit,
    grantAdmin: grantAdmin,
    applyServerPlan: applyServerPlan,
    maybeStartTrial: maybeStartTrial,
    openUpgrade: openUpgrade,
    closeUpgrade: closeUpgrade,
    startCheckout: startCheckout,
    refreshUI: refreshUI,
    onLogin: onLogin
  };
})();
