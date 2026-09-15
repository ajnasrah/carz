// The Buyer Outreach text, and the clock its 30 minutes are counted on.
//
// Shared by /api/outreach (which sends it) and the Outreach page (which shows
// the owner exactly what will go out). Pure functions, no imports, so both a
// Vercel function and the browser bundle can load it.

export const REPLY_MINUTES = 30
export const ZONE = 'America/Chicago'
// Mon-Sat, 8am to 6pm Memphis. ISO weekday: 1 = Monday ... 7 = Sunday.
export const HOURS = { days: [1, 2, 3, 4, 5, 6], open: 8 * 60, close: 18 * 60 }

// ---------------------------------------------------------------------------
// The message
// ---------------------------------------------------------------------------

// GSM-7 only. One character outside it (an em dash, a curly quote from a model
// name pasted out of Word) switches the whole text to UCS-2 and cuts each
// segment from 153 characters to 67 — this message would go from 3 segments to 6.
export function gsmSafe(s) {
  return String(s ?? '')
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[·•]/g, '-')
    .replace(/[^\x20-\x7E\n]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

const money = (v) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? `$${Math.round(n).toLocaleString('en-US')}` : null
}

export function carTitle(car) {
  return gsmSafe([car.year, car.make, car.model, car.trim].filter(Boolean).join(' ')) || 'Vehicle'
}

//   Carz Inc Wholesale: our AI matches dealers to cars we have for sale based
//   on what you've bought before. You're our top match for:
//
//   2021 FORD F-150 XLT, 48,210 mi
//   $32,500 Buy Now
//   VIN 1FTFW1E50MFA12345
//   https://www.smartauction.com/...
//
//   Reply within 30 min or we'll offer it to the next best match. Reply STOP to opt out.
export function buildOutreachMessage(car, { dealer = 'Carz Inc Wholesale' } = {}) {
  const miles = Number(String(car.mileage ?? '').replace(/[^0-9]/g, ''))
  const head = Number.isFinite(miles) && miles > 0
    ? `${carTitle(car)}, ${miles.toLocaleString('en-US')} mi`
    : carTitle(car)
  const lines = [
    `${gsmSafe(dealer)}: our AI matches dealers to cars we have for sale based on what you've bought before. You're our top match for:`,
    '',
    head,
  ]
  const price = money(car.price)
  if (price) lines.push(`${price} Buy Now`)
  if (car.vin) lines.push(`VIN ${gsmSafe(car.vin).toUpperCase()}`)
  if (car.sa_url) lines.push(String(car.sa_url).trim())
  lines.push('', `Reply within ${REPLY_MINUTES} min or we'll offer it to the next best match. Reply STOP to opt out.`)
  return lines.join('\n')
}

// Rough segment count for the preview. GSM-7 only (gsmSafe guarantees it);
// ^ { } [ ] ~ \ | count double, which this ignores — close enough to warn on.
export function segmentCount(text) {
  const n = String(text || '').length
  return n <= 160 ? 1 : Math.ceil(n / 153)
}

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})
const ISO_DAY = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }

function local(at) {
  const p = Object.fromEntries(fmt.formatToParts(at).map((x) => [x.type, x.value]))
  return { day: ISO_DAY[p.weekday], minutes: Number(p.hour) * 60 + Number(p.minute) }
}

export function isBusinessTime(at = new Date(), hours = HOURS) {
  const { day, minutes } = local(at)
  return hours.days.includes(day) && minutes >= hours.open && minutes < hours.close
}

// When a text sent at `from` stops waiting: `minutes` of business time later.
// Sent at 5:45pm Friday, that is 8:15am Saturday; sent Saturday 5:50pm, it is
// 8:20am Monday. Walks a minute at a time, which is at most a few thousand
// steps across a long weekend and needs no DST arithmetic at all.
export function businessDeadline(from = new Date(), minutes = REPLY_MINUTES, hours = HOURS) {
  const step = 60000
  let t = Math.floor(new Date(from).getTime() / step) * step
  let left = minutes
  for (let guard = 0; guard < 60 * 24 * 10 && left > 0; guard++) {
    if (isBusinessTime(new Date(t), hours)) left -= 1
    t += step
  }
  return new Date(t)
}
