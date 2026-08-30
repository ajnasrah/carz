// Walk the car and talk. The agent listens, asks, and writes it down.
//
// The inspector holds the phone and says what he sees. Nothing is typed and
// nothing is remembered — the finding is captured in the second he is looking
// at it, which is the entire point. Reconstructing a list at the end of a drive
// is the thing that was losing problems, and no amount of better form design
// fixes it, because the loss happens between noticing and recording.
//
// Speech in comes from src/native/speech.js — the same wrapper Lot Walk already
// ships, Capacitor's recognizer on a phone and the browser's on the web. Speech
// out is the device's own voice: free, instant, and it works with no signal, so
// the agent can still lead the walk when the network drops.
//
// Every write goes through mechanicalFindings, exactly as the tap screens do,
// so the agent inherits the offline queue and the server-side merge instead of
// having a second, weaker write path of its own.

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Mic, Square, Loader2, Check } from 'lucide-react'
import { supabase } from '../services/supabase'
import { createSpeechSession, speechAvailable } from '../native/speech'
import { MECHANICAL_CHECKS, EXTERIOR_PANELS, INTERIOR_ZONES } from '../services/inspectionFlow'
import {
  addFinding, setCheckStatus, isAnswered, readFindings, readOtherFindings,
  addDamage, matchPanel, OTHER_SECTION,
} from '../services/mechanicalFindings'
import { fetchRepairHistory } from '../services/mechanic'
import { markTrackComplete } from '../services/tracks'

// Which section a check id belongs to, so an agent action lands in the right
// branch without the agent needing to know the shape of the JSON.
const SECTION_OF = Object.fromEntries(MECHANICAL_CHECKS.map((c) => [c.id, c.section]))
const LABEL_OF = Object.fromEntries(MECHANICAL_CHECKS.map((c) => [c.id, c.label]))

// The agent endpoint spends money per call, so it is gated on a signed-in
// employee. The session token travels with every request.
async function authHeaders() {
  const { data } = await supabase.auth.getSession()
  return {
    'content-type': 'application/json',
    ...(data?.session?.access_token
      ? { authorization: `Bearer ${data.session.access_token}` } : {}),
  }
}

// The default speechSynthesis voice is the worst one installed — on Apple
// devices it is the old compact Alex, which is where "sounds like a robot"
// comes from. The good voices are already on the phone; nothing picks them
// unless you ask by name.
//
// Ordered best-first. Anything with "Siri" or a name like Ava/Samantha is a
// modern neural voice; a `localService` en-US voice is the next best thing;
// the default is the last resort.
const VOICE_PREF = [
  /siri/i, /\bava\b/i, /samantha/i, /allison/i, /\bnicky\b/i, /\bzoe\b/i,
  /\bjoanna\b/i, /google us english/i, /\bkaren\b/i, /\bdaniel\b/i,
]

let cachedVoice
function pickVoice() {
  if (cachedVoice !== undefined) return cachedVoice
  if (typeof speechSynthesis === 'undefined') return (cachedVoice = null)
  const voices = speechSynthesis.getVoices() || []
  if (!voices.length) return null          // not loaded yet; try again next time

  const english = voices.filter((v) => /^en(-|_|$)/i.test(v.lang || ''))
  for (const want of VOICE_PREF) {
    // "Enhanced" / "Premium" variants exist on iOS and are markedly better.
    const hit = english.find((v) => want.test(v.name) && /enhanced|premium/i.test(v.name))
      || english.find((v) => want.test(v.name))
    if (hit) return (cachedVoice = hit)
  }
  return (cachedVoice = english.find((v) => v.localService) || english[0] || null)
}

if (typeof speechSynthesis !== 'undefined') {
  // Voices arrive asynchronously on most browsers; the first call usually gets
  // an empty list, so the cache is cleared once they land.
  speechSynthesis.onvoiceschanged = () => { cachedVoice = undefined }
}

function speak(text) {
  if (!text || typeof speechSynthesis === 'undefined') return
  try {
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    const v = pickVoice()
    if (v) { u.voice = v; u.lang = v.lang }
    // Slightly under natural pace: this is being heard once, outdoors, over an
    // engine, by somebody who is not looking at the screen.
    u.rate = 0.98
    u.pitch = 1
    speechSynthesis.speak(u)
  } catch { /* a phone with no voices installed still shows the text */ }
}

