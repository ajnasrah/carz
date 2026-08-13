import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { X } from 'lucide-react'

// "What do you want to do?" as a left drawer instead of a wall of tiles. The
// dashboard's job is the numbers; the nav is something you reach for, not
// something that should be occupying half the screen underneath them.
//
// The day's work on top, in the order it gets reached for; the occasional
// screens under More. A drawer has room for all of it, so nothing hides behind
// a toggle — the heading is the only thing separating them.
const PRIMARY = [
  { to: '/lot', emoji: '🚶', label: 'Walk Lot' },
  { to: '/inventory', emoji: '🚗', label: 'Cars' },
  { to: '/body-shop', emoji: '🎨', label: 'Body Shop' },
  { to: '/list-builder', emoji: '🔨', label: 'List Builder' },
  { to: '/marketplace', emoji: '🏪', label: 'Marketplace' },
  { to: '/front-lot-aging', emoji: '⏰', label: 'Lot Aging' },
  { to: '/buyer-match', emoji: '🎯', label: 'Buyers' },
  { to: '/reports', emoji: '📈', label: 'Reports' },
]

const MORE = [
  { to: '/pull-list', emoji: '📋', label: 'Pull List' },
  { to: '/inspections', emoji: '📝', label: 'Inspect' },
  { to: '/inbound', emoji: '📥', label: 'Inbound' },
  { to: '/lookup', emoji: '📊', label: 'MMR/BB' },
  { href: '/training/', emoji: '🎓', label: 'Training' },
]

export default function ActionDrawer({ open, onClose, footer }) {
  // Escape closes it, and the page behind it doesn't scroll while it's open —
  // otherwise a swipe on the backdrop drags the dashboard around underneath.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden={!open}
        className={`fixed inset-0 z-40 bg-slate-950/70 transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-[17rem] max-w-[85vw] bg-slate-900 border-r border-slate-800 flex flex-col transition-transform duration-200 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)' }}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800">
          <span className="flex-1 text-[11px] uppercase tracking-wide text-slate-500">
            What do you want to do?
          </span>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-slate-800 text-slate-300">
            <X size={16} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          {PRIMARY.map((item) => (
            <Row key={item.label} item={item} onClose={onClose} />
          ))}
          <p className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-wide text-slate-600">More</p>
          {MORE.map((item) => (
            <Row key={item.label} item={item} onClose={onClose} />
          ))}
        </nav>

        {footer && <div className="p-3 border-t border-slate-800">{footer}</div>}
      </aside>
    </>
  )
}

function Row({ item, onClose }) {
  const className =
    'flex items-center gap-3 px-4 py-2.5 text-sm font-semibold text-slate-200 active:bg-slate-800'
  const body = (
    <>
      <span className="text-lg w-6 text-center">{item.emoji}</span>
      {item.label}
    </>
  )
  if (item.href) {
    return (
      <a href={item.href} target="_blank" rel="noopener noreferrer" className={className} onClick={onClose}>
        {body}
      </a>
    )
  }
  return (
    <Link to={item.to} className={className} onClick={onClose}>
      {body}
    </Link>
  )
}
