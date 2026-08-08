import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Camera, Check, Trash2 } from 'lucide-react'
import { supabase } from '../services/supabase'
import { REQUIRED_PHOTOS } from '../services/inspectionFlow'
import { markTrackComplete } from '../services/tracks'
import ConditionTabs from '../components/ConditionTabs'
import CameraCapture from '../components/CameraCapture'

export default function PhotoCapture() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [inspection, setInspection] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activePhoto, setActivePhoto] = useState(null) // photo slot opened in camera
  const [finishing, setFinishing] = useState(false)
  const [finishError, setFinishError] = useState('')

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('inspections').select('*').eq('id', id).single()
      setInspection(data)
      setLoading(false)
    }
    load()
  }, [id])

  // Upload a single photo synchronously. Throws on any failure so the camera
  // modal stays open and the user sees the error instead of losing the photo.
  async function uploadPhoto(photoId, file) {
    const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase()
    const uid = crypto.randomUUID().slice(0, 8)
    const fileName = `${id}/stock/${photoId}-${uid}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('inspection-photos')
      .upload(fileName, file, { contentType: file.type || 'image/jpeg' })
    if (uploadError) {
      console.error('[PhotoCapture] storage upload failed:', uploadError)
      throw new Error(uploadError.message || 'Upload failed')
    }

    const { data: { publicUrl } } = supabase.storage
      .from('inspection-photos')
      .getPublicUrl(fileName)

    const { data: fresh, error: loadErr } = await supabase
      .from('inspections')
      .select('checklist')
      .eq('id', id)
      .single()
    if (loadErr || !fresh) {
      console.error('[PhotoCapture] reload inspection failed:', loadErr)
      throw new Error('Could not reload inspection: ' + (loadErr?.message || 'unknown'))
    }

    const nextChecklist = { ...(fresh.checklist || {}) }
    nextChecklist.photos = { ...(nextChecklist.photos || {}) }
    nextChecklist.photos[photoId] = { url: publicUrl, path: fileName }

    const { error: updateErr } = await supabase
      .from('inspections')
      .update({ checklist: nextChecklist })
      .eq('id', id)
    if (updateErr) {
      console.error('[PhotoCapture] update checklist failed:', updateErr)
      throw new Error('Checklist update failed: ' + updateErr.message)
    }

    await supabase.from('inspection_photos').insert({
      inspection_id: id,
      file_path: fileName,
      url: publicUrl,
      category: photoId,
    })

    setInspection((prev) => ({ ...prev, checklist: nextChecklist }))
  }

  // Returns a promise the camera modal awaits — on success it closes the modal,
  // on failure it stays open with the error so the photo isn't lost.
  async function handleCapturedFile(photoId, file) {
    if (!file) throw new Error('No file')
    await uploadPhoto(photoId, file)
    setActivePhoto(null)
  }

  async function handleRetake(photoId) {
    const photos = inspection.checklist?.photos || {}
    const existing = photos[photoId]

    if (existing?.path) {
      await supabase.storage.from('inspection-photos').remove([existing.path])
      await supabase.from('inspection_photos').delete().eq('file_path', existing.path)
    }

    const updated = { ...(inspection.checklist || {}) }
    updated.photos = { ...(updated.photos || {}) }
    updated.photos[photoId] = { url: null, path: null }
    await supabase.from('inspections').update({ checklist: updated }).eq('id', id)
    setInspection((prev) => ({ ...prev, checklist: updated }))
  }

  function getProgress() {
    const photos = inspection?.checklist?.photos || {}
    const done = REQUIRED_PHOTOS.filter((p) => photos[p.id]?.url).length
    return { done, total: REQUIRED_PHOTOS.length }
  }

  async function handleNext() {
    setFinishing(true)
    setFinishError('')
    try {
      const result = await markTrackComplete(id, 'condition')
      if (result?.error) throw new Error(result.error.message || 'Unknown error')
      navigate('/inspections', {
        state: result.inspectionCompleted
          ? { justCompleted: result.vinLast6 || '' }
          : { trackDone: 'Condition' },
      })
    } catch (err) {
      console.error('[PhotoCapture] markTrackComplete failed:', err)
      setFinishError(err?.message || 'Could not mark done. Please retry.')
      setFinishing(false)
    }
  }

  if (loading) return <div className="page text-center text-slate-400 pt-20">Loading...</div>
  if (!inspection) return <div className="page text-center text-red-400 pt-20">Not found</div>

  const photos = inspection.checklist?.photos || {}
  const progress = getProgress()

  return (
    <div className="page">
      <ConditionTabs inspectionId={id} current="photos" checklist={inspection.checklist} />

      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate(`/inspect/${id}/interior`)} className="p-2 rounded-lg bg-slate-800">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-emerald-400">Photos</h1>
          <p className="text-sm text-slate-400">VIN ...{inspection.vin_last6 || inspection.vin?.slice(-6)}</p>
        </div>
        <span className="text-xs font-bold text-emerald-400">
          {progress.done}/{progress.total}
        </span>
      </div>

      {/* Photo grid */}
      <div className="grid grid-cols-2 gap-2">
        {REQUIRED_PHOTOS.map((photo) => {
          const data = photos[photo.id]
          const hasPhoto = data?.url

          return (
            <div
              key={photo.id}
              className={`relative rounded-xl overflow-hidden border-2 transition-colors ${
                hasPhoto ? 'border-emerald-500' : 'border-slate-700'
              }`}
            >
              {hasPhoto ? (
                <>
                  <div className="aspect-[4/3] bg-slate-800">
                    <img src={data.url} alt={photo.label} className="w-full h-full object-cover" />
                  </div>
                  <div className="absolute top-1 left-1 w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center">
                    <Check size={12} strokeWidth={3} />
                  </div>
                  <button
                    onClick={() => handleRetake(photo.id)}
                    className="absolute top-1 right-1 p-1 bg-red-500/80 rounded-full"
                  >
                    <Trash2 size={12} />
                  </button>
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-0.5">
                    <p className="text-[10px] text-white font-semibold truncate">{photo.label}</p>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setActivePhoto(photo)}
                  className="w-full aspect-[4/3] flex flex-col items-center justify-center bg-slate-800 active:bg-slate-700"
                >
                  <Camera size={22} className="text-slate-500 mb-1" />
                  <p className="text-[10px] text-slate-400 font-semibold text-center px-2 leading-tight">
                    {photo.label}
                  </p>
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Extra photos */}
      <label className="block mt-3 card text-center cursor-pointer active:bg-slate-700 py-3">
        <span className="text-sm text-slate-400 font-semibold">+ Extra Photos</span>
        {/* No `capture` — it forces the one-shot camera sheet, which overrides
            `multiple` and shuts out the photo library entirely. Without it the
            picker offers both, and several photos can go up at once. */}
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={async (e) => {
            const files = Array.from(e.target.files)
            for (const file of files) {
              const ext = file.name.split('.').pop() || 'jpg'
              const uid = crypto.randomUUID().slice(0, 8)
              const fileName = `${id}/extra/${uid}.${ext}`
              await supabase.storage.from('inspection-photos').upload(fileName, file, { contentType: file.type })
              const { data: { publicUrl } } = supabase.storage.from('inspection-photos').getPublicUrl(fileName)
              await supabase.from('inspection_photos').insert({
                inspection_id: id, file_path: fileName, url: publicUrl, category: 'extra',
              })
            }
          }}
          className="hidden"
        />
      </label>

      <div className="mt-6">
        {finishError && (
          <p className="text-red-400 text-sm text-center mb-2">{finishError}</p>
        )}
        <button
          type="button"
          onClick={handleNext}
          disabled={finishing}
          style={{ touchAction: 'manipulation' }}
          className="btn-primary flex items-center justify-center gap-2 text-lg disabled:opacity-60"
        >
          {finishing ? 'Saving...' : (
            <>Mark Condition Done <ArrowRight size={20} /></>
          )}
        </button>
      </div>

      {activePhoto && (
        <CameraCapture
          label={activePhoto.label}
          instructions={activePhoto.instructions}
          outline={activePhoto.outline}
          onCapture={(file) => handleCapturedFile(activePhoto.id, file)}
          onCancel={() => setActivePhoto(null)}
        />
      )}
    </div>
  )
}