export default function InspectAgent() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [inspection, setInspection] = useState(null)
  const [loading, setLoading] = useState(true)
  const [listening, setListening] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [heard, setHeard] = useState('')
  const [log, setLog] = useState([])          // {who:'you'|'agent', text}
  const [issues, setIssues] = useState([])
  const [history, setHistory] = useState({ repairs: [], bodyShop: [] })
  const [error, setError] = useState('')
  const [canSpeak, setCanSpeak] = useState(true)
  const [typed, setTyped] = useState('')
  const [finished, setFinished] = useState('')

  const sessionRef = useRef(null)
  const historyRef = useRef([])               // the Claude message list
  const checklistRef = useRef({})
  const busyRef = useRef(false)
  const openedRef = useRef(false)             // the greeting fires exactly once

  // ------------------------------------------------------------- load the car
  useEffect(() => {
    let alive = true
    async function load() {
      const { data } = await supabase.from('inspections').select('*').eq('id', id).single()
      if (!alive) return
      setInspection(data)
      checklistRef.current = data?.checklist || {}
      setLoading(false)

      speechAvailable().then((ok) => alive && setCanSpeak(!!ok)).catch(() => {})

      // What this model is known for, fetched once and handed to the agent as
      // background. Not spoken at the inspector — it earns its place only when
      // the agent decides it is worth his time.
      try {
        const res = await fetch('/api/inspect-agent', {
          method: 'POST',
          headers: await authHeaders(),
          body: JSON.stringify({
            mode: 'known_issues',
            car: { year: data?.year, make: data?.make, model: data?.model },
          }),
        })
        const json = await res.json()
        if (alive && Array.isArray(json.issues)) setIssues(json.issues)
      } catch { /* the walk works without the briefing */ }

      // An outbound walk is partly an audit of our own repairs, so the agent
      // needs to know what we paid to fix before it can tell him how to check it.
      if (data?.type === 'outbound') {
        try {
          const h = await fetchRepairHistory(data.vin_last6 || (data.vin || '').slice(-6))
          if (alive) setHistory(h)
        } catch { /* a walk without the history is still a walk */ }
      }
    }
    load()
    return () => { alive = false }
  }, [id])

  // The agent speaks first, always.
  //
  // Somebody on their first day does not know what to say to a phone, and a
  // silent screen with a microphone on it is a screen they will put back in
  // their pocket. So the walk opens with the agent telling them where to stand
  // and what to look at, and it keeps leading from there.
  useEffect(() => {
    if (loading || !inspection || openedRef.current) return
    openedRef.current = true
    send('[begin]')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, inspection])

  // ------------------------------------------------------------ progress
  const covered = MECHANICAL_CHECKS.filter((c) => isAnswered(checklistRef.current, c.section, c.id))
  const findingCount =
    MECHANICAL_CHECKS.reduce((n, c) => n + readFindings(checklistRef.current, c.section, c.id).length, 0)
    + readOtherFindings(checklistRef.current).length

  // ---------------------------------------------------- apply what it decided
  //
  // The agent returns actions; the phone performs them with the same services
  // the tap screens use. A failure here must not kill the conversation — the
  // inspector is mid-sentence — so each one is caught on its own.
  const callAgent = useCallback(async (messages) => {
    const remaining = MECHANICAL_CHECKS
      .filter((c) => !isAnswered(checklistRef.current, c.section, c.id))
      .map((c) => c.label)
    const res = await fetch('/api/inspect-agent', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({
        mode: 'turn',
        type: inspection?.type || 'inbound',
        car: {
          year: inspection?.year, make: inspection?.make,
          model: inspection?.model, mileage: inspection?.mileage,
        },
        issues,
        repairs: history.repairs,
        bodyShop: history.bodyShop,
        covered: MECHANICAL_CHECKS
          .filter((c) => isAnswered(checklistRef.current, c.section, c.id))
          .map((c) => c.label),
        remaining,
        messages,
      }),
    })
    const json = await res.json()
    if (json.error) throw new Error(json.error)
    return json
  }, [inspection, issues, history])

  const applyActions = useCallback(async (actions) => {
    const done = []
    for (const a of actions) {
      try {
        if (a.name === 'record_problem') {
          const { check, description, severity } = a.input || {}
          const section = SECTION_OF[check] || OTHER_SECTION
          const checkId = SECTION_OF[check] ? check : null
          const { checklist } = await addFinding(
            id, checklistRef.current, section, checkId, { description, severity })
          checklistRef.current = checklist
          done.push(`${LABEL_OF[check] ? LABEL_OF[check] + ' — ' : ''}${description}`)
        } else if (a.name === 'record_damage') {
          // Damage goes on the panel branches the diagram screens own, because
          // that is what the work order router counts to decide whether to open
          // a BODY SHOP ticket. Recorded as a finding instead, a dented door
          // would have opened a MECHANIC line — the right information sent to
          // the wrong shop, which is worse than not recording it, because
          // somebody acts on it.
          const { area, panel, type, size, note } = a.input || {}
          const panelId = matchPanel(area, panel, EXTERIOR_PANELS, INTERIOR_ZONES)
          const label = panelId
            ? String(panelId).replace(/_/g, ' ')
            : String(panel || 'unspecified').replace(/_/g, ' ')
          checklistRef.current = await addDamage(
            id, checklistRef.current, area,
            // An unmatched panel keeps the spoken name rather than being
            // dropped: an oddly-labelled ticket still gets the car fixed.
            panelId || `spoken_${String(panel || 'other').toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
            { type, size, note })
          done.push([type, `on the ${label}`, size && `(${size})`].filter(Boolean).join(' '))
        } else if (a.name === 'finish_walk') {
          // Closing the walk completes the inspection, which is what fires the
          // work order router and opens the tickets. Every track is marked so
          // the tap screens and this one agree the car is finished.
          for (const track of ['quick', 'condition', 'drive']) {
            await markTrackComplete(id, track)
          }
          setFinished(a.input?.summary || 'Inspection complete.')
        } else if (a.name === 'mark_good') {
          for (const check of a.input?.checks || []) {
            const section = SECTION_OF[check]
            if (!section) continue
            checklistRef.current = await setCheckStatus(
              id, checklistRef.current, section, check, 'pass')
          }
        }
      } catch (e) {
        setError(e.message || 'Could not save that one — say it again')
      }
    }
    if (done.length) setLog((l) => [...l, { who: 'saved', text: done.join(' · ') }])
  }, [id])

  // --------------------------------------------------------------- one turn
  const send = useCallback(async (text) => {
    const said = String(text || '').trim()
    if (!said || busyRef.current) return
    busyRef.current = true
    setThinking(true); setError('')
    // '[begin]' is how the page asks the agent to open the walk. It is an
    // instruction, not something a person said, so it never appears in the log.
    if (said !== '[begin]') setLog((l) => [...l, { who: 'you', text: said }])
    historyRef.current = [...historyRef.current, { role: 'user', content: said }]

    try {
      // Recording is only half a turn: when the model calls tools it STOPS, so
      // the results have to go back before it can say the next thing. And it
      // can call tools AGAIN on the way back — record two problems, then ask
      // for a photo — so this is a loop, not one round trip.
      //
      // Handling only one round left a tool_use with no tool_result in the
      // history, and the API rejects the NEXT message with a 400 that kills the
      // whole conversation. The bug does not show up until the third turn.
      let json = await callAgent(historyRef.current)
      let guard = 0
      while (json.actions?.length && guard < 5) {
        guard += 1
        historyRef.current = [...historyRef.current, { role: 'assistant', content: json.content }]
        await applyActions(json.actions)
        historyRef.current = [...historyRef.current, {
          role: 'user',
          content: json.actions.map((a) => ({
            type: 'tool_result', tool_use_id: a.id, content: 'recorded',
          })),
        }]
        json = await callAgent(historyRef.current)
      }
      historyRef.current = [...historyRef.current, { role: 'assistant', content: json.content }]

      if (json.say) {
        setLog((l) => [...l, { who: 'agent', text: json.say }])
        speak(json.say)
      }
    } catch (e) {
      setError(e.message || 'The agent did not answer — try again')
    } finally {
      busyRef.current = false
      setThinking(false)
    }
  }, [callAgent, applyActions])

  // --------------------------------------------------------------- listening
  function startListening() {
    setError('')
    const session = createSpeechSession({
      onResult: ({ text, isFinal }) => {
        setHeard(text)
        // Only settled speech is sent. Acting on partials is right for Lot Walk
        // — a digit string that matches one car is unambiguous — but here a
        // half-heard sentence would be recorded as a finding, and a wrong
        // finding is worse than a slow one.
        if (isFinal && text.trim()) {
          setHeard('')
          send(text)
        }
      },
      onError: (e) => setError(typeof e === 'string' ? e : 'Could not hear you'),
    })
    sessionRef.current = session
    session.start()
    setListening(true)
  }

  function stopListening() {
    sessionRef.current?.stop()
    sessionRef.current?.destroy?.()
    sessionRef.current = null
    setListening(false)
  }

  useEffect(() => () => {
    sessionRef.current?.stop?.()
    sessionRef.current?.destroy?.()
    try { speechSynthesis?.cancel() } catch { /* nothing speaking */ }
  }, [])

  if (loading) return <div className="page text-center text-slate-400 pt-20">Loading…</div>
  if (!inspection) return <div className="page text-center text-red-400 pt-20">Not found</div>

  const carLabel = [inspection.year, inspection.make, inspection.model].filter(Boolean).join(' ')

  return (
    <div className="page pb-40">
      <div className="flex items-center gap-2 mb-3">
        <button onClick={() => navigate(`/inspect/${id}/review`)} aria-label="Back"
          className="p-2 -ml-2 rounded-lg bg-slate-800 text-slate-300 active:bg-slate-700">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold truncate leading-tight">
            {carLabel || `VIN …${inspection.vin_last6 || ''}`}
          </h1>
          <p className="text-[11px] text-slate-400">
            {inspection.type === 'outbound' ? 'Outbound · condition report' : 'Inbound'}
            {' · '}{covered.length}/{MECHANICAL_CHECKS.length} covered · {findingCount} found
          </p>
        </div>
      </div>

      {error && (
        <div className="card border-red-500/40 bg-red-500/10 text-red-300 text-sm mb-3">{error}</div>
      )}

      {finished && (
        <div className="card border-emerald-500/40 bg-emerald-500/10 mb-3">
          <p className="text-emerald-300 text-sm font-semibold">Inspection complete</p>
          <p className="text-[11px] text-slate-300 mt-1">{finished}</p>
          <p className="text-[11px] text-slate-400 mt-1">
            The work orders are open — anything for the shops is on their boards now.
          </p>
          <button onClick={() => navigate(`/inspect/${id}/review`)}
            className="btn-primary mt-2 text-sm">See the report</button>
        </div>
      )}

      {!canSpeak && (
        <div className="card border-amber-500/40 bg-amber-500/10 text-amber-300 text-sm mb-3">
          This phone won't let the app listen. Check microphone and speech permission in Settings.
        </div>
      )}

      {/* The conversation. Newest at the bottom, the way a chat reads. */}
      <div className="space-y-2 mb-4">
        {log.length === 0 && (
          <div className="card text-center py-8">
            <div className="text-4xl mb-2">🎙</div>
            <p className="text-slate-300 text-sm font-semibold">Start talking and walk the car.</p>
            <p className="text-slate-500 text-[11px] mt-1 leading-snug">
              Say what you see as you see it. One problem at a time is fine —
              so is three in a row.
            </p>
          </div>
        )}
        {log.map((m, i) => (
          <div key={i} className={
            m.who === 'you' ? 'text-right'
            : m.who === 'saved' ? '' : ''}>
            {m.who === 'saved' ? (
              <div className="flex items-start gap-2 text-[11px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-2.5 py-1.5">
                <Check size={13} className="shrink-0 mt-0.5" />
                <span>{m.text}</span>
              </div>
            ) : (
              <div className={`inline-block max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                m.who === 'you'
                  ? 'bg-slate-700 text-slate-100'
                  : 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-100'}`}>
                {m.text}
              </div>
            )}
          </div>
        ))}
        {heard && (
          <div className="text-right">
            <div className="inline-block max-w-[85%] rounded-2xl px-3 py-2 text-sm bg-slate-800 text-slate-400 italic">
              {heard}…
            </div>
          </div>
        )}
        {thinking && (
          <div className="flex items-center gap-2 text-slate-500 text-xs">
            <Loader2 size={13} className="animate-spin" /> thinking…
          </div>
        )}
      </div>

      {/* The one control. Big, fixed, reachable with a thumb and greasy hands.
          The text box under it is not a nicety: a denied microphone, a loud
          shop, or a word the recogniser will never get right all leave somebody
          standing at a car with no way to record what he is looking at. Talking
          is the fast path, not the only path. */}
      <div className="fixed inset-x-0 bottom-0 px-4 pt-4 bg-gradient-to-t from-slate-950 via-slate-950/95 to-transparent"
        style={{ paddingBottom: 'calc(0.75rem + var(--safe-bottom, 0px))' }}>
        <button
          onClick={listening ? stopListening : startListening}
          disabled={!canSpeak}
          className={`w-full py-5 rounded-2xl font-bold text-lg flex items-center justify-center gap-3 disabled:opacity-40 ${
            listening
              ? 'bg-red-500 text-slate-900 animate-pulse'
              : 'bg-emerald-500 text-slate-900 active:bg-emerald-600'}`}>
          {listening ? <Square size={22} /> : <Mic size={24} />}
          {listening ? 'Listening — tap to stop' : 'Talk to it'}
        </button>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            const t = typed.trim()
            if (!t || thinking) return
            setTyped('')
            send(t)
          }}
          className="flex gap-2 mt-2">
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="…or type it"
            className="text-sm !py-2.5"
          />
          <button type="submit" disabled={!typed.trim() || thinking}
            className="shrink-0 px-4 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 font-semibold text-sm disabled:opacity-40">
            Send
          </button>
        </form>
      </div>
    </div>
  )
}
