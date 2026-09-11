// Who gets texted what, and when.
//
// The whole point of this screen is that a reminder is a thing the owner edits
// at 8pm on his phone, not a thing that needs a deploy. So everything the cron
// reads is editable here, and the preview shows the exact string Twilio will
// send rather than a description of it — a checklist you can't see is one you
// can't tell is wrong.

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2, Pencil, Clock, MessageSquare, X, Check } from 'lucide-react'
import { useAuth } from '../context/useAuth'
import { isPrimaryAdmin } from '../services/adminSetup'
import {
  DAYS, WEEKDAYS, fetchChecklists, fetchStaff, saveChecklist, setActive,
  deleteChecklist, prettyPhone, prettyTime, previewMessage, segments, toE164,
} from '../services/checklists'

const BLANK = { name: '', phone: '', title: '', send_at: '09:00', days: WEEKDAYS, items: [''], active: true }

function DayChips({ days, onToggle }) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {DAYS.map((d) => {
        const on = days.includes(d.iso)
        return (
          <button
            key={d.iso}
            type="button"
            onClick={() => onToggle(d.iso)}
            className={`px-2.5 py-1 rounded-lg text-sm font-medium ${
              on ? 'bg-emerald-500 text-slate-900' : 'bg-slate-800 text-slate-400'
            }`}
          >
            {d.label}
          </button>
        )
      })}
    </div>
  )
}

function Editor({ draft, setDraft, staff, onSave, onCancel, saving, error }) {
  const text = previewMessage(draft)
  const segs = segments(text)

  const setItem = (i, v) => setDraft({ ...draft, items: draft.items.map((s, j) => (j === i ? v : s)) })
  const addItem = () => setDraft({ ...draft, items: [...draft.items, ''] })
  const removeItem = (i) => setDraft({ ...draft, items: draft.items.filter((_, j) => j !== i) })
  const toggleDay = (iso) =>
    setDraft({
      ...draft,
      days: draft.days.includes(iso) ? draft.days.filter((d) => d !== iso) : [...draft.days, iso],
    })

  // Picking from the roster fills the number too. Typing one by hand is how a
  // reminder ends up going to a stranger every morning at 4:30.
  const pickStaff = (id) => {
    const p = staff.find((s) => s.id === id)
    if (p) setDraft({ ...draft, name: p.name.split(' ')[0], phone: toE164(p.phone) })
  }

  return (
    <div className="card mb-4 border border-emerald-500/40">
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Who</label>
          <select
            className="w-full bg-slate-800 rounded-lg px-3 py-2 text-slate-100"
            value={staff.find((s) => toE164(s.phone) === draft.phone)?.id || ''}
            onChange={(e) => pickStaff(e.target.value)}
          >
            <option value="">Pick someone...</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Texts to</label>
          <input
            className="w-full bg-slate-800 rounded-lg px-3 py-2 text-slate-100"
            placeholder="(901) 555-0100"
            value={draft.phone}
            onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Name in the text</label>
          <input
            className="w-full bg-slate-800 rounded-lg px-3 py-2 text-slate-100"
            placeholder="Chris"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Time (Memphis)</label>
          <input
            type="time"
            className="w-full bg-slate-800 rounded-lg px-3 py-2 text-slate-100"
            value={String(draft.send_at).slice(0, 5)}
            onChange={(e) => setDraft({ ...draft, send_at: e.target.value })}
          />
        </div>
      </div>

      <div className="mb-3">
        <label className="block text-xs text-slate-400 mb-1">Label (yours only, never texted)</label>
        <input
          className="w-full bg-slate-800 rounded-lg px-3 py-2 text-slate-100"
          placeholder="Body shop - morning walk"
          value={draft.title || ''}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
      </div>

      <div className="mb-3">
        <label className="block text-xs text-slate-400 mb-1">Days</label>
        <DayChips days={draft.days} onToggle={toggleDay} />
      </div>

      <div className="mb-3">
        <label className="block text-xs text-slate-400 mb-1">What he has to do</label>
        {draft.items.map((item, i) => (
          <div key={i} className="flex gap-2 mb-2">
            <span className="text-slate-500 pt-2 w-4 text-right text-sm">{i + 1}</span>
            <textarea
              rows={2}
              className="flex-1 bg-slate-800 rounded-lg px-3 py-2 text-slate-100 text-sm"
              value={item}
              onChange={(e) => setItem(i, e.target.value)}
            />
            <button type="button" onClick={() => removeItem(i)} className="p-2 text-slate-500">
              <X size={16} />
            </button>
          </div>
        ))}
        <button type="button" onClick={addItem} className="text-emerald-400 text-sm flex items-center gap-1">
          <Plus size={14} /> Add a line
        </button>
      </div>

      {text && (
        <div className="mb-3">
          <label className="block text-xs text-slate-400 mb-1">
            What his phone shows - {text.length} characters,{' '}
            <span className={segs > 2 ? 'text-amber-400' : 'text-slate-400'}>
              {segs} {segs === 1 ? 'text' : 'texts'}
            </span>
          </label>
          <pre className="bg-slate-950 rounded-lg p-3 text-sm text-slate-200 whitespace-pre-wrap font-sans">
            {text}
          </pre>
        </div>
      )}

      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={onSave}
          disabled={saving}
          className="bg-emerald-500 text-slate-900 font-bold py-2 px-5 rounded-lg disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button onClick={onCancel} className="bg-slate-800 text-slate-300 py-2 px-5 rounded-lg">
          Cancel
        </button>
      </div>
    </div>
  )
}

