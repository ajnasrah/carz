import { NavLink, useLocation } from 'react-router-dom'

const TABS = [
  { to: '/',            emoji: '🏠', label: 'Home' },
  { to: '/inventory',   emoji: '🚗', label: 'Cars' },
  { to: '/sold-reports', emoji: '💰', label: 'Sold' },
  { to: '/buyer-match', emoji: '🎯', label: 'Buyers' },
  { to: '/inspections', emoji: '📝', label: 'Insp.' },
]

export default function BottomNav() {
  const { pathname } = useLocation()
  // Hide on the in-flight inspection wizard so you can't accidentally lose work.
  if (pathname.startsWith('/inspect/')) return null
  // Hide on the public marketplace pages.
  if (pathname.startsWith('/marketplace')) return null
  if (pathname.startsWith('/listings')) return null
  if (pathname === '/login') return null
  if (pathname === '/setup') return null

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-slate-900/95 backdrop-blur border-t border-slate-800">
      <div className="max-w-lg mx-auto grid grid-cols-5">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center py-2 px-1 gap-0.5 ${
                isActive ? 'text-emerald-400' : 'text-slate-400'
              }`
            }
          >
            <span className="text-xl leading-none">{t.emoji}</span>
            <span className="text-[10px] font-bold">{t.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
