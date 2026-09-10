// Every place you can go, written down once.
//
// It used to be written down twice: the phone's action drawer had fifteen
// destinations, and the tablet/desktop rail had four. On a wide screen both
// were on the page at the same time, stacked at the same z-index, so opening
// the drawer got you the rail painted over the top of it — fifteen links
// hidden behind four, with only the drawer's close button poking out past the
// rail's edge. Nobody on an iPad or a desktop could reach the other eleven
// screens at all.
//
// So there is one list now. The phone shows it in a drawer because a phone has
// no room for a permanent one; anything wider shows the same list in the rail
// and never opens a drawer over it.

// The day's work, in the order it gets reached for.
export const PRIMARY_LINKS = [
  { to: '/', emoji: '🏠', label: 'Home', end: true },
  { to: '/lot', emoji: '🚶', label: 'Walk Lot' },
  { to: '/inventory', emoji: '🚗', label: 'Cars' },
  // 💰 Sold is the SAME destination here as it is on the phone's bottom bar:
  // /sold-reports, the profit trends. It used to be the car list, and renaming
  // it "Sold Cars" was not enough — on a desktop the rail is always open, so the
  // money icon under Cars is the one you reach for when you want the sold
  // numbers, and it kept landing you on a table of cars instead. The phone and
  // the rail now agree on where 💰 Sold goes, which is the only version of this
  // nobody has to learn.
  { to: '/sold-reports', emoji: '💰', label: 'Sold' },
  { to: '/body-shop', emoji: '🎨', label: 'Body Shop' },
  // Next to the body shop because they're the same question asked of the two
  // shops: what's in there, and how long have we owned it.
  { to: '/mechanic', emoji: '🔧', label: 'Mechanic' },
  // Asked while standing next to a car: what does this one still need, from
  // anybody? Answering it used to mean opening both shop boards in turn.
  { to: '/work', emoji: '🧾', label: 'Work Order' },
  { to: '/list-builder', emoji: '🔨', label: 'List Builder' },
  { to: '/marketplace', emoji: '🏪', label: 'Marketplace' },
  { to: '/front-lot-aging', emoji: '⏰', label: 'Lot Aging' },
  { to: '/buyer-match', emoji: '🎯', label: 'Buyers' },
  // The car list itself — every car that left, searchable, with its history.
  // It lives down here with the other look-it-up screens rather than under Cars,
  // and it is called a list because that is what distinguishes it from the
  // numbers: two destinations may share a subject, they may not share a name.
  { to: '/sold', emoji: '🗂️', label: 'Sold Car List' },
  { to: '/reports', emoji: '📈', label: 'Reports' },
]

// The occasional screens. Under a heading rather than behind a toggle — a
// drawer and a rail both have the room.
export const MORE_LINKS = [
  { to: '/pull-list', emoji: '📋', label: 'Pull List' },
  { to: '/inspections', emoji: '📝', label: 'Inspect' },
  { to: '/lookup', emoji: '📊', label: 'MMR/BB' },
  { href: '/training/', emoji: '🎓', label: 'Training' },
]

// The body shop crew only has the shop, so the full list would be fifteen links
// that all bounce off ProtectedRoute back to the board. Give them the two
// screens they can actually reach.
export const BODY_SHOP_LINKS = [
  { to: '/body-shop', emoji: '🎨', label: 'Body Shop' },
  { to: '/body-shop/payout', emoji: '💵', label: 'Payout' },
]

// The phone's bottom bar stays four, because four is what fits across a phone
// without the labels turning into initials. It's a shortcut to the four most
// used of the above, not a different menu.
export const PHONE_TABS = [
  { to: '/', emoji: '🏠', label: 'Home', end: true },
  { to: '/inventory', emoji: '🚗', label: 'Cars' },
  { to: '/sold-reports', emoji: '💰', label: 'Sold' },
  { to: '/buyer-match', emoji: '🎯', label: 'Buyers' },
]
