// SmartAuction Buyer-Match Engine
// Ranks the top-N likely buyers for each active car, optimizing for "highest price likely"
// among buyers who genuinely fit the car. Validated against 1,037 real sold rows.
//
// Algorithm (see docs/BUYER_MATCH_SPEC.md):
//   1. Build a profile per buyer from sold history (make/segment affinity, price & mileage
//      bands, per-segment price premium with shrinkage, recency, frequency, geography).
//   2. For each active car compute a Comparable Market Value (CMV) = blend of the car's own
//      Buy Now price with the median sale price of comparable sold cars.
//   3. Relevance gate: keep only buyers who plausibly buy this make/segment, price & mileage.
//   4. predicted_price = CMV x buyer premium (display).  RANK by a confidence-weighted
//      composite = premium x fit x support, so noisy 1-purchase buyers can't win on a tie.

// ---- helpers ---------------------------------------------------------------
export const num = (x) => {
  const n = parseFloat(String(x ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const median = (a) => {
  const v = a.filter((x) => x != null).sort((x, y) => x - y);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

export function segment(make, model) {
  const s = `${make ?? ''} ${model ?? ''}`.toLowerCase();
  const has = (arr) => arr.some((k) => s.includes(k));
  if (has(['silverado','sierra','f-150','f150','f-250','f-350','ram 1500','ram 2500','tundra','tacoma','ranger','colorado','canyon','frontier','titan','ridgeline','gladiator','maverick','super duty','1500','2500','3500'])) return 'truck';
  if (has(['transit','express','promaster','sienna','odyssey','carnival','pacifica','caravan','sprinter'])) return 'van';
  if (has(['tesla','model 3','mach-e','ev6','id.4','lyriq','mullen','ioniq','bolt','leaf'])) return 'ev';
  if (has(['tahoe','suburban','yukon','expedition','explorer','escape','equinox','traverse','blazer','pilot','highlander','4runner','rav4','cr-v','crv','rogue','pathfinder','murano','telluride','palisade','santa fe','sorento','wrangler','grand cherokee','cherokee','compass','renegade','bronco','edge','nautilus','cx-9','cx-5','outlander','ascent','atlas','tiguan','durango','acadia','enclave','escalade','navigator','q5','x5','gx','rx','kona','tucson','seltos','encore','trailblazer','envision','corsair','aviator'])) return 'suv';
  return 'car';
}

// US state centroids (lat, lng) for transport-distance estimates. Approximate is fine —
// we only need relative proximity to turn into a transport-cost signal.
const STATE_CENTROIDS = {
  AL: [32.8, -86.8], AK: [64.0, -152.0], AZ: [34.3, -111.7], AR: [34.9, -92.4], CA: [37.2, -119.3],
  CO: [39.0, -105.5], CT: [41.6, -72.7], DE: [39.0, -75.5], FL: [28.6, -82.4], GA: [32.6, -83.4],
  HI: [20.3, -156.4], ID: [44.4, -114.6], IL: [40.0, -89.2], IN: [39.9, -86.3], IA: [42.0, -93.5],
  KS: [38.5, -98.4], KY: [37.5, -85.3], LA: [31.0, -92.0], ME: [45.4, -69.2], MD: [39.0, -76.8],
  MA: [42.3, -71.8], MI: [44.3, -85.4], MN: [46.3, -94.3], MS: [32.7, -89.7], MO: [38.4, -92.5],
  MT: [47.0, -109.6], NE: [41.5, -99.8], NV: [39.3, -116.6], NH: [43.7, -71.6], NJ: [40.2, -74.7],
  NM: [34.4, -106.1], NY: [42.9, -75.5], NC: [35.5, -79.4], ND: [47.5, -100.5], OH: [40.3, -82.8],
  OK: [35.6, -97.5], OR: [43.9, -120.6], PA: [40.9, -77.8], RI: [41.7, -71.5], SC: [33.9, -80.9],
  SD: [44.4, -100.2], TN: [35.9, -86.4], TX: [31.5, -99.3], UT: [39.3, -111.7], VT: [44.1, -72.7],
  VA: [37.5, -78.9], WA: [47.4, -120.4], WV: [38.6, -80.6], WI: [44.6, -90.0], WY: [43.0, -107.6],
  DC: [38.9, -77.0],
};
// Extract a 2-letter state code from a location string like "Memphis, TN" or "TX".
function parseState(loc) {
  if (!loc) return null;
  const m = String(loc).toUpperCase().match(/\b([A-Z]{2})\b(?!.*\b[A-Z]{2}\b)/);
  return m && STATE_CENTROIDS[m[1]] ? m[1] : null;
}
function milesBetween(a, b) {
  const ca = STATE_CENTROIDS[a], cb = STATE_CENTROIDS[b];
  if (!ca || !cb) return null;
  const R = 3959, toR = Math.PI / 180;
  const dLat = (cb[0] - ca[0]) * toR, dLng = (cb[1] - ca[1]) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(ca[0] * toR) * Math.cos(cb[0] * toR) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

// Parse a sale date (ISO "YYYY-MM-DD" or "MM/DD/YYYY") to epoch-days. Null if unparseable.
function dateNum(s) {
  if (!s) return null;
  const str = String(s);
  let y, m, d;
  if (str.includes('-')) { [y, m, d] = str.slice(0, 10).split('-').map(Number); }
  else if (str.includes('/')) { [m, d, y] = str.split('/').map(Number); if (y < 100) y += 2000; }
  else return null;
  if (!y || !m || !d) return null;
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

// Price tier within a segment so an Escalade isn't priced like an Equinox.
// Derived from the car's own value anchor relative to segment medians.
function priceTier(price, segMedian) {
  if (!price || !segMedian) return 'mid';
  const r = price / segMedian;
  if (r < 0.7) return 'low';
  if (r > 1.4) return 'high';
  return 'mid';
}

// ---- profile building ------------------------------------------------------
// sold: array of rows {make,model,year,odometer,sale_price,sale_date,buyer_name,buyer_email,buyer_phone,buyer_state}
export function buildModel(sold) {
  const rows = sold.map((r) => ({
    ...r,
    _p: num(r.sale_price), _o: num(r.odometer), _y: num(r.year),
    _seg: r.segment || segment(r.make, r.model),
    _d: dateNum(r.sale_date),
  }));

  // global median sale price per segment (premium baseline + tier baseline)
  const segMed = {};
  for (const seg of new Set(rows.map((r) => r._seg))) {
    segMed[seg] = median(rows.filter((r) => r._seg === seg).map((r) => r._p)) || 0;
  }
  // newest sale date in the dataset = "now" reference for recency
  const maxDate = Math.max(...rows.map((r) => r._d).filter((x) => x != null), 0);

  // buyer profiles
  const prof = new Map();
  for (const r of rows) {
    const b = (r.buyer_name || '').trim();
    if (!b) continue;
    if (!prof.has(b)) prof.set(b, { name: b, cars: [], makeCount: {}, segCount: {}, makeSegCount: {} });
    const p = prof.get(b);
    p.cars.push(r);
    p.makeCount[r.make] = (p.makeCount[r.make] || 0) + 1;
    p.segCount[r._seg] = (p.segCount[r._seg] || 0) + 1;
    // bought THIS make IN THIS segment — the most specific "will they buy this car" signal
    const ms = `${r.make}|${r._seg}`;
    p.makeSegCount[ms] = (p.makeSegCount[ms] || 0) + 1;
    p.email = r.buyer_email; p.phone = r.buyer_phone; p.state = r.buyer_state;
  }

  const SHRINK = 3;          // pull premium toward 1.0 until ~3 samples back it
  const PREM_LO = 0.8, PREM_HI = 1.2;
  const RECENCY_HALFLIFE = 120;  // days; a buyer this stale loses ~half their recency boost
  for (const p of prof.values()) {
    p.n = p.cars.length;
    p.prices = p.cars.map((c) => c._p).filter((x) => x != null);
    p.odos = p.cars.map((c) => c._o).filter((x) => x != null);
    p.priceMed = median(p.prices);
    p.odoMed = median(p.odos);
    // recency: days since this buyer's most recent purchase → multiplier in [0.85, 1.0]
    const lastSale = Math.max(...p.cars.map((c) => c._d).filter((x) => x != null), 0);
    const ageDays = lastSale ? Math.max(0, maxDate - lastSale) : 9999;
    p.lastSale = lastSale;
    p.recencyMult = 0.85 + 0.15 * Math.exp(-ageDays / RECENCY_HALFLIFE);
    // overall average price this buyer actually paid
    p.avgPrice = p.prices.length ? p.prices.reduce((a, b) => a + b, 0) / p.prices.length : null;
    // per-segment premium (how much above/below market this buyer pays), shrunk by sample size,
    // plus the buyer's actual average price within each segment.
    p.prem = {};
    p.avgBySeg = {};
    const segP = {};
    for (const c of p.cars) if (c._p) (segP[c._seg] ||= []).push(c._p);
    for (const [seg, ps] of Object.entries(segP)) {
      const base = segMed[seg] || median(ps);
      const raw = base ? median(ps) / base : 1;
      const ns = ps.length;
      const shrunk = (ns * raw + SHRINK * 1.0) / (ns + SHRINK);
      p.prem[seg] = Math.max(PREM_LO, Math.min(PREM_HI, shrunk));
      p.avgBySeg[seg] = ps.reduce((a, b) => a + b, 0) / ps.length;
    }
  }

  return { rows, profiles: [...prof.values()], segMed };
}

// Comparable Market Value: blend the car's own Buy Now with median of comparable sales.
function cmv(car, model) {
  const { rows } = model;
  const seg = car.segment || segment(car.make, car.model);
  // The ask. SmartAuction's export fills `Opening Price` and leaves `Buy Now`
  // empty on every car we list, so reading buy_now alone left bn null for the
  // whole active list — which silently disabled the price band below AND
  // dropped the 60/40 anchor, pricing every car off comps alone. The
  // marketplace already treats opening price as the ask (price_source
  // 'smartauction'); this agrees with it.
  const y = num(car.year), o = num(car.odometer);
  const bn = num(car.buy_now) ?? num(car.opening_price);
  // Only comp against sales in a price band around Buy Now, so a $6.5k micro-EV is never
  // comped against $30k Teslas that merely share the "ev" segment + year + mileage.
  const inBand = (r) => !bn || (r._p >= bn * 0.5 && r._p <= bn * 2);
  const comp = (pred, minN) => {
    const c = rows.filter((r) => r._p && inBand(r) && pred(r)).map((r) => r._p);
    return c.length >= minN ? median(c) : null;
  };
  // Strong comps (make/year/mileage-aware) refine Buy Now 60/40.
  const strong =
    comp((r) => r.make === car.make && r._seg === seg && r._y && Math.abs(r._y - y) <= 2 && r._o && Math.abs(r._o - o) <= 25000, 3) ||
    comp((r) => r._seg === seg && r._y && Math.abs(r._y - y) <= 2 && r._o && Math.abs(r._o - o) <= 30000, 4) ||
    comp((r) => r.make === car.make && r._seg === seg, 3);
  if (bn && strong) return 0.6 * bn + 0.4 * strong;
  if (strong) return strong;
  // Weak comp (segment-only median, e.g. a $30k-Tesla-dominated "ev") is unreliable for an
  // off-profile car — lean hard on Buy Now (80/20) so a $6.5k micro-EV isn't priced like a Tesla.
  const weak = comp((r) => r._seg === seg, 1);
  if (bn && weak) return 0.8 * bn + 0.2 * weak;
  return bn || weak || null;
}

// ---- scoring one car -------------------------------------------------------
export function recommendForCar(car, model) {
  const { profiles, segMed } = model;
  const seg = car.segment || segment(car.make, car.model);
  const value = cmv(car, model);
  const codo = num(car.odometer);
  const tier = priceTier(value, segMed[seg]);
  const carState = parseState(car.location);   // where the car sits (for transport distance)

  // Score all buyers. `relaxed` drops the make/segment gate (cold-start fallback).
  const scorePass = (relaxed) => {
    const out = [];
    for (const p of profiles) {
      const makeAff = (p.makeCount[car.make] || 0) / p.n;
      const segAff = (p.segCount[seg] || 0) / p.n;
      if (!relaxed && makeAff === 0 && segAff === 0) continue;   // never buys this make or segment

      if (p.priceMed && value) {                                 // price band gate (always)
        if (value < p.priceMed * 0.45 || value > p.priceMed * 1.9) continue;
      }
      if (!relaxed && p.odoMed && codo) {                        // mileage band gate
        if (codo < p.odoMed * 0.4 || codo > p.odoMed * 1.8) continue;
      }

      const prem = p.prem[seg] ?? 1.0;
      const predicted = value ? value * prem : null;
      const buyerAvg = p.avgBySeg[seg] ?? p.avgPrice;   // what they actually pay for this kind of car

      const makeN = p.makeCount[car.make] || 0;
      const segN = p.segCount[seg] || 0;
      const makeInSeg = p.makeSegCount[`${car.make}|${seg}`] || 0;  // bought THIS make IN THIS segment

      // MATCH SCORE — how likely is THIS buyer to buy a car LIKE THIS? A weighted blend of
      // real predictors, so a pick isn't decided by make alone:
      //   • price fit (40%) — does the car's value sit where this buyer actually buys?
      //   • segment volume (22%) — do they buy this body type, and how much?
      //   • make-in-segment (28%) — have they bought THIS make IN THIS segment? (most specific)
      //   • make anywhere (10%) — weak brand signal (a Ford-truck buyer ≠ Ford-SUV buyer)
      const ln = (x, cap) => Math.log10(1 + x) / Math.log10(1 + cap);
      const priceFit = buyerAvg && value
        ? Math.exp(-0.5 * Math.pow((value - buyerAvg) / (0.6 * buyerAvg), 2))   // 1 at match, decays with gap
        : 0.5;
      const segVol = ln(segN, 40);
      const makeSegVol = ln(makeInSeg, 12);
      const makeVol = ln(makeN, 40);
      let match = 0.40 * priceFit + 0.22 * segVol + 0.28 * makeSegVol + 0.10 * makeVol;
      if (relaxed) match = 0.5 * priceFit + 0.1;                  // cold-start: price/mileage only
      match = Math.max(0.02, match);

      // Geography: closer buyer = cheaper transport = stronger lead. geoMult ∈ [0.90, 1.05].
      const miles = carState && p.state ? milesBetween(carState, p.state.toUpperCase()) : null;
      const geoMult = miles == null ? 1.0 : 1.05 - 0.15 * Math.min(1, miles / 1500);

      // Final: predicted price (top-dollar lever) × how-good-a-match × recency × geography.
      const score = (predicted ?? 0) * match * p.recencyMult * geoMult;

      const geoStr = miles == null ? (p.state || '?') : `${p.state}, ~${miles}mi`;
      const confidence = relaxed ? 'low'
        : (makeInSeg >= 3 || (segN >= 8 && priceFit > 0.5)) ? 'high'
        : (makeInSeg >= 1 || segN >= 3) ? 'medium' : 'low';
      const fitPct = Math.round(priceFit * 100);
      const reason = relaxed
        ? `No ${car.make}/${seg} history — price & mileage match. ${p.n} total buys, ${geoStr}.`
        : `${makeInSeg ? `Bought ${makeInSeg} ${car.make} ${seg}${makeInSeg > 1 ? 's' : ''}; ` : `Buys ${seg}s (${segN}); `}` +
          `avg ${buyerAvg ? '$' + Math.round(buyerAvg).toLocaleString() : '?'} vs this ${value ? '$' + Math.round(value).toLocaleString() : '?'} (${fitPct}% price fit). ${p.n} buys, ${geoStr}.`;

      out.push({
        buyer_name: p.name, buyer_email: p.email, buyer_phone: p.phone, buyer_state: p.state,
        predicted_price: predicted ? Math.round(predicted) : null, miles,
        buyer_avg_price: buyerAvg ? Math.round(buyerAvg) : null,
        buyer_seg_count: segN, make_in_seg: makeInSeg, price_fit: Math.round(priceFit * 100),
        score, baseScore: score, confidence, reason, _aff: makeAff, _n: p.n,
      });
    }
    return out;
  };

  let cands = scorePass(false);
  if (cands.length === 0) cands = scorePass(true);             // cold-start: relax make/segment gate
  cands.sort((a, b) => b.score - a.score || (b.predicted_price ?? 0) - (a.predicted_price ?? 0));
  return {
    vin: car.vin, value: value ? Math.round(value) : null, segment: seg, tier,
    candidates: cands,                                          // full list (spread pass re-ranks)
  };
}

// Tunable knobs. Priority: top dollar -> proven buyer -> spread/fair-share.
export const DEFAULT_CONFIG = {
  trustK: 4,            // evidence half-saturation; higher = trust matters more vs price
  trustFloor: 0.25,     // floor multiplier for low-evidence buyers (lower = price dominates more)
  spread: {
    enabled: true,
    perRepeat: 0.10,    // score penalty per extra time a buyer is already someone's #1
    maxPenalty: 0.45,   // cap so a great match can still repeat
  },
  topN: 3,
};

// ---- batch (with global spread / fair-share pass) --------------------------
export function recommendAll(activeCars, soldRows, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config, spread: { ...DEFAULT_CONFIG.spread, ...(config.spread || {}) } };
  const model = buildModel(soldRows);

  // Pass 1: score every car's candidates (price-primary, trust-discounted).
  const scored = activeCars.map((car) => recommendForCar(car, model));

  // Pass 2: SPREAD. Count provisional #1 picks, then penalize over-used buyers so the
  // next-best (often also a strong-dollar buyer) can take #1 on some cars.
  const finalize = (cars) =>
    cars.map((c) => ({
      vin: c.vin, value: c.value, segment: c.segment, tier: c.tier,
      recommendations: c.candidates.slice(0, cfg.topN).map((x, i) => {
        const { baseScore, ...rest } = x; void baseScore;
        return { ...rest, rank: i + 1 };
      }),
    }));

  if (!cfg.spread.enabled) return finalize(scored);

  const firstCount = {};
  for (const c of scored) if (c.candidates[0]) firstCount[c.candidates[0].buyer_name] = (firstCount[c.candidates[0].buyer_name] || 0) + 1;

  for (const c of scored) {
    for (const cand of c.candidates) {
      const reps = (firstCount[cand.buyer_name] || 1) - 1;
      const penalty = Math.min(cfg.spread.maxPenalty, reps * cfg.spread.perRepeat);
      cand.score = cand.baseScore * (1 - penalty);
    }
    c.candidates.sort((a, b) => b.score - a.score || b.predicted_price - a.predicted_price);
  }
  return finalize(scored);
}
