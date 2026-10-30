// ============================================================================
//   NexTrade SCANNER ENGINE — Yosi's weekly method (SMA30 + S/R + 5-candle)
//   Pure, testable analysis of weekly (1W) bars. No network, no DOM.
//   Exposed as window.NTScanner. main.js feeds it weekly bars per symbol.
//
//   Encodes the rules taught in /memories/repo/signal-method.md:
//     - Weekly chart, SMA30 central line, Vol MA(60), ATR(14).
//     - Trade ONLY in the direction of the main trend (up => long, down => short).
//     - Long pullback to a support confluence (SMA30 + historical support) with a
//       reversal candle and CONTRACTING volume.
//     - Breakout + >=5 weekly candles holding above/below + retest of the flipped
//       level = entry (the "5-candle rule"), both directions.
//     - Historical levels weighted by touch count (~3 = significant, 5+ = strong).
//     - Range: trade confirmed breakout of either boundary (same 5-candle rule).
//     - Below SMA30 disqualifies a long; a deep pullback needs an SMA30 RECLAIM
//       plus a fresh 2 HH + 2 HL structure before a long.
//     - Expanding volume on a decline rejects a long but CONFIRMS a short.
//     - Fib 0.5 / 0.618 are watch zones only (not an entry on their own).
//     - Alert fires a little BEFORE the entry (on the side price is coming from)
//       to give lead time — default ~1% buffer (support x 1.01).
//     - Stop = level -/+ one ATR; target = 1:2 risk:reward minimum.
// ============================================================================

