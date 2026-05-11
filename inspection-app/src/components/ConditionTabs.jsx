import { useNavigate } from 'react-router-dom'
import { Check } from 'lucide-react'

const TABS = [
  { key: 'exterior', label: 'Exterior', path: 'exterior' },
  { key: 'interior', label: 'Interior', path: 'interior' },
  { key: 'photos', label: 'Pictures', path: 'photos' },
]

export default function ConditionTabs({ inspectionId, current, checklist }) {
  const navigate = useNavigate()

  function hasContent(key) {
    if (!checklist) return false
    if (key === 'exterior') {
      const ext = checklist.exterior || {}
      return Object.values(ext).some((p) => p?.damages?.length > 0)
    }
    if (key === 'interior') {
      const int = checklist.interior || {}
      return Object.values(int).some((z) => z?.damages?.length > 0) || checklist.interior_needs_detail
    }
    if (key === 'photos') {
      const photos = checklist.photos || {}
      return Object.values(photos).some((p) => p?.url)
    }
    return false
  }

  return (
    <div className="flex gap-1 mb-4 bg-slate-800 p-1 rounded-xl">
      {TABS.map((tab) => {
        const active = tab.key === current
        const filled = hasContent(tab.key)
        return (
          <button
            key={tab.key}
            onClick={() => navigate(`/inspect/${inspectionId}/${tab.path}`)}
            className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-1.5 ${
              active
                ? 'bg-emerald-500 text-slate-900'
                : 'text-slate-400 active:bg-slate-700'
            }`}
          >
            {filled && !active && <Check size={12} className="text-emerald-400" />}
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
