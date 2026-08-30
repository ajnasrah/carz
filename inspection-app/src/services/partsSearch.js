// What we hand a parts vendor: the car, then the part.
//
// This lives apart from the component because it is where a real bug hid. The
// search button was handed two different shapes by different screens — a board
// row straight from the database (vehicle_year / vehicle_make / vehicle_model)
// and a hand-built object (year / make / model) — and the component read only
// the second. On the body shop's parts list that produced a search for "Front
// passenger door" with no car attached: it looks like it worked, opens real
// results, and every one of them is for the wrong vehicle.
//
// Pure functions, so the behaviour is testable without a browser.

// Accept either shape. Anything a caller can reasonably pass, we read.
export function normalizeVehicle(vehicle) {
  if (!vehicle) return { year: null, make: null, model: null, trim: null, vin: '' }
  return {
    year:  vehicle.year  ?? vehicle.vehicle_year  ?? null,
    make:  vehicle.make  ?? vehicle.vehicle_make  ?? null,
    model: vehicle.model ?? vehicle.vehicle_model ?? null,
    trim:  vehicle.trim  ?? vehicle.vehicle_trim  ?? null,
    vin:   vehicle.vin   ?? vehicle.vehicle_vin   ?? '',
  }
}

// Year, make, model, then the part. Trim is doing real work — a row with no
// part text yet should search the car alone, not the car plus a trailing space.
export function buildQuery(car, term) {
  return [car?.year, car?.make, car?.model, term]
    .filter(Boolean)
    .join(' ')
    .trim()
}

export function carLabel(car) {
  return [car?.year, car?.make, car?.model].filter(Boolean).join(' ')
}

// eBay and Amazon take a plain keyword search in the URL, so they can open
// straight onto results for this car and this part — no account, no API.
//
// PartsTech and RepairLink are login-only shop/dealer portals whose catalogues
// sit behind auth and which take no useful search parameters, so the honest
// version is: open the site with the VIN on the clipboard, ready to paste into
// their own vehicle picker.
//
// Deliberately NOT using eBay's fitment parameters (_vhc / epid): they break
// constantly, and a wrong fitment link is worse than a keyword search because
// it looks authoritative while filtering out the part you actually wanted.
export const VENDORS = [
  {
    key: 'ebay',
    label: 'eBay',
    emoji: '🏷️',
    url: ({ q }) => `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}`,
  },
  {
    key: 'amazon',
    label: 'Amazon',
    emoji: '📦',
    url: ({ q }) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}`,
  },
  {
    key: 'partstech',
    label: 'PartsTech',
    emoji: '🔩',
    needsLogin: true,
    url: () => 'https://app.partstech.com/',
  },
  {
    key: 'repairlink',
    label: 'RepairLink',
    emoji: '🏭',
    needsLogin: true,
    url: () => 'https://repairlinkshop.com/',
  },
]

export function vendorByKey(key) {
  return VENDORS.find((v) => v.key === key) || null
}
