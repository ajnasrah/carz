import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Mic, Square, Search, CheckCircle2, X, AlertCircle, Camera, CameraOff } from 'lucide-react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { supabase } from '../services/supabase'
import {
  fetchSections, recordScan, recordUnmatchedVehicle, filterInventory, parseSpokenDigits,
  extractVIN, matchVehicleByVIN,
} from '../services/lotTracking'

const RECENT_LIMIT = 6

export default function LotWalk() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [sections, setSections] = useState([])
  const [section, setSection] = useState('')
  const [inventory, setInventory] = useState([])
  const [query, setQuery] = useState(() => searchParams.get('stock') || searchParams.get('last6') || '')
  const [recent, setRecent] = useState([])
  const [toast, setToast] = useState(null)
  const [voiceOn, setVoiceOn] = useState(false)
  const [voiceText, setVoiceText] = useState('')
  const [voiceSupported] = useState(
    () => typeof window !== 'undefined' &&
      !!(window.SpeechRecognition || window.webkitSpeechRecognition)
  )
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [loading, setLoading] = useState(true)
  const recognitionRef = useRef(null)
  const cameraScannerRef = useRef(null)
  // Tracks whether html5-qrcode is actively running. Without this guard,
  // calling .stop() on a never-started scanner throws synchronously.
  const cameraRunningRef = useRef(false)
  const inputRef = useRef(null)
  // TTL Map for dedupe: key = "stock|section", value = expires_at (ms epoch).
  // Blocks ANY duplicate submission within the dedupe window, not just consecutive ones.
  const recentScansRef = useRef(new Map())
  // Stable refs so the voice-recognition effect can read latest values without re-running
  const inventoryRef = useRef([])
  const submitScanRef = useRef(null)

  const showToast = useCallback((kind, title, body) => {
    setToast({ kind, title, body, id: Date.now() })
  }, [])

  // Initial load — sections + inventory. Each query is independent so we can
  // pinpoint which one failed and surface a useful error.
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    let cancelled = false
    async function load() {
      // Inventory query (independent of sections)
      const invRes = await supabase
        .from('inventory')
        .select('stock_number, vehicle_vin, last_6_vin, vehicle_year, vehicle_make, vehicle_model')
      if (cancelled) return
      if (invRes.error) {
        console.error('LotWalk inventory load failed', invRes.error)
        showToast('error', 'Inventory load failed', invRes.error.message)
      } else {
        setInventory(invRes.data || [])
      }

      // Sections query (independent of inventory)
      try {
        const secs = await fetchSections()
        if (cancelled) return
        setSections(secs)
        if (secs.length === 0) {
          showToast('error', 'No sections', 'Run lot-tracking-schema.sql in Supabase SQL Editor.')
        } else {
          // Restore last selected section from localStorage
          const saved = localStorage.getItem('lotwalk:section')
          if (saved && secs.some((s) => s.name === saved)) setSection(saved)
          else setSection(secs[0].name)
        }
      } catch (err) {
        if (cancelled) return
        console.error('LotWalk sections load failed', err)
        const msg = err?.message || String(err)
        if (msg.includes('does not exist') || msg.includes('lot_sections')) {
          showToast('error', 'Migration not run', 'Run lot-tracking-schema.sql in Supabase SQL Editor.')
        } else {
          showToast('error', 'Sections load failed', msg)
        }
      }

      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [])
  /* eslint-enable react-hooks/exhaustive-deps */

  // Persist section choice across visits
  useEffect(() => {
    if (section) localStorage.setItem('lotwalk:section', section)
  }, [section])

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2400)
    return () => clearTimeout(t)
  }, [toast])

  const matches = useMemo(() => filterInventory(inventory, query).slice(0, 8), [inventory, query])

  const submitScan = useCallback(async (vehicle, inputMethod) => {
    if (!section) {
      showToast('error', 'Pick a section first', 'Set the section dropdown at top.')
      return
    }
    // Dedupe: block ANY duplicate (stock, section) submission within 3 seconds —
    // not just consecutive ones. Catches accidental rescans even if the user
    // tapped other cars in between. Same car in a DIFFERENT section is a real
    // move event and is NOT deduped.
    const now = Date.now()
    const dedupeKey = `${vehicle.stock_number}|${section}`
    // Sweep expired entries to keep the map small
    for (const [k, exp] of recentScansRef.current) {
      if (exp <= now) recentScansRef.current.delete(k)
    }
    if (recentScansRef.current.has(dedupeKey)) {
      return
    }
    recentScansRef.current.set(dedupeKey, now + 3000)

    try {
      await recordScan({
        stock_number: vehicle.stock_number,
        vin: vehicle.vehicle_vin,
        section,
        input_method: inputMethod,
      })
      const label = [vehicle.vehicle_year, vehicle.vehicle_make, vehicle.vehicle_model]
        .filter(Boolean).join(' ')
      showToast('success', `${label || vehicle.stock_number} → ${section}`,
        `Stock ${vehicle.stock_number}`)
      setRecent((prev) => [
        { ...vehicle, section, scannedAt: new Date(), inputMethod },
        ...prev.filter((r) => r.stock_number !== vehicle.stock_number),
      ].slice(0, RECENT_LIMIT))
      setQuery('')
      setVoiceText('')
      // Refocus input for next scan
      setTimeout(() => inputRef.current?.focus(), 50)
    } catch (err) {
      showToast('error', 'Scan failed', err.message)
    }
  }, [section, showToast])

  // Keep refs in sync so voice + camera effects can read latest without re-running
  useEffect(() => { inventoryRef.current = inventory }, [inventory])
  useEffect(() => { submitScanRef.current = submitScan }, [submitScan])

  // ── Camera barcode scanner ──
  // Resolves a decoded barcode/QR text into a vehicle and logs the scan.
  // Supports factory door-jamb VIN barcodes (17 chars), QR codes containing
  // VINs or stock numbers, and any Code 39/128/Data Matrix that maps to one.
  const handleCameraDecoded = useCallback(async (decodedText) => {
    if (!decodedText) return
    // 1. Try VIN extraction (17-char VIN pattern, no I/O/Q)
    const vin = extractVIN(decodedText)
    if (vin) {
      const vehicle = matchVehicleByVIN(inventoryRef.current, vin)
      if (vehicle) {
        submitScanRef.current?.(vehicle, 'barcode')
        return
      }
      // VIN not found in inventory - record as unmatched
      try {
        await recordUnmatchedVehicle({
          scanned_value: vin,
          scan_type: 'vin',
          section,
          scan_method: 'barcode',
          notes: 'Full VIN scanned but not in inventory'
        })
        showToast('warning', 'Unknown VIN recorded', `${vin.slice(-6)} - Added to unmatched list`)
      } catch (err) {
        console.error('Failed to record unmatched VIN', err)
        showToast('error', 'VIN not in inventory', `Scanned ${vin.slice(-6)}`)
      }
      return
    }
    // 2. No 17-char VIN — maybe a QR with a stock number or short code.
    //    Try the same filter that type/voice use.
    const trimmed = decodedText.trim().toUpperCase()
    const matches = filterInventory(inventoryRef.current, trimmed)
    if (matches.length === 1) {
      submitScanRef.current?.(matches[0], 'barcode')
    } else if (matches.length > 1) {
      setQuery(trimmed)  // surface for user to tap
    } else {
      // No match - record as unmatched
      try {
        await recordUnmatchedVehicle({
          scanned_value: trimmed,
          scan_type: trimmed.length === 6 ? 'partial_vin' : 'unknown',
          section,
          scan_method: 'barcode',
          notes: `Scanned value not found in inventory`
        })
        showToast('warning', 'Unknown vehicle recorded', `"${trimmed.slice(0, 20)}" - Added to unmatched list`)
      } catch (err) {
        console.error('Failed to record unmatched scan', err)
        showToast('error', 'No match', `Scanned "${trimmed.slice(0, 20)}" — not in inventory`)
      }
    }
  }, [showToast, section])

  // Safely stop the scanner — html5-qrcode throws synchronously if you call
  // .stop() on a scanner that was never started, so we guard with cameraRunningRef
  // AND wrap in try/catch as a belt-and-suspenders safety net.
  const stopCameraSafely = useCallback(async () => {
    const scanner = cameraScannerRef.current
    if (!scanner || !cameraRunningRef.current) return
    try {
      await scanner.stop()
    } catch { /* already stopped or in a weird state */ }
    cameraRunningRef.current = false
  }, [])

  // Camera scanner is created lazily on first toggle, not on mount.
  // This avoids React 19 StrictMode double-mount issues with html5-qrcode,
  // which crashes if .stop() is called on a never-started instance.
  useEffect(() => {
    return () => {
      // Cleanup on unmount
      const scanner = cameraScannerRef.current
      if (scanner && cameraRunningRef.current) {
        try { scanner.stop().catch(() => {}) } catch { /* noop */ }
      }
      cameraScannerRef.current = null
      cameraRunningRef.current = false
    }
  }, [])

  const toggleCamera = useCallback(async () => {
    if (cameraOn) {
      await stopCameraSafely()
      setCameraOn(false)
      setCameraError('')
      return
    }

    setCameraError('')
    // Show the camera region FIRST so its DOM element has real dimensions
    // before html5-qrcode tries to inject the video element into it.
    setCameraOn(true)
    // Wait two animation frames for React to flush the layout.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

    // Lazily create the scanner on first use
    if (!cameraScannerRef.current) {
      try {
        cameraScannerRef.current = new Html5Qrcode('lotwalk-camera-region', {
          formatsToSupport: [
            Html5QrcodeSupportedFormats.QR_CODE,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.DATA_MATRIX,
            Html5QrcodeSupportedFormats.CODE_93,
            Html5QrcodeSupportedFormats.ITF,
          ],
          verbose: false,
        })
      } catch (err) {
        console.error('Camera init failed', err)
        setCameraError('Camera scanner failed to initialize')
        setCameraOn(false)
        return
      }
    }

    try {
      await cameraScannerRef.current.start(
        // Prefer a sharper back camera at higher resolution — VIN barcodes on
        // factory door-jamb stickers are long 1D barcodes that need detail.
        { facingMode: { exact: 'environment' } },
        {
          fps: 20,
          // Wider box: VIN barcodes are horizontally long. Use the full width.
          qrbox: (vw, vh) => ({
            width: Math.floor(vw * 0.95),
            height: Math.floor(vh * 0.4),
          }),
          aspectRatio: (typeof window !== 'undefined' && window.innerWidth < 640) ? 4 / 3 : 16 / 9,
          videoConstraints: {
            facingMode: { exact: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            focusMode: 'continuous',
          },
          disableFlip: true,
        },
        (decodedText) => handleCameraDecoded(decodedText),
        () => { /* per-frame failures are noisy — ignore */ },
      )
      cameraRunningRef.current = true
    } catch (err) {
      // Exact facingMode fails on some devices that don't have a back camera;
      // fall back to relaxed constraints.
      if (err?.name === 'OverconstrainedError' || /facingMode/i.test(String(err?.message))) {
        try {
          await cameraScannerRef.current.start(
            { facingMode: 'environment' },
            { fps: 20, qrbox: { width: 320, height: 120 }, aspectRatio: 4 / 3 },
            (decodedText) => handleCameraDecoded(decodedText),
            () => {},
          )
          cameraRunningRef.current = true
          return
        } catch {
          /* fall through to error handler below */
        }
      }
      console.error('Camera start failed', err)
      setCameraError(
        err?.message?.includes('Permission')
          ? 'Camera permission denied — allow in browser settings'
          : 'Camera unavailable on this device'
      )
      cameraRunningRef.current = false
      setCameraOn(false)
    }
  }, [cameraOn, handleCameraDecoded, stopCameraSafely])

  // Voice recognition setup — runs ONCE per mount so an active session survives section changes
  useEffect(() => {
    if (!voiceSupported) return
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    const rec = new SR()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'
    rec.onresult = (e) => {
      let interim = ''
      let final = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) final += t
        else interim += t
      }
      const heard = (final || interim).trim()
      setVoiceText(heard)
      const digits = parseSpokenDigits(final)
      if (digits && digits.length >= 3) {
        const m = filterInventory(inventoryRef.current, digits)
        if (m.length === 1) {
          submitScanRef.current?.(m[0], 'voice')
        } else if (m.length > 1) {
          setQuery(digits)
        } else {
          // No match - record as unmatched
          recordUnmatchedVehicle({
            scanned_value: digits,
            scan_type: digits.length === 6 ? 'partial_vin' : 'unknown',
            section,
            scan_method: 'voice',
            notes: 'Voice input not found in inventory'
          }).then(() => {
            showToast('warning', 'Unknown vehicle recorded', `"${digits}" - Added to unmatched list`)
          }).catch(err => {
            console.error('Failed to record unmatched voice scan', err)
            showToast('error', 'No match', `Heard "${digits}" — not in inventory`)
          })
        }
      }
    }
    rec.onend = () => {
      // Auto-restart while voice mode is on (continuous)
      if (rec._wantOn) {
        try { rec.start() } catch { /* already started */ }
      }
    }
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
        rec._wantOn = false
        showToast('error', 'Mic blocked', 'Allow microphone access in browser settings.')
        setVoiceOn(false)
      }
    }
    recognitionRef.current = rec
    return () => {
      rec._wantOn = false
      try { rec.stop() } catch { /* noop */ }
      recognitionRef.current = null
    }
  }, [voiceSupported, showToast])

  function toggleVoice() {
    const rec = recognitionRef.current
    if (!rec) return
    if (voiceOn) {
      rec._wantOn = false
      try { rec.stop() } catch { /* noop */ }
      setVoiceOn(false)
      setVoiceText('')
    } else {
      rec._wantOn = true
      try { rec.start() } catch { /* already started */ }
      setVoiceOn(true)
    }
  }

  function handleManualKey(e) {
    if (e.key === 'Enter' && matches.length === 1) {
      submitScan(matches[0], 'manual')
    }
  }

  return (
    <div className="page pb-24">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-3 left-3 right-3 z-50 rounded-xl shadow-2xl p-4 flex items-start gap-3 max-w-lg mx-auto ${
            toast.kind === 'success'
              ? 'bg-emerald-500 text-slate-900'
              : 'bg-red-500 text-white'
          }`}
          onClick={() => setToast(null)}
        >
          {toast.kind === 'success' ? (
            <CheckCircle2 size={22} className="shrink-0 mt-0.5" />
          ) : (
            <AlertCircle size={22} className="shrink-0 mt-0.5" />
          )}
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm">{toast.title}</p>
            {toast.body && <p className="text-xs mt-0.5 opacity-90">{toast.body}</p>}
          </div>
          <X size={18} className="shrink-0 opacity-70" />
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate('/inventory')} className="p-2 rounded-lg bg-slate-800">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-emerald-400">Track Inventory</h1>
          <p className="text-xs text-slate-400">{inventory.length} cars in inventory</p>
        </div>
      </div>

      {/* Sticky section selector */}
      <div className="sticky top-0 z-30 -mx-4 px-4 py-3 bg-slate-900/95 backdrop-blur border-b border-slate-800">
        <label className="block text-[10px] uppercase tracking-wide text-slate-400 mb-1">
          Current Section
        </label>
        <select
          value={sections.some((s) => s.name === section) ? section : (section ? '__other__' : '')}
          onChange={(e) => setSection(e.target.value === '__other__' ? '' : e.target.value)}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-3 text-base font-bold text-emerald-400 focus:outline-none focus:border-emerald-500"
          disabled={loading}
        >
          {sections.length === 0 && (
            <option value="">{loading ? 'Loading sections...' : 'No sections — add in admin'}</option>
          )}
          {sections.map((s) => (
            <option key={s.id} value={s.name}>{s.name}</option>
          ))}
          <option value="__other__">✏️ Other (type custom)…</option>
        </select>
        {(!sections.some((s) => s.name === section) || !section) && (
          <input
            type="text"
            value={sections.some((s) => s.name === section) ? '' : section}
            onChange={(e) => setSection(e.target.value)}
            placeholder="Type a custom location (e.g. Pro Auto, Summit, mechanic section)"
            className="mt-2 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-emerald-400 focus:outline-none focus:border-emerald-500"
          />
        )}
      </div>

      {/* Search box */}
      <div className="mt-4">
        <div className="relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            ref={inputRef}
            type="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Type stock # or last 6 of VIN (letters OK)"
            value={query}
            onChange={(e) => setQuery(e.target.value.toUpperCase())}
            onKeyDown={handleManualKey}
            className="w-full pl-10 pr-3 py-3 bg-slate-800 border border-slate-700 rounded-lg text-base text-white focus:outline-none focus:border-emerald-500"
            autoFocus
          />
        </div>

        {/* Live filter results */}
        {query && (
          <div className="mt-2 space-y-1">
            {matches.length === 0 && (
              <p className="text-xs text-slate-500 py-3 text-center">No matches in inventory</p>
            )}
            {matches.map((v) => {
              const label = [v.vehicle_year, v.vehicle_make, v.vehicle_model]
                .filter(Boolean).join(' ')
              return (
                <button
                  key={v.stock_number}
                  onClick={() => submitScan(v, 'manual')}
                  className="w-full text-left px-3 py-3 rounded-lg bg-slate-800 active:bg-emerald-500/20 border border-slate-700 active:border-emerald-500 transition-colors"
                >
                  <p className="font-semibold text-white text-sm truncate">{label || `Stock ${v.stock_number}`}</p>
                  <p className="text-xs text-slate-400 font-mono">
                    {v.stock_number} · {v.last_6_vin || v.vehicle_vin?.slice(-6)}
                  </p>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Camera scanner */}
      <div className="mt-4">
        <button
          onClick={toggleCamera}
          className={`w-full flex items-center justify-center gap-2 py-3 rounded-lg font-semibold transition-colors ${
            cameraOn
              ? 'bg-emerald-500 text-slate-900'
              : 'bg-slate-800 text-slate-300 border border-slate-700'
          }`}
        >
          {cameraOn ? <CameraOff size={18} /> : <Camera size={18} />}
          {cameraOn ? 'Scanning — point at door jamb VIN sticker' : 'Camera Scan (VIN barcode / QR)'}
        </button>
        {cameraError && (
          <p className="mt-2 text-center text-xs text-red-400">{cameraError}</p>
        )}
        {/* Always-mounted scanner region — html5-qrcode requires a stable DOM target.
            Hidden when camera is off. */}
        <div
          id="lotwalk-camera-region"
          className={cameraOn ? 'mt-3 rounded-lg overflow-hidden border border-slate-700' : 'hidden'}
        />
        {cameraOn && (
          <p className="mt-2 text-center text-[10px] text-slate-500">
            Open the driver door, point at the federal VIN sticker on the door jamb.
          </p>
        )}
      </div>

      {/* Voice button */}
      <div className="mt-4">
        {voiceSupported ? (
          <button
            onClick={toggleVoice}
            className={`w-full flex items-center justify-center gap-2 py-3 rounded-lg font-semibold transition-colors ${
              voiceOn
                ? 'bg-red-500 text-white animate-pulse'
                : 'bg-slate-800 text-slate-300 border border-slate-700'
            }`}
          >
            {voiceOn ? <Square size={18} /> : <Mic size={18} />}
            {voiceOn ? 'Stop Voice Input' : 'Start Voice Entry'}
          </button>
        ) : (
          <p className="text-xs text-slate-500 text-center py-2">
            Voice not supported in this browser
          </p>
        )}
        {voiceOn && (
          <>
            <p className="mt-2 text-center text-xs text-emerald-400 font-medium">
              🎤 Listening... Say the stock number or last 6 of VIN
            </p>
            <p className="mt-1 text-center text-[10px] text-slate-500">
              Tips: Say numbers clearly (e.g., "five three eight two"). For letters, use NATO phonetic alphabet.
            </p>
          </>
        )}
        {voiceOn && voiceText && (
          <p className="mt-2 text-center text-sm text-slate-300 bg-slate-800 rounded-lg py-2">
            Heard: <span className="text-white font-mono font-bold">{voiceText}</span>
          </p>
        )}
      </div>

      {/* Recent scans */}
      {recent.length > 0 && (
        <div className="mt-6">
          <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-2">
            Recent ({recent.length})
          </p>
          <div className="space-y-1">
            {recent.map((r) => {
              const label = [r.vehicle_year, r.vehicle_make, r.vehicle_model]
                .filter(Boolean).join(' ')
              return (
                <div
                  key={`${r.stock_number}-${r.scannedAt.getTime()}`}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/60 text-xs"
                >
                  <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-white truncate">{label || r.stock_number}</p>
                    <p className="text-slate-500 font-mono text-[10px]">
                      {r.stock_number} → {r.section}
                    </p>
                  </div>
                  <span className="text-[10px] text-slate-500 shrink-0">
                    {r.inputMethod}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
