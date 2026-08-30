// One place-name map, shared.
//
// This lived inside Inventory.jsx as a component-scoped const, which is why the
// car-history timeline printed raw slugs — "mechanic_section", "daa_rockies",
// "901_sound" — for the same locations the inventory list was rendering
// properly two screens away. Same car, same place, two different names
// depending on where you were standing.
//
// location_keywords in the database carries a label per location too, and is
// the live list the Telegram bot matches against. This map stays the display
// side of that: it's what a HUMAN should read, it needs no round trip, and
// formatLocationLabel() prettifies anything it hasn't been taught yet, so a
// location added to the keywords table shows up sensibly here before anyone
// gets round to naming it.

export const LOCATION_LABELS = {
  __loc_M__: "Memphis",
  __loc_J__: "Jackson",
  __loc_transit__: "In Transit",
  __loc_A__: "Auction",
  uax: "UAX",
  daa: "DAA",
  adesa: "ADESA",
  in_transit: "In Transit",
  // Chat-sourced destinations (CARZ INC, Body shop, Mechanics, Seller Group)
  body_shop: "Body Shop (Jorge)",
  mechanic_section: "Mechanic",
  mechanic: "Mechanic",
  jorge: "Body Shop (Jorge)",
  front: "Memphis - Front Lot",
  seller_group: "Memphis - Front Lot",
  carz_inc: "Memphis - Front Lot",
  gravel_front: "Memphis - Front Lot",
  gravel_front_lot: "Memphis - Front Lot",
  jackson: "Jackson",
  pro_auto: "Pro Auto",
  andys_auto: "Andy's Auto",
  summit_tire: "Summit Tire",
  tri_state: "Tri State",
  tri_state_glass: "Tri State Glass",
  city_auto: "City Auto",
  upholstery: "Upholstery",
  jim_keras_nissan: "Jim Keras Nissan",
  jim_keras_chevy_service: "Jim Keras Chevy Svc",
  muffler_cs: "Muffler C&S",
  santa_maria: "Santa Maria Tire & Alignment",
  // Denver + West Coast expansion
  otta_body: "Otta Body Shop",
  manheim_denver: "Manheim Denver",
  daa_rockies: "DAA Rockies",
  manheim_sf: "Manheim San Francisco",
  manheim_riverside: "Manheim Riverside",
  manheim_little_rock: "Manheim Little Rock",
  loveland: "Loveland Auto Auction",
  marc_pdr: "Marc Dent Doctor (Denver)",
  rocky_mountain_dent: "Rocky Mountain Dent (Denver)",
  emich_kia: "Emich Kia",
  personal: "Personal",
  // Memphis destinations the transport group has been naming all along — the
  // bot just had no keyword for them until 20260813000014.
  southern: "Southern",
  mt_moriah: "Mt Moriah",
  copart: "Copart",
  kia_gossett: "Gossett Kia",
  cashete: "Cashete",
  b_and_j: "B&J",
  olive_branch: "Olive Branch",
  wilfong: "Wilfong",
  toyota_hernando: "Toyota Hernando",
  streamline: "Streamline",
  dynospeed: "Dynospeed",
  // Lot states. The slug prettifier would render these "On Lot" / "Ready
  // Detail" / "Arb Section", which read like places rather than states.
  on_lot: "On Lot",
  sold_lot: "Sold Lot",
  ready_detail: "Detail",
  arb_section: "Arbitration",
};
// Format any location value for display: use the label if we have one,
// otherwise prettify the raw slug (snake_case → Title Case) so chat entries
// like "901_sound" render as "901 Sound" instead of "901_SOUND".
export function formatLocationLabel(slug) {
  if (!slug) return "";
  if (LOCATION_LABELS[slug]) return LOCATION_LABELS[slug];
  return String(slug)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
