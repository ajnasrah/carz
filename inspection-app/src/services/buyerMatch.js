// Buyer-Match Engine
// Ranks buyers for cars and cars for buyers, across every channel we sell
// through — not just SmartAuction.
//
// WHAT CHANGED AND WHY (2026-08-20 rewrite)
// The previous engine trained on sa_sold_sales alone (1,236 rows, 100%
// SmartAuction) and scored with a hand-tuned blend of price fit, segment volume
// and make affinity behind hard price/mileage gates. Backtested walk-forward over
// the last 180 days of real sales it hit 30.2% at top-3 — against 33.5% for
// "sort buyers by how many cars they bought in the last 90 days". It lost to a
// GROUP BY. Three things were actually wrong, and none of them were the formula:
//
//   1. It could only see one channel. UAX, DAA, ADESA, Manheim, ACV, OpenLane,
//      our Jackson store and every direct dealer sale were invisible — roughly
//      five sixths of the business. Training now comes from buyer_training_rows(),
//      which unions all of it: 6,088 sales, 654 buyers.
//   2. It identified buyers by the raw name string while every other screen used
//      phone -> email -> name, so one dealer group's nine rooftops were nine
//      separate small buyers. Profiles are keyed on buyer_key now.
//   3. The hard gates eliminated the buyer who actually bought the car in 24% of
//      backtested sales. They are soft penalties now.
//
// Recency is the strongest single signal in the data, so it is weighted properly
// (exponential decay on every count) rather than applied as a 0.85–1.00 nudge at
// the end. And the score is computed as a full car x buyer matrix, so "the best
// cars for this buyer" is its own ranking rather than a by-product of slicing
// each car's list to three.

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
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export function segment(make, model) {
  const s = `${make ?? ''} ${model ?? ''}`.toLowerCase();
  const has = (arr) => arr.some((k) => s.includes(k));
  if (has(['transit','express','promaster','sienna','odyssey','carnival','pacifica','caravan','sprinter','metris','savana','econoline','town & country','voyager','sedona','quest','nv200','nv1500','nv2500','nv3500'])) return 'van';
  if (has(['silverado','sierra','f-150','f150','f-250','f250','f-350','f350','f-450','f450','ram 1500','ram 2500','tundra','tacoma','ranger','colorado','canyon','frontier','titan','ridgeline','gladiator','maverick','super duty','avalanche','dakota','santa cruz','1500','2500','3500'])) return 'truck';
  if (has(['tesla','model 3','mach-e','ev6','id.4','lyriq','mullen','ioniq','bolt','leaf'])) return 'ev';
  if (has(['tahoe','suburban','yukon','expedition','explorer','escape','equinox','traverse','blazer','pilot','highlande','4runner','rav4','cr-v','crv','rogue','pathfinder','murano','telluride','palisade','santa fe','sorento','wrangler','grand cherokee','cherokee','compass','renegade','bronco','edge','nautilus','cx-9','cx-5','outlander','ascent','atlas','tiguan','durango','acadia','enclave','escalade','navigator','gx','rx','kona','tucson','seltos','encore','trailblazer','envision','corsair','aviator','terrain','kicks','trax','armada','outback','soul','sportage','forester','journey','crosstrek','hr-v','hrv','mkc','mkx','mdx','rdx','qx50','qx55','qx60','qx80','xt4','xt5','xt6','gv70','gv80','glc','gle','gls','glb','gla','g-class','c-hr','defender','sequoia','wagoneer','patriot','flex','range rover','juke','cx-3','cx-30','cx-50','cx-90','fj cruiser','xc40','xc60','xc90','ecosport','envista','eclipse cross','cayenne','ariya','passport','hornet','niro','taos','venza','discovery','xterra','touareg','e-pace','f-pace','hummer','grenadier','corolla cross',' q3',' q5',' q7',' q8',' x3',' x4',' x5',' x6',' x7',' nx'])) return 'suv';
  return 'car';
}

