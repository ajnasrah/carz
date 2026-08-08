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

export default function BottomNav() {
  const { pathname } = useLocation()
  const { profile } = useAuth()
  // Hide on the in-flight inspection wizard so you can't accidentally lose work.
  if (pathname.startsWith('/inspect/')) return null
  // Hide on the public marketplace pages.
  if (pathname.startsWith('/marketplace')) return null
  if (pathname.startsWith('/listings')) return null
  if (pathname === '/login') return null
  if (pathname === '/setup') return null
  if (pathname === '/pending') return null

  const tabs = isBodyShopOnly(profile) ? BODY_SHOP_TABS : TABS

  return (
    // safe-bottom extends the bar's background down through the home-indicator
    // strip while keeping the tappable icons above it. Without it the tabs sit
    // under the indicator and are hard to hit on a notched phone.
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-slate-900/95 backdrop-blur border-t border-slate-800 safe-bottom">
      <div
        className="max-w-lg mx-auto grid"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      >
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.to === '/'}
            className={({ isActive }) => {
              // A job page (/body-shop/:id) belongs to the board, but the payout
              // screen is its own tab — without this it lights both up.
              const active = t.to === '/body-shop' ? pathname !== '/body-shop/payout' && isActive : isActive
              return `flex flex-col items-center justify-center py-2 px-1 gap-0.5 ${
                active ? 'text-emerald-400' : 'text-slate-400'
              }`
            }}
          >
            <span className="text-xl leading-none">{t.emoji}</span>
            <span className="text-[10px] font-bold">{t.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
