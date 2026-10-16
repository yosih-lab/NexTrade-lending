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
    pullbackLookback: 8,    // weeks to inspect a pullback leg
    volContractRatio: 0.9,  // recent vol <= 0.9x of pullback-start vol = contracting
    volExpandRatio: 1.15,   // recent vol >= 1.15x = expanding
    volBreakoutRatio: 1.2,  // breakout week vol >= 1.2x Vol MA = quality
    slopeLookback: 4,       // weeks back to measure SMA30 slope
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

  // ---- Trend classification (Dow structure from last swings) -----------------
  function classifyTrend(swings) {
    var highs = swings.filter(function (s) { return s.type === 'high'; });
    var lows = swings.filter(function (s) { return s.type === 'low'; });
    if (highs.length < 2 || lows.length < 2) return 'range';
    var h1 = highs[highs.length - 2], h2 = highs[highs.length - 1];
    var l1 = lows[lows.length - 2], l2 = lows[lows.length - 1];
    if (h2.price > h1.price && l2.price > l1.price) return 'up';
    if (h2.price < h1.price && l2.price < l1.price) return 'down';
    return 'range';
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
    var trend = classifyTrend(swings);
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

      // (A) Breakout + 5-candle hold + retest of a flipped resistance.
      var resLvl = nearestLevelBelow(levels, price); // the level just under price = possible flipped resistance
      if (resLvl) {
        var bo = breakoutRetest(bars, resLvl.price, 'above');
        if (bo.held && bo.retesting) {
          res.direction = 'long'; res.setup = 'breakout_retest';
          res.level = resLvl.price; res.levelTouches = resLvl.touches;
          res.reasons.push('פריצה' + (bo.qualityBreakout ? ' איכותית' : '') + ' מעל ' + fmt(resLvl.price) + ' + ' + bo.heldCount + ' נרות מעל + ריטסט');
          return finalizeEntry(res, 'long', resLvl.price, resLvl.price, atrVal, price);
        }
        if (bo.held && !bo.retesting) {
          res.direction = 'long'; res.setup = 'breakout_retest'; res.status = 'watch';
          res.level = resLvl.price; res.levelTouches = resLvl.touches;
          res.reasons.push('פריצה אושרה (' + bo.heldCount + ' נרות) — להמתין לריטסט של ' + fmt(resLvl.price));
          return finalizeWatch(res, resLvl.price, price);
        }
      }

      // (B) Pullback to a support confluence (SMA30 + historical support).
      var sup = nearestLevelBelow(levels, price);
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
        res.reasons.push('Pullback במגמת עלייה לקונפלואנס: ' + confText + (vol.contracting ? ' | נפח מתכווץ' : ''));
        if (rev) res.reasons.push('נר היפוך שורי בתמיכה');
        res.direction = 'long'; res.setup = 'pullback';
        // Entry only with a reversal confirmation; otherwise watch.
        if (rev) return finalizeEntry(res, 'long', price, stopRef, atrVal, price);
        res.status = 'watch';
        return finalizeWatch(res, res.level, price);
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
        res.disq.push('above_sma30');
        res.reasons.push('מגמת ירידה אך המחיר מעל SMA30 — להמתין');
        res.direction = 'short'; res.setup = 'sma30_rejection'; res.status = 'watch';
        return finalizeWatch(res, sma30, price);
      }
      if (smaFalling) res.reasons.push('SMA30 יורד ומשמש התנגדות דינמית');

      // (A) Breakdown + 5-candle hold + retest of a flipped support from below.
      var supLvl = nearestLevelAbove(levels, price);
      if (supLvl) {
        var bd = breakoutRetest(bars, supLvl.price, 'below');
        if (bd.held && bd.retesting) {
          res.direction = 'short'; res.setup = 'breakdown_retest';
          res.level = supLvl.price; res.levelTouches = supLvl.touches;
          res.reasons.push('שבירה מתחת ' + fmt(supLvl.price) + ' + ' + bd.heldCount + ' נרות מתחת + ריטסט מלמטה' + (vol.expanding ? ' | נפח מתרחב מחזק שורט' : ''));
          return finalizeEntry(res, 'short', supLvl.price, supLvl.price, atrVal, price);
        }
        if (bd.held && !bd.retesting) {
          res.direction = 'short'; res.setup = 'breakdown_retest'; res.status = 'watch';
          res.level = supLvl.price; res.levelTouches = supLvl.touches;
          res.reasons.push('שבירה אושרה (' + bd.heldCount + ' נרות) — להמתין לריטסט מלמטה של ' + fmt(supLvl.price));
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
        return finalizeEntry(res, 'long', upper.price, upper.price, atrVal, price);
      }
    }
    if (lower) {
      var boL = breakoutRetest(bars, lower.price, 'below');
      if (boL.held && boL.retesting && (boL.qualityBreakout || strongRange)) {
        res.direction = 'short'; res.setup = 'range_breakout';
        res.level = lower.price; res.levelTouches = lower.touches;
        res.reasons.push('שבירת גבול תחתון ' + fmt(lower.price) + ' + 5 נרות + ריטסט = שורט');
        return finalizeEntry(res, 'short', lower.price, lower.price, atrVal, price);
      }
    }
    res.status = 'watch';
    if (upper) res.reasons.push('גבול עליון ~' + fmt(upper.price) + ' (' + upper.touches + ' נגיעות)');
    if (lower) res.reasons.push('גבול תחתון ~' + fmt(lower.price) + ' (' + lower.touches + ' נגיעות)');
    return res;

    // ---- inner helpers (hoisted) --------------------------------------------
    function finalizeEntry(r, dir, entry, stopRef, a, px) {
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

  // Public API
  window.NTScanner = {
    analyze: analyze,
    config: CFG,
    // low-level helpers exposed for testing / tuning
    _sma: sma, _atr: atr, _volAvg: volAvg,
    _findSwings: findSwings, _classifyTrend: classifyTrend,
    _buildLevels: buildLevels, _breakoutRetest: breakoutRetest,
    _volumeTrend: volumeTrend, _candle: candle
  };
})();
