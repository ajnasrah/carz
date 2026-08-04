import { useRef, useEffect, useState } from 'react'
import { X, RotateCcw, Loader, Smartphone } from 'lucide-react'
import CameraOutline from './CameraOutline'

// Which outline types require landscape orientation. Corner shots need the whole
// car in frame — impossible to compose portrait.
const LANDSCAPE_OUTLINES = new Set(['car_fl', 'car_fr', 'car_rr', 'car_rl'])

export default function CameraCapture({ label, instructions, outline, onCapture, onCancel }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [error, setError] = useState(null)
  const [ready, setReady] = useState(false)
  const [preview, setPreview] = useState(null)
  const [facingMode, setFacingMode] = useState('environment')
  const [cameraKey, setCameraKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [isPortrait, setIsPortrait] = useState(
    typeof window !== 'undefined' ? window.innerHeight > window.innerWidth : false,
  )

  const needsLandscape = LANDSCAPE_OUTLINES.has(outline)

  useEffect(() => {
    function onResize() {
      setIsPortrait(window.innerHeight > window.innerWidth)
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function start() {
      try {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop())
          streamRef.current = null
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.onloadedmetadata = () => setReady(true)
        }
      } catch (err) {
        setError(err.message || 'Camera unavailable. Check browser permissions.')
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
  }, [facingMode, cameraKey])

  function handleShutter() {
    const video = videoRef.current
    if (!video || !ready) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(
      (blob) => {
        if (!blob) return
        // Stop camera stream during preview to save battery on mobile
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop())
          streamRef.current = null
        }
        const url = URL.createObjectURL(blob)
        setPreview({ url, blob })
      },
      'image/jpeg',
      0.92,
    )
  }

  async function handleConfirm() {
    if (!preview || saving) return
    setSaving(true)
    setSaveError(null)
    const file = new File([preview.blob], `${label.replace(/\s+/g, '_')}.jpg`, {
      type: 'image/jpeg',
    })
    try {
      await onCapture(file)
      URL.revokeObjectURL(preview.url)
    } catch (err) {
      setSaveError(err?.message || 'Save failed. Tap Retry.')
      setSaving(false)
    }
  }

  function handleRetake() {
    if (preview) URL.revokeObjectURL(preview.url)
    setPreview(null)
    setReady(false)
    setCameraKey((k) => k + 1) // restart camera stream
  }

  function toggleCamera() {
    setReady(false)
    setFacingMode((m) => (m === 'environment' ? 'user' : 'environment'))
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

  const showRotatePrompt = needsLandscape && isPortrait && !preview

  return (
    <div className="fixed inset-0 bg-black z-50">
      {preview ? (
        <>
          <img src={preview.url} alt="preview" className="absolute inset-0 w-full h-full object-cover" />
          {saving && (
            <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center">
              <Loader size={48} className="text-emerald-400 animate-spin mb-3" />
              <p className="text-white font-bold text-lg">Saving photo...</p>
              <p className="text-slate-300 text-sm mt-1">Do not close this screen</p>
            </div>
          )}
          <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/80 to-transparent px-4 pb-4 pt-[calc(1.5rem+env(safe-area-inset-top))]">
            <p className="text-white font-bold text-base">{label}</p>
            <p className="text-slate-300 text-xs mt-0.5">
              {saving ? 'Uploading to cloud...' : saveError ? saveError : 'Review photo before saving'}
            </p>
          </div>
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-6 pt-6 pb-[calc(2.5rem+env(safe-area-inset-bottom))] flex items-center justify-between gap-4">
            <button
              onClick={handleRetake}
              disabled={saving}
              className="flex-1 py-3 rounded-xl bg-slate-800 text-white font-bold active:bg-slate-700 disabled:opacity-40"
            >
              Retake
            </button>
            <button
              onClick={handleConfirm}
              disabled={saving}
              className="flex-1 py-3 rounded-xl bg-emerald-500 text-slate-900 font-bold active:bg-emerald-600 disabled:opacity-60"
            >
              {saving ? 'Saving...' : saveError ? 'Retry' : 'Use Photo'}
            </button>
          </div>
        </>
      ) : (
        <>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover"
          />

          {/* Big oval guide — fills the whole screen with tight margins.
              User fits the subject inside the dashed oval. */}
          <div className="absolute inset-2 pointer-events-none text-white drop-shadow-[0_0_8px_rgba(0,0,0,1)]">
            <CameraOutline />
          </div>

          <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/80 to-transparent px-4 pb-4 pt-[calc(1.5rem+env(safe-area-inset-top))]">
            <div className="flex items-start gap-3">
              <button
                onClick={onCancel}
                className="p-2 rounded-full bg-black/60 text-white shrink-0"
              >
                <X size={20} />
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-white font-bold text-base">{label}</p>
                <p className="text-slate-200 text-xs mt-0.5 leading-snug">{instructions}</p>
              </div>
              <button
                onClick={toggleCamera}
                className="p-2 rounded-full bg-black/60 text-white shrink-0"
                title="Flip camera"
              >
                <RotateCcw size={18} />
              </button>
            </div>
          </div>

          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-6 pt-6 pb-[calc(2.5rem+env(safe-area-inset-bottom))] flex justify-center">
            <button
              onClick={handleShutter}
              disabled={!ready || showRotatePrompt}
              className="w-20 h-20 rounded-full bg-white/20 border-4 border-white active:scale-95 transition-transform disabled:opacity-30 flex items-center justify-center"
              aria-label="Take photo"
            >
              <div className="w-16 h-16 rounded-full bg-white" />
            </button>
          </div>

          {/* Rotate-phone banner for corner shots — overlays the live camera */}
          {showRotatePrompt && (
            <div className="absolute inset-0 bg-black/85 flex items-center justify-center p-6 pointer-events-none">
              <div className="text-center">
                <Smartphone size={64} className="mx-auto text-emerald-400 mb-4" style={{ transform: 'rotate(90deg)' }} />
                <p className="text-white font-bold text-xl mb-2">Rotate your phone</p>
                <p className="text-slate-300 text-sm max-w-xs mx-auto">
                  {label} needs landscape mode — the whole car has to fit in the frame.
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