// The model a car actually is, not just its make and body style. "JEEP suv" put
// a Wrangler Rubicon in front of a dealer whose four Jeeps were all Cherokees —
// same make, same segment, a completely different vehicle and a different buyer.
// Trim words are dropped ("WRANGLER UNLIMI" -> WRANGLER) but genuinely distinct
// two-word nameplates are kept whole (GRAND CHEROKEE is not a CHEROKEE).
const TWO_WORD_HEAD = new Set(['GRAND', 'SUPER', 'SANTA', 'MODEL', 'LAND', 'RANGE', 'GRAN', 'TOWN', 'SANTA']);
export function modelFamily(make, model) {
  // Join the hyphen in F-150 / CX-5 / MACH-E rather than splitting on it, or
  // every Ford truck collapses into a family called "F".
  const s = String(model ?? '').toUpperCase()
    .replace(/([A-Z])[-/]([0-9A-Z])/g, '$1$2')
    .replace(/[^A-Z0-9]+/g, ' ').trim();
  const mk = String(make ?? '').toUpperCase().trim();
  if (!s) return mk ? `${mk}|?` : null;
  const t = s.split(' ');
  const fam = TWO_WORD_HEAD.has(t[0]) && t[1] ? `${t[0]} ${t[1]}` : t[0];
  return `${mk}|${fam}`;
}

