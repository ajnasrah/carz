// Building the message that goes to a buyer.
//
// Links are always absolute against the public site. window.location.href is
// wrong in the native shell — it's capacitor://localhost/marketplace/<id>, a URL
// that resolves for nobody — so every share built from it was a dead link the
// moment it was sent from a phone.
export const PUBLIC_ORIGIN = 'https://www.carzinc.ai'

export function listingUrl(id) {
  return `${PUBLIC_ORIGIN}/marketplace/${id}`
}

const money = (v) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? `$${Math.round(n).toLocaleString()}` : null
}

// One car, as a buyer would want to read it. Three parts, in the order someone
// skims them: what it is, then the numbers, then a blank line so the link sits
// on its own and every messaging app renders it as a link rather than swallowing
// it into the end of a sentence.
//
//   2016 INFINITI QX60
//   92,013 mi · $8,500 · VIN 5N1AL0MMXGC504245
//
//   https://www.carzinc.ai/marketplace/<id>
export function carLines(car) {
  const name = [car.year, car.make, car.model].filter(Boolean).join(' ') || 'Vehicle'
  const miles = Number(String(car.mileage ?? '').replace(/[^0-9]/g, ''))
  const facts = []
  if (Number.isFinite(miles) && miles > 0) facts.push(`${miles.toLocaleString()} mi`)
  const price = money(car.buy_now)
  if (price) facts.push(price)
  const vin = car.full_vin || car.vin
  if (vin) facts.push(`VIN ${vin}`)

  const lines = [name]
  if (facts.length) lines.push(facts.join(' · '))
  lines.push('', listingUrl(car.id))
  return lines.join('\n')
}

export function buildShareMessage(cars, { buyer } = {}) {
  if (cars.length === 1) return carLines(cars[0])
  const hello = buyer ? `${buyer.trim()} — ` : ''
  return [
    `${hello}${cars.length} cars from Carz Inc:`,
    '',
    cars.map(carLines).join('\n\n'),
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Buyer lists: one link per buyer instead of one link per car.
//
// Pitching a buyer ten cars as ten marketplace links is a wall of URLs nobody
// opens. A buyer list is a single page holding exactly the cars we picked for
// him, so the message stays short enough to read on a phone.
// ---------------------------------------------------------------------------
export function buyerListUrl(slug) {
  return `${PUBLIC_ORIGIN}/m/${slug}`
}

// The cars are named in the message as well as on the page. A buyer skimming a
// text should be able to tell whether it's worth tapping without tapping.
export function buildBuyerListMessage(cars, { buyer, slug, dealer } = {}) {
  const hello = buyer ? `Hi ${String(buyer).split(/[,(]/)[0].trim()},` : 'Hi,'
  const n = cars.length
  const head = `${hello}\n\n${n} unit${n === 1 ? '' : 's'} I think fit your book right now:`

  const lines = cars.slice(0, 8).map((c) => {
    const name = [c.year, c.make, c.model].filter(Boolean).join(' ') || 'Vehicle'
    const bits = []
    const miles = Number(String(c.odometer ?? c.mileage ?? '').replace(/[^0-9]/g, ''))
    if (Number.isFinite(miles) && miles > 0) bits.push(`${Math.round(miles / 1000)}k mi`)
    const price = money(c.buy_now ?? c.predicted_price)
    if (price) bits.push(price)
    return `• ${name}${bits.length ? ` · ${bits.join(' · ')}` : ''}`
  })
  if (n > 8) lines.push(`• …and ${n - 8} more`)

  return [
    head, '',
    slug ? buyerListUrl(slug) : null,
    slug ? '' : null,
    lines.join('\n'),
    '',
    dealer || null,
  ].filter((x) => x !== null).join('\n')
}
