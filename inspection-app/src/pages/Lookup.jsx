import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Search, ExternalLink, Loader, Clock, X } from 'lucide-react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/useAuth'
import { SERVICES, decodeVIN, isValidVIN } from '../services/valuationServices'

// Static Tailwind class map — dynamic `bg-${color}` strings get purged by JIT
const SVC_STYLES = {
  amber:   { bg: 'bg-amber-500/20',   text: 'text-amber-400' },
  emerald: { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
  violet:  { bg: 'bg-violet-500/20',  text: 'text-violet-400' },
}

export default function Lookup() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [vinInput, setVinInput] = useState('')
  const [decoded, setDecoded] = useState(null)
  const [currentVIN, setCurrentVIN] = useState(null)
  const [loading, setLoading] = useState(false)
  const [recent, setRecent] = useState([])
  const [notes, setNotes] = useState('')
  const [savedId, setSavedId] = useState(null)
  const [error, setError] = useState('')

  async function loadRecent() {
    const { data } = await supabase
      .from('valuations')
      .select('id, vin, year, make, model, trim, created_at')
      .order('created_at', { ascending: false })
      .limit(15)
    setRecent(data || [])
  }

  useEffect(() => {
    let cancelled = false
    async function run() {
      const { data } = await supabase
        .from('valuations')
        .select('id, vin, year, make, model, trim, created_at')
        .order('created_at', { ascending: false })
        .limit(15)
      if (!cancelled) setRecent(data || [])
    }
    run()
    return () => { cancelled = true }
  }, [])

  async function handleLookup(e) {
    e?.preventDefault()
    setError('')
    const vin = vinInput.trim().toUpperCase()
    if (!isValidVIN(vin)) {
      setError('Enter a valid 17-character VIN')
      return
    }

    setLoading(true)
    setCurrentVIN(vin)
    setDecoded(null)
    setNotes('')
    setSavedId(null)

    const info = await decodeVIN(vin)
    setDecoded(info)

    const { data, error: dbError } = await supabase
      .from('valuations')
      .insert({
        user_id: user?.id || null,
        vin,
        ...info,
      })
      .select()
      .single()

    if (dbError) {
      console.error('[Lookup] insert valuation failed:', dbError)
      setError('Saved lookup failed: ' + dbError.message)
    } else {
      setSavedId(data.id)
      loadRecent()
    }

    setLoading(false)
  }

  async function saveNotes() {
    if (!savedId) return
    const { error: err } = await supabase
      .from('valuations')
      .update({ notes })
      .eq('id', savedId)
    if (err) setError('Save notes failed: ' + err.message)
  }

  async function openRecent(row) {
    setVinInput(row.vin)
    setCurrentVIN(row.vin)
    // Show what we have immediately, then re-decode for full vehicle details
    setDecoded({ year: row.year, make: row.make, model: row.model, trim: row.trim })
    setSavedId(row.id)
    loadNotesForId(row.id)
    // Re-decode to get body_class, drive_type, engine_cylinders, etc.
    const full = await decodeVIN(row.vin)
    if (full.year) setDecoded(full)
  }

  async function loadNotesForId(id) {
    const { data } = await supabase.from('valuations').select('notes').eq('id', id).single()
    setNotes(data?.notes || '')
  }

  async function clearRecent(id) {
    await supabase.from('valuations').delete().eq('id', id)
    loadRecent()
  }

  const vehicleLabel = decoded
    ? [decoded.year, decoded.make, decoded.model, decoded.trim].filter(Boolean).join(' ')
    : ''

  return (
    <div className="page">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate('/')} className="p-2 rounded-lg bg-slate-800">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-emerald-400">VIN Lookup</h1>
          <p className="text-sm text-slate-400">MMR · Black Book · AutoCheck</p>
        </div>
      </div>

      <form onSubmit={handleLookup} className="mb-6">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="17-character VIN"
            value={vinInput}
            onChange={(e) => setVinInput(e.target.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '').slice(0, 17))}
            className="font-mono text-lg flex-1 tracking-wider"
            autoFocus
            spellCheck={false}
          />
          <button type="submit" disabled={loading || vinInput.length !== 17} className="btn-primary px-4 !w-auto flex items-center gap-1">
            {loading ? <Loader size={16} className="animate-spin" /> : <Search size={16} />}
            Lookup
          </button>
        </div>
        {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
      </form>

      {decoded && currentVIN && (
        <>
          <div className="card mb-4">
            <p className="text-xs text-slate-400 uppercase mb-1">Decoded</p>
            <p className="text-lg font-bold text-white">{vehicleLabel || 'Unknown vehicle'}</p>
            <p className="text-xs text-slate-500 mt-1 font-mono">{currentVIN}</p>
            <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
              {decoded.body_class && <div><span className="text-slate-500">Body:</span> <span className="text-slate-300">{decoded.body_class}</span></div>}
              {decoded.drive_type && <div><span className="text-slate-500">Drive:</span> <span className="text-slate-300">{decoded.drive_type}</span></div>}
              {decoded.engine_cylinders && <div><span className="text-slate-500">Engine:</span> <span className="text-slate-300">{decoded.engine_cylinders} cyl {decoded.engine_displacement}L</span></div>}
              {decoded.fuel_type && <div><span className="text-slate-500">Fuel:</span> <span className="text-slate-300">{decoded.fuel_type}</span></div>}
              {decoded.transmission && <div className="col-span-2"><span className="text-slate-500">Trans:</span> <span className="text-slate-300">{decoded.transmission}</span></div>}
            </div>
          </div>

          <div className="space-y-2 mb-4">
            {Object.entries(SERVICES).map(([key, svc]) => (
              <div key={key} className="card">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg ${SVC_STYLES[svc.color]?.bg || ''} ${SVC_STYLES[svc.color]?.text || ''} font-bold text-sm flex items-center justify-center`}>
                      {svc.short}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-white">{svc.name}</p>
                      <p className="text-xs text-slate-500">{svc.description}</p>
                    </div>
                  </div>
                  <a
                    href={svc.portalUrl(currentVIN)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 rounded-lg bg-slate-800 text-emerald-400 active:bg-slate-700"
                  >
                    <ExternalLink size={16} />
                  </a>
                </div>
              </div>
            ))}
          </div>

          <div className="card mb-6">
            <label className="block text-xs uppercase text-slate-400 mb-2">Notes</label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Condition notes, bidding target, etc."
              className="w-full text-sm"
            />
            <button onClick={saveNotes} disabled={!savedId} className="btn-secondary mt-2 text-xs">
              Save Notes
            </button>
          </div>
        </>
      )}

      <div className="flex items-center gap-2 mb-2">
        <Clock size={14} className="text-slate-500" />
        <h2 className="text-xs uppercase text-slate-400 font-bold">Recent Lookups</h2>
      </div>
      {recent.length === 0 ? (
        <p className="text-slate-500 text-xs">No lookups yet</p>
      ) : (
        <div className="space-y-1">
          {recent.map((row) => {
            const label = [row.year, row.make, row.model].filter(Boolean).join(' ') || row.vin
            return (
              <div key={row.id} className="flex items-center gap-2 py-2 border-b border-slate-800">
                <button onClick={() => openRecent(row)} className="flex-1 text-left">
                  <p className="text-sm text-white font-semibold">{label}</p>
                  <p className="text-xs text-slate-500 font-mono">{row.vin} · {new Date(row.created_at).toLocaleString()}</p>
                </button>
                <button onClick={() => clearRecent(row.id)} className="p-1 text-slate-600 active:text-red-400">
                  <X size={14} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