// Stable buyer identity — phone, then email, then name. MUST mirror
// buyer_training_rows() in SQL and buyerKey() in buyerTrends.js, or one dealer
// becomes two buyers depending on which screen you are looking at.
export function buyerKeyOf(r) {
  if (r.buyer_key) return r.buyer_key;
  const digits = String(r.buyer_phone || '').replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (ten.length === 10) return `p:${ten}`;
  const email = String(r.buyer_email || '').trim().toLowerCase();
  if (email.includes('@') && email.length > 3) return `e:${email}`;
  const name = String(r.buyer_name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return name ? `n:${name}` : null;
}

// US state centroids for a rough transport-distance signal. Approximate is fine —
// only relative proximity matters.
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

// Sale date (ISO or MM/DD/YYYY) to epoch-days. Null if unparseable.
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

function priceTier(price, segMedian) {
  if (!price || !segMedian) return 'mid';
  const r = price / segMedian;
  if (r < 0.7) return 'low';
  if (r > 1.4) return 'high';
  return 'mid';
}

// ---- tunables --------------------------------------------------------------
export const DEFAULT_CONFIG = {
  // Days for a purchase's evidence to lose half its weight. Swept {60, 90, 120,
  // 180, 270} x dollarWeight {0,1,2,3} walk-forward over the last 180 days:
  // 60 is clearly best for the nameable call list (top-1 21.9% / top-3 34.5%,
  // against 19.6% / 29.5% at 270) and within noise of the best on the combined
  // ladder. Who is buying RIGHT NOW is the strongest signal in this data.
  halfLife: 60,
  // How hard the score chases the buyer who pays the most, over the buyer most
  // likely to buy at all — the premium (typically 0.8–1.2) raised to this power.
  // The owner's stated priority is top dollar first, and 1 is where that stops
  // being free: at 2 the call list gains ~0.4pp at top-3 but the full ladder
  // loses 1.8pp at top-1, and at 3 everything degrades sharply.
  dollarWeight: 1,
  // Shape of the soft penalties that replaced the old hard gates.
  priceSigma: 0.55,    // lognormal width around what a buyer actually pays
  odoSigma: 0.70,
  odoFloor: 0.40,      // worst a mileage mismatch can cost, rather than exclusion
  // Recent browsing (listing_events) counts for something, but never more than
  // a real purchase history.
  demandBoost: 0.35,
  // Strength of the pull toward the market's own mix when a buyer has barely any
  // history. Without it a customer who bought exactly one sedan reads as a pure
  // sedan specialist and outranks a dealer who has bought forty — the classic
  // small-sample lift problem, and it put a one-purchase retail walk-in second on
  // the call list. Roughly "pretend we also saw this buyer make `shrink` average
  // purchases".
  shrink: 8,
  // Weight on the exact nameplate, over and above make x body style.
  //
  // ZERO ON PURPOSE, and this is the measurement rather than an opinion. It looks
  // obviously right that a dealer with four Cherokees and no Wranglers should not
  // be pitched a Wrangler, so it was swept walk-forward over the last 180 days of
  // real sales (26 weekly folds, 1,057 sales, named buyers ranked among named
  // buyers) — and every non-zero value is worse, monotonically:
  //
  //   modelWeight   top-1    top-3    top-10
  //   0             18.3%    28.2%    40.2%
  //   0.15          18.1%    26.6%    39.8%
  //   0.30          16.9%    25.0%    38.9%
  //   0.50          14.6%    23.1%    36.6%
  //
  // Dealers buy a body style at a price point, not a nameplate: the Cherokee
  // buyer's next unit is an Equinox or a Rogue about as often as it is another
  // Cherokee, and paying for nameplate agreement costs real hit rate. What the
  // nameplate IS good for is telling the truth about the match — see the reason
  // string and `confidence` in scoreCar, which both read the nameplate count and
  // neither of which touches the ranking. Re-run the sweep with ?bmdebug=1
  // before changing this.
  modelWeight: 0,
  // Every channel also gets a lane profile, not just the ones we have no buyer
  // names for. Carz Jackson sells 229 cars a year to 196 walk-ins, 89% of whom
  // buy exactly once — so no individual ever ranked, and the store appeared
  // nowhere on this screen at all. A rooftop is a place to send a car whether or
  // not we know who signs for it.
  laneForEveryChannel: true,
  // A car only appears in a buyer's list if he is among the top N buyers for it.
  // Without a floor every buyer gets a full dozen cars and the list means
  // nothing; at 25 it is still ~8x more generous than the old top-3.
  maxBuyerRankForCar: 25,
  spread: {
    enabled: true,
    perRepeat: 0.10,   // penalty per extra time a buyer is already someone's #1
    maxPenalty: 0.45,
  },
  // Auction lanes (UAX, DAA, ADESA...) are one customer each until we can upload
  // their buyer lists. They take enormous volume, so mixing them into the call
  // list would bury every nameable buyer. They get their own list instead.
  separateChannels: true,
  topN: 3,             // buyers shown per car
  topLanes: 5,         // channels shown per car
  topCars: 12,         // cars shown per buyer
};

// ---- profile building ------------------------------------------------------
// rows: buyer_training_rows() output, or raw sa_sold_sales rows (buyer_key is
// derived when absent, so both shapes work).
export function buildModel(sold, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const rows = sold.map((r) => ({
    ...r,
    _p: num(r.sale_price), _o: num(r.odometer), _y: num(r.year),
    _seg: r.segment || segment(r.make, r.model),
    _fam: modelFamily(r.make, r.model),
    _d: dateNum(r.sale_date),
    _key: buyerKeyOf(r),
  })).filter((r) => r._key);

  const maxDate = Math.max(...rows.map((r) => r._d).filter((x) => x != null), 0);
  // Every count in this model is recency-weighted: a sale from last week is worth
  // a full unit, one from four months ago about half. This is the single change
  // that made the biggest difference in backtesting.
  const weightOf = (r) => (r._d == null ? 0.25 : Math.pow(0.5, (maxDate - r._d) / cfg.halfLife));

  const segMed = {};
  for (const seg of new Set(rows.map((r) => r._seg))) {
    segMed[seg] = median(rows.filter((r) => r._seg === seg).map((r) => r._p)) || 0;
  }
  // A premium measured against the whole segment says "this buyer buys dearer
  // cars", not "this buyer pays over the odds". Every high-volume dealer then
  // pins to the 1.2 cap and predicted_price stops telling them apart — three
  // different buyers came back with the identical figure on a $37k Genesis whose
  // segment median is $15k. Bucketing by price tier compares like with like.
  for (const r of rows) r._tier = priceTier(r._p, segMed[r._seg]);
  const segTierMed = {};
  for (const r of rows) {
    const k = `${r._seg}|${r._tier}`;
    (segTierMed[k] ||= []).push(r._p);
  }
  for (const k of Object.keys(segTierMed)) segTierMed[k] = median(segTierMed[k]) || 0;

  const prof = new Map();
  let totalW = 0;
  const segW = {}, makeW = {}, famW = {};
  for (const r of rows) {
    const w = weightOf(r);
    totalW += w;
    segW[r._seg] = (segW[r._seg] || 0) + w;
    makeW[r.make] = (makeW[r.make] || 0) + w;
    if (r._fam) famW[r._fam] = (famW[r._fam] || 0) + w;

    let p = prof.get(r._key);
    if (!p) {
      p = {
        key: r._key, name: (r.buyer_name || '').trim(), cars: [],
        w: 0, n: 0, segW: {}, makeW: {}, makeSegW: {}, famW: {}, famN: {},
        channel_key: r.channel_key || 'smartauction',
        channel_label: r.channel_label || null,
        is_channel: r._key.startsWith('c:'),
        email: null, phone: null, state: null, city: null,
      };
      prof.set(r._key, p);
    }
    p.cars.push(r);
    p.w += w; p.n += 1;
    p.segW[r._seg] = (p.segW[r._seg] || 0) + w;
    p.makeW[r.make] = (p.makeW[r.make] || 0) + w;
    p.makeSegW[`${r.make}|${r._seg}`] = (p.makeSegW[`${r.make}|${r._seg}`] || 0) + w;
    if (r._fam) { p.famW[r._fam] = (p.famW[r._fam] || 0) + w; p.famN[r._fam] = (p.famN[r._fam] || 0) + 1; }
    // Keep the newest non-empty contact details and the newest spelling of the name.
    p.email = r.buyer_email || p.email;
    p.phone = r.buyer_phone || p.phone;
    p.state = r.buyer_state || p.state;
    p.city = r.buyer_city || p.city;
    if (r.buyer_name) p.name = String(r.buyer_name).trim();
  }

  // Every channel is also a lane, not only the ones whose buyers we never learn.
  // Where we DO know the names — Carz Jackson, Direct, SmartAuction — the rows
  // stay attached to those buyers as well; this adds the rooftop itself as a
  // place a car can go. Without it Carz Jackson was invisible: 229 sales to 196
  // walk-ins, 89% of them one-time, so no individual ever cleared the ranking
  // floor and the store never appeared on this screen in any form.
  //
  // Built AFTER the loop above on purpose: these profiles must not contribute to
  // segBase/makeBase/famBase, or the same sale would be counted twice in the
  // market mix every lift is measured against.
  if (cfg.laneForEveryChannel) {
    const byChannel = new Map();
    for (const r of rows) {
      if (String(r._key).startsWith('c:')) continue;   // already its own lane
      const ck = r.channel_key || 'smartauction';
      let g = byChannel.get(ck);
      if (!g) { g = []; byChannel.set(ck, g); }
      g.push(r);
    }
    for (const [ck, chRows] of byChannel) {
      const key = `c:${ck}`;
      if (prof.has(key)) continue;
      const p = {
        key, name: chRows[0].channel_label || ck, cars: chRows,
        w: 0, n: chRows.length, segW: {}, makeW: {}, makeSegW: {}, famW: {}, famN: {},
        channel_key: ck, channel_label: chRows[0].channel_label || ck,
        is_channel: true, email: null, phone: null, state: null, city: null,
      };
      for (const r of chRows) {
        const w = weightOf(r);
        p.w += w;
        p.segW[r._seg] = (p.segW[r._seg] || 0) + w;
        p.makeW[r.make] = (p.makeW[r.make] || 0) + w;
        p.makeSegW[`${r.make}|${r._seg}`] = (p.makeSegW[`${r.make}|${r._seg}`] || 0) + w;
        if (r._fam) { p.famW[r._fam] = (p.famW[r._fam] || 0) + w; p.famN[r._fam] = (p.famN[r._fam] || 0) + 1; }
        p.state = r.buyer_state || p.state;
      }
      prof.set(key, p);
    }
  }

  const SHRINK = 3;
  const PREM_LO = 0.8, PREM_HI = 1.2;
  for (const p of prof.values()) {
    p.prices = p.cars.map((c) => c._p).filter((x) => x != null);
    p.odos = p.cars.map((c) => c._o).filter((x) => x != null);
    p.priceMed = median(p.prices);
    p.odoMed = median(p.odos);
    p.avgPrice = p.prices.length ? p.prices.reduce((a, b) => a + b, 0) / p.prices.length : null;
    const lastSale = Math.max(...p.cars.map((c) => c._d).filter((x) => x != null), 0);
    p.lastSale = lastSale || null;
    p.daysSince = lastSale ? Math.max(0, maxDate - lastSale) : null;
    p.share = totalW ? p.w / totalW : 0;
    // Channels shown as one customer keep their label as the display name.
    if (p.is_channel && !p.name) p.name = p.channel_label || p.key.slice(2);

    p.prem = {}; p.premTier = {}; p.avgBySeg = {}; p.medBySeg = {}; p.medByTier = {};
    const segP = {}, tierP = {};
    for (const c of p.cars) {
      if (c._p == null) continue;
      (segP[c._seg] ||= []).push(c._p);
      (tierP[`${c._seg}|${c._tier}`] ||= []).push(c._p);
    }
    const shrinkTo1 = (ps, base) => {
      const raw = base ? median(ps) / base : 1;
      return clamp((ps.length * raw + SHRINK * 1.0) / (ps.length + SHRINK), PREM_LO, PREM_HI);
    };
    for (const [seg, ps] of Object.entries(segP)) {
      p.prem[seg] = shrinkTo1(ps, segMed[seg] || median(ps));
      p.avgBySeg[seg] = ps.reduce((a, b) => a + b, 0) / ps.length;
      p.medBySeg[seg] = median(ps);
    }
    for (const [k, ps] of Object.entries(tierP)) {
      p.premTier[k] = shrinkTo1(ps, segTierMed[k] || median(ps));
      p.medByTier[k] = median(ps);
    }
  }

  return {
    rows, profiles: [...prof.values()], segMed, maxDate, totalW,
    segTierMed,
    segBase: Object.fromEntries(Object.entries(segW).map(([k, v]) => [k, totalW ? v / totalW : 0])),
    famBase: Object.fromEntries(Object.entries(famW).map(([k, v]) => [k, totalW ? v / totalW : 0])),
    makeBase: Object.fromEntries(Object.entries(makeW).map(([k, v]) => [k, totalW ? v / totalW : 0])),
    cfg,
  };
}

// Comparable Market Value: blend the car's own ask with the median of comparable
// sales. SmartAuction leaves Buy Now empty and fills Opening Price, and the
// marketplace RPC returns whichever it has as buy_now, so read all three.
function cmv(car, model) {
  const { rows } = model;
  const seg = car.segment || segment(car.make, car.model);
  const y = num(car.year), o = num(car.odometer);
  const bn = num(car.buy_now) ?? num(car.opening_price) ?? num(car.price);
  const inBand = (r) => !bn || (r._p >= bn * 0.5 && r._p <= bn * 2);
  const comp = (pred, minN) => {
    const c = rows.filter((r) => r._p && inBand(r) && pred(r)).map((r) => r._p);
    return c.length >= minN ? median(c) : null;
  };
  const strong =
    comp((r) => r.make === car.make && r._seg === seg && r._y && Math.abs(r._y - y) <= 2 && r._o && Math.abs(r._o - o) <= 25000, 3) ||
    comp((r) => r._seg === seg && r._y && Math.abs(r._y - y) <= 2 && r._o && Math.abs(r._o - o) <= 30000, 4) ||
    comp((r) => r.make === car.make && r._seg === seg, 3);
  if (bn && strong) return 0.6 * bn + 0.4 * strong;
  if (strong) return strong;
  // A segment-only median is unreliable for an off-profile car (a $6.5k micro-EV
  // against a Tesla-dominated "ev"), so lean hard on the ask.
  const weak = comp((r) => r._seg === seg, 1);
  if (bn && weak) return 0.8 * bn + 0.2 * weak;
  return bn || weak || null;
}

// ---- scoring one car against every buyer -----------------------------------
export function scoreCar(car, model, demand) {
  const { profiles, segMed, segBase, makeBase, famBase, cfg } = model;
  const seg = car.segment || segment(car.make, car.model);
  const fam = modelFamily(car.make, car.model);
  const value = cmv(car, model);
  const codo = num(car.odometer);
  const tier = priceTier(value, segMed[seg]);
  const carState = parseState(car.location);

  const out = [];
  for (const p of profiles) {
    // --- how much does this buyer buy, lately ---
    // sqrt so a lane with 1,400 purchases does not simply outrank everyone on
    // volume alone, while still counting for more than a one-car buyer.
    const volume = Math.sqrt(p.w);

    // --- does he buy this body style / this make in this body style ---
    // Lift, not share: "this buyer skews toward trucks compared with the market"
    // survives the fact that most of what we sell is trucks and SUVs. Shrunk
    // toward the market mix by `shrink` pseudo-purchases, so a thin history
    // cannot manufacture a specialist.
    const K = cfg.shrink;
    const segRate = Math.max(segBase[seg] || 0.01, 0.01);
    const segShare = ((p.segW[seg] || 0) + K * segRate) / (p.w + K);
    const segLift = segShare / segRate;
    const msRate = Math.max((makeBase[car.make] || 0) * segRate, 0.002);
    const msShare = ((p.makeSegW[`${car.make}|${seg}`] || 0) + K * msRate) / (p.w + K);
    const msLift = msShare / msRate;
    // --- and does he buy THIS nameplate ---
    // Same lift-and-shrink shape one level finer. A dealer with four Cherokees
    // and no Wranglers reads as a Jeep-SUV buyer without this, and got pitched a
    // Wrangler Rubicon on that basis.
    const famRate = fam ? Math.max((famBase[fam] || 0), 0.0008) : null;
    const famShare = fam ? (((p.famW[fam] || 0) + K * famRate) / (p.w + K)) : null;
    const famLift = fam ? famShare / famRate : 1;

    // --- does the money line up ---
    // Prefer what he pays for cars in THIS price bracket of THIS segment; fall
    // back up the hierarchy when the bracket is thin.
    const buyerAvg = p.medByTier[`${seg}|${tier}`] ?? p.medBySeg[seg] ?? p.avgBySeg[seg] ?? p.priceMed;
    let priceFit = 0.5;
    if (buyerAvg && value) {
      const lr = Math.log(value / buyerAvg);
      priceFit = Math.exp(-0.5 * (lr / cfg.priceSigma) ** 2);
    }
    // Mileage used to be a hard gate that excluded the true buyer in a quarter of
    // backtested sales. It is a penalty now, floored so it can never eliminate.
    let odoFit = 1;
    if (p.odoMed && codo) {
      const lr = Math.log(codo / Math.max(p.odoMed, 1));
      odoFit = cfg.odoFloor + (1 - cfg.odoFloor) * Math.exp(-0.5 * (lr / cfg.odoSigma) ** 2);
    }

    // --- has he been looking at cars like this on the marketplace ---
    const d = demand?.get(p.key);
    const looked = d ? (d.byMake.get(String(car.make || '').toUpperCase()) || 0) + (d.bySegment.get(seg) || 0) : 0;
    const demandMult = 1 + cfg.demandBoost * Math.min(1, looked / 3);

    // --- transport ---
    const miles = carState && p.state ? milesBetween(carState, String(p.state).toUpperCase()) : null;
    const geoMult = miles == null ? 1.0 : 1.05 - 0.15 * Math.min(1, miles / 1500);

    const prem = p.premTier[`${seg}|${tier}`] ?? p.prem[seg] ?? 1.0;
    const predicted = value ? value * prem : null;

    const likelihood = volume
      * Math.pow(Math.max(segLift, 0.05), 0.7)
      * Math.pow(Math.max(msLift, 0.05), 0.35)
      * Math.pow(Math.max(famLift, 0.05), cfg.modelWeight)
      * Math.max(priceFit, 0.02)
      * odoFit * demandMult * geoMult;
    // Top dollar first, then proven buyer — the owner's stated priority.
    const score = likelihood * Math.pow(prem, cfg.dollarWeight);

    const segN = p.cars.filter((c) => c._seg === seg).length;
    const makeInSeg = p.cars.filter((c) => c._seg === seg && c.make === car.make).length;
    const nameplateN = fam ? (p.famN[fam] || 0) : 0;
    // "High" used to mean three of the same make in the same body style, which is
    // how four Cherokees certified a Wrangler Rubicon as a high-confidence match.
    // The badge does not move the ranking, so it can afford to be strict: high
    // means we have actually watched this buyer take this nameplate.
    const confidence = p.is_channel
      ? (segN >= 20 ? 'high' : segN >= 5 ? 'medium' : 'low')
      : (nameplateN >= 2 || (nameplateN >= 1 && segN >= 5)) ? 'high'
        : (nameplateN >= 1 || makeInSeg >= 2 || (segN >= 3 && priceFit > 0.5)) ? 'medium' : 'low';

    const geoStr = miles == null ? (p.state || '—') : `${p.state}, ~${miles}mi`;
    const fresh = p.daysSince == null ? 'no dated buys' : p.daysSince <= 45 ? 'buying now' : `last bought ${p.daysSince}d ago`;
    // Say what he actually bought, at the nameplate. The old wording read
    // "Bought 4 JEEP suvs" under a Wrangler Rubicon when all four were Cherokees,
    // which is exactly the claim the number does not support.
    const plate = fam ? fam.split('|')[1] : null;
    const history = nameplateN
      ? `Bought ${nameplateN} ${car.make} ${plate}${nameplateN > 1 ? 's' : ''}`
      : makeInSeg
        ? `Buys ${car.make} ${seg}s (${makeInSeg}) but no ${plate || 'match'}`
        : `Buys ${seg}s (${segN}), no ${car.make}`;
    const reason = p.is_channel
      ? `${p.name} takes ${segN} ${seg}${segN === 1 ? '' : 's'} like this` +
        `${nameplateN ? ` (${nameplateN} ${plate})` : makeInSeg ? ` (${makeInSeg} ${car.make})` : ''}; ` +
        `typically ${buyerAvg ? '$' + Math.round(buyerAvg).toLocaleString() : '?'} vs this ${value ? '$' + Math.round(value).toLocaleString() : '?'}. ${fresh}.`
      : `${history}; ` +
        `avg ${buyerAvg ? '$' + Math.round(buyerAvg).toLocaleString() : '?'} vs this ${value ? '$' + Math.round(value).toLocaleString() : '?'} ` +
        `(${Math.round(priceFit * 100)}% price fit)${looked ? `, looked at ${looked} like it` : ''}. ${p.n} buys, ${fresh}, ${geoStr}.`;

    out.push({
      buyer_key: p.key, buyer_name: p.name, buyer_email: p.email, buyer_phone: p.phone,
      buyer_state: p.state, buyer_city: p.city,
      channel_key: p.channel_key, channel_label: p.channel_label, is_channel: p.is_channel,
      predicted_price: predicted ? Math.round(predicted) : null,
      buyer_avg_price: buyerAvg ? Math.round(buyerAvg) : null,
      buyer_seg_count: segN, make_in_seg: makeInSeg, nameplate_count: nameplateN,
      price_fit: Math.round(priceFit * 100), demand_views: looked,
      total_buys: p.n, days_since: p.daysSince, miles,
      score, baseScore: score, confidence, reason,
    });
  }
  out.sort((a, b) => b.score - a.score || (b.predicted_price ?? 0) - (a.predicted_price ?? 0));
  return {
    vin: car.vin, stock_number: car.stock_number ?? null,
    value: value ? Math.round(value) : null, segment: seg, tier,
    candidates: out,
  };
}

// Backwards-compatible name.
export const recommendForCar = scoreCar;

// Turn buyer_demand_signals() rows into a lookup the scorer can use.
export function buildDemandIndex(signalRows = []) {
  const m = new Map();
  for (const r of signalRows) {
    if (!r.buyer_key) continue;
    let d = m.get(r.buyer_key);
    if (!d) { d = { byMake: new Map(), bySegment: new Map() }; m.set(r.buyer_key, d); }
    const views = Number(r.views) || 1;
    const mk = String(r.make || '').toUpperCase();
    if (mk) d.byMake.set(mk, (d.byMake.get(mk) || 0) + views);
    if (r.segment) d.bySegment.set(r.segment, (d.bySegment.get(r.segment) || 0) + views);
  }
  return m;
}

// ---- the full matrix -------------------------------------------------------
// Everything below reads this one structure, so "top buyers for a car" and "top
// cars for a buyer" are two views of the same numbers rather than one derived
// from the other's leftovers.
export function scoreAll(activeCars, soldRows, config = {}, demandRows = []) {
  const cfg = {
    ...DEFAULT_CONFIG, ...config,
    spread: { ...DEFAULT_CONFIG.spread, ...(config.spread || {}) },
  };
  const model = buildModel(soldRows, cfg);
  const demand = buildDemandIndex(demandRows);
  const scored = activeCars.map((car) => scoreCar(car, model, demand));

  // SPREAD — count provisional #1 picks among nameable buyers and penalise
  // repeats, so the second-best (often also a strong-dollar buyer) can take the
  // top slot on some cars. Channels are exempt: a lane taking a hundred cars is
  // a fact about the lane, not hogging.
  if (cfg.spread.enabled) {
    const firstCount = {};
    for (const c of scored) {
      const first = c.candidates.find((x) => !x.is_channel);
      if (first) firstCount[first.buyer_key] = (firstCount[first.buyer_key] || 0) + 1;
    }
    for (const c of scored) {
      for (const cand of c.candidates) {
        if (cand.is_channel) { cand.score = cand.baseScore; continue; }
        const reps = (firstCount[cand.buyer_key] || 1) - 1;
        cand.score = cand.baseScore * (1 - Math.min(cfg.spread.maxPenalty, reps * cfg.spread.perRepeat));
      }
      c.candidates.sort((a, b) => b.score - a.score || (b.predicted_price ?? 0) - (a.predicted_price ?? 0));
    }
  }
  return { model, cfg, cars: scored };
}

// Per-car view: the buyers to call about this car, and separately the lanes that
// reliably take it.
export function recommendAll(activeCars, soldRows, config = {}, demandRows = []) {
  const { cfg, cars } = scoreAll(activeCars, soldRows, config, demandRows);
  const rank = (list) => list.map((x, i) => {
    const { baseScore, ...rest } = x; void baseScore;
    return { ...rest, rank: i + 1 };
  });
  return cars.map((c) => {
    const named = cfg.separateChannels ? c.candidates.filter((x) => !x.is_channel) : c.candidates;
    const lanes = cfg.separateChannels ? c.candidates.filter((x) => x.is_channel) : [];
    return {
      vin: c.vin, stock_number: c.stock_number, value: c.value, segment: c.segment, tier: c.tier,
      recommendations: rank(named.slice(0, cfg.topN)),
      channels: rank(lanes.slice(0, cfg.topLanes)),
      candidateCount: c.candidates.length,
    };
  });
}

// Per-buyer view: for EVERY buyer we know, the cars worth pitching him, ranked on
// his own scores. This is the direction calls are made in, and it is computed
// from the full matrix — a buyer who is a consistent fourth-best on eleven cars
// used to appear nowhere at all.
export function recommendForBuyers(activeCars, soldRows, config = {}, demandRows = []) {
  const { cfg, cars, model } = scoreAll(activeCars, soldRows, config, demandRows);
  const byVin = new Map(activeCars.map((c) => [c.vin, c]));
  const buyers = new Map();

  for (const c of cars) {
    // Rank each kind of candidate on its own ladder. A lane takes hundreds of
    // cars, so it heads almost every combined list — and "best fit" would then
    // mean "beat UAX", which no dealer ever does and which is not the question
    // anyway. A named buyer's position is among named buyers.
    const ladder = new Map();
    let namedSeen = 0, laneSeen = 0;
    for (const cand of c.candidates) {
      ladder.set(cand.buyer_key, cand.is_channel ? ++laneSeen : ++namedSeen);
    }
    c.candidates.forEach((cand) => {
      const i = ladder.get(cand.buyer_key) - 1;
      // Everyone scores against every car, so without a floor every buyer we have
      // ever met comes back holding a full dozen cars and the list says nothing.
      // Being in a car's top 25 is a real claim; being its 300th-best buyer is not.
      if (i >= cfg.maxBuyerRankForCar) return;
      let b = buyers.get(cand.buyer_key);
      if (!b) {
        b = {
          buyer_key: cand.buyer_key, buyer_name: cand.buyer_name,
          buyer_email: cand.buyer_email, buyer_phone: cand.buyer_phone,
          buyer_state: cand.buyer_state, buyer_city: cand.buyer_city,
          channel_key: cand.channel_key, channel_label: cand.channel_label,
          is_channel: cand.is_channel, total_buys: cand.total_buys,
          days_since: cand.days_since, cars: [],
        };
        buyers.set(cand.buyer_key, b);
      }
      b.cars.push({
        ...(byVin.get(c.vin) || {}),
        vin: c.vin, stock_number: c.stock_number, est_value: c.value,
        segment: c.segment, tier: c.tier,
        predicted_price: cand.predicted_price, score: cand.score,
        confidence: cand.confidence, reason: cand.reason,
        price_fit: cand.price_fit, demand_views: cand.demand_views,
        car_rank: i + 1,                    // his position among buyers for this car
      });
    });
  }

  const out = [];
  for (const b of buyers.values()) {
    if (!b.cars.length) continue;
    b.cars.sort((x, y) => y.score - x.score);
    b.cars = b.cars.slice(0, cfg.topCars).map((c, i) => ({ ...c, rank: i + 1 }));
    b.count = b.cars.length;
    b.top_pick_count = b.cars.filter((c) => c.car_rank === 1).length;
    b.total_predicted = b.cars.reduce((s, c) => s + (c.predicted_price || 0), 0);
    b.best_score = b.cars[0]?.score ?? 0;
    out.push(b);
  }
  // A buyer who is somebody's best shot at a car is worth calling before one who
  // merely fits a lot of them; after that, the strongest single match beats a
  // long weak list, so a thin-history buyer cannot climb on volume of near-misses.
  out.sort((a, b) =>
    b.top_pick_count - a.top_pick_count
    || b.best_score - a.best_score
    || b.count - a.count);
  return { buyers: out, cars, model };
}
