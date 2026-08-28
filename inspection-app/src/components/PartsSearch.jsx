// Find a part for this car, without retyping the car.
//
// Four vendors, two very different kinds of link:
//
//   eBay and Amazon take a plain keyword search in the URL, so we can open them
//   straight onto results for this exact car and this exact part. No account, no
//   API, nothing to maintain.
//
//   PartsTech and RepairLink are login-only shop/dealer portals. Their catalogue
//   sits behind auth and they take no useful search parameters, so the honest
//   version is: open the site and put the VIN on the clipboard, ready to paste
//   into their own vehicle picker. That's the whole integration until an API
//   key says otherwise — pretending otherwise would just produce dead links.
//
// Deliberately NOT attempting eBay's fitment parameters (the _vhc / epid
// machinery). They break constantly and a wrong fitment link is worse than a
// keyword search, because it looks authoritative while filtering out the part
// you wanted.

import { useState } from 'react'
import { ExternalLink, Copy, Check } from 'lucide-react'

const VENDORS = [
  {
    key: 'ebay',
    label: 'eBay',
    emoji: '🏷️',
    // Used parts and OEM takeoffs — usually the first place anyone looks here.
    url: ({ q }) => `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}`,
  },
  {
    key: 'amazon',
    label: 'Amazon',
    emoji: '📦',
    url: ({ q }) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}`,
  },
  {
    key: 'partstech',
    label: 'PartsTech',
    emoji: '🔩',
    needsLogin: true,
    url: () => 'https://app.partstech.com/',
  },
  {
    key: 'repairlink',
    label: 'RepairLink',
    emoji: '🏭',
    needsLogin: true,
    url: () => 'https://repairlinkshop.com/',
  },
]

// What we'd type into a parts site if we were typing: the car, then the part.
// Trim is doing real work — a line with no part text yet should search the car
// alone rather than the car plus a trailing space.
function buildQuery(vehicle, term) {
  return [vehicle?.year, vehicle?.make, vehicle?.model, term]
    .filter(Boolean).join(' ').trim()
}

export default function PartsSearch({ vehicle, defaultTerm = '', onSearched }) {
  const [term, setTerm] = useState(defaultTerm)
  const [copied, setCopied] = useState(false)

  const vin = vehicle?.vin || ''
  const q = buildQuery(vehicle, term)

  async function copyVin() {
    if (!vin) return
    try {
      await navigator.clipboard.writeText(vin)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard is blocked in some in-app webviews. Selecting the text is the
      // fallback, so the VIN stays visible above rather than living only here.
      setCopied(false)
    }
  }

  function open(vendor) {
    // The login-only vendors get the VIN put on the clipboard first, because the
    // very next thing anyone does on their site is paste it into a vehicle
    // picker. Fire and forget — a blocked clipboard must not stop the tab.
    if (vendor.needsLogin) copyVin()
    window.open(vendor.url({ q }), '_blank', 'noopener,noreferrer')
    onSearched?.({ vendor: vendor.key, query: q })
  }

  return (
    <div className="rounded-xl bg-slate-900 border border-slate-700 p-3 space-y-3">
      {/* The car, always on screen while you shop. For the login-only sites this
          IS the integration — you paste from here. */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Searching for</div>
          <div className="text-sm font-semibold truncate">
            {[vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(' ') || 'Unknown vehicle'}
          </div>
          {vin && (
            <div className="text-[11px] font-mono text-slate-400 truncate mt-0.5 select-all">{vin}</div>
          )}
        </div>
        {vin && (
          <button onClick={copyVin} type="button"
            className="shrink-0 flex items-center gap-1 px-2 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-[11px] font-semibold active:bg-slate-700">
            {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
            {copied ? 'Copied' : 'Copy VIN'}
          </button>
        )}
      </div>

      <input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="water pump, front rotors, alternator…"
        className="text-sm"
      />

      <div className="grid grid-cols-2 gap-1.5">
        {VENDORS.map((v) => (
          <button key={v.key} type="button" onClick={() => open(v)}
            title={v.needsLogin
              ? `Opens ${v.label} and copies the VIN — paste it into their vehicle picker`
              : `Search ${v.label} for this car`}
            className="flex items-center justify-between gap-1 px-2.5 py-2 rounded-lg bg-slate-800 border border-slate-700 text-xs font-semibold active:bg-slate-700">
            <span className="truncate">{v.emoji} {v.label}</span>
            <ExternalLink size={12} className="shrink-0 text-slate-500" />
          </button>
        ))}
      </div>

      <p className="text-[10px] text-slate-500 leading-snug">
        eBay and Amazon open on results for this car. PartsTech and RepairLink need
        their own login — they open with the VIN copied, ready to paste.
      </p>
    </div>
  )
}
