import { useState, useRef, useEffect, useCallback } from 'react'
import { Mic, Square, X, Loader2, Check, CornerDownLeft, AlertTriangle } from 'lucide-react'
import { createSpeechSession, speechAvailable, requestSpeechPermission } from '../native/speech'
import { askAgent, applyMove } from '../services/voiceAgent'

// Say it instead of posting it in a group chat.
//
// This is the replacement for the Telegram station groups. There, "dropping
// 123456 back to body shop for the front bumper" was a message a person had to
// read and a keyword bot had to guess at. Here the same sentence comes back as
// a card naming the actual car and the actual place, and NOTHING MOVES until
// somebody taps Confirm — because the one failure that matters is a misheard
// digit quietly moving the wrong car.
//
// It also just answers questions. Same thread, same mic: "where's 4529",
// "what's waiting on parts", "what did we get for the Altima". The agent
// decides which of the two you meant; you never tell it.
//
// Voice comes from ../native/speech, which is the Web Speech API in a browser
// and the native recognizer inside the iOS app — webkitSpeechRecognition simply
// does not exist in WKWebView, so anything built directly on it dies on the App
// Store build.

export default function VoiceAgentModal({ onClose }) {
  const [supported, setSupported] = useState(null)   // null = still checking
  const [listening, setListening] = useState(false)
  const [heard, setHeard] = useState('')             // live, un-submitted speech
  const [thread, setThread] = useState([])           // what's on screen
  const [pending, setPending] = useState([])         // proposals awaiting a tap
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [typed, setTyped] = useState('')

  const sessionRef = useRef(null)
  const convoRef = useRef([])                        // Anthropic-shape history
  const heardRef = useRef('')
  const scrollRef = useRef(null)
  // send() changes identity whenever `busy` flips. The speech session must NOT
  // be rebuilt when it does — that would destroy the recognizer mid-sentence,
  // every single turn. The session reads the current send through this ref and
  // is created exactly once.
  const sendRef = useRef(null)

  useEffect(() => {
    let alive = true
    speechAvailable().then((ok) => alive && setSupported(!!ok))
    return () => { alive = false }
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [thread, pending, busy])

  const send = useCallback(async (text) => {
    const said = String(text || '').trim()
    if (!said || busy) return

    setError('')
    setHeard('')
    heardRef.current = ''
    setThread((t) => [...t, { role: 'you', text: said }])
    setBusy(true)

    try {
      const turn = [...convoRef.current, { role: 'user', content: said }]
      const out = await askAgent(turn)
      // Keep the assistant + tool blocks the endpoint added, so the next
      // question can refer back to "it" and mean the same car.
      convoRef.current = [...turn, ...(out.messages || [])]
      if (out.say) setThread((t) => [...t, { role: 'agent', text: out.say }])
      if (out.proposals?.length) setPending((p) => [...p, ...out.proposals])
    } catch (e) {
      setError(e.message || 'Could not reach the agent')
    } finally {
      setBusy(false)
    }
  }, [busy])

  useEffect(() => { sendRef.current = send }, [send])

  // One session for the life of the modal. Speech is submitted when the phrase
  // settles (isFinal) rather than on partials: unlike the lot walk, where a
  // partial that matches exactly one car is safe to act on, here the whole
  // sentence carries the meaning and half of it means something else.
  useEffect(() => {
    if (!supported) return
    const session = createSpeechSession({
      onResult: ({ text, isFinal }) => {
        setHeard(text)
        heardRef.current = text
        if (isFinal && text.trim()) {
          session.stop().catch(() => {})
          setListening(false)
          sendRef.current?.(text)
        }
      },
      onError: (code) => {
        setListening(false)
        setError(code === 'not-allowed'
          ? 'Microphone permission denied — allow it in settings'
          : code === 'no-speech' ? '' : 'Could not hear that')
      },
    })
    sessionRef.current = session
    return () => { session.destroy() }
  }, [supported])

  async function toggleMic() {
    setError('')
    if (listening) {
      await sessionRef.current?.stop().catch(() => {})
      setListening(false)
      // Nothing settled but words were caught — take them rather than lose them.
      if (heardRef.current.trim()) sendRef.current?.(heardRef.current)
      return
    }
    const ok = await requestSpeechPermission()
    if (!ok) { setError('Microphone permission denied'); return }
    setHeard('')
    heardRef.current = ''
    try {
      await sessionRef.current?.start()
      setListening(true)
    } catch {
      setError('Could not start the microphone')
    }
  }

  async function confirm(proposal, idx) {
    setError('')
    setPending((p) => p.map((x, i) => (i === idx ? { ...x, _saving: true } : x)))
    try {
      await applyMove(proposal)
      setPending((p) => p.filter((_, i) => i !== idx))
      setThread((t) => [...t, {
        role: 'done',
        text: `${proposal.vehicle || proposal.stock_number} → ${proposal.to_label}${
          proposal.note ? ` · ${proposal.note}` : ''}`,
      }])
    } catch (e) {
      setPending((p) => p.map((x, i) => (i === idx ? { ...x, _saving: false } : x)))
      setError(e.message || 'Could not save that move')
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-slate-950">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800 safe-top">
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-emerald-400">Say it</h2>
          <p className="text-[11px] text-slate-500">
            Move a car, or ask about anything on the lot
          </p>
        </div>
        <button onClick={onClose} className="p-2 rounded-lg bg-slate-800 text-slate-300"
          aria-label="Close">
          <X size={18} />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {thread.length === 0 && !heard && (
          <div className="text-center text-slate-500 text-sm pt-10 space-y-3">
            <p className="text-4xl">🎙️</p>
            <p>Hold the button and talk.</p>
            <div className="text-[12px] text-slate-600 space-y-1 pt-2">
              <p>“Dropping 123456 back to body shop for the front bumper”</p>
              <p>“Where is 4529”</p>
              <p>“What’s waiting on parts”</p>
            </div>
          </div>
        )}

        {thread.map((m, i) => (
          <Bubble key={i} role={m.role} text={m.text} />
        ))}

        {heard && <Bubble role="you" text={heard} live />}

        {pending.map((p, i) => (
          <MoveCard key={`${p.stock_number}-${i}`} proposal={p}
            onConfirm={() => confirm(p, i)}
            onCancel={() => setPending((rows) => rows.filter((_, j) => j !== i))} />
        ))}

        {busy && (
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <Loader2 size={14} className="animate-spin" /> Looking…
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 text-red-300 text-sm bg-red-500/10 border border-red-500/30 rounded-lg p-2.5">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      <div className="border-t border-slate-800 p-3 safe-bottom space-y-2">
        {/* Typing is the fallback, not the point — but a noisy shop and a
            recognizer that refuses to hear "Otta Body" both happen. */}
        <form
          onSubmit={(e) => { e.preventDefault(); const v = typed; setTyped(''); send(v) }}
          className="flex gap-2"
        >
          <input value={typed} onChange={(e) => setTyped(e.target.value)}
            placeholder="…or type it" className="flex-1 !py-2 text-sm" />
          <button type="submit" disabled={!typed.trim() || busy}
            className="px-3 rounded-lg bg-slate-800 text-slate-300 disabled:opacity-40">
            <CornerDownLeft size={16} />
          </button>
        </form>

        {supported === false ? (
          <p className="text-center text-[11px] text-slate-500">
            This device has no speech recognition — type instead.
          </p>
        ) : (
          <button
            onClick={toggleMic}
            disabled={busy}
            className={`w-full rounded-xl py-4 font-bold flex items-center justify-center gap-2 disabled:opacity-40 ${
              listening
                ? 'bg-red-500 text-slate-900'
                : 'bg-emerald-500 text-slate-900 active:bg-emerald-400'
            }`}
          >
            {listening ? <><Square size={18} /> Stop</> : <><Mic size={18} /> Talk</>}
          </button>
        )}
      </div>
    </div>
  )
}

function Bubble({ role, text, live }) {
  if (role === 'done') {
    return (
      <div className="flex items-start gap-2 text-emerald-300 text-sm bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-2.5">
        <Check size={14} className="mt-0.5 shrink-0" />
        <span>Moved · {text}</span>
      </div>
    )
  }
  const mine = role === 'you'
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${
        mine
          ? `bg-slate-800 text-slate-100 ${live ? 'opacity-60 italic' : ''}`
          : 'bg-slate-900 border border-slate-800 text-slate-200'
      }`}>
        {text}
      </div>
    </div>
  )
}

// What it understood, before anything happens. Deliberately spells out the car
// AND both ends of the move: the failure this exists to catch is a digit heard
// wrong, and you only catch that by reading back the car it picked.
function MoveCard({ proposal, onConfirm, onCancel }) {
  return (
    <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-3 space-y-2">
      <div className="font-semibold text-white">
        {proposal.vehicle || 'Vehicle'}
        {proposal.last6 && (
          <span className="font-mono text-slate-400 text-sm"> …{proposal.last6}</span>
        )}
      </div>
      <div className="text-sm text-slate-300">
        {proposal.from_label} <span className="text-emerald-400">→</span>{' '}
        <span className="font-semibold">{proposal.to_label}</span>
      </div>
      {proposal.note && <div className="text-xs text-slate-400">note: {proposal.note}</div>}
      <div className="text-[11px] text-slate-600 font-mono">{proposal.stock_number}</div>
      <div className="flex gap-2 pt-1">
        <button onClick={onConfirm} disabled={proposal._saving}
          className="flex-1 rounded-lg bg-emerald-500 text-slate-900 font-bold py-2.5 disabled:opacity-50 flex items-center justify-center gap-2">
          {proposal._saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
          Confirm
        </button>
        <button onClick={onCancel} disabled={proposal._saving}
          className="px-4 rounded-lg bg-slate-800 text-slate-300 font-semibold disabled:opacity-50">
          Cancel
        </button>
      </div>
    </div>
  )
}
