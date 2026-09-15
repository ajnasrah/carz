import { useState } from 'react'
import { X, MessageSquare, Users } from 'lucide-react'
import { buildPitchMessage, buyerShortName, logBuyerPitch, agoLabel } from '../services/buyerPicks'
import { openExternal, smsUrl } from '../native/links'
import { dealerPhonePretty } from '../config/dealer'

// Log first, then open Messages — but never let a slow network hold the text
// up. On the phone, opening Messages backgrounds the app, and a request still in
// flight at that moment may never land; 800 ms is enough for it to go out.
async function pitch(car, pick, onPitched) {
  const logged = logBuyerPitch(car, pick)
    .then(() => onPitched?.(car, pick))
    .catch((err) => console.warn('pitch log failed', err))
  await Promise.race([logged, new Promise((r) => setTimeout(r, 800))])
  await openExternal(smsUrl(pick.buyer_phone, buildPitchMessage(car, pick)))
}

const CONFIDENCE = {
  high: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  medium: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  low: 'bg-slate-700/40 text-slate-400 border-slate-600',
}

// Staff-only strip under a car: one tap texts the best buyer we have a number
// for, with the car already written into the message. "Top 3" shows who else
// and why, for when the first buyer already passed.
export function BestBuyerBar({ car, picks, onPitched, className = '' }) {
  const [open, setOpen] = useState(false)
  const best = picks?.[0]
  if (!best) return null
  const texted = agoLabel(best.last_pitched_at)
  return (
    <>
      <div className={`flex gap-2 ${className}`}>
        <button
          onClick={() => pitch(car, best, onPitched)}
          className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2 rounded-lg bg-sky-500/15 border border-sky-500/40 text-sky-200 text-xs font-bold active:bg-sky-500/25"
        >
          <MessageSquare size={14} className="shrink-0" />
          <span className="truncate">Text {buyerShortName(best.buyer_name)}</span>
          {texted && <span className="shrink-0 font-normal text-sky-300/70">· texted {texted}</span>}
        </button>
        <button
          onClick={() => setOpen(true)}
          className="shrink-0 flex items-center gap-1 px-3 py-2 rounded-lg bg-slate-800 text-slate-200 text-xs font-bold active:bg-slate-700"
        >
          <Users size={13} /> Top {picks.length}
        </button>
      </div>
      {open && <BestBuyerSheet car={car} picks={picks} onPitched={onPitched} onClose={() => setOpen(false)} />}
    </>
  )
}

export function BestBuyerSheet({ car, picks, onPitched, onClose }) {
  const vehicle = [car.year, car.make, car.model].filter(Boolean).join(' ') || 'Vehicle'
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/95 flex flex-col safe-inset">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800">
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-white truncate">Best buyers · {vehicle}</h2>
          <p className="text-[11px] text-slate-400">Buyers with a phone on file, ranked on what they buy</p>
        </div>
        <button onClick={onClose} className="p-2 rounded-lg bg-slate-800 text-slate-300">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {picks.map((p) => {
          const texted = agoLabel(p.last_pitched_at)
          const place = [p.buyer_city, p.buyer_state].filter(Boolean).join(', ')
          return (
            <div key={p.buyer_key} className={`rounded-xl border p-3 ${p.rank === 1 ? 'border-sky-500/50 bg-sky-500/5' : 'border-slate-800 bg-slate-900'}`}>
              <div className="flex items-start gap-2">
                <span className="shrink-0 w-6 h-6 rounded-full bg-slate-800 text-slate-300 text-xs font-bold flex items-center justify-center">
                  {p.rank}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-white text-sm leading-tight">{p.buyer_name}</p>
                  <p className="text-[11px] text-slate-400">
                    {[place, dealerPhonePretty(p.buyer_phone)].filter(Boolean).join(' · ')}
                  </p>
                </div>
                {p.confidence && (
                  <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full border font-semibold ${CONFIDENCE[p.confidence] || CONFIDENCE.low}`}>
                    {p.confidence}
                  </span>
                )}
              </div>
              {p.reason && <p className="mt-2 text-xs text-slate-300">{p.reason}</p>}
              <div className="mt-2 flex items-center gap-2">
                <p className="flex-1 text-[11px] text-slate-500">
                  {p.predicted_price ? `Likely pays ~$${Number(p.predicted_price).toLocaleString()}` : ''}
                  {texted && (
                    <span className="text-amber-300/80">
                      {p.predicted_price ? ' · ' : ''}texted {texted}{p.last_pitched_by ? ` by ${p.last_pitched_by}` : ''}
                      {p.pitch_count > 1 ? ` (${p.pitch_count}×)` : ''}
                    </span>
                  )}
                </p>
                <button
                  onClick={() => pitch(car, p, onPitched)}
                  className={`shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold ${
                    p.rank === 1 ? 'bg-sky-500 text-slate-900' : 'bg-slate-800 text-slate-200'
                  }`}
                >
                  <MessageSquare size={13} /> Text
                </button>
              </div>
            </div>
          )
        })}

        <div>
          <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1.5">Message</p>
          <pre className="whitespace-pre-wrap break-words text-xs text-slate-300 bg-slate-900 border border-slate-800 rounded-lg p-3">
            {buildPitchMessage(car, picks[0])}
          </pre>
        </div>
      </div>
    </div>
  )
}