export default function Checklists() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [rows, setRows] = useState([])
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)

  const admin = profile?.role === 'admin' || isPrimaryAdmin(profile?.phone)

  // Pulls both lists. Used for the refresh after every edit; the first load has
  // its own copy inside the effect below, which is what keeps the lint rule
  // about setState-in-an-effect satisfied and matches how Admin.jsx does it.
  async function load() {
    try {
      const [list, people] = await Promise.all([fetchChecklists(), fetchStaff().catch(() => [])])
      setRows(list)
      setStaff(people)
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  useEffect(() => {
    if (!admin) { navigate('/'); return }
    let cancelled = false
    async function first() {
      try {
        const [list, people] = await Promise.all([fetchChecklists(), fetchStaff().catch(() => [])])
        if (cancelled) return
        setRows(list)
        setStaff(people)
      } catch (e) {
        if (!cancelled) setError(e.message)
      }
      if (!cancelled) setLoading(false)
    }
    first()
    return () => { cancelled = true }
  }, [admin, navigate])

  async function save() {
    setSaving(true)
    setError('')
    try {
      await saveChecklist(draft)
      setDraft(null)
      await load()
    } catch (e) {
      setError(e.message)
    }
    setSaving(false)
  }

  async function toggle(row) {
    try {
      await setActive(row.id, !row.active)
      await load()
    } catch (e) {
      setError(e.message)
    }
  }

  async function remove(row) {
    try {
      await deleteChecklist(row.id)
      setConfirmDelete(null)
      await load()
    } catch (e) {
      setError(e.message)
    }
  }

  if (!admin) return null

  // Grouped by person so a man's whole day reads top to bottom, which is the
  // question actually being asked here: what does Chris get told, and when.
  const people = [...new Set(rows.map((r) => r.name))].sort()

  return (
    <div className="page">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/admin')} className="p-2 rounded-lg bg-slate-800">
          <ArrowLeft size={20} />
        </button>
        <h1 className="page-title mb-0">Daily Checklists</h1>
      </div>

      <p className="text-sm text-slate-400 mb-4">
        Texts that go out on their own, every day, at the time you set. Anything the
        crew texts back lands on your phone.
      </p>

      {!draft && (
        <button
          onClick={() => setDraft({ ...BLANK })}
          className="bg-emerald-500 text-slate-900 font-bold py-2 px-5 rounded-lg flex items-center gap-2 mb-4"
        >
          <Plus size={18} /> New reminder
        </button>
      )}

      {draft && (
        <Editor
          draft={draft}
          setDraft={setDraft}
          staff={staff}
          onSave={save}
          onCancel={() => { setDraft(null); setError('') }}
          saving={saving}
          error={error}
        />
      )}

      {error && !draft && <p className="text-red-400 text-sm mb-3">{error}</p>}
      {loading && <p className="text-slate-400">Loading...</p>}

      {!loading && !rows.length && (
        <div className="card text-center text-slate-400">
          <MessageSquare size={28} className="mx-auto mb-2 opacity-40" />
          Nobody is getting a checklist yet.
        </div>
      )}

      {people.map((person) => (
        <div key={person} className="mb-6">
          <h2 className="text-lg font-bold text-slate-200 mb-2">{person}</h2>
          {rows.filter((r) => r.name === person).map((row) => (
            <div key={row.id} className={`card mb-2 ${row.active ? '' : 'opacity-50'}`}>
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <p className="font-bold text-emerald-400 flex items-center gap-1.5">
                    <Clock size={15} /> {prettyTime(row.send_at)}
                  </p>
                  <p className="text-xs text-slate-500">
                    {row.title ? `${row.title} - ` : ''}
                    {(row.days || []).map((d) => DAYS.find((x) => x.iso === d)?.label).join(' ')}
                    {' - '}{prettyPhone(row.phone)}
                  </p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => toggle(row)} className="p-2 text-slate-400" title={row.active ? 'Pause' : 'Turn on'}>
                    {row.active ? <Check size={16} /> : <X size={16} />}
                  </button>
                  <button
                    onClick={() => setDraft({ ...row, send_at: String(row.send_at).slice(0, 5) })}
                    className="p-2 text-slate-400"
                  >
                    <Pencil size={16} />
                  </button>
                  <button onClick={() => setConfirmDelete(row.id)} className="p-2 text-red-400">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              <ol className="text-sm text-slate-300 space-y-1 list-decimal list-inside">
                {(row.items || []).map((item, i) => <li key={i}>{item}</li>)}
              </ol>

              {row.last_error && (
                <p className="text-xs text-red-400 mt-2">Last send failed: {row.last_error}</p>
              )}
              {confirmDelete === row.id && (
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-sm text-slate-300">Delete this one?</span>
                  <button onClick={() => remove(row)} className="bg-red-500 text-white text-sm py-1 px-3 rounded-lg">
                    Delete
                  </button>
                  <button onClick={() => setConfirmDelete(null)} className="bg-slate-800 text-slate-300 text-sm py-1 px-3 rounded-lg">
                    Keep
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
