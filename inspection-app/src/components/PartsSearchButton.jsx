// The parts shortcut, as one button that drops onto any part row.
//
// PartsSearch itself was only ever wired into a mechanic's repair line, which
// left out the two places a body shop manager actually buys from: the job card
// and the Parts to Order list. Buying is buying — the car and the part name are
// all any vendor needs — so the panel is the same one, just reachable from
// wherever someone is standing when they decide to order something.

import { useState } from 'react'
import { Search, X } from 'lucide-react'
import PartsSearch from './PartsSearch'

export default function PartsSearchButton({ vehicle, term, label = 'Find this part' }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true) }}
        aria-label={label}
        title={label}
        className="shrink-0 p-1.5 rounded-lg text-slate-400 active:bg-slate-700">
        <Search size={13} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-3"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false) }}>
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-xl p-3 shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-bold text-sm truncate">{term || 'Find a part'}</h2>
              <button onClick={() => setOpen(false)} aria-label="Close" className="text-slate-400 p-1">
                <X size={18} />
              </button>
            </div>
            <PartsSearch vehicle={vehicle} defaultTerm={term || ''} />
          </div>
        </div>
      )}
    </>
  )
}
