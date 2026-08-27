import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { isBodyShopOnly } from '../services/bodyShop'

const TABS = [
  { to: '/',            emoji: '🏠', label: 'Home' },
  { to: '/inventory',   emoji: '🚗', label: 'Cars' },
  { to: '/sold-reports', emoji: '💰', label: 'Sold' },
  { to: '/buyer-match', emoji: '🎯', label: 'Buyers' },
]

// The body shop crew only has the shop, so the usual four tabs would all bounce
// off ProtectedRoute back to the board. Give them the two screens they can reach.
const BODY_SHOP_TABS = [
  { to: '/body-shop',        emoji: '🎨', label: 'Body Shop' },
  { to: '/body-shop/payout', emoji: '💵', label: 'Payout' },
]

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

  const tabs = isBodyShopOnly(profile) ? BODY_SHOP_TABS : TABS

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
          notched phone. */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-slate-900/95 backdrop-blur border-t border-slate-800 safe-bottom">
        <div
          className="max-w-lg mx-auto grid"
          style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
        >
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.to === '/'}
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

      {/* Tablet: the same destinations as a rail down the left.
          A four-item bar stretched across the foot of an 11" iPad is the single
          clearest tell that a phone app was shipped unchanged — the tabs end up
          marooned in the middle of a 1180pt strip. A rail uses the width the
          bottom bar was wasting, and gives the labels room to be read rather
          than squeezed to 10px. */}
      <nav className="hidden md:flex fixed inset-y-0 left-0 z-50 w-56 flex-col bg-slate-900 border-r border-slate-800 safe-inset px-3">
        <div className="px-2 pt-5 pb-6">
          <h1 className="text-lg font-bold text-emerald-400 leading-none">CARZ INC</h1>
          <p className="text-[10px] uppercase tracking-wide text-slate-500 mt-1.5">
            Inventory Management
          </p>
        </div>
        <div className="flex flex-col gap-1">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 ${
                  isActiveTab(t.to, isActive)
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`
              }
            >
              <span className="text-lg leading-none">{t.emoji}</span>
              <span className="text-sm font-semibold">{t.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </>
  )
}
