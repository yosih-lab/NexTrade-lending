// ============================================================
//  NexTrade — Plan / Monetization layer (window.NTPlan)
//  Freemium model:
//    - free     : limited signals, limited favorites, no advanced tools
//    - premium  : everything, real-time, unlimited
//    - trial    : every new user gets 7 days of premium automatically
//  NOTE: client-side gating is UX only. Real enforcement of WHO receives
//  which signals must live on the server (see server/server.js billing).
// ============================================================
(function () {
  'use strict';

  var STATE_KEY = 'nt_plan_state';

  // Tunable limits for the free tier.
  var LIMITS = {
    FREE_SIGNAL_MAX: 3,   // visible signal cards for free users
    FREE_FAV_MAX:    3,    // favorites / watched symbols for free users
    TRIAL_DAYS:      7     // auto trial length on first use
  };

  // Features that require premium. Used by canUse(feature).
  var PREMIUM_FEATURES = {
    unlimitedSignals: true,
    unlimitedFavs:    true,
    alertsLog:        true,
    perf:             true,
    earnings:         true,
    realtimePush:     true
  };

  function nowMs() { return Date.now(); }

  function defaultState() {
    return { plan: 'free', premiumUntil: null, trialUsed: false, admin: false };
  }

  function loadState() {
    try {
      var s = JSON.parse(localStorage.getItem(STATE_KEY) || 'null');
      if (!s || typeof s !== 'object') return defaultState();
      return {
        plan: s.plan === 'premium' ? 'premium' : 'free',
        premiumUntil: s.premiumUntil || null,
        trialUsed: !!s.trialUsed,
        admin: !!s.admin
      };
    } catch (e) { return defaultState(); }
  }

  function saveState(s) {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (e) {}
  }

  // Is premium currently ACTIVE? (admin = always; otherwise plan premium and not expired)
  function isPremium() {
    var s = loadState();
    if (s.admin) return true;
    if (s.plan !== 'premium') return false;
    if (!s.premiumUntil) return true; // lifetime / unset expiry
    return nowMs() < new Date(s.premiumUntil).getTime();
  }

  function isTrialActive() {
    var s = loadState();
    if (s.admin || s.plan !== 'premium' || !s.premiumUntil) return false;
    return s.trialUsed && nowMs() < new Date(s.premiumUntil).getTime();
  }

  // Whole days left on the current premium window (0 if none / expired).
  function daysLeft() {
    var s = loadState();
    if (s.admin) return Infinity;
    if (s.plan !== 'premium' || !s.premiumUntil) return 0;
    var ms = new Date(s.premiumUntil).getTime() - nowMs();
    return ms <= 0 ? 0 : Math.ceil(ms / 86400000);
  }

  function planName() { return isPremium() ? 'premium' : 'free'; }

  function canUse(feature) {
    if (!PREMIUM_FEATURES[feature]) return true; // not gated
    return isPremium();
  }

  function signalLimit() { return isPremium() ? Infinity : LIMITS.FREE_SIGNAL_MAX; }
  function favLimit()    { return isPremium() ? Infinity : LIMITS.FREE_FAV_MAX; }

  // Give admins full access without consuming a trial.
  function grantAdmin() {
    var s = loadState();
    s.admin = true;
    saveState(s);
  }

  // Apply an authoritative plan coming from the server (/api/me).
  // shape: { plan:'free'|'premium', premiumUntil: ISO|null, trialUsed?:bool }
  function applyServerPlan(info) {
    if (!info) return;
    var s = loadState();
    if (info.plan === 'premium' || info.plan === 'free') s.plan = info.plan;
    if (info.premiumUntil !== undefined) s.premiumUntil = info.premiumUntil || null;
    if (typeof info.trialUsed === 'boolean') s.trialUsed = info.trialUsed;
    saveState(s);
    refreshUI();
  }

  // Start the automatic 7-day trial once, on first use.
  function maybeStartTrial() {
    var s = loadState();
    if (s.admin || s.trialUsed || s.plan === 'premium') return false;
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
  function startCheckout(cycle) {
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
      body: JSON.stringify({ cycle: cycle || 'monthly' })
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
      if (isPremium()) {
        var d = daysLeft();
        badge.textContent = isTrialActive() ? ('⭐ ניסיון · ' + d + ' ימים') : '⭐ פרימיום';
        badge.className = 'nt-plan-badge premium';
      } else {
        badge.textContent = 'חינם';
        badge.className = 'nt-plan-badge free';
      }
    }
    var upBtn = document.getElementById('ntUpgradeBtn');
    if (upBtn) upBtn.style.display = isPremium() ? 'none' : '';
    // let the feed re-render with the new gating
    try { if (window.NTSignals && window.NTSignals.render) window.NTSignals.render(); } catch (e) {}
  }

  // Called after login. role may grant admin; otherwise start trial for newcomers.
  function onLogin(opts) {
    opts = opts || {};
    if (opts.role === 'admin') grantAdmin();
    else maybeStartTrial();
    refreshUI();
  }

  window.NTPlan = {
    LIMITS: LIMITS,
    isPremium: isPremium,
    isTrialActive: isTrialActive,
    daysLeft: daysLeft,
    planName: planName,
    canUse: canUse,
    signalLimit: signalLimit,
    favLimit: favLimit,
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
