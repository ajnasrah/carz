import { useState, useRef, useEffect } from 'react'
import { X, Camera, Plus, Trash2, ChevronDown } from 'lucide-react'
import { supabase } from '../services/supabase'

export default function DamageModal({
  panelId,
  panelLabel,
  damages = [],
  damageTypes,
  damageSizes,
  inspectionId,
  onSave,
  onClose,
}) {
  const [localDamages, setLocalDamages] = useState(
    damages.length > 0
      ? damages.map((d) => ({
          ...d,
          // Backfill legacy single-photo shape → new photos[] shape
          photos: d.photos || (d.photo_url ? [{ url: d.photo_url, path: d.photo_path }] : []),
        }))
      : [{ id: crypto.randomUUID(), type: '', size: '', count: '', note: '', photos: [] }]
  )
  const [uploading, setUploading] = useState(null) // index of damage being uploaded
  const [expandedIdx, setExpandedIdx] = useState(damages.length > 0 ? null : 0)
  const [saving, setSaving] = useState(false)
  const fileRefs = useRef({})

  // Lock body scroll so the page behind the modal can't scroll on touch drag
  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    const prevPosition = document.body.style.position
    const scrollY = window.scrollY
    document.body.style.overflow = 'hidden'
    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollY}px`
    document.body.style.width = '100%'
    return () => {
      document.body.style.overflow = prevOverflow
      document.body.style.position = prevPosition
      document.body.style.top = ''
      document.body.style.width = ''
      window.scrollTo(0, scrollY)
    }
  }, [])

  function addDamage() {
    const newDamage = {
      id: crypto.randomUUID(),
      type: '',
      size: '',
      count: '',
      note: '',
      photos: [],
    }
    setLocalDamages((prev) => [...prev, newDamage])
    setExpandedIdx(localDamages.length)
  }

  function updateDamage(idx, field, value) {
    setLocalDamages((prev) => {
      const updated = [...prev]
      updated[idx] = { ...updated[idx], [field]: value }
      return updated
    })
  }

  function removeDamage(idx) {
    setLocalDamages((prev) => {
      const updated = prev.filter((_, i) => i !== idx)
      return updated
    })
    setExpandedIdx(null)
  }

  async function handlePhoto(idx, e) {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(idx)

    const ext = file.name.split('.').pop() || 'jpg'
    const uid = crypto.randomUUID().slice(0, 12)
    const fileName = `${inspectionId}/damage/${panelId}-${uid}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('inspection-photos')
      .upload(fileName, file, { contentType: file.type })

    if (uploadError) {
      alert('Upload failed: ' + uploadError.message)
      setUploading(null)
      return
    }

    const { data: { publicUrl } } = supabase.storage
      .from('inspection-photos')
      .getPublicUrl(fileName)

    setLocalDamages((prev) => {
      const updated = [...prev]
      const existing = updated[idx].photos || []
      updated[idx] = { ...updated[idx], photos: [...existing, { url: publicUrl, path: fileName }] }
      return updated
    })

    // Clear the input so picking the same file again re-triggers onChange
    if (e.target) e.target.value = ''
    setUploading(null)
  }

  async function removePhotoAt(damageIdx, photoIdx) {
    const damage = localDamages[damageIdx]
    const photo = damage.photos?.[photoIdx]
    if (photo?.path) {
      await supabase.storage.from('inspection-photos').remove([photo.path])
    }
    setLocalDamages((prev) => {
      const updated = [...prev]
      const filtered = (updated[damageIdx].photos || []).filter((_, i) => i !== photoIdx)
      updated[damageIdx] = { ...updated[damageIdx], photos: filtered }
      return updated
    })
  }

  async function handleSave() {
    // Block save while any photo is still uploading — otherwise we race
    // with setLocalDamages and orphan the photo in storage.
    if (uploading !== null) {
      alert('A photo is still uploading. Wait for it to finish before saving.')
      return
    }

    // Capture the absolute latest localDamages by reading it via functional
    // setState inside a Promise (sidesteps any stale closure). This guarantees
    // we save whatever the user has CURRENTLY in the modal, even if a recent
    // handlePhoto setter hasn't flushed to a render yet.
    const current = await new Promise((resolve) => {
      setLocalDamages((prev) => {
        resolve(prev)
        return prev
      })
    })

    // Auto-strip empty rows silently. Anything with a type (preset or free-text) is kept;
    // rows where the user added nothing are just dropped. No nag dialog.
    const filled = current.filter((d) => (d.type || '').trim().length > 0)
    setSaving(true)
    try {
      await onSave(panelId, filled)
    } catch (err) {
      alert('Save failed: ' + (err?.message || 'unknown'))
    } finally {
      setSaving(false)
    }
  }

  function handleNoDamage() {
    onSave(panelId, [])
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-slate-800 rounded-t-2xl md:rounded-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <div>
            <h3 className="text-lg font-bold text-white">{panelLabel}</h3>
            <p className="text-xs text-slate-400">Record any damage found on this panel</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg bg-slate-700">
            <X size={18} />
          </button>
        </div>

        {/* Damage list */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-3" style={{ WebkitOverflowScrolling: 'touch' }}>
          {localDamages.map((damage, idx) => (
            <div key={damage.id} className="bg-slate-900 rounded-xl border border-slate-700 overflow-hidden">
              {/* Damage header — sticks to top when this row is expanded so the
                  user always sees which damage they're editing */}
              <button
                className="w-full flex items-center justify-between p-3 sticky top-0 z-10 bg-slate-900"
                onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
              >
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center text-xs font-bold">
                    {idx + 1}
                  </span>
                  <span className="text-sm font-semibold text-white">
                    {damage.type || 'Select damage type...'}
                  </span>
                  {damage.size && (
                    <span className="text-xs text-slate-500 ml-1">({damage.size})</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {(damage.photos || []).length > 0 && (
                    <>
                      <div className="w-6 h-6 rounded overflow-hidden">
                        <img src={damage.photos[0].url} className="w-full h-full object-cover" alt="" />
                      </div>
                      {damage.photos.length > 1 && (
                        <span className="text-[10px] text-slate-500 font-semibold">+{damage.photos.length - 1}</span>
                      )}
                    </>
                  )}
                  <ChevronDown
                    size={16}
                    className={`text-slate-500 transition-transform ${expandedIdx === idx ? 'rotate-180' : ''}`}
                  />
                </div>
              </button>

              {/* Expanded details */}
              {expandedIdx === idx && (
                <div className="border-t border-slate-700 p-3 space-y-3">
                  {/* Damage Type — either pick from preset OR type free-form */}
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5 font-semibold">
                      Damage Type
                    </label>
                    <input
                      type="text"
                      value={damage.type || ''}
                      onChange={(e) => updateDamage(idx, 'type', e.target.value)}
                      placeholder="Type damage (e.g. Driver Door - Scratch) or tap a preset below"
                      className="text-sm py-2 w-full mb-2"
                    />
                    <div className="grid grid-cols-3 gap-1.5">
                      {damageTypes.map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => updateDamage(idx, 'type', type)}
                          className={`py-2 px-2 rounded-lg text-xs font-semibold transition-colors ${
                            damage.type === type
                              ? 'bg-red-500 text-white'
                              : 'bg-slate-800 text-slate-400 active:bg-slate-700'
                          }`}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Size */}
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5 font-semibold">
                      Size
                    </label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {damageSizes.map((size) => (
                        <button
                          key={size}
                          type="button"
                          onClick={() => updateDamage(idx, 'size', size)}
                          className={`py-2 px-2 rounded-lg text-xs font-semibold transition-colors ${
                            damage.size === size
                              ? size === 'Multiple'
                                ? 'bg-amber-500 text-white'
                                : 'bg-blue-500 text-white'
                              : 'bg-slate-800 text-slate-400 active:bg-slate-700'
                          }`}
                        >
                          {size}
                        </button>
                      ))}
                    </div>
                    {damage.size === 'Multiple' && (
                      <div className="mt-2">
                        <label className="block text-xs text-slate-400 mb-1 font-semibold">
                          How many? (optional)
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="e.g. 3"
                          value={damage.count || ''}
                          onChange={(e) => updateDamage(idx, 'count', e.target.value.replace(/\D/g, '').slice(0, 3))}
                          className="text-sm py-2 w-24 text-center"
                        />
                      </div>
                    )}
                  </div>

                  {/* Note */}
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5 font-semibold">
                      Note (optional)
                    </label>
                    <input
                      type="text"
                      placeholder="Additional details..."
                      value={damage.note}
                      onChange={(e) => updateDamage(idx, 'note', e.target.value)}
                      className="text-sm py-2"
                    />
                  </div>

                  {/* Photos — multiple allowed */}
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5 font-semibold">
                      Photos ({(damage.photos || []).length})
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {(damage.photos || []).map((p, pIdx) => (
                        <div key={pIdx} className="relative aspect-square rounded-lg overflow-hidden bg-slate-800">
                          <img src={p.url} alt="" className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => removePhotoAt(idx, pIdx)}
                            className="absolute top-1 right-1 p-1 bg-red-500/80 rounded-full"
                          >
                            <Trash2 size={10} />
                          </button>
                        </div>
                      ))}
                      <label
                        className={`aspect-square flex flex-col items-center justify-center rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
                          uploading === idx
                            ? 'border-yellow-500 bg-yellow-500/10 text-yellow-400'
                            : 'border-slate-600 bg-slate-800 text-slate-400 active:border-emerald-500'
                        }`}
                      >
                        <Camera size={18} />
                        <span className="text-[9px] font-semibold mt-1">
                          {uploading === idx ? 'Uploading...' : 'Add Photo'}
                        </span>
                        <input
                          ref={(el) => (fileRefs.current[idx] = el)}
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={(e) => handlePhoto(idx, e)}
                          className="hidden"
                          disabled={uploading !== null}
                        />
                      </label>
                    </div>
                  </div>

                  {/* Remove damage */}
                  {localDamages.length > 1 && (
                    <button
                      onClick={() => removeDamage(idx)}
                      className="w-full py-2 rounded-lg bg-red-500/10 text-red-400 text-xs font-semibold flex items-center justify-center gap-1"
                    >
                      <Trash2 size={14} /> Remove This Damage
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* Add another damage */}
          <button
            onClick={addDamage}
            className="w-full py-3 rounded-lg border-2 border-dashed border-slate-600 text-slate-400 text-sm font-semibold flex items-center justify-center gap-2 active:border-emerald-500"
          >
            <Plus size={16} /> Add Another Damage
          </button>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-700 space-y-2">
          <button
            onClick={handleSave}
            disabled={saving || uploading !== null}
            className="btn-primary disabled:opacity-60"
          >
            {uploading !== null
              ? 'Waiting for photo upload…'
              : saving
                ? 'Saving...'
                : `Save Damages (${localDamages.filter((d) => d.type).length})`}
          </button>
          <button onClick={handleNoDamage} className="btn-secondary text-sm">
            No Damage on This Panel
          </button>
        </div>
      </div>
    </div>
  )
}
