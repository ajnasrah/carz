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

// One car, as a buyer would want to read it: what it is, how far it's gone,
// what we want for it, and where to look.
export function carLines(car) {
  const name = [car.year, car.make, car.model].filter(Boolean).join(' ') || 'Vehicle'
  const miles = Number(String(car.mileage ?? '').replace(/[^0-9]/g, ''))
  const bits = [name]
  if (Number.isFinite(miles) && miles > 0) bits.push(`${miles.toLocaleString()} mi`)
  const price = money(car.buy_now)
  if (price) bits.push(price)
  const vin = car.full_vin || car.vin
  if (vin) bits.push(`VIN ${vin}`)
  return `${bits.join(' · ')}\n${listingUrl(car.id)}`
}

export function buildShareMessage(cars, { buyer } = {}) {
  if (cars.length === 1) return carLines(cars[0])
  const hello = buyer ? `${buyer.trim()} — ` : ''
  return [
    `${hello}${cars.length} cars from Carz Inc:`,
    '',
    ...cars.map((c) => carLines(c)),
  ].join('\n')
}
