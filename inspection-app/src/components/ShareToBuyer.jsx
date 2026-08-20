import { useState } from 'react'
import { X, Send, Share2, Copy, Check, MessageSquare } from 'lucide-react'
import { buildShareMessage } from '../services/marketplaceShare'
import { shareText } from '../native/share'
import { copyText } from '../native/clipboard'
import { openExternal, smsUrl } from '../native/links'

// Send a set of cars to ONE buyer, in one message. Three ways out, because how
// you reach a buyer depends on the buyer: text them directly, hand it to the
// share sheet (WhatsApp, email, anything), or copy it and paste it yourself.
export default function ShareToBuyer({ cars, onClose }) {
  const [buyer, setBuyer] = useState('')
  const [phone, setPhone] = useState('')
  const [done, setDone] = useState('')

  const message = buildShareMessage(cars, { buyer })

  function flash(what) {
    setDone(what)
    setTimeout(() => setDone(''), 1800)
  }

  async function text() {
    const digits = phone.replace(/\D/g, '')
    // An empty box means "I don't have his number" — send it anyway and let the
    // salesman pick the contact in Messages, which is how most of these go out,
    // since the dealers that come from Frazer have a name and no phone. A
    // half-typed number is a different thing and still worth catching.
    if (digits.length > 0 && digits.length < 10) {
      flash('Need a 10-digit number, or leave it blank')
      return
    }
    await openExternal(smsUrl(digits, message))
  }

  async function sheet() {
    const result = await shareText({
      title: `${cars.length} cars from Carz Inc`,
      text: message,
    })
    if (result === 'copied') flash('Copied — no share sheet here')
    else if (result === 'shared') onClose?.()
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/95 flex flex-col safe-inset">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800">
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-white">Send to a buyer</h2>
          <p className="text-[11px] text-slate-400">
            {cars.length} car{cars.length !== 1 ? 's' : ''} in one message
          </p>
        </div>
        <button onClick={onClose} className="p-2 rounded-lg bg-slate-800 text-slate-300">
          <X size={18} />
        </button>
      </div>

      <div className="px-4 py-3 space-y-2 border-b border-slate-800">
        <input
          value={buyer}
          onChange={(e) => setBuyer(e.target.value)}
          placeholder="Buyer name (optional)"
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="tel"
          placeholder="Their phone — or leave blank and pick in Messages"
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
        />
      </div>

      {/* What they'll actually receive */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1.5">Message</p>
        <pre className="whitespace-pre-wrap break-words text-xs text-slate-300 bg-slate-900 border border-slate-800 rounded-lg p-3">
          {message}
        </pre>
      </div>

      {done && <p className="px-4 pb-1 text-xs text-emerald-400">{done}</p>}

      <div className="grid grid-cols-3 gap-2 px-4 py-3 border-t border-slate-800">
        <button
          onClick={text}
          className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-emerald-500 text-slate-900 font-bold text-xs"
        >
          <MessageSquare size={14} /> Text
        </button>
        <button
          onClick={sheet}
          className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-slate-800 text-slate-200 font-bold text-xs"
        >
          <Share2 size={14} /> Share
        </button>
        <button
          onClick={() => copyText(message).then((ok) => flash(ok ? 'Copied' : 'Copy failed'))}
          className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-slate-800 text-slate-200 font-bold text-xs"
        >
          {done === 'Copied' ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />} Copy
        </button>
      </div>
    </div>
  )
}

// The per-car version: one tap, no sheet in the way.
export function ShareCarButton({ car, className = '', label = 'Share' }) {
  const [state, setState] = useState('')
  async function go(e) {
    e.preventDefault()
    e.stopPropagation()
    const result = await shareText({
      title: [car.year, car.make, car.model].filter(Boolean).join(' ') || 'Carz Inc',
      text: buildShareMessage([car]),
    })
    if (result !== 'cancelled') {
      setState(result === 'copied' ? 'Copied' : 'Sent')
      setTimeout(() => setState(''), 1500)
    }
  }
  return (
    <button onClick={go} className={className}>
      {state ? <Check size={13} className="text-emerald-400" /> : <Send size={13} />}
      {state || label}
    </button>
  )
}
