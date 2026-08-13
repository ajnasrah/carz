// Link previews for /marketplace/<id>.
//
// A texted listing link came through as a bare "Carz Inc IMS · carzinc.ai" card
// with the app icon, because the app is a single-page bundle: every route is
// served the same index.html, whose <head> says "Carz Inc IMS" and nothing else.
// iMessage, WhatsApp and the rest read the HTML they are served and never run
// the JavaScript, so no amount of client-side <title> setting reaches them.
//
// So this route is served by a function instead. It fetches the very same
// index.html the app is built to, injects the car's own OG tags into the head,
// and returns it. There is no cloaking and no second code path: a person gets
// the normal app (React takes over the moment it boots), a crawler gets the
// tags, and both get identical HTML.
//
// It fails open on purpose. Supabase down, a bad id, a listing that no longer
// exists — the page still renders, just with the generic card it had before.
// A preview is a nicety; the link itself has to work.
//
// Env (Vercel): SUPABASE_URL, VITE_SUPABASE_ANON_KEY (the anon key is public —
// it ships in the web bundle — and RLS still applies to it).

export const config = { runtime: 'edge' };

const SITE = 'https://www.carzinc.ai';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

async function sb(path, body) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) return null;
  return res.json();
}

// The cover photo, chosen by the same rules the marketplace card uses: an
// admin's chosen order wins, then the standard corner shots, then whatever is
// left — and a photo an admin removed is never the one a buyer sees first.
function coverPhoto(checklist, edit) {
  const photos = checklist?.photos || {};
  const urlOf = (p) => (typeof p === 'string' ? p : p?.url) || null;
  const hidden = new Set(edit?.hidden || []);

  const present = new Set(Object.values(photos).map(urlOf).filter(Boolean));
  const chosen = (edit?.ordering || []).find((u) => present.has(u) && !hidden.has(u));
  if (chosen) return chosen;

  for (const slot of ['driver_front_corner', 'pass_front_corner', 'driver_rear_corner', 'pass_rear_corner']) {
    const url = urlOf(photos[slot]);
    if (url && !hidden.has(url)) return url;
  }
  for (const p of Object.values(photos)) {
    const url = urlOf(p);
    if (url && !hidden.has(url)) return url;
  }
  return null;
}

// Deliberately the same facts the shared message carries, and deliberately no
// others: this RPC also returns total_cost and days_on_lot, which are ours and
// have no business in a card that renders in a stranger's group chat.
function describe(car) {
  const bits = [];
  const miles = Number(String(car.mileage ?? '').replace(/[^0-9]/g, ''));
  if (Number.isFinite(miles) && miles > 0) bits.push(`${miles.toLocaleString()} mi`);
  const price = Number(car.buy_now);
  if (Number.isFinite(price) && price > 0) bits.push(`$${Math.round(price).toLocaleString()}`);
  if (car.vehicle_color) bits.push(String(car.vehicle_color).toLowerCase());
  const vin = car.full_vin || car.vin;
  if (vin) bits.push(`VIN ${vin}`);
  return bits.join(' · ');
}

export default async function handler(request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id') || '';

  // Whatever happens below, the app itself must still be served.
  const shellRes = await fetch(new URL('/index.html', url.origin), {
    headers: { 'x-og-shell': '1' },
  });
  const shell = await shellRes.text();
  const passthrough = () =>
    new Response(shell, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, s-maxage=60' },
    });

  if (!UUID.test(id)) return passthrough();

  let car = null;
  try {
    const rows = await sb('rpc/marketplace_listing_detail', { listing_id: id });
    car = Array.isArray(rows) ? rows[0] : rows;
  } catch { /* fall through to the generic card */ }
  if (!car) return passthrough();

  let edit = null;
  try {
    const vin = car.full_vin || car.vin;
    if (vin) {
      const rows = await sb(`listing_photo_edits?select=hidden,ordering&vin=eq.${encodeURIComponent(vin.toUpperCase())}`);
      edit = Array.isArray(rows) ? rows[0] : null;
    }
  } catch { /* an unreachable overlay must not cost us the preview */ }

  const name = [car.year, car.make, car.model].filter(Boolean).join(' ') || 'Vehicle';
  const desc = describe(car);
  const image = coverPhoto(car.checklist, edit);
  const canonical = `${SITE}/marketplace/${id}`;

  const tags = [
    `<title>${esc(name)} — Carz Inc</title>`,
    `<meta name="description" content="${esc(desc)}" />`,
    `<link rel="canonical" href="${esc(canonical)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Carz Inc" />`,
    `<meta property="og:title" content="${esc(name)}" />`,
    `<meta property="og:description" content="${esc(desc)}" />`,
    `<meta property="og:url" content="${esc(canonical)}" />`,
    // summary_large_image is what turns the little corner thumbnail into the
    // full-width photo card people actually stop scrolling for.
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${esc(name)}" />`,
    `<meta name="twitter:description" content="${esc(desc)}" />`,
  ];
  if (image) {
    tags.push(`<meta property="og:image" content="${esc(image)}" />`);
    tags.push(`<meta property="og:image:alt" content="${esc(name)}" />`);
    tags.push(`<meta name="twitter:image" content="${esc(image)}" />`);
  }

  // Replace the shell's own <title> so there is exactly one, then hang the rest
  // off </head>.
  const html = shell
    .replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace('</head>', `${tags.join('\n    ')}\n  </head>`);

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Crawlers re-fetch; buyers share the same link repeatedly. Cache at the
      // edge so a popular car isn't a database hit per preview.
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=86400',
    },
  });
}
