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
  // The sold list, sitting directly under Cars because it's the other half of
  // the same question — what we're holding, and what left.
  { to: '/sold', emoji: '💰', label: 'Sold' },
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
  // Two different things with similar names, both kept: the profit trends on
  // what sold, and the reports hub. The bottom bar's Sold tab is the former.
  { to: '/sold-reports', emoji: '📉', label: 'Sold Reports' },
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