(function () {
  'use strict';

  // ---- Tunable thresholds (adjust as more bell stocks are reviewed) ----------
  var CFG = {
    smaPeriod: 30,            // SMA30 (weekly) — the central line
    atrPeriod: 14,           // ATR(14) for stops
    volPeriod: 60,           // Vol MA(60)
    swingWing: 2,            // fractal half-width for swing detection
    minBars: 36,            // need enough history for SMA30 + swings
    levelTol: 0.02,         // 2% clustering tolerance for horizontal levels
    touchSignificant: 3,    // >=3 touches = significant level
    touchStrong: 5,         // >=5 touches = strong level
    nearLevel: 0.025,       // price "at" a level within 2.5%
    atStop: 0.012,          // "at entry" window (1.2%) => status entry vs watch
    ranAwayPct: 0.06,       // >6% past the entry level => don't chase (watch)
    holdCandles: 5,         // 5 weekly candles must hold past a broken level
    retestStopAtr: 0.75,    // retest setups: the flipped level is strong, so the stop sits only 0.75 ATR beyond it
    retestStopPct: 0.05,    // ...but never closer than 5% of the level for SHORT retests (room for a weekly wick)
    planZoneAtr: 1.5,       // a not-yet-broken level within 1.5 ATR of price is shown to the user as a "plan" (do NOT enter yet)
    pullbackLookback: 8,    // weeks to inspect a pullback leg
    volContractRatio: 0.9,  // recent vol <= 0.9x of pullback-start vol = contracting
    volExpandRatio: 1.15,   // recent vol >= 1.15x = expanding
    volBreakoutRatio: 1.2,  // breakout week vol >= 1.2x Vol MA = quality
    volEntryRatio: 1.0,     // pullback entry candle needs volume >= Vol MA (aggressive entry)
    slopeLookback: 4,       // weeks back to measure SMA30 slope
    trendTol: 0.015,        // swings within 1.5% count as the SAME level (a re-test of support doesn't cancel a trend)
    minDownDays: 120,       // a DOWNtrend needs >=120 days (4 months) of decline from the 52-week peak; shorter = range
    alertBuffer: 0.01,      // fire alert ~1% before the entry level
    rrTarget: 2             // minimum 1:2 risk:reward
  };

  // ---- Small numeric helpers -------------------------------------------------
  function sma(bars, period, endIdx) {
    if (endIdx == null) endIdx = bars.length - 1;
    if (endIdx + 1 < period) return null;
    var sum = 0;
    for (var i = endIdx - period + 1; i <= endIdx; i++) sum += bars[i].close;
    return sum / period;
  }

  function atr(bars, period, endIdx) {
    if (endIdx == null) endIdx = bars.length - 1;
    if (endIdx + 1 <= period) return null;
    var sum = 0;
    for (var i = endIdx - period + 1; i <= endIdx; i++) {
      var h = bars[i].high, l = bars[i].low, pc = bars[i - 1].close;
      var tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
      sum += tr;
    }
    return sum / period;
  }

  function volAvg(bars, period, endIdx) {
    if (endIdx == null) endIdx = bars.length - 1;
    var n = Math.min(period, endIdx + 1), sum = 0, cnt = 0;
    for (var i = endIdx - n + 1; i <= endIdx; i++) {
      if (bars[i].volume != null) { sum += bars[i].volume; cnt++; }
    }
    return cnt ? sum / cnt : 0;
  }

  // ---- Swing detection (fractal, non-repainting) -----------------------------
  function findSwings(bars, wing) {
    wing = wing || CFG.swingWing;
    var out = [];
    for (var i = wing; i < bars.length - wing; i++) {
      var isHigh = true, isLow = true;
      for (var j = 1; j <= wing; j++) {
        if (bars[i].high <= bars[i - j].high || bars[i].high <= bars[i + j].high) isHigh = false;
        if (bars[i].low >= bars[i - j].low || bars[i].low >= bars[i + j].low) isLow = false;
      }
      if (isHigh) out.push({ idx: i, type: 'high', price: bars[i].high });
      if (isLow) out.push({ idx: i, type: 'low', price: bars[i].low });
    }
    return out;
  }

  // Collapse consecutive swings of the same type into the most extreme one, so the
  // sequence alternates high/low (classic Dow zigzag) and minor wiggles don't count.
  function zigzag(swings) {
    var out = [];
    for (var i = 0; i < swings.length; i++) {
      var s = swings[i], last = out[out.length - 1];
      if (last && last.type === s.type) {
        if ((s.type === 'high' && s.price > last.price) || (s.type === 'low' && s.price < last.price)) out[out.length - 1] = s;
      } else out.push(s);
    }
    return out;
  }

  // Confirmed swings + the swing currently FORMING after the last confirmed one.
  // A fractal low/high needs `wing` bars on its right, so a fresh lower low (e.g. a sharp
  // drop followed by a 1-2 week bounce) is invisible to findSwings. Dow theory counts it
  // already, so the tail's most extreme bar is appended as a provisional opposite swing.
  function structureSwings(bars) {
    var sw = findSwings(bars.slice(0, bars.length - 1));
    var last = sw[sw.length - 1];
    if (!last || last.idx + 1 > bars.length - 1) return sw;
    var best = null;
    for (var i = last.idx + 1; i < bars.length; i++) {
      if (last.type === 'high') { if (!best || bars[i].low < best.price) best = { idx: i, type: 'low', price: bars[i].low }; }
      else { if (!best || bars[i].high > best.price) best = { idx: i, type: 'high', price: bars[i].high }; }
    }
    if (best) sw = sw.concat([best]);
    return sw;
  }

  // ---- Trend classification (Dow structure from last swings) -----------------
  // Down = lower highs AND lows that are lower OR equal (re-testing the same support);
  // Up = higher lows AND highs that are higher OR equal. Equal = within CFG.trendTol.
  function classifyTrend(swings) {
    var zz = zigzag(swings);
    var highs = zz.filter(function (s) { return s.type === 'high'; });
    var lows = zz.filter(function (s) { return s.type === 'low'; });
    if (highs.length < 2 || lows.length < 2) return 'range';
    var h1 = highs[highs.length - 2].price, h2 = highs[highs.length - 1].price;
    var l1 = lows[lows.length - 2].price, l2 = lows[lows.length - 1].price;
    var t = CFG.trendTol;
    if ((h2 < h1 * (1 - t) && l2 <= l1 * (1 + t)) || (l2 < l1 * (1 - t) && h2 <= h1 * (1 + t))) return 'down';
    if ((h2 > h1 * (1 + t) && l2 >= l1 * (1 - t)) || (l2 > l1 * (1 + t) && h2 >= h1 * (1 - t))) return 'up';
    return 'range';
  }

  // Trend used everywhere (analyze + trendDuration). The still-forming swing may flag a
  // downtrend, but while price holds ABOVE SMA30 that provisional read is ignored and only
  // confirmed swings count (a 1-2 week bounce after a sharp dip must not flip an uptrend).
  function trendOf(bars) {
    var t = classifyTrend(structureSwings(bars));
    if (t === 'down') {
      var s = sma(bars, CFG.smaPeriod);
      if (s != null && bars[bars.length - 1].close >= s) {
        var conf = classifyTrend(findSwings(bars.slice(0, bars.length - 1)));
        if (conf !== 'down') return conf;
      }
    }
    return t;
  }

  // Days since the 52-week peak (weekly bars, 7 days each): how long the decline has lasted.
  function declineDays(bars) {
    var n = bars.length, from = Math.max(0, n - 52), pk = from;
    for (var i = from; i < n; i++) { if (bars[i].high >= bars[pk].high) pk = i; }
    return (n - 1 - pk) * 7;
  }

  // Fresh micro-structure after a deep pullback: >=2 higher highs AND 2 higher lows.
  function hasRebuildStructure(swings, dir) {
    var highs = swings.filter(function (s) { return s.type === 'high'; });
    var lows = swings.filter(function (s) { return s.type === 'low'; });
    if (highs.length < 2 || lows.length < 2) return false;
    var h1 = highs[highs.length - 2].price, h2 = highs[highs.length - 1].price;
    var l1 = lows[lows.length - 2].price, l2 = lows[lows.length - 1].price;
    if (dir === 'up') return h2 > h1 && l2 > l1;
    return h2 < h1 && l2 < l1;
  }

  // ---- Horizontal levels weighted by touch count -----------------------------
  // Clusters swing highs+lows into price levels; counts touches within tolerance.
  function buildLevels(bars, swings) {
    var pts = swings.map(function (s) { return { price: s.price, idx: s.idx }; });
    pts.sort(function (a, b) { return a.price - b.price; });
    var levels = [];
    for (var i = 0; i < pts.length; i++) {
      var placed = false;
      for (var k = 0; k < levels.length; k++) {
        if (Math.abs(pts[i].price - levels[k].price) / levels[k].price <= CFG.levelTol) {
          // merge: running average + touch count
          levels[k].price = (levels[k].price * levels[k].touches + pts[i].price) / (levels[k].touches + 1);
          levels[k].touches++;
          if (pts[i].idx > levels[k].lastIdx) levels[k].lastIdx = pts[i].idx;
          placed = true;
          break;
        }
      }
      if (!placed) levels.push({ price: pts[i].price, touches: 1, lastIdx: pts[i].idx });
    }
    levels.sort(function (a, b) { return a.price - b.price; });
    return levels;
  }

  function nearestLevelBelow(levels, price) {
    var best = null;
    for (var i = 0; i < levels.length; i++) {
      if (levels[i].price <= price && (!best || levels[i].price > best.price)) best = levels[i];
    }
    return best;
  }
  function nearestLevelAbove(levels, price) {
    var best = null;
    for (var i = 0; i < levels.length; i++) {
      if (levels[i].price >= price && (!best || levels[i].price < best.price)) best = levels[i];
    }
    return best;
  }

  // ---- Candle reads ----------------------------------------------------------
  function candle(bar, prev) {
    var body = Math.abs(bar.close - bar.open);
    var range = bar.high - bar.low || 1e-9;
    var upWick = bar.high - Math.max(bar.close, bar.open);
    var dnWick = Math.min(bar.close, bar.open) - bar.low;
    var bull = bar.close >= bar.open;
    var r = {
      bull: bull,
      doji: body / range < 0.1,
      hammer: dnWick > body * 1.5 && upWick < body && bull,
      shootingStar: upWick > body * 1.5 && dnWick < body && !bull,
      strongBull: bull && body / range > 0.6,
      strongBear: !bull && body / range > 0.6,
      bullEngulf: false,
      bearEngulf: false
    };
    if (prev) {
      r.bullEngulf = bull && prev.close < prev.open && bar.close >= prev.open && bar.open <= prev.close;
      r.bearEngulf = !bull && prev.close > prev.open && bar.close <= prev.open && bar.open >= prev.close;
    }
    return r;
  }

  function bullishReversal(bars) {
    var n = bars.length;
    var c = candle(bars[n - 1], bars[n - 2]);
    return c.hammer || c.doji || c.bullEngulf || c.strongBull;
  }
  function bearishReversal(bars) {
    var n = bars.length;
    var c = candle(bars[n - 1], bars[n - 2]);
    return c.shootingStar || c.doji || c.bearEngulf || c.strongBear;
  }

  // ---- Volume behaviour over the recent pullback leg -------------------------
  function volumeTrend(bars, lookback) {
    lookback = Math.min(lookback || CFG.pullbackLookback, bars.length - 1);
    var recent = bars.slice(-Math.ceil(lookback / 2));
    var older = bars.slice(-lookback, -Math.ceil(lookback / 2));
    if (!recent.length || !older.length) return { ratio: 1, contracting: false, expanding: false };
    var avg = function (a) { return a.reduce(function (s, b) { return s + (b.volume || 0); }, 0) / a.length; };
    var ro = avg(older) || 1e-9, rr = avg(recent);
    var ratio = rr / ro;
    return { ratio: ratio, contracting: ratio <= CFG.volContractRatio, expanding: ratio >= CFG.volExpandRatio };
  }

  // Did price hold >=holdCandles beyond a broken level, and is it retesting now?
  // side = 'above' (long breakout) or 'below' (short breakdown).
  function breakoutRetest(bars, level, side) {
    var hold = CFG.holdCandles;
    var n = bars.length;
    // Look back for the breakout: a window where all closes are on the correct side.
    var heldCount = 0, breakoutVolOk = false, breakoutIdx = -1;
    for (var i = n - 2; i >= Math.max(1, n - 20); i--) {
      var onSide = side === 'above' ? bars[i].close > level : bars[i].close < level;
      if (onSide) {
        heldCount++;
        // mark quality breakout: the bar that first crossed with volume + body
        var crossed = side === 'above'
          ? (bars[i - 1].close <= level && bars[i].close > level)
          : (bars[i - 1].close >= level && bars[i].close < level);
        if (crossed) {
          breakoutIdx = i;
          var vMa = volAvg(bars, CFG.volPeriod, i);
          var body = Math.abs(bars[i].close - bars[i].open);
          var range = bars[i].high - bars[i].low || 1e-9;
          var goodBody = side === 'above' ? (bars[i].close >= bars[i].open && body / range > 0.4)
                                          : (bars[i].close <= bars[i].open && body / range > 0.4);
          breakoutVolOk = (bars[i].volume || 0) >= vMa * CFG.volBreakoutRatio && goodBody;
        }
      } else {
        break; // streak on the correct side ended
      }
    }
    var price = bars[n - 1].close;
    var atLevel = Math.abs(price - level) / level <= CFG.nearLevel;
    var retesting = side === 'above' ? (price <= level * (1 + CFG.nearLevel) && price >= level * (1 - CFG.atStop))
                                     : (price >= level * (1 - CFG.nearLevel) && price <= level * (1 + CFG.atStop));
    return {
      held: heldCount >= hold,
      heldCount: heldCount,
      qualityBreakout: breakoutVolOk,
      retesting: retesting && atLevel,
      breakoutIdx: breakoutIdx
    };
  }

  // A significant support (>=3 touches) near price that has NOT yet been broken, i.e. the last
  // holdCandles weekly closes were not all below it. No short is allowed while this exists.
  // A support BELOW price counts while it is within ~2 ATR (a strong floor right under price
  // sits inside the short's path to target, so the trade only starts after it breaks).
  function unbrokenSupport(bars, levels, price, atrVal) {
    var n = bars.length, best = null;
    var maxBelow = Math.max(CFG.nearLevel * 2, atrVal && price ? 2 * atrVal / price : 0);
    levels.forEach(function (l) {
      if (l.touches < CFG.touchSignificant) return;
      var dist = Math.abs(price - l.price) / l.price;
      if (dist > (l.price < price ? maxBelow : CFG.nearLevel * 2)) return;
      var below = 0;
      for (var i = n - 2; i >= 0; i--) { if (bars[i].close < l.price) below++; else break; }
      if (below >= CFG.holdCandles) return;   // broken for 5+ candles -> confirmed
      if (!best || Math.abs(price - l.price) < Math.abs(price - best.price)) best = l;
    });
    return best;
  }

  // The level closest to price (either side, within nearLevel). Touches are re-counted from the
  // weekly lows that land inside a small ATR band around it, because the most recent touches are not
  // yet confirmed swings (a fractal needs bars on its right) but a trader still counts them.
  function nearLevelAny(levels, price, bars, atrVal) {
    var best = null;
    levels.forEach(function (l) {
      var d = Math.abs(price - l.price) / l.price;
      if (d > CFG.nearLevel) return;
      if (!best || d < best.d) best = { l: l, d: d };
    });
    if (!best) return null;
    var band = Math.max(best.l.price * CFG.levelTol * 0.5, 0.35 * (atrVal || 0)), up = best.l.price * 0.005, t = 0;
    for (var i = 0; i < bars.length; i++) {
      var dLow = bars[i].low - best.l.price;      // wick that reaches (or pierces) the level from above
      if (dLow <= up && dLow >= -band) t++;
    }
    return { price: best.l.price, touches: Math.max(best.l.touches, t), lastIdx: best.l.lastIdx };
  }

  // A significant resistance that price is approaching (not yet broken) or has cleared by 1-4 weekly
  // closes (still short of the 5-candle hold). Mirror of unbrokenSupport for the long side.
  function formingBreakout(bars, levels, price, atrVal) {
    var n = bars.length, maxD = CFG.planZoneAtr * (atrVal || 0), best = null;
    levels.forEach(function (l) {
      if (l.touches < CFG.touchSignificant) return;
      var closes = 0;
      for (var i = n - 2; i >= 0 && bars[i].close > l.price; i--) closes++;
      if (closes === 0) { if (l.price <= price || (l.price - price) > maxD) return; }
      else if (closes >= CFG.holdCandles || (price - l.price) > maxD) return;
      if (!best || Math.abs(price - l.price) < Math.abs(price - best.level)) best = { level: l.price, touches: l.touches, closes: closes };
    });
    return best;
  }

  // ---- Fibonacci of the most recent up/down leg ------------------------------
  function fibZone(bars, swings, dir) {
    var highs = swings.filter(function (s) { return s.type === 'high'; });
    var lows = swings.filter(function (s) { return s.type === 'low'; });
    if (!highs.length || !lows.length) return null;
    var hi = highs[highs.length - 1], lo = lows[lows.length - 1];
    var top = Math.max(hi.price, lo.price), bot = Math.min(hi.price, lo.price);
    var diff = top - bot;
    return { f382: top - diff * 0.382, f5: top - diff * 0.5, f618: top - diff * 0.618 };
  }

  // ---- Trade level builder ---------------------------------------------------
  function buildTrade(dir, entry, stopRef, atrVal) {
    var stop, target, risk;
    if (dir === 'long') {
      stop = stopRef - atrVal;
      risk = entry - stop;
      target = entry + CFG.rrTarget * risk;
    } else {
      stop = stopRef + atrVal;
      risk = stop - entry;
      target = entry - CFG.rrTarget * risk;
    }
    return { entry: entry, stop: stop, target: target, rr: CFG.rrTarget, risk: risk };
  }

  // Alert fires a little before the entry, on the side price is approaching from.
  function alertFor(entry, price) {
    var fromAbove = price > entry;
    return {
      level: fromAbove ? entry * (1 + CFG.alertBuffer) : entry * (1 - CFG.alertBuffer),
      side: fromAbove ? 'from_above' : 'from_below'
    };
  }

  // ============================================================================
  //   MAIN: analyze one symbol's weekly bars
  // ============================================================================
  function analyze(bars, meta) {
    meta = meta || {};
    var res = {
      symbol: meta.symbol || null,
      name: meta.name || null,
      curr: meta.curr || '',
      price: null, direction: null, setup: null, status: 'reject',
      trend: null, sma30: null, atr: null, volMA: null,
      level: null, levelTouches: 0,
      entry: null, stop: null, target: null, rr: CFG.rrTarget,
      alertLevel: null, alertSide: null,
      reasons: [], disq: []
    };
    if (!bars || bars.length < CFG.minBars) { res.disq.push('insufficient_data'); return res; }

    var n = bars.length;
    var price = bars[n - 1].close;
    res.price = price;
    var sma30 = sma(bars, CFG.smaPeriod);
    var sma30prev = sma(bars, CFG.smaPeriod, n - 1 - CFG.slopeLookback);
    var atrVal = atr(bars, CFG.atrPeriod);
    var vMA = volAvg(bars, CFG.volPeriod);
    res.sma30 = sma30; res.atr = atrVal; res.volMA = vMA;
    if (sma30 == null || atrVal == null) { res.disq.push('insufficient_data'); return res; }

    var smaRising = sma30prev != null && sma30 > sma30prev;
    var smaFalling = sma30prev != null && sma30 < sma30prev;
    var aboveSMA = price >= sma30;

    // Use a confirmed-swing window (drop the still-forming last bar for structure)
    var swingBars = bars.slice(0, n - 1);
    var swings = findSwings(swingBars);
    var trend = trendOf(bars);
    if (trend === 'down') {
      var dDays = declineDays(bars);
      res.declineDays = dDays;
      if (dDays < CFG.minDownDays) {
        // Too young to be a real downtrend: treated as a range (no short).
        trend = 'range';
        res.disq.push('decline_too_short');
        res.reasons.push('ירידה של ' + dDays + ' ימים בלבד מהשיא — מגמת ירידה דורשת לפחות ' + CFG.minDownDays + ' ימים');
      }
    }
    res.trend = trend;
    var levels = buildLevels(swingBars, swings);
    var vol = volumeTrend(bars);
    res.volRatio = +vol.ratio.toFixed(2);

    // ===================== LONG side (only if trend up) =====================
    if (trend === 'up') {
      if (!aboveSMA) {
        // Deep pullback below SMA30 => NOT a long yet; needs reclaim + rebuild.
        res.direction = 'long';
        res.setup = 'sma30_reclaim';
        res.status = 'watch';
        res.disq.push('below_sma30');
        if (vol.expanding) res.disq.push('expanding_down_volume');
        res.reasons.push('מגמת עלייה אך המחיר מתחת SMA30 — להמתין ל-reclaim מעל SMA30 + מבנה 2 שיאים ו-2 שפלים עולים');
        var supA = nearestLevelBelow(levels, price);
        if (supA) { res.level = supA.price; res.levelTouches = supA.touches; }
        return finalizeWatch(res, sma30, price);
      }

      // Price above a (preferably rising) SMA30 — healthy uptrend zone.
      if (smaRising) res.reasons.push('SMA30 עולה ותומך במגמה');

      // The level price is closest to (either side, within nearLevel): a support being tested right now
      // may sit a hair ABOVE the last close (a wick-pierce), so "nearest below" alone would skip it.
      var supNear = nearLevelAny(levels, price, bars, atrVal);

      // (A) Breakout + 5-candle hold + retest of a flipped resistance.
      var resLvl = nearestLevelBelow(levels, price); // the level just under price = possible flipped resistance
      if (resLvl) {
        var bo = breakoutRetest(bars, resLvl.price, 'above');
        if (bo.held && bo.retesting) {
          res.direction = 'long'; res.setup = 'breakout_retest';
          res.level = resLvl.price; res.levelTouches = resLvl.touches;
          res.reasons.push('פריצה' + (bo.qualityBreakout ? ' איכותית' : '') + ' מעל ' + fmt(resLvl.price) + ' + ' + bo.heldCount + ' נרות מעל + ריטסט');
          res.plan = makePlan('breakout', 'long', resLvl.price, resLvl.touches, bo.heldCount, 'entry');
          return finalizeEntry(res, 'long', resLvl.price, resLvl.price, atrVal * CFG.retestStopAtr, price);
        }
        // A breakout level far below price is not a retest candidate when a nearer support is being tested.
        var nearerSupport = supNear && Math.abs(price - supNear.price) < Math.abs(price - resLvl.price);
        if (bo.held && !bo.retesting && !nearerSupport) {
          res.direction = 'long'; res.setup = 'breakout_retest'; res.status = 'watch';
          res.level = resLvl.price; res.levelTouches = resLvl.touches;
          res.reasons.push('פריצה אושרה (' + bo.heldCount + ' נרות) — להמתין לריטסט של ' + fmt(resLvl.price));
          res.plan = makePlan('breakout', 'long', resLvl.price, resLvl.touches, bo.heldCount, 'await_retest');
          return finalizeWatch(res, resLvl.price, price);
        }
      }

      // (B) Pullback to a support confluence (SMA30 + historical support).
      var sup = supNear || nearestLevelBelow(levels, price);
      var nearSMA = Math.abs(price - sma30) / sma30 <= CFG.nearLevel;
      var nearSup = sup && Math.abs(price - sup.price) / sup.price <= CFG.nearLevel;
      var confluence = (nearSMA ? 1 : 0) + (nearSup ? 1 : 0);
      if (confluence >= 1) {
        // Volume must contract on a healthy pullback; expanding = reject.
        if (vol.expanding) {
          res.direction = 'long'; res.setup = 'pullback'; res.status = 'reject';
          res.disq.push('expanding_down_volume');
          res.reasons.push('נפח מתרחב בירידה — pullback לא בריא, אין כניסה');
          if (sup) { res.level = sup.price; res.levelTouches = sup.touches; }
          return res;
        }
        var stopRef = nearSup ? sup.price : sma30;
        res.level = nearSup ? sup.price : sma30;
        res.levelTouches = nearSup ? sup.touches : 0;
        var rev = bullishReversal(bars);
        var confText = (nearSMA ? 'SMA30' : '') + (nearSMA && nearSup ? ' + ' : '') + (nearSup ? 'תמיכה ' + fmt(sup.price) + ' (' + sup.touches + ' נגיעות)' : '');
        res.reasons.push('חזרה לתמיכה במגמת עלייה: ' + confText + (vol.contracting ? ' | התכנסות עם מחזורי מסחר מתכווצים' : ''));
        if (rev) res.reasons.push('נר היפוך שורי בתמיכה');
        res.direction = 'long'; res.setup = 'pullback';
        // Entry needs a reversal candle AND trading volume above the Vol MA (aggressive entry).
        var volNow = bars[n - 1].volume || 0;
        var volOk = vMA > 0 ? volNow >= vMA * CFG.volEntryRatio : true;
        res.volVsMA = vMA > 0 ? +(volNow / vMA).toFixed(2) : null;
        if (rev && !volOk) {
          res.reasons.push('חסר מחזור מסחר גבוה מהממוצע (' + Math.round(volNow / vMA * 100) + '% מ-Vol MA) — כניסה רק עם מחזור מעל הממוצע');
          res.disq.push('low_entry_volume');
        }
        if (!(rev && volOk) && nearSup && sup.touches >= CFG.touchSignificant) {
          res.plan = makePlan('pullback', 'long', sup.price, sup.touches, 0, 'await_reversal', { volContracting: !!vol.contracting, volRatio: +vol.ratio.toFixed(2) });
          res.reasons.push('כניסה רק כשהמחיר עולה מהתמיכה עם נר היפוך ומחזור מסחר מעל הממוצע');
        }
        if (rev && volOk) {
          if (vMA > 0) res.reasons.push('מחזור מסחר מעל הממוצע (' + Math.round(volNow / vMA * 100) + '% מ-Vol MA)');
          if (nearSup) res.plan = makePlan('pullback', 'long', sup.price, sup.touches, 0, 'entry', { volContracting: !!vol.contracting, volRatio: +vol.ratio.toFixed(2) });
          var r2 = finalizeEntry(res, 'long', price, stopRef, atrVal, price);
          // Strong ceiling (>=3 touches) above price and inside the 1:2 target path?
          var ceil = null;
          levels.forEach(function (l) {
            if (l.price > price && l.touches >= CFG.touchSignificant && (!ceil || l.price < ceil.price)) ceil = l;
          });
          if (r2.entry != null && ceil && ceil.price < r2.target) {
            var riskPx = r2.entry - r2.stop;
            var rrToCeil = riskPx > 0 ? (ceil.price - r2.entry) / riskPx : 0;
            r2.ceiling = { price: ceil.price, touches: ceil.touches, rrToCeiling: +rrToCeil.toFixed(2) };
            r2.reasons.push('התנגדות חזקה ' + fmt(ceil.price) + ' (' + ceil.touches + ' נגיעות) בדרך ליעד — רק ' + rrToCeil.toFixed(1) + 'R עד אליה. ' +
              'כניסה אגרסיבית; סולידי: להמתין לפריצת ' + fmt(ceil.price) + ' + 5 נרות + ריטסט');
            if (rrToCeil < 1) {
              r2.status = 'watch';
              r2.disq.push('ceiling_too_close');
              r2.reasons.push('התנגדות קרובה מדי (פחות מ-1R) — ממתינים לפריצה');
            }
          }
          return r2;
        }
        res.status = 'watch';
        return finalizeWatch(res, res.level, price);
      }

      // Breakout still forming: a strong resistance just above price (approach) or broken 1-4 weekly
      // closes ago (holding) — show the user the progress instead of nothing.
      var fb = formingBreakout(bars, levels, price, atrVal);
      if (fb) {
        res.direction = 'long'; res.setup = 'breakout_retest'; res.status = 'watch';
        res.level = fb.level; res.levelTouches = fb.touches;
        res.disq.push('resistance_not_broken');
        res.plan = makePlan('breakout', 'long', fb.level, fb.touches, fb.closes, fb.closes > 0 ? 'holding' : 'approach');
        res.reasons.push(fb.closes > 0
          ? 'פריצה של ' + fmt(fb.level) + ' בתהליך — נר ' + fb.closes + ' מתוך ' + CFG.holdCandles + ' מעליה, אין כניסה עד 5 נרות + ריטסט'
          : 'ההתנגדות ' + fmt(fb.level) + ' (' + fb.touches + ' נגיעות) עוד לא נפרצה — כניסה רק אחרי פריצה + ' + CFG.holdCandles + ' נרות מעליה + ריטסט');
        return finalizeWatch(res, fb.level, price);
      }

      // Uptrend but price ran away from support — don't chase.
      res.direction = 'long'; res.setup = 'pullback'; res.status = 'watch';
      res.reasons.push('מגמת עלייה אך המחיר רחוק מהתמיכה — לא לרדוף, להמתין לריטסט/תיקון');
      if (sup) { res.level = sup.price; res.levelTouches = sup.touches; return finalizeWatch(res, sup.price, price); }
      return res;
    }

    // ===================== SHORT side (only if trend down) ==================
    if (trend === 'down') {
      if (aboveSMA) {
        // Hard rule: never a short while price is above SMA30 - no direction, no alert.
        res.disq.push('above_sma30');
        res.reasons.push('המחיר מעל SMA30 — אין שורט עד שהמחיר נשבר מתחתיו');
        res.status = 'reject';
        return res;
      }
      if (smaFalling) res.reasons.push('SMA30 יורד ומשמש התנגדות דינמית');

      // Hard rule: no short while a significant support under/at price has NOT been broken
      // (break + 5 weekly closes below + retest from below is the only way in). Checked BEFORE any
      // other short setup: a minor level above price must not trigger a short into a strong floor.
      var unb = unbrokenSupport(bars, levels, price, atrVal);
      if (unb) {
        res.direction = 'short'; res.setup = 'breakdown_retest'; res.status = 'watch';
        res.level = unb.price; res.levelTouches = unb.touches;
        res.disq.push('support_not_broken');
        var closesBelow = 0;
        for (var cb = n - 2; cb >= 0 && bars[cb].close < unb.price; cb--) closesBelow++;
        res.plan = makePlan('breakdown', 'short', unb.price, unb.touches, closesBelow, closesBelow > 0 ? 'holding' : 'approach');
        res.reasons.push('התמיכה ' + fmt(unb.price) + ' (' + unb.touches + ' נגיעות) עדיין לא נשברה — אין שורט עד שבירה + ' + CFG.holdCandles + ' נרות מתחתיה + ריטסט מלמטה');
        return finalizeWatch(res, unb.price, price);
      }

      // (A) Breakdown + 5-candle hold + retest of a flipped support from below.
      var supLvl = nearestLevelAbove(levels, price);
      if (supLvl) {
        var bd = breakoutRetest(bars, supLvl.price, 'below');
        if (bd.held && bd.retesting) {
          res.direction = 'short'; res.setup = 'breakdown_retest';
          res.level = supLvl.price; res.levelTouches = supLvl.touches;
          res.reasons.push('שבירה מתחת ' + fmt(supLvl.price) + ' + ' + bd.heldCount + ' נרות מתחת + ריטסט מלמטה' + (vol.expanding ? ' | נפח מתרחב מחזק שורט' : ''));
          res.plan = makePlan('breakdown', 'short', supLvl.price, supLvl.touches, bd.heldCount, 'entry');
          return finalizeEntry(res, 'short', supLvl.price, supLvl.price, Math.max(atrVal * CFG.retestStopAtr, supLvl.price * CFG.retestStopPct), price);
        }
        if (bd.held && !bd.retesting) {
          res.direction = 'short'; res.setup = 'breakdown_retest'; res.status = 'watch';
          res.level = supLvl.price; res.levelTouches = supLvl.touches;
          res.reasons.push('שבירה אושרה (' + bd.heldCount + ' נרות) — להמתין לריטסט מלמטה של ' + fmt(supLvl.price));
          res.plan = makePlan('breakdown', 'short', supLvl.price, supLvl.touches, bd.heldCount, 'await_retest');
          return finalizeWatch(res, supLvl.price, price);
        }
      }

      // (B) SMA30 rejection: relief rally up to a falling SMA30 in a downtrend.
      var nearSMAd = Math.abs(price - sma30) / sma30 <= CFG.nearLevel;
      if (nearSMAd && price <= sma30 * (1 + CFG.atStop)) {
        res.direction = 'short'; res.setup = 'sma30_rejection';
        res.reasons.push('תיקון עולה אל SMA30 (' + fmt(sma30) + ') כהתנגדות דינמית במגמת ירידה');
        if (bearishReversal(bars)) {
          res.reasons.push('נר היפוך דובי ב-SMA30');
          return finalizeEntry(res, 'short', price, sma30, atrVal, price);
        }
        res.status = 'watch';
        return finalizeWatch(res, sma30, price);
      }

      res.direction = 'short'; res.setup = 'breakdown_retest'; res.status = 'watch';
      res.reasons.push('מגמת ירידה — להמתין לשבירה/ריטסט או דחייה מ-SMA30');
      if (supLvl) { res.level = supLvl.price; res.levelTouches = supLvl.touches; return finalizeWatch(res, supLvl.price, price); }
      return res;
    }

    // ===================== RANGE (trade confirmed breakouts both ways) ======
    res.trend = 'range';
    var upper = nearestLevelAbove(levels, price);
    var lower = nearestLevelBelow(levels, price);
    var strongRange = upper && lower && upper.touches >= CFG.touchSignificant && lower.touches >= CFG.touchSignificant;
    res.reasons.push('דשדוש' + (strongRange ? ' (Range קלאסי)' : ' (Range חלש — tradeable רק עם פריצה איכותית)'));
    if (upper) {
      var boU = breakoutRetest(bars, upper.price, 'above');
      if (boU.held && boU.retesting && (boU.qualityBreakout || strongRange)) {
        res.direction = 'long'; res.setup = 'range_breakout';
        res.level = upper.price; res.levelTouches = upper.touches;
        res.reasons.push('פריצת גבול עליון ' + fmt(upper.price) + ' + 5 נרות + ריטסט = לונג');
        return finalizeEntry(res, 'long', upper.price, upper.price, atrVal * CFG.retestStopAtr, price);
      }
    }
    if (lower && res.disq.indexOf('decline_too_short') === -1) {
      var boL = breakoutRetest(bars, lower.price, 'below');
      if (boL.held && boL.retesting && (boL.qualityBreakout || strongRange)) {
        res.direction = 'short'; res.setup = 'range_breakout';
        res.level = lower.price; res.levelTouches = lower.touches;
        res.reasons.push('שבירת גבול תחתון ' + fmt(lower.price) + ' + 5 נרות + ריטסט = שורט');
        return finalizeEntry(res, 'short', lower.price, lower.price, Math.max(atrVal * CFG.retestStopAtr, lower.price * CFG.retestStopPct), price);
      }
    }
    res.status = 'watch';
    if (upper) res.reasons.push('גבול עליון ~' + fmt(upper.price) + ' (' + upper.touches + ' נגיעות)');
    if (lower) res.reasons.push('גבול תחתון ~' + fmt(lower.price) + ' (' + lower.touches + ' נגיעות)');
    return res;

    // ---- inner helpers (hoisted) --------------------------------------------
    // "Plan" = the level-based trade the user must WAIT for: break -> 5 closes beyond -> retest -> entry.
    // Carries the progress so the app can show a stepper, chart overlay and stage alerts.
    function makePlan(kind, dir, level, touches, closes, stage, extra) {
      var stopDist = Math.max(atrVal * CFG.retestStopAtr, dir === 'short' ? level * CFG.retestStopPct : 0);
      if (kind === 'pullback') stopDist = atrVal;
      var t = buildTrade(dir, level, level, stopDist);
      var p = {
        kind: kind, dir: dir, level: level, touches: touches,
        closes: closes, needed: CFG.holdCandles, stage: stage,
        zone: stage !== 'approach' || Math.abs(price - level) <= CFG.planZoneAtr * atrVal,
        entry: t.entry, stop: t.stop, target: t.target, rr: t.rr
      };
      if (extra) { for (var k in extra) { if (extra.hasOwnProperty(k)) p[k] = extra[k]; } }
      return p;
    }
    function finalizeEntry(r, dir, entry, stopRef, a, px) {
      // Hard rule: never a SHORT entry while price is at/above SMA30.
      if (dir === 'short' && px >= sma30) {
        r.status = 'reject'; r.direction = null; r.setup = null;
        r.entry = r.stop = r.target = null; r.alertLevel = r.alertSide = null;
        if (r.disq.indexOf('above_sma30') === -1) r.disq.push('above_sma30');
        r.reasons.push('המחיר מעל SMA30 — אין שורט');
        return r;
      }
      // Hard rule: never a LONG entry while price is below SMA30 (any setup / trend class).
      if (dir === 'long' && px < sma30) {
        r.status = 'watch';
        r.entry = r.stop = r.target = null; r.alertLevel = r.alertSide = null;
        if (r.disq.indexOf('below_sma30') === -1) r.disq.push('below_sma30');
        r.reasons.push('המחיר מתחת SMA30 — אין לונג עד שהמחיר חוזר מעל SMA30 ונבנה מבנה עולה');
        return r;
      }
      var ranAway = Math.abs(px - entry) / entry > CFG.ranAwayPct;
      var t = buildTrade(dir, entry, stopRef, a);
      r.entry = t.entry; r.stop = t.stop; r.target = t.target; r.rr = t.rr;
      var al = alertFor(entry, px);
      r.alertLevel = al.level; r.alertSide = al.side;
      if (ranAway) {
        r.status = 'watch';
        r.reasons.push('המחיר כבר ברח מה-entry — להמתין לריטסט הבא (לא לרדוף)');
      } else {
        var atEntry = Math.abs(px - entry) / entry <= CFG.atStop;
        r.status = atEntry ? 'entry' : 'watch';
      }
      return r;
    }
    function finalizeWatch(r, levelPx, px) {
      if (levelPx) {
        var al = alertFor(levelPx, px);
        r.alertLevel = al.level; r.alertSide = al.side;
      }
      return r;
    }
  }

  function fmt(x) { return (Math.round(x * 100) / 100).toString(); }

  // ============================================================================
  //   DESCRIBE: full technical profile of one symbol (powers the "AI analysis"
  //   popup). Reuses analyze() + the same swings/levels so it never disagrees
  //   with the scanner. Pure: no network, no DOM.
  // ============================================================================
  var SETUP_HE = {
    pullback: 'חזרה לתמיכה', breakout_retest: 'פריצה + ריטסט',
    breakdown_retest: 'שבירה + ריטסט', range_breakout: 'פריצת Range',
    sma30_reclaim: 'החזרת SMA30', sma30_rejection: 'דחייה מ-SMA30'
  };
  var TREND_HE = { up: 'מגמת עלייה', down: 'מגמת ירידה', range: 'דישדוש (Range)' };

  // Nearest level on one side of price; strong (>=3 touches) levels are preferred.
  function pickLevel(levels, bars, price, below) {
    var side = levels.filter(function (l) { return below ? l.price <= price : l.price >= price; });
    if (!side.length) return null;
    var strong = side.filter(function (l) { return l.touches >= CFG.touchSignificant; });
    var pool = strong.length ? strong : side;
    var best = pool[0];
    pool.forEach(function (l) { if (Math.abs(l.price - price) < Math.abs(best.price - price)) best = l; });
    var lastBar = bars[best.lastIdx];
    return {
      price: best.price, touches: best.touches,
      strong: best.touches >= CFG.touchSignificant, veryStrong: best.touches >= CFG.touchStrong,
      lastTouch: lastBar ? lastBar.time : null,
      distPct: (best.price - price) / price * 100
    };
  }

  // How long (in weekly bars) the current Dow trend has been in force.
  function trendDuration(bars, swings, trend) {
    var n = bars.length, weeks = 1, capped = true;
    for (var end = n - 2; end >= CFG.minBars; end--) {
      // trend as it was at that earlier week (same method as analyze(): confirmed + forming swing)
      if (trendOf(bars.slice(0, end + 1)) !== trend) { capped = false; break; }
      weeks++;
    }
    return { weeks: weeks, capped: capped, since: bars[n - weeks] ? bars[n - weeks].time : null };
  }

  // Rough lead-time estimate until a real entry signal. A heuristic, NOT a forecast:
  // travel time to the trigger level at ~0.4-1.0 ATR per week + confirmation weeks.
  function estimateEta(a, price, trigger) {
    if (a.status === 'entry' && a.entry != null) {
      return { kind: 'now', minWeeks: 0, maxWeeks: 0, text: 'הסיגנל פעיל כעת' };
    }
    if (a.status === 'reject') {
      return { kind: 'unlikely', minWeeks: null, maxWeeks: null, text: 'אין סיגנל צפוי כרגע — המבנה לא תקין לכניסה' };
    }
    var atrPct = (a.atr && price) ? a.atr / price : 0.04;
    var dist = trigger != null ? Math.abs(price - trigger) / price : 0;
    var travel = Math.max(0, dist - CFG.atStop);
    var wMin = Math.ceil(travel / Math.max(atrPct, 0.005));
    var wMax = Math.ceil(travel / Math.max(atrPct * 0.4, 0.004));
    var cMin = 0, cMax = 1, basis = '';
    if (a.setup === 'sma30_reclaim') { cMin = 3; cMax = 8; basis = 'נדרשת החזרת SMA30 ובניית מבנה 2 שיאים + 2 שפלים עולים'; }
    else if (a.setup === 'breakout_retest' || a.setup === 'breakdown_retest') { cMin = 0; cMax = 3; basis = 'ממתינים לריטסט של הרמה שנפרצה'; }
    else if (a.setup === 'pullback' || a.setup === 'sma30_rejection') { cMin = 0; cMax = 2; basis = 'ממתינים להגעה לרמה ולנר היפוך מאשר'; }
    else if (a.trend === 'range') { cMin = CFG.holdCandles; cMax = CFG.holdCandles + 3; basis = 'דישדוש: נדרשת פריצה + ' + CFG.holdCandles + ' נרות מעל/מתחת + ריטסט'; }
    var lo = wMin + cMin, hi = wMax + cMax;
    if (hi < lo) hi = lo;
    if (lo > 26) {
      return { kind: 'far', minWeeks: lo, maxWeeks: hi, text: 'רחוק — לא צפוי איתות בחצי השנה הקרובה', basis: basis };
    }
    if (hi > 26) hi = 26;
    var text = hi <= 1 ? 'בשבוע הקרוב'
      : (lo === hi ? ('כ-' + lo + ' שבועות') : ('כ-' + Math.max(lo, 1) + ' עד ' + hi + ' שבועות'));
    return { kind: 'estimate', minWeeks: lo, maxWeeks: hi, text: text, basis: basis };
  }

  function describe(bars, meta) {
    meta = meta || {};
    var a = analyze(bars, meta);
    var out = { ok: false, symbol: a.symbol, name: a.name, curr: meta.curr || a.curr || '' };
    if (!bars || bars.length < CFG.minBars || a.sma30 == null) { out.error = 'insufficient_data'; return out; }

    var n = bars.length;
    var price = a.price;
    var swingBars = bars.slice(0, n - 1);
    var swings = findSwings(swingBars);
    var levels = buildLevels(swingBars, swings);
    var trend = a.trend || 'range';

    // --- trend + duration ---
    var td = trendDuration(bars, swings, trend);

    // --- SMA30 position / slope ---
    var smaPrev = sma(bars, CFG.smaPeriod, n - 1 - CFG.slopeLookback);
    var slopePct = smaPrev ? (a.sma30 - smaPrev) / smaPrev * 100 : 0;
    var above = price >= a.sma30;
    var sideWeeks = 0;
    for (var i = n - 1; i >= CFG.smaPeriod - 1; i--) {
      var m = sma(bars, CFG.smaPeriod, i);
      if ((bars[i].close >= m) === above) sideWeeks++; else break;
    }

    // --- last strong support (below) / resistance (above) ---
    var support = pickLevel(levels, bars, price, true);
    var resistance = pickLevel(levels, bars, price, false);

    // --- did price break a resistance / support recently? ---
    var broke = null;
    function consider(type, lvl, side) {
      var bo = breakoutRetest(bars, lvl.price, side);
      var cand = null;
      if (bo.breakoutIdx >= 0) {
        cand = { type: type, level: lvl.price, weeksAgo: (n - 1) - bo.breakoutIdx, held: bo.heldCount + 1,
                 confirmed: bo.held, quality: bo.qualityBreakout, retesting: bo.retesting };
      } else if (bars[n - 2] && (side === 'above' ? (bars[n - 2].close <= lvl.price && price > lvl.price)
                                                   : (bars[n - 2].close >= lvl.price && price < lvl.price))) {
        cand = { type: type, level: lvl.price, weeksAgo: 0, held: 1, confirmed: false, quality: false, retesting: false };
      }
      if (cand && (!broke || cand.weeksAgo < broke.weeksAgo)) broke = cand;
    }
    if (support) consider('resistance', support, 'above');   // level now under price = flipped resistance
    if (resistance) consider('support', resistance, 'below'); // level now over price = flipped support
    var nearRes = resistance && Math.abs(resistance.distPct) <= CFG.nearLevel * 100;
    var nearSup = support && Math.abs(support.distPct) <= CFG.nearLevel * 100;

    // --- entry readiness ---
    var canEnter = a.status === 'entry' && a.entry != null;
    var trigger = a.entry != null ? a.entry
      : ((a.setup === 'sma30_reclaim' || a.setup === 'sma30_rejection') ? a.sma30
      : (a.level != null ? a.level : null));
    if (trigger == null && trend === 'range') {
      var cands = [];
      if (resistance) cands.push(resistance.price);
      if (support) cands.push(support.price);
      cands.forEach(function (p) { if (trigger == null || Math.abs(p - price) < Math.abs(trigger - price)) trigger = p; });
    }
    var eta = estimateEta(a, price, trigger);

    var dirTxt = a.direction === 'short' ? 'שורט' : (a.direction === 'long' ? 'לונג' : '');
    var verdict;
    if (canEnter) {
      verdict = { key: 'enter', text: dirTxt + ' — ניתנת לכניסה כעת (' + (SETUP_HE[a.setup] || a.setup || '') + ')' };
    } else if (a.status === 'watch') {
      verdict = { key: 'wait', text: 'במעקב' + (dirTxt ? ' (' + dirTxt + ')' : '') + ' — עדיין לא ניתנת לכניסה, ממתינים לאישור' };
    } else {
      verdict = { key: 'avoid', text: 'לא ניתנת לכניסה כרגע' };
    }

    out.ok = true;
    out.price = price;
    out.trend = { type: trend, text: TREND_HE[trend] || trend, weeks: td.weeks, capped: td.capped, since: td.since };
    out.sma = {
      value: a.sma30, position: above ? 'above' : 'below',
      distPct: (price - a.sma30) / a.sma30 * 100,
      slope: slopePct > 0.3 ? 'rising' : (slopePct < -0.3 ? 'falling' : 'flat'),
      slopePct: slopePct, sideWeeks: sideWeeks
    };
    out.support = support;
    out.resistance = resistance;
    out.nearSupport = !!nearSup;
    out.nearResistance = !!nearRes;
    out.broke = broke;
    out.entry = {
      canEnter: canEnter, status: a.status, direction: a.direction,
      setup: a.setup, setupText: SETUP_HE[a.setup] || a.setup || null,
      entry: a.entry, stop: a.stop, target: a.target, rr: a.rr, alertLevel: a.alertLevel
    };
    out.eta = eta;
    out.verdict = verdict;
    out.reasons = a.reasons || [];
    out.disq = a.disq || [];
    return out;
  }

  // Public API — works in the browser (window.NTScanner) and in Node (module.exports),
  // so the exact same method runs client-side and on the server.
  var NTScanner = {
    analyze: analyze,
    describe: describe,
    config: CFG,
    // low-level helpers exposed for testing / tuning
    _sma: sma, _atr: atr, _volAvg: volAvg,
    _findSwings: findSwings, _classifyTrend: classifyTrend,
    _buildLevels: buildLevels, _breakoutRetest: breakoutRetest,
    _volumeTrend: volumeTrend, _candle: candle
  };
  if (typeof window !== 'undefined') window.NTScanner = NTScanner;
  if (typeof module !== 'undefined' && module.exports) module.exports = NTScanner;
})();
