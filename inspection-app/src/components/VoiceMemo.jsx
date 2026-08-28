// Say it now, sort it later.
//
// The test drive is the one part of the job done with both hands busy and eyes
// on the road, and it is exactly where findings were being lost — not because
// the inspector didn't notice, but because noticing and recording were minutes
// apart and the recording step needed a keyboard.
//
// One tap starts, one tap stops. Nothing to choose, nothing to type. A noise is
// also the one finding a mechanic genuinely cannot picture from a sentence, so
// the recording is often more use to him than any write-up would have been.
//
// Deliberately NOT transcribed here: that needs a speech vendor nobody has
// picked yet, and waiting for one would mean shipping nothing. The audio is
// attached to the finding and plays on the tech's board; transcription can be
// added later without changing what is stored.

import { useState, useRef, useEffect } from 'react'
import { Mic, Square, Loader2 } from 'lucide-react'

// Safari and older Android webviews disagree about what MediaRecorder accepts;
// the first supported type wins and its extension follows the container.
const CANDIDATES = [
  { mime: 'audio/mp4', ext: 'm4a' },
  { mime: 'audio/webm;codecs=opus', ext: 'webm' },
  { mime: 'audio/webm', ext: 'webm' },
  { mime: 'audio/ogg;codecs=opus', ext: 'ogg' },
]

function pickFormat() {
  if (typeof MediaRecorder === 'undefined') return null
  for (const c of CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(c.mime)) return c
    } catch { /* isTypeSupported can throw on old webviews */ }
  }
  return { mime: '', ext: 'webm' }   // let the browser choose
}

export default function VoiceMemo({ onRecorded, big = false, label = 'Voice note' }) {
  const [state, setState] = useState('idle')   // idle | recording | saving
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')
  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)
  const timerRef = useRef(null)

  // A recording left running because the page was closed would hold the mic
  // open for the rest of the session.
  useEffect(() => () => {
    try { recorderRef.current?.state === 'recording' && recorderRef.current.stop() } catch { /* already gone */ }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    clearInterval(timerRef.current)
  }, [])

  async function start() {
    setError('')
    const fmt = pickFormat()
    if (!fmt) { setError('This phone cannot record audio'); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const rec = new MediaRecorder(stream, fmt.mime ? { mimeType: fmt.mime } : undefined)
      chunksRef.current = []
      rec.ondataavailable = (e) => { if (e.data?.size) chunksRef.current.push(e.data) }
      rec.onstop = async () => {
        clearInterval(timerRef.current)
        streamRef.current?.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunksRef.current, { type: fmt.mime || 'audio/webm' })
        setState('saving')
        try {
          await onRecorded(blob, fmt.ext, seconds)
        } catch (e) {
          setError(e.message || 'Could not save the recording')
        } finally {
          setState('idle')
          setSeconds(0)
        }
      }
      recorderRef.current = rec
      rec.start()
      setState('recording')
      setSeconds(0)
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000)
    } catch (e) {
      setError(e.name === 'NotAllowedError'
        ? 'Microphone permission is off for this app'
        : (e.message || 'Could not start recording'))
    }
  }

  function stop() {
    try { recorderRef.current?.stop() } catch { /* nothing to stop */ }
  }

  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

  if (big) {
    return (
      <div>
        <button
          type="button"
          onClick={state === 'recording' ? stop : start}
          disabled={state === 'saving'}
          className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 ${
            state === 'recording'
              ? 'bg-red-500 text-slate-900 animate-pulse'
              : 'bg-slate-800 border border-slate-700 text-slate-200 active:bg-slate-700'}`}>
          {state === 'saving' ? <Loader2 size={18} className="animate-spin" />
            : state === 'recording' ? <Square size={16} /> : <Mic size={18} />}
          {state === 'saving' ? 'Saving…'
            : state === 'recording' ? `Recording ${mmss} — tap to stop`
            : label}
        </button>
        {error && <p className="text-[11px] text-red-400 mt-1">{error}</p>}
      </div>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={state === 'recording' ? stop : start}
        disabled={state === 'saving'}
        aria-label={state === 'recording' ? 'Stop recording' : 'Record a voice note'}
        title={error || 'Record a voice note'}
        className={`shrink-0 p-1 rounded ${
          state === 'recording' ? 'text-red-400 animate-pulse' : 'text-slate-400 active:bg-slate-700'}`}>
        {state === 'saving' ? <Loader2 size={13} className="animate-spin" />
          : state === 'recording' ? <Square size={13} /> : <Mic size={13} />}
      </button>
      {state === 'recording' && (
        <span className="shrink-0 text-[10px] text-red-400 tabular-nums">{mmss}</span>
      )}
    </>
  )
}
