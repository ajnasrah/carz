import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { isBodyShopOnly } from '../services/bodyShop'
import { PRIMARY_LINKS, MORE_LINKS, BODY_SHOP_LINKS, PHONE_TABS } from '../navLinks'

// Whether this route shows navigation at all.
//
// Exported because the app shell has to agree with it: on a tablet the nav is a
// fixed left rail, and the content is padded clear of it. If the shell padded
// unconditionally, every nav-less screen (the inspection wizard, the public
// marketplace, login) would open with a 14rem gutter of nothing down its side.
export function useNavShown() {
  const { pathname } = useLocation()

  // Hide on the in-flight inspection wizard so you can't accidentally lose work.
  if (pathname.startsWith('/inspect/')) return false
  // Hide on the public marketplace pages.
  if (pathname.startsWith('/marketplace')) return false
  if (pathname.startsWith('/listings')) return false
  if (pathname === '/login') return false
  if (pathname === '/setup') return false
  if (pathname === '/pending') return false
  return true
}

export default function BottomNav() {
  const { pathname } = useLocation()
  const { profile } = useAuth()
  const shown = useNavShown()
  if (!shown) return null

  const shopOnly = isBodyShopOnly(profile)
  const tabs = shopOnly ? BODY_SHOP_LINKS : PHONE_TABS
  const railPrimary = shopOnly ? BODY_SHOP_LINKS : PRIMARY_LINKS
  const railMore = shopOnly ? [] : MORE_LINKS

  // A job page (/body-shop/:id) belongs to the board, but the payout screen is
  // its own tab — without this it lights both up.
  const isActiveTab = (to, isActive) =>
    to === '/body-shop' ? pathname !== '/body-shop/payout' && isActive : isActive

  return (
    <>
      {/* Phone: the bar across the bottom.
          safe-bottom extends the bar's background down through the
          home-indicator strip while keeping the tappable icons above it.
          Without it the tabs sit under the indicator and are hard to hit on a
          notched phone.

          Four shortcuts, not the whole menu — the rest is one tap away in the
          action drawer, which on a phone is the only nav there's room for. */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-slate-900/95 backdrop-blur border-t border-slate-800 safe-bottom">
        <div
          className="max-w-lg mx-auto grid"
          style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
        >
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center py-2 px-1 gap-0.5 ${
                  isActiveTab(t.to, isActive) ? 'text-emerald-400' : 'text-slate-400'
                }`
              }
            >
              <span className="text-xl leading-none">{t.emoji}</span>
              <span className="text-[10px] font-bold">{t.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      {/* Tablet and desktop: a rail down the left with EVERY destination on it.
          A four-item bar stretched across the foot of an 11" iPad is the single
          clearest tell that a phone app was shipped unchanged, and a rail uses
          the width the bottom bar was wasting.

          It carries the full list, not four of them, because the alternative
          was a hamburger opening the action drawer underneath this rail — same
          z-index, drawn first, so the rail covered it. On a wide screen this IS
          the menu; the drawer never opens. See navLinks.js.

          The list scrolls on a short landscape window; the header stays put. */}
      <nav className="hidden md:flex fixed inset-y-0 left-0 z-50 w-56 flex-col bg-slate-900 border-r border-slate-800 safe-inset px-3">
        <div className="px-2 pt-5 pb-4 shrink-0">
          <h1 className="text-lg font-bold text-emerald-400 leading-none">CARZ INC</h1>
          <p className="text-[10px] uppercase tracking-wide text-slate-500 mt-1.5">
            Inventory Management
          </p>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto pb-4">
          <div className="flex flex-col gap-0.5">
            {railPrimary.map((t) => (
              <RailLink key={t.label} item={t} isActiveTab={isActiveTab} />
            ))}
          </div>
          {railMore.length > 0 && (
            <>
              <p className="px-3 pt-4 pb-1 text-[10px] uppercase tracking-wide text-slate-600">
                More
              </p>
              <div className="flex flex-col gap-0.5">
                {railMore.map((t) => (
                  <RailLink key={t.label} item={t} isActiveTab={isActiveTab} />
                ))}
              </div>
            </>
          )}
        </div>
      </nav>
    </>
  )
}

const RAIL_CLASS = 'flex items-center gap-3 rounded-lg px-3 py-2'

function RailLink({ item, isActiveTab }) {
  const body = (
    <>
      <span className="text-base leading-none">{item.emoji}</span>
      <span className="text-sm font-semibold">{item.label}</span>
    </>
  )

  // Training is a static site outside the router, so it can never be "active".
  if (item.href) {
    return (
      <a href={item.href} target="_blank" rel="noopener noreferrer"
        className={`${RAIL_CLASS} text-slate-400 hover:bg-slate-800 hover:text-slate-200`}>
        {body}
      </a>
    )
  }

  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        `${RAIL_CLASS} ${
          isActiveTab(item.to, isActive)
            ? 'bg-emerald-500/15 text-emerald-400'
            : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
        }`
      }
    >
      {body}
    </NavLink>
  )
}
