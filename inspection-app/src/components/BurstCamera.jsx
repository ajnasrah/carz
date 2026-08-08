// Shoot a run of photos in one go: the stream stays live between shots, so it's
// tap-tap-tap around the car and one Done at the end.
//
// The phone's own camera sheet (<input capture>) closes after every single shot
// and drops you back on the page — twelve photos meant twelve round trips, which
// is why nobody used it. This never leaves the viewfinder.
//
// Nothing uploads from here. Done hands the files up and the caller decides what
// to do with them, so this component works anywhere a batch of photos is wanted.

import { useEffect, useRef, useState } from 'react'
import { X, RefreshCw, Check } from 'lucide-react'
import { tap } from '../native/haptics'

export default function BurstCamera({ title = 'Photos', onDone, onCancel }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const shotsRef = useRef([])
  const [shots, setShots] = useState([])
  const [facing, setFacing] = useState('environment')
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [flash, setFlash] = useState(false)

  // The unmount cleanup below must see the LAST shots without re-running on
  // every shot (which would revoke the URLs out from under the strip).
  useEffect(() => { shotsRef.current = shots }, [shots])
  useEffect(() => () => shotsRef.current.forEach((s) => URL.revokeObjectURL(s.url)), [])

  useEffect(() => {
    let cancelled = false

    async function start() {
      setReady(false)
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.onloadedmetadata = () => setReady(true)
        }
      } catch (e) {
        setError(e.message || 'Camera unavailable. Check the app’s camera permission.')
      }
    }
    start()

    return () => {
      cancelled = true
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
    }
  }, [facing])

  function shoot() {
    const video = videoRef.current
    if (!video || !ready) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
    // Async, so the viewfinder is already live again by the time the JPEG lands —
    // the shutter never blocks the next shot.
    canvas.toBlob((blob) => {
      if (!blob) return
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      setShots((s) => [...s, {
        id: crypto.randomUUID(),
        url: URL.createObjectURL(blob),
        file: new File([blob], `shot-${stamp}.jpg`, { type: 'image/jpeg' }),
      }])
    }, 'image/jpeg', 0.9)
    tap()
    setFlash(true)
    setTimeout(() => setFlash(false), 110)
  }

  function drop(id) {
    setShots((s) => {
      const gone = s.find((x) => x.id === id)
      if (gone) URL.revokeObjectURL(gone.url)
      return s.filter((x) => x.id !== id)
    })
  }

  if (error) {
    return (
      <div className="fixed inset-0 bg-black z-50 flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <p className="text-red-400 font-bold mb-2 text-lg">Camera Unavailable</p>
          <p className="text-slate-400 text-sm mb-6">{error}</p>
          <button onClick={onCancel} className="btn-secondary">Close</button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black z-50">
      <video ref={videoRef} autoPlay playsInline muted
        className="absolute inset-0 w-full h-full object-cover" />

      {flash && <div className="absolute inset-0 bg-white/80 pointer-events-none" />}

      {/* Top bar */}
      <div className="absolute top-0 inset-x-0 flex items-center justify-between gap-3 px-4 pb-3 pt-[calc(1rem+env(safe-area-inset-top))] bg-gradient-to-b from-black/80 to-transparent">
        <button onClick={onCancel} aria-label="Close" className="p-1.5 text-white active:text-slate-400">
          <X size={24} />
        </button>
        <p className="text-white font-bold text-sm truncate">{title}</p>
        <button onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}
          aria-label="Flip camera" className="p-1.5 text-white active:text-slate-400">
          <RefreshCw size={20} />
        </button>
      </div>

      {/* What you've shot so far — tap one to throw it away before it uploads. */}
      {shots.length > 0 && (
        <div className="absolute bottom-[calc(8.5rem+env(safe-area-inset-bottom))] inset-x-0 px-3">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {shots.map((s) => (
              <button key={s.id} onClick={() => drop(s.id)}
                className="relative shrink-0 w-14 h-14 rounded-lg overflow-hidden border border-white/40">
                <img src={s.url} alt="" className="w-full h-full object-cover" />
                <span className="absolute top-0 right-0 bg-black/70 text-white text-[9px] px-1 rounded-bl">✕</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Shutter row */}
      <div className="absolute bottom-0 inset-x-0 px-6 pt-6 pb-[calc(2rem+env(safe-area-inset-bottom))] bg-gradient-to-t from-black/80 to-transparent flex items-center justify-between gap-4">
        <span className="w-24 text-white text-xs font-semibold tabular-nums">
          {shots.length > 0 ? `${shots.length} photo${shots.length === 1 ? '' : 's'}` : ''}
        </span>

        <button onClick={shoot} disabled={!ready} aria-label="Take photo"
          className="shrink-0 rounded-full border-4 border-white/80 p-1 disabled:opacity-40 active:scale-95 transition-transform"
          style={{ width: 72, height: 72 }}>
          <span className="block w-full h-full rounded-full bg-white" />
        </button>

        <button onClick={() => (shots.length ? onDone(shots.map((s) => s.file)) : onCancel())}
          className={`w-24 flex items-center justify-center gap-1 py-2.5 rounded-xl font-bold text-sm ${
            shots.length ? 'bg-emerald-500 text-slate-900 active:bg-emerald-600' : 'bg-slate-800 text-slate-300'
          }`}>
          <Check size={16} /> Done
        </button>
      </div>
    </div>
  )
}
