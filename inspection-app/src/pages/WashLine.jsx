// Wash line — the key tags the reader couldn't read.
//
// Every car here was photographed coming off the wash, and every one of them is
// stuck: the VIN couldn't be read off the tag, the bot asked the group which car
// it was, and nobody answered. Until this screen existed that was the end of it —
// the car never finished, never moved to the front line, and nothing anywhere
// said so. 57 cars went that way in three and a half weeks.
//
// One job here: look at the tag, type the last 6. The car then finishes exactly
// as if the reader had got it right — body shop job closed, mechanic job closed,
// car moved to the front line.

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, RefreshCw, Check, X } from 'lucide-react'
import {
  fetchWashLineQueue, fetchWashLinePhoto, finishWashLineCar, dismissWashLinePhoto,
} from '../services/washLine'

const when = (ts) => {
  if (!ts) return ''
  const d = new Date(ts)
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  const stamp = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return `${stamp}, ${time}${days > 0 ? ` · ${days}d ago` : ''}`
}

export default function WashLine() {
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [done, setDone] = useState([])

  const load = useCallback(async () => {
    setError('')
    try {
      setItems(await fetchWashLineQueue())
    } catch (e) {
      setError(e.message || 'Could not load the wash line queue')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { setLoading(true); load() }, [load])

  // Drop it from the list here rather than reloading: the person is working down
  // a pile and a list that reshuffles under them loses their place.
  function settled(messageId, note) {
    setItems((rows) => rows.filter((r) => r.message_id !== messageId))
    if (note) setDone((d) => [note, ...d].slice(0, 6))
  }

  return (
    <div className="page">
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => navigate(-1)} aria-label="Back"
          className="p-2 -ml-2 mr-1 rounded-lg bg-slate-800 text-slate-300 active:bg-slate-700">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="page-title mb-0">🧽 Wash Line</h1>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Key tags the reader couldn&rsquo;t read — oldest first
          </p>
        </div>
        <button onClick={() => { setLoading(true); load() }}
          className="p-2 rounded-lg bg-slate-800 border border-slate-700 active:bg-slate-700"
          aria-label="Refresh">
          <RefreshCw size={16} className={loading ? 'animate-spin text-slate-500' : 'text-slate-300'} />
        </button>
      </div>

      {error && (
        <div className="card border-red-500/40 bg-red-500/10 text-red-300 text-sm mb-3">{error}</div>
      )}

      {items.length > 0 && (
        <div className="mb-3 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/40 text-[11px] text-amber-300 leading-snug">
          {items.length} {items.length === 1 ? 'car was' : 'cars were'} washed but never identified, so
          {' '}{items.length === 1 ? 'it is' : 'they are'} still showing as in the shop. Read the tag,
          type the last 6, and the car finishes.
        </div>
      )}

      {done.length > 0 && (
        <div className="mb-3 text-[11px] text-emerald-400">
          ✅ {done.join(' · ')}
        </div>
      )}

      {loading ? (
        <div className="text-center text-slate-500 py-10 text-sm">Loading…</div>
      ) : items.length === 0 ? (
        <div className="card text-center py-10">
          <div className="text-4xl mb-2">🧽</div>
          <p className="text-slate-400 text-sm">Nothing waiting — every key tag has been read.</p>
          <p className="text-slate-600 text-[11px] mt-2">
            Photos land here only when the VIN can&rsquo;t be read off the tag.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <TagCard key={item.message_id} item={item} onSettled={settled} onError={setError} />
          ))}
        </div>
      )}
    </div>
  )
}

function TagCard({ item, onSettled, onError }) {
  const [url, setUrl] = useState(null)
  const [gone, setGone] = useState(false)
  const [vin6, setVin6] = useState('')
  const [busy, setBusy] = useState(false)

  // The photo comes through an authenticated endpoint, so it arrives as a blob
  // rather than a URL — which means it has to be handed back when the card goes,
  // or a long session quietly holds every tag it ever looked at.
  useEffect(() => {
    let revoked = false
    let made = null
    fetchWashLinePhoto(item.message_id)
      .then((u) => {
        if (revoked) { if (u) URL.revokeObjectURL(u); return }
        if (!u) { setGone(true); return }
        made = u
        setUrl(u)
      })
      .catch(() => setGone(true))
    return () => { revoked = true; if (made) URL.revokeObjectURL(made) }
  }, [item.message_id])

  async function finish() {
    setBusy(true)
    try {
      const out = await finishWashLineCar(item.message_id, vin6)
      onSettled(item.message_id, `…${out.vin6}`)
    } catch (e) {
      onError(e.message || 'Could not finish that car')
      setBusy(false)
    }
  }

  async function dismiss() {
    if (!window.confirm('Take this photo off the list without finishing a car?')) return
    setBusy(true)
    try {
      await dismissWashLinePhoto(item.message_id)
      onSettled(item.message_id)
    } catch (e) {
      onError(e.message || 'Could not dismiss')
      setBusy(false)
    }
  }

  const ready = /^[A-Za-z0-9]{6}$/.test(vin6.trim())

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
      <div className="px-3 pt-2.5 pb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] text-slate-400">{when(item.received_at)}</span>
        <button onClick={dismiss} disabled={busy}
          className="text-[11px] text-slate-500 active:text-red-400 flex items-center gap-1 disabled:opacity-40">
          <X size={12} /> Not a car
        </button>
      </div>

      {/* The tag, as big as the screen allows — this is the whole job. */}
      {gone ? (
        <div className="mx-3 mb-2 p-4 rounded-lg bg-slate-900 border border-slate-700 text-center">
          <p className="text-[11px] text-slate-500 leading-snug">
            Telegram no longer has this photo. If you know which car it was you can still
            type it below; otherwise take it off the list.
          </p>
        </div>
      ) : url ? (
        <img src={url} alt="Key tag" className="w-full max-h-[55vh] object-contain bg-black" />
      ) : (
        <div className="h-40 flex items-center justify-center text-slate-600 text-xs">Loading photo…</div>
      )}

      <div className="p-3 flex gap-2">
        <input
          value={vin6}
          onChange={(e) => setVin6(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-6))}
          placeholder="Last 6"
          inputMode="text" autoCapitalize="characters" autoComplete="off"
          className="flex-1 font-mono tracking-widest !py-2"
        />
        <button onClick={finish} disabled={busy || !ready}
          className="px-4 rounded-lg bg-emerald-500 text-slate-900 font-bold text-sm disabled:opacity-40 flex items-center gap-1.5">
          <Check size={16} /> {busy ? '…' : 'Finish'}
        </button>
      </div>
    </div>
  )
}
