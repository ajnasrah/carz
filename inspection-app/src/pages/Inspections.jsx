import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft, ClipboardList, Check, Clock, Circle, Plus, CheckCircle2 } from 'lucide-react'
import { supabase } from '../services/supabase'
import { TRACKS, getTrackStatuses } from '../services/inspectionFlow'

const STATUS_STYLES = {
  complete: {
    icon: Check,
    btn: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
    label: 'Done',
  },
  in_progress: {
    icon: Clock,
    btn: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400',
    label: 'In Progress',
  },
  not_started: {
    icon: Circle,
    btn: 'bg-slate-800 border-slate-700 text-slate-300',
    label: 'Start',
  },
}

export default function Inspections() {
  const navigate = useNavigate()
  const location = useLocation()
  const [inspections, setInspections] = useState([])
  const [filter, setFilter] = useState('in_progress')
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState(null)

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    window.scrollTo(0, 0)
    if (location.state?.justCompleted) {
      setToast({
        kind: 'success',
        title: 'Inspection Complete',
        body: `VIN ...${location.state.justCompleted} marked done. Ready to list.`,
      })
      setFilter('complete')
      window.history.replaceState({}, '')
    } else if (location.state?.trackDone) {
      setToast({
        kind: 'info',
        title: `${location.state.trackDone} Saved`,
        body: 'Pick the next track for this car when you\'re ready.',
      })
      window.history.replaceState({}, '')
    }
  }, [location])
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4500)
    return () => clearTimeout(t)
  }, [toast])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      let query = supabase
        .from('inspections')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50)
      if (filter === 'in_progress') query = query.eq('status', 'in_progress')
      else if (filter === 'complete') query = query.eq('status', 'complete')
      const { data } = await query
      if (cancelled) return
      setInspections(data || [])
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [filter])

  return (
    <div className="page">
      {toast && (
        <div
          className={`fixed top-3 left-3 right-3 md:left-60 z-50 rounded-xl shadow-2xl p-4 flex items-start gap-3 max-w-lg mx-auto ${
            toast.kind === 'success'
              ? 'bg-emerald-500 text-slate-900'
              : 'bg-slate-800 text-white border border-slate-700'
          }`}
          onClick={() => setToast(null)}
        >
          <CheckCircle2 size={22} className="shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm">{toast.title}</p>
            <p className="text-xs mt-0.5 opacity-90">{toast.body}</p>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate('/')} className="p-2 rounded-lg bg-slate-800">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-emerald-400">Inspections</h1>
          <p className="text-xs text-slate-400">
            {inspections.length}
            {filter === 'all' ? ' total' : ` ${filter.replace('_', ' ')}`}
          </p>
        </div>
      </div>

      {/* NEW INSPECTION — big obvious button at the top */}
      <button
        onClick={() => navigate('/new')}
        className="w-full flex items-center justify-center gap-2 py-4 rounded-xl bg-emerald-500 text-slate-900 font-bold mb-4 active:bg-emerald-600"
      >
        <Plus size={22} />
        <span className="text-base">New Inspection</span>
      </button>

      <div className="flex gap-2 mb-4">
        {[
          { key: 'in_progress', label: '⏳ Open' },
          { key: 'complete', label: '✅ Done' },
          { key: 'all', label: 'All' },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
              filter === f.key ? 'bg-emerald-500 text-slate-900' : 'bg-slate-800 text-slate-400'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center text-slate-400 py-12">Loading...</div>
      ) : inspections.length === 0 ? (
        <div className="text-center py-12">
          <ClipboardList size={48} className="mx-auto text-slate-600 mb-4" />
          <p className="text-slate-400">No inspections yet</p>
          <p className="text-slate-500 text-sm">Tap + to start one</p>
        </div>
      ) : (
        <div className="space-y-3 md:space-y-0 md:grid md:grid-cols-2 md:gap-3">
          {inspections.map((insp) => {
            const isComplete = insp.status === 'complete'
            const tracks = getTrackStatuses(insp.checklist)

            let damageCount = 0
            const cl = insp.checklist || {}
            if (cl.exterior) Object.values(cl.exterior).forEach((p) => { damageCount += p.damages?.length || 0 })
            if (cl.interior) Object.values(cl.interior).forEach((z) => { damageCount += z.damages?.length || 0 })

            return (
              <div key={insp.id} className="card">
                <div className="flex justify-between items-start mb-3">
                  <div className="min-w-0">
                    <p className="font-bold text-white truncate">
                      VIN ...{insp.vin_last6 || insp.vin?.slice(-6)}
                    </p>
                    <p className="text-xs text-slate-400">
                      {insp.mileage?.toLocaleString()} mi
                      {damageCount > 0 && <span className="text-red-400 ml-2">{damageCount} damages</span>}
                      <span className="text-slate-500 ml-2">{new Date(insp.created_at).toLocaleDateString()}</span>
                    </p>
                  </div>
                  <span
                    className={`text-xs px-2 py-1 rounded-full font-semibold shrink-0 ${
                      isComplete ? 'bg-emerald-500/20 text-emerald-400' : 'bg-yellow-500/20 text-yellow-400'
                    }`}
                  >
                    {isComplete ? 'Complete' : 'In Progress'}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {TRACKS.map((track) => {
                    const st = STATUS_STYLES[tracks[track.key]]
                    const Icon = st.icon
                    return (
                      <button
                        key={track.key}
                        onClick={() => navigate(track.entryPath(insp.id))}
                        className={`border rounded-lg px-2 py-2.5 text-center active:opacity-70 ${st.btn}`}
                      >
                        <Icon size={14} className="mx-auto mb-1" />
                        <p className="text-xs font-bold leading-tight">{track.short}</p>
                        <p className="text-[10px] opacity-70 mt-0.5">{st.label}</p>
                      </button>
                    )
                  })}
                </div>

                {isComplete && (
                  <button
                    onClick={() => navigate(`/inspect/${insp.id}/review`)}
                    className="w-full mt-2 py-2 rounded-lg bg-emerald-500/10 text-emerald-400 text-xs font-semibold"
                  >
                    View Report
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
