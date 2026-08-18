// Who we are, in one place.
//
// This is what a buyer sees on a shared list and what goes in the outreach
// message. It was previously a bare phone number typed into MarketplaceListing
// with no name attached to it, so a buyer got a text from an unknown number.
// Change it here and every outreach surface follows.
export const DEALER = {
  name: 'Carz Inc',
  department: 'Wholesale',
  city: 'Memphis',
  state: 'TN',
  phone: '19018319661',
  email: null,               // add a wholesale inbox here and it appears everywhere
}

// (901) 831-9661
export const dealerPhonePretty = (p = DEALER.phone) => {
  const d = String(p).replace(/\D/g, '').replace(/^1/, '')
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p
}

// "Carz Inc · Wholesale · (901) 831-9661"
export const dealerLine = () =>
  [DEALER.name, DEALER.department, dealerPhonePretty(), DEALER.email]
    .filter(Boolean).join(' · ')
