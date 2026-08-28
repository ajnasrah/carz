// One body shop job: price it, list the parts, assign a tech, see the photos.
//
// Photos come from the private car-history bucket under `<vin6>/` — the same
// folder the Telegram bot drops the shop's photos into, so what the guys sent
// over Telegram and what's shot in the app are one gallery.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Trash2, Plus, Camera, ImagePlus, Copy, Check } from 'lucide-react'
import { useAuth } from '../context/useAuth'
import useSwipe from '../hooks/useSwipe'
import HistoryButton from '../components/HistoryButton'
import PhotoLightbox from '../components/PhotoLightbox'
import PartsSearchButton from '../components/PartsSearchButton'
import BurstCamera from '../components/BurstCamera'
import {
  fetchJob, updateJob, assignTech, deleteJob, fetchBoard,
  fetchParts, addPart, updatePart, deletePart,
  fetchTechs, fetchTechInvites, addTech, removeTechInvite, formatPhone,
  techOptions, techValue,
  JOB_STATUSES, PART_STATUSES, PART_STATUS_STYLES, HOLD_STATUS,
  ageStyle, ownedStyle, jobAge, isOnHold,
  vehicleLabel, lastSix, isBodyShopManager, isBodyShopTech, canSeeShopMoney,
  CHARGE_STATUS_LABELS, CHARGE_STATUS_STYLES,
  isChargeApprover, isShopManager,
  proposeCharge, approveCharge, counterCharge, acceptCounter,
} from '../services/bodyShop'
import {
  fetchVehiclePhotos, uploadVehiclePhoto, deleteVehiclePhoto, photoSourceLabel,
} from '../services/vehiclePhotos'
import { copyText } from '../native/clipboard'

const money = (n) => (n == null ? '—' : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`)
// " · Aug 5" — enough to place the move without a wall of timestamp.
const when = (ts) => (ts ? ` · ${new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : '')

export default function BodyShopJob() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { state } = useLocation()
  const { profile } = useAuth()
  const manager = isBodyShopManager(profile)
  // Jorge prices the work and collects it; his techs are paid by him, per job.
  // The charge, the parts costs and the payout are his to see, not theirs.
  const seeMoney = canSeeShopMoney(profile)
  const techOnly = isBodyShopTech(profile) && !manager

  const [job, setJob] = useState(null)
  const [parts, setParts] = useState([])
  const [photos, setPhotos] = useState([])
  const [techs, setTechs] = useState([])
  const [invites, setInvites] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [photoError, setPhotoError] = useState('')

  // ---- swiping between cars -------------------------------------------------
  // The board hands over the ids it was showing, so the swipe order is exactly
  // the order on screen — same filter, same search, oldest first.
  const [siblings, setSiblings] = useState(() => state?.siblings || null)

  // A deep link, a refresh, or a hard reload has no handover. Rebuild the order
  // from the board so swiping works anyway.
  useEffect(() => {
    if (siblings) return
    let cancelled = false
    fetchBoard()
      .then((rows) => {
        if (cancelled) return
        const mine = techOnly && profile?.id
          ? rows.filter((j) => j.assigned_tech === profile.id) : rows
        setSiblings(mine.map((j) => j.id))
      })
      .catch(() => setSiblings([]))
    return () => { cancelled = true }
  }, [siblings, techOnly, profile?.id])

  const at = useMemo(() => (siblings ? siblings.indexOf(id) : -1), [siblings, id])

  // `replace` so back always returns to the board rather than walking every car
  // you swiped through. The ids ride along so the next screen keeps the order.
  const go = useCallback((delta) => {
    if (at < 0 || !siblings) return
    const next = siblings[at + delta]
    if (next) navigate(`/body-shop/${next}`, { state: { siblings }, replace: true })
  }, [at, siblings, navigate])

  const swipe = useSwipe({
    onLeft: () => go(1),
    onRight: () => go(-1),
    enabled: (siblings?.length || 0) > 1,
  })

  // Same thing from a keyboard, for the office screen.
  useEffect(() => {
    function onKey(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.target.closest?.('input, textarea, select')) return
      if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go])

  const load = useCallback(async () => {
    setError('')
    try {
      const j = await fetchJob(id)
      if (!j) { setError('That job no longer exists.'); return }
      setJob(j)
      const [p, t] = await Promise.all([fetchParts(id), fetchTechs()])
      setParts(p); setTechs(t)
      // Invites are the manager's business only, and a failure to read them must
      // not take the job screen down with it.
      if (manager) {
        try { setInvites(await fetchTechInvites()) } catch { /* not fatal */ }
      }
      // Photos are a separate, non-fatal concern — a storage hiccup shouldn't
      // blank out the price and the parts list.
      try { setPhotos(await fetchVehiclePhotos({ vin6: j.vin6, stockNumber: j.stock_number })) }
      catch (e) { setPhotoError(e.message || 'Could not load photos') }
    } catch (e) {
      setError(e.message || 'Could not load this job')
    } finally {
      setLoading(false)
    }
  }, [id, manager])

  useEffect(() => { load() }, [load])

  async function patch(fields) {
    setError('')
    const previous = job
    setJob((j) => ({ ...j, ...fields }))          // optimistic
    try {
      await updateJob(id, fields)
      setJob(await fetchJob(id))                   // re-read for view-computed fields
    } catch (e) {
      setJob(previous)
      setError(e.message || 'Could not save')
    }
  }

  // Every status move goes through patch(), so the optimistic paint and the
  // re-read for view-computed columns (held_at, days_in_shop) are the same one
  // path the price and the notes already use.
  function changeStatus(status) {
    return patch({ status })
  }

  if (loading) return <div className="page"><p className="text-slate-500 text-sm py-10 text-center">Loading…</p></div>
  if (!job) {
    return (
      <div className="page">
        <BackBar onBack={() => navigate('/body-shop')} />
        <div className="card text-center py-10 text-slate-400 text-sm">{error || 'Not found'}</div>
      </div>
    )
  }

  const age = jobAge(job)
  const held = isOnHold(job)
  const headerMeta = [
    job.stock_number ? `#${job.stock_number}` : null,
    job.vehicle_color || null,
    job.mileage
      ? `${Number(String(job.mileage).replace(/[^0-9]/g, '')).toLocaleString()} mi`
      : null,
  ].filter(Boolean)

  return (
    // Swipe left for the next car, right for the previous one — same order as
    // the board. Inputs, the photo viewer and anything [data-no-swipe] opt out.
    <div className="page" {...swipe}>
      <BackBar onBack={() => navigate('/body-shop')}
        right={<HistoryButton showPhotos stockNumber={job.stock_number} vin={job.vin} />}
        at={at} total={siblings?.length || 0} onGo={go} />

      {/* Car header */}
      <div className="card mb-3">
        <div className="flex items-start gap-3">
          {/* Days owned is the headline, same as the board — it's what the list
              is ranked by, so the card you tapped has to show the same number
              you tapped. The shop's own clock sits under it. */}
          <div className="shrink-0 text-center w-14">
            <div className={`text-3xl font-bold leading-none ${
              age.owned ? ownedStyle(age.days) : ageStyle(age.days)}`}>
              {age.days ?? '—'}
            </div>
            <div className="text-[9px] uppercase tracking-wide text-slate-500 mt-0.5 leading-tight">
              {age.owned ? 'days owned' : 'days in shop'}
            </div>
            {age.owned && job.days_in_shop != null && (
              <div className={`text-[10px] mt-1 ${ageStyle(job.days_in_shop)}`}>
                🎨 {job.days_in_shop}d here
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold leading-tight truncate">{vehicleLabel(job)}</h1>
            {/* The stock number used to fall back to "VIN …xxxxxx" when the car
                wasn't in inventory yet. VinRow below now always shows the six,
                and the fresh-buy notice says the rest, so the fallback would be
                saying the same thing a third time. Drop the line instead. */}
            {headerMeta.length > 0 && (
              <p className="text-[11px] text-slate-400 mt-0.5">{headerMeta.join(' · ')}</p>
            )}
            {job.awaiting_inventory && (
              <p className="text-[10px] text-sky-300 mt-1">
                🆕 Fresh buy — not in inventory yet. It links itself once Frazer has it.
              </p>
            )}
            <VinRow job={job} />
          </div>
        </div>
      </div>

      {error && <div className="card border-red-500/40 bg-red-500/10 text-red-300 text-sm mb-3">{error}</div>}

      {/* Status — the stages in the order the car moves through them:
          intake → need parts → parts ordered → parts in → in progress →
          final check → done. Done is full width because it's the end of the
          line, not another lane.

          The three parts stages are set by the checklist below, not from here:
          add a part and the car is in Need Parts, mark it Ordered and it's in
          Parts Ordered, mark the last one Received and it's in Parts In. The
          buttons still work — a car can be waiting on something nobody wrote
          down — but tapping them is the exception now, and the next checklist
          change takes the car back.

          On hold is drawn under the grid, not inside it, because it isn't a
          stage: it takes the car off the pipeline. Red, and separate, so nobody
          taps it on the way to Done. */}
      <Section title="Status">
        <div className="grid grid-cols-2 gap-2">
          {JOB_STATUSES.map((s) => {
            const active = job.status === s.key
            return (
              <button key={s.key}
                onClick={() => !active && changeStatus(s.key)}
                className={`rounded-lg p-3 text-left border ${s.key === 'done' ? 'col-span-2' : ''} ${
                  active
                    ? 'bg-emerald-500 text-slate-900 border-emerald-400 font-bold'
                    : 'bg-slate-800 border-slate-700 active:bg-slate-700'
                }`}>
                <div className="text-base leading-none">{s.emoji}</div>
                <div className="text-sm font-semibold mt-1">{s.label}</div>
                <div className={`text-[10px] mt-0.5 ${active ? 'text-slate-800' : 'text-slate-500'}`}>{s.hint}</div>
              </button>
            )
          })}
        </div>

        {/* Coming off hold lands in intake, not back where it was: a car that
            has been parked needs looking at again before it's a queue position. */}
        <button
          onClick={() => changeStatus(held ? 'intake' : HOLD_STATUS.key)}
          className={`w-full mt-2 rounded-lg p-3 text-left border ${
            held
              ? 'bg-red-500 text-slate-900 border-red-400 font-bold'
              : 'bg-slate-800 border-slate-700 text-red-300 active:bg-slate-700'
          }`}>
          <div className="flex items-center gap-2">
            <span className="text-base leading-none">{HOLD_STATUS.emoji}</span>
            <span className="text-sm font-semibold">
              {held ? 'On Hold — tap to put back in Intake' : 'Put On Hold'}
            </span>
          </div>
          <div className={`text-[10px] mt-0.5 ${held ? 'text-slate-800' : 'text-slate-500'}`}>
            {held
              ? `Parked${when(job.held_at)} — off the board's counts and its oldest-car figure`
              : HOLD_STATUS.hint}
          </div>
        </button>
      </Section>

      {/* Charge — negotiated, not just typed. Manager and owners only. */}
      {seeMoney && (
      <Section title="Charge">
        <ChargeCard job={job} profile={profile} onDone={() => fetchJob(id).then(setJob)}
          onError={setError} />
        {(job.parts_total > 0) && (
          <p className="text-[11px] text-slate-500 mt-2">
            Parts on this job: <span className="text-slate-300">{money(job.parts_cost)}</span>
            {' '}across {job.parts_total} {job.parts_total === 1 ? 'part' : 'parts'}
            {job.charge_status === 'agreed' && job.agreed_amount != null && (
              <> · he collects <span className="text-emerald-400 font-semibold">
                {money(job.agreed_amount - job.parts_cost)}</span></>
            )}
          </p>
        )}
      </Section>
      )}

      {/* Tech */}
      <Section title="Assigned Tech">
        {manager ? (
          <>
            {/* The roster is the dropdown: a man added by name is assignable
                immediately, whether or not he has ever opened the app. */}
            <select value={techValue(job)}
              onChange={(e) => assignTech(id, e.target.value).then(() => fetchJob(id)).then(setJob)
                .catch((err) => setError(err.message || 'Could not assign'))}>
              <option value="">— Unassigned —</option>
              {techOptions(techs, invites).map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <TechRoster techs={techs} invites={invites} setInvites={setInvites}
              onTechsChanged={() => fetchTechs().then(setTechs).catch(() => {})} />
          </>
        ) : (
          <p className="text-sm">{job.tech_name || <span className="text-slate-500">Unassigned</span>}</p>
        )}
      </Section>

      {/* Parts */}
      <Section title={`Parts Needed${parts.length ? ` (${parts.filter((p) => p.status === 'received').length}/${parts.length})` : ''}`}>
        <PartsList jobId={id} parts={parts} setParts={setParts} showCost={seeMoney}
          vehicle={job}
          onError={setError} onChanged={() => fetchJob(id).then(setJob)} />
      </Section>

      {/* Photos */}
      <Section title={`Photos${photos.length ? ` (${photos.length})` : ''}`}>
        <PhotoGrid job={job} photos={photos} setPhotos={setPhotos} error={photoError} onError={setPhotoError} />
      </Section>

      {/* Notes */}
      <Section title="Notes">
        <NotesEditor key={job.notes || ''} value={job.notes} onSave={(notes) => patch({ notes })} />
      </Section>

      {manager && (
        <button
          onClick={async () => {
            if (!window.confirm('Remove this car from the body shop? The parts list and app photos on this job go with it.')) return
            try { await deleteJob(id); navigate('/body-shop') }
            catch (e) { setError(e.message || 'Could not remove') }
          }}
          className="btn-danger mt-4 flex items-center justify-center gap-2">
          <Trash2 size={16} /> Remove from Body Shop
        </button>
      )}
    </div>
  )
}

// The car pager lives here rather than only on the swipe: the arrows say the
// gesture exists, give it a target on a desktop mouse, and "3 / 12" tells you
// where you are in the queue without going back to the board.
function BackBar({ onBack, right, at = -1, total = 0, onGo }) {
  const paging = at >= 0 && total > 1
  return (
    <div className="flex items-center justify-between gap-2 mb-3">
      <button onClick={onBack} className="flex items-center gap-1 text-slate-300 text-sm active:text-white -ml-1">
        <ChevronLeft size={18} /> Body Shop
      </button>
      <div className="flex items-center gap-1.5">
        {paging && (
          <div className="flex items-center gap-0.5">
            <button onClick={() => onGo(-1)} disabled={at === 0} aria-label="Previous car"
              className="p-1.5 rounded-lg bg-slate-800 border border-slate-700 disabled:opacity-30 active:bg-slate-700">
              <ChevronLeft size={16} />
            </button>
            <span className="text-[11px] text-slate-500 tabular-nums w-12 text-center">
              {at + 1} / {total}
            </span>
            <button onClick={() => onGo(1)} disabled={at === total - 1} aria-label="Next car"
              className="p-1.5 rounded-lg bg-slate-800 border border-slate-700 disabled:opacity-30 active:bg-slate-700">
              <ChevronRight size={16} />
            </button>
          </div>
        )}
        {right}
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="mb-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1.5">{title}</p>
      <div className="card">{children}</div>
    </div>
  )
}

// Add a tech by name, before — or without — him ever opening the app.
//
// The name alone is enough to put a car on him: he lands in the dropdown above
// the moment he's added. Most of the shop will never install anything, and
// waiting on a sign-in to assign work was the whole problem.
//
// A phone number is optional and buys one thing: when that number signs in, the
// profile it creates is claimed by the invite — named, given the body_shop_tech
// role, approved, with the cars already on his name carried over — so he goes
// straight to his own board instead of through signup and the pending queue. If
// the number already has an account the role is granted on the spot, which is
// why the button reports which of the three happened.
function TechRoster({ techs, invites, setInvites, onTechsChanged }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')

  const digits = phone.replace(/\D/g, '')

  async function submit(e) {
    e.preventDefault()
    setErr(''); setNote(''); setSaving(true)
    try {
      const outcome = await addTech(name, phone)
      const who = name.trim()
      setNote(
        outcome === 'linked' ? `${who} already had an account — he's a tech now.`
          : outcome === 'invited' ? `${who} is added — assign him a car now. He gets his own board the first time he signs in with that number.`
            : `${who} is added — assign him a car now. Add his number later if you want him in the app.`)
      setName(''); setPhone(''); setOpen(false)
      setInvites(await fetchTechInvites())
      onTechsChanged?.()
    } catch (e2) {
      setErr(e2.message || 'Could not add the tech')
    } finally {
      setSaving(false)
    }
  }

  async function drop(invite) {
    setErr('')
    const before = invites
    setInvites((list) => list.filter((i) => i.id !== invite.id))
    try { await removeTechInvite(invite.id) }
    catch (e2) { setInvites(before); setErr(e2.message || 'Could not remove') }
  }

  return (
    <div className="mt-3 pt-3 border-t border-slate-700/60">
      {invites.length > 0 && (
        <div className="space-y-1.5 mb-2">
          {invites.map((i) => (
            <div key={i.id} className="flex items-center gap-2 text-[11px]">
              <span className="shrink-0 px-2 py-0.5 rounded-full bg-slate-700 text-slate-300 font-semibold">
                {i.phone10 ? 'waiting' : 'no login'}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {i.name} <span className="text-slate-500">{formatPhone(i.phone || i.phone10)}</span>
              </span>
              <button onClick={() => drop(i)} className="shrink-0 p-1 text-slate-600 active:text-red-400">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <p className="text-[10px] text-slate-500">
            On the roster, no account yet — assign them cars as normal. The ones with a number
            join as techs the first time that number logs in, and keep their cars.
          </p>
        </div>
      )}

      {open ? (
        <form onSubmit={submit} className="space-y-2">
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus
            placeholder="Tech's name" className="!py-2 text-sm" />
          <div className="flex gap-2">
            <input value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))}
              type="tel" inputMode="tel" maxLength={14} placeholder="Phone (optional)"
              className="flex-1 !py-2 text-sm" />
            {/* Blank is fine; half a number is a typo, and the server rejects it. */}
            <button type="submit" disabled={saving || !name.trim() || (digits.length > 0 && digits.length !== 10)}
              className="px-3 rounded-lg bg-emerald-500 text-slate-900 font-bold text-sm disabled:opacity-40">
              {saving ? '…' : 'Add'}
            </button>
          </div>
          <button type="button" onClick={() => { setOpen(false); setErr('') }}
            className="text-[11px] text-slate-500 underline">cancel</button>
        </form>
      ) : (
        <button onClick={() => { setOpen(true); setNote('') }}
          className="flex items-center gap-1 text-[11px] text-emerald-400 font-semibold">
          <Plus size={13} /> Add a tech
        </button>
      )}

      {note && <p className="text-[11px] text-emerald-400/90 mt-2">{note}</p>}
      {err && <p className="text-[11px] text-red-400 mt-2">{err}</p>}
      {techs.length === 0 && invites.length === 0 && !open && (
        <p className="text-[11px] text-slate-500 mt-2">
          No techs yet. Add one by name — he doesn't need an account to be given a car.
        </p>
      )}
    </div>
  )
}

// The charge is a negotiation, not a number. Jorge names it, an owner approves
// or counters with a reason, Jorge accepts. Only an AGREED charge is payable.
// Every button here maps to a SECURITY DEFINER RPC that re-checks the caller's
// role server-side, so hiding a button is convenience, not the control.
function ChargeCard({ job, profile, onDone, onError }) {
  const approver = isChargeApprover(profile)
  const shopManager = isShopManager(profile)
  const [mode, setMode] = useState(null)         // 'propose' | 'counter'
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const status = job.charge_status || 'draft'
  const locked = !!job.paid

  async function run(fn) {
    setBusy(true)
    try { await fn(); setMode(null); setNote(''); setAmount(''); await onDone() }
    catch (e) { onError(e.message || 'Could not save') }
    finally { setBusy(false) }
  }

  const headline = status === 'agreed' ? job.agreed_amount
    : status === 'countered' ? job.counter_amount
    : job.price

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className={`text-2xl font-bold ${
            status === 'agreed' ? 'text-emerald-400'
            : status === 'draft' ? 'text-yellow-400' : 'text-white'}`}>
            {headline == null ? 'Not priced' : money(headline)}
          </div>
          {status === 'countered' && job.price != null && (
            <div className="text-[11px] text-slate-500">
              countered from {money(job.price)}
            </div>
          )}
          {/* Who moved the number, always — a counter with no note used to land
              on Jorge anonymously, and "someone cut my price" is not a thing you
              can answer. Same for the approval. */}
          {status === 'countered' && (
            <div className="text-[11px] text-orange-300/90">
              by {job.counter_by_name || 'an owner'}{when(job.counter_at)}
            </div>
          )}
          {status === 'agreed' && (job.agreed_by_name || job.agreed_at) && (
            <div className="text-[11px] text-slate-500">
              agreed{job.agreed_by_name ? ` by ${job.agreed_by_name}` : ''}{when(job.agreed_at)}
            </div>
          )}
        </div>
        <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-bold ${CHARGE_STATUS_STYLES[status]}`}>
          {CHARGE_STATUS_LABELS[status]}
        </span>
      </div>

      {status === 'countered' && job.counter_note && (
        <p className="text-[11px] text-orange-300/90 mt-2 bg-orange-500/10 border border-orange-500/30 rounded-lg p-2">
          “{job.counter_note}”{job.counter_by_name ? ` — ${job.counter_by_name}` : ''}
        </p>
      )}

      {status === 'countered' && !job.counter_note && (
        <p className="text-[11px] text-slate-500 mt-2">
          No reason given{job.counter_by_name ? ` — ask ${job.counter_by_name}` : ''}.
        </p>
      )}

      {locked && <p className="text-[11px] text-sky-300 mt-2">Paid out — the amount is locked.</p>}

      {/* Entry form for whichever move is in progress */}
      {mode && !locked && (
        <div className="mt-3 space-y-2">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
            <input type="number" inputMode="decimal" min="0" value={amount} autoFocus
              onChange={(e) => setAmount(e.target.value)}
              placeholder={mode === 'counter' ? 'Your counter' : 'Your charge'}
              className="!pl-7 text-lg font-bold" />
          </div>
          {mode === 'counter' && (
            <input value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Why? (Jorge sees this)" className="!py-2 text-sm" />
          )}
          <div className="flex gap-2">
            <button disabled={busy || !amount}
              onClick={() => run(() => mode === 'counter'
                ? counterCharge(job.id, amount, note)
                : proposeCharge(job.id, amount))}
              className="btn-primary !py-2 text-sm">
              {busy ? 'Saving…' : mode === 'counter' ? 'Send Counter' : 'Send Charge'}
            </button>
            <button onClick={() => setMode(null)} className="btn-secondary !py-2 text-sm !w-auto px-4">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Whose move is it? */}
      {!mode && !locked && (
        <div className="flex flex-wrap gap-2 mt-3">
          {shopManager && status !== 'countered' && (
            <button onClick={() => { setAmount(job.price == null ? '' : String(job.price)); setMode('propose') }}
              className="btn-secondary !py-2 text-sm !w-auto px-4">
              {status === 'draft' ? 'Set Charge' : 'Change Charge'}
            </button>
          )}
          {shopManager && status === 'countered' && (
            <>
              <button disabled={busy} onClick={() => run(() => acceptCounter(job.id))}
                className="btn-primary !py-2 text-sm !w-auto px-4">
                Accept {money(job.counter_amount)}
              </button>
              <button onClick={() => { setAmount(''); setMode('propose') }}
                className="btn-secondary !py-2 text-sm !w-auto px-4">Counter Back</button>
            </>
          )}
          {approver && status === 'proposed' && (
            <>
              <button disabled={busy} onClick={() => run(() => approveCharge(job.id))}
                className="btn-primary !py-2 text-sm !w-auto px-4">
                Approve {money(job.price)}
              </button>
              <button onClick={() => { setAmount(''); setMode('counter') }}
                className="btn-secondary !py-2 text-sm !w-auto px-4">Counter</button>
            </>
          )}
          {approver && status === 'agreed' && (
            <button onClick={() => { setAmount(''); setMode('counter') }}
              className="text-[11px] text-slate-500 underline">reopen / counter</button>
          )}
        </div>
      )}

      {!shopManager && !approver && (
        <p className="text-[11px] text-slate-500 mt-2">Only the shop manager and owners change the charge.</p>
      )}
      {status === 'proposed' && !approver && (
        <p className="text-[11px] text-yellow-400/80 mt-2">Waiting on an owner to approve.</p>
      )}
      {status === 'countered' && !shopManager && (
        <p className="text-[11px] text-orange-300/80 mt-2">Waiting on Jorge to accept the counter.</p>
      )}
    </div>
  )
}

// Keyed on the saved note by the parent, so a value that changes underneath us
// remounts with a clean draft instead of syncing through an effect.
function NotesEditor({ value, onSave }) {
  const [draft, setDraft] = useState(value || '')
  const [dirty, setDirty] = useState(false)

  return (
    <div>
      <textarea
        rows={3} value={draft}
        onChange={(e) => { setDraft(e.target.value); setDirty(true) }}
        placeholder="What's being done, what to watch out for…"
      />
      {dirty && (
        <button onClick={() => { onSave(draft.trim() || null); setDirty(false) }}
          className="btn-primary mt-2 !py-2 text-sm">Save note</button>
      )}
    </div>
  )
}

// The VIN, tappable.
//
// Two things are worth taking off a car and neither could be had without
// retyping it: the FULL VIN, which is what every other system wants pasted into
// it — Carfax, the auction site, the parts counter on the phone — and the LAST
// 6, which is what this shop actually calls the car and what goes back into the
// Telegram group. Both are one tap.
//
// A fresh buy has only the six: the full VIN arrives with the car's inventory
// row. Rather than show a dead button, it just isn't offered until there's
// something behind it.
function VinRow({ job }) {
  const [copied, setCopied] = useState(null)
  const last6 = lastSix(job)

  async function copy(value, key) {
    // copyText resolves false rather than throwing — don't flash a checkmark
    // for a copy that didn't happen. That toast lying is worse than no toast.
    if (!(await copyText(value))) return
    setCopied(key)
    setTimeout(() => setCopied(null), 1500)
  }

  if (!job.vin && !last6) return null

  const chip = 'flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 active:bg-slate-700'
  const icon = (key) =>
    copied === key ? <Check size={11} className="text-emerald-400 shrink-0" /> : <Copy size={11} className="text-slate-500 shrink-0" />

  return (
    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
      {job.vin && (
        <button onClick={() => copy(job.vin, 'vin')} className={`${chip} min-w-0`}
          aria-label="Copy the full VIN">
          <span className="font-mono text-[10px] text-slate-400 truncate">{job.vin}</span>
          {icon('vin')}
        </button>
      )}
      {last6 && (
        <button onClick={() => copy(last6, 'six')} className={chip}
          aria-label="Copy the last 6 of the VIN">
          <span className="font-mono text-[11px] text-slate-200 tracking-wider">…{last6}</span>
          {icon('six')}
        </button>
      )}
    </div>
  )
}

function PartsList({ jobId, parts, setParts, onError, onChanged, showCost = true, vehicle }) {
  const [name, setName] = useState('')
  const [cost, setCost] = useState('')
  const [vendor, setVendor] = useState('')
  const [showDetail, setShowDetail] = useState(false)
  const [saving, setSaving] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      const created = await addPart(jobId, { name, cost, vendor })
      setParts((p) => [...p, created])
      setName(''); setCost(''); setVendor(''); setShowDetail(false)
      onChanged?.()
    } catch (err) {
      onError(err.message || 'Could not add the part')
    } finally {
      setSaving(false)
    }
  }

  // Tap the status pill to advance: needed → ordered → received → needed.
  async function cyclePart(part) {
    const order = ['needed', 'ordered', 'received']
    const next = order[(order.indexOf(part.status) + 1) % order.length]
    setParts((ps) => ps.map((p) => (p.id === part.id ? { ...p, status: next } : p)))
    try {
      const updated = await updatePart(part.id, { status: next })
      setParts((ps) => ps.map((p) => (p.id === part.id ? updated : p)))
      onChanged?.()
    } catch (err) {
      setParts((ps) => ps.map((p) => (p.id === part.id ? part : p)))
      onError(err.message || 'Could not update the part')
    }
  }

  async function remove(part) {
    setParts((ps) => ps.filter((p) => p.id !== part.id))
    try { await deletePart(part.id); onChanged?.() }
    catch (err) { setParts((ps) => [...ps, part]); onError(err.message || 'Could not delete') }
  }

  return (
    <div>
      {parts.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {parts.map((part) => {
            const meta = PART_STATUSES.find((s) => s.key === part.status)
            return (
              <div key={part.id} className="flex items-center gap-2 py-1">
                <button onClick={() => cyclePart(part)}
                  className={`shrink-0 text-[10px] px-2 py-1 rounded-full font-bold w-24 text-center ${PART_STATUS_STYLES[part.status]}`}>
                  {meta?.emoji} {meta?.label}
                </button>
                <div className="min-w-0 flex-1">
                  <div className={`text-sm truncate ${part.status === 'received' ? 'text-slate-400 line-through' : ''}`}>
                    {part.name}
                  </div>
                  {(part.vendor || (showCost && part.cost != null)) && (
                    <div className="text-[10px] text-slate-500 truncate">
                      {[part.vendor, showCost && part.cost != null ? money(part.cost) : null]
                        .filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
                <PartsSearchButton vehicle={vehicle} term={part.name} />
                <button onClick={() => remove(part)} className="shrink-0 p-1 text-slate-600 active:text-red-400">
                  <Trash2 size={14} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      <form onSubmit={submit} className="space-y-2">
        <div className="flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Add a part…" className="flex-1 !py-2 text-sm" />
          <button type="submit" disabled={saving || !name.trim()}
            className="px-3 rounded-lg bg-emerald-500 text-slate-900 font-bold disabled:opacity-40">
            <Plus size={18} />
          </button>
        </div>
        {showDetail ? (
          <div className="flex gap-2">
            <input value={vendor} onChange={(e) => setVendor(e.target.value)}
              placeholder="Where from" className="flex-1 !py-2 text-sm" />
            <input value={cost} onChange={(e) => setCost(e.target.value)} type="number" inputMode="decimal"
              placeholder="$" className="w-24 !py-2 text-sm" />
          </div>
        ) : (
          <button type="button" onClick={() => setShowDetail(true)}
            className="text-[11px] text-slate-500 underline">+ cost / where from</button>
        )}
      </form>

      {parts.length === 0 && (
        <p className="text-[11px] text-slate-600 mt-2">
          Tap a part's tag to move it Needed → Ordered → Received.
        </p>
      )}
    </div>
  )
}

// The car's whole photo history, newest first — Telegram (any group), app shots,
// inspection photos — each badged with where it came from. Defaults to just the
// body shop's own photos, because that's what the manager is looking for; one tap
// shows everything, which is how you spot damage the car arrived with.
function PhotoGrid({ job, photos, setPhotos, error, onError }) {
  // {done, total} while a batch is going up, null otherwise — a dozen photos off
  // a phone is slow enough that a spinner with no number reads as a hang.
  const [progress, setProgress] = useState(null)
  const [shooting, setShooting] = useState(false)
  const uploading = progress != null
  // Desktop browsers with no camera (and anything served insecurely) fall back
  // to the phone's own one-shot sheet rather than a viewfinder that can't start.
  const canShoot = !!navigator.mediaDevices?.getUserMedia
  // An index into `visible`, not a photo object — the viewer pages through the
  // set from here, so it needs to know where in the set it is.
  const [viewIdx, setViewIdx] = useState(null)
  const [showAll, setShowAll] = useState(false)

  // A car that comes back gets a NEW job, but photos are car-level — so without
  // this the new job would show the previous visit's damage with nothing marking
  // it as old, and the manager reads last month's quarter panel as today's work.
  //
  // The boundary is when the car last LEFT the shop (visit_since), NOT when this
  // card was created. Only a card the Telegram bot opens is born the moment the
  // photos land; one made by hand, by the location sync, or by the history
  // backfill is created days later, and anchoring on entered_at threw away every
  // photo taken before it — 11 open cards were showing zero of the pictures the
  // shop had actually posted. A car that has never been here has no boundary,
  // and all of its shop photos belong to the visit it is on now.
  const since = job.visit_since ? new Date(job.visit_since).getTime() : null
  const shopPhotos = photos.filter((p) => p.station === 'body_shop' || p.source === 'app')
  const inWindow = since == null ? shopPhotos
    : shopPhotos.filter((p) => p.takenAt && new Date(p.takenAt).getTime() > since)
  // Last resort: if the window is empty but the shop HAS shot this car, show
  // those rather than an empty grid. Photos older than the last visit are still
  // the best answer to "what does this car look like" — and an empty gallery on
  // a car with pictures reads as the pipeline having dropped them.
  const thisVisit = inWindow.length ? inWindow : shopPhotos
  const visible = showAll ? photos : thisVisit
  const otherCount = photos.length - thisVisit.length

  // One photo failing must not throw away the eleven that worked — each is its
  // own upload, so the batch carries on and reports what didn't make it.
  async function upload(files) {
    if (!files.length) return
    onError('')
    setProgress({ done: 0, total: files.length })
    const car = { vin6: job.vin6, stockNumber: job.stock_number, vin: job.vin }
    let failed = 0
    try {
      for (const [i, file] of files.entries()) {
        try { await uploadVehiclePhoto(car, file) }
        catch { failed += 1 }
        setProgress({ done: i + 1, total: files.length })
      }
      setPhotos(await fetchVehiclePhotos(car))
      if (failed) onError(`${failed} of ${files.length} photos didn’t upload — try those again.`)
    } catch (err) {
      onError(err.message || 'Upload failed')
    } finally {
      setProgress(null)
    }
  }

  function handleFiles(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    upload(files)
  }

  async function remove(photo) {
    if (!window.confirm('Delete this photo?')) return
    try {
      await deleteVehiclePhoto(photo)
      setPhotos((ps) => ps.filter((p) => p.path !== photo.path))
      setViewIdx(null)
    } catch (err) { onError(err.message || 'Could not delete') }
  }

  return (
    <div>
      {error && <p className="text-[11px] text-red-400 mb-2">{error}</p>}

      {otherCount > 0 && (
        <div className="flex gap-1.5 mb-2">
          <button onClick={() => setShowAll(false)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${
              !showAll ? 'bg-emerald-500 text-slate-900' : 'bg-slate-700 text-slate-300'}`}>
            This visit · {thisVisit.length}
          </button>
          <button onClick={() => setShowAll(true)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${
              showAll ? 'bg-emerald-500 text-slate-900' : 'bg-slate-700 text-slate-300'}`}>
            Whole history · {photos.length}
          </button>
        </div>
      )}

      {visible.length > 0 ? (
        <div className="grid grid-cols-3 gap-1.5 mb-3">
          {visible.map((photo, i) => (
            <button key={`${photo.bucket}/${photo.path}`} onClick={() => setViewIdx(i)}
              className="relative aspect-square rounded-lg overflow-hidden bg-slate-900 border border-slate-700">
              <img src={photo.url} alt="" loading="lazy" className="w-full h-full object-cover" />
              {showAll && (
                <span className="absolute bottom-0 inset-x-0 bg-black/70 text-[8px] text-slate-200 py-0.5 px-1 truncate">
                  {photoSourceLabel(photo)}
                </span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-slate-500 mb-3">
          {!job.vin6 ? 'This job has no VIN attached, so photos can’t be matched to it.'
            : photos.length > 0 ? 'Nothing shot this visit yet — tap “Whole history” for earlier photos of this car.'
            : 'No photos yet. Anything the shop posts in the Telegram group shows up here.'}
        </p>
      )}

      {/* Two ways in, because they're two different jobs: shoot a run of photos
          of the car in front of you, or send up ones already on the phone. The
          old single button did neither well — `capture` forces the camera sheet,
          which overrides `multiple` and closes after every shot. */}
      {job.vin6 && (
        uploading ? (
          <div className="btn-secondary flex items-center justify-center gap-2 !py-2 text-sm opacity-70">
            <Camera size={16} /> Uploading {progress.done}/{progress.total}…
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {canShoot ? (
              <button onClick={() => setShooting(true)}
                className="btn-secondary flex items-center justify-center gap-2 !py-2 text-sm">
                <Camera size={16} /> Take Photos
              </button>
            ) : (
              <label className="btn-secondary flex items-center justify-center gap-2 cursor-pointer !py-2 text-sm">
                <Camera size={16} /> Take Photo
                <input type="file" accept="image/*" capture="environment"
                  onChange={handleFiles} className="hidden" />
              </label>
            )}
            {/* No `capture` here — that's what lets the picker offer the library
                and take several at once. */}
            <label className="btn-secondary flex items-center justify-center gap-2 cursor-pointer !py-2 text-sm">
              <ImagePlus size={16} /> Upload
              <input type="file" accept="image/*" multiple
                onChange={handleFiles} className="hidden" />
            </label>
          </div>
        )
      )}

      {shooting && (
        <BurstCamera
          title={vehicleLabel(job) || `#${job.stock_number || job.vin6}`}
          onCancel={() => setShooting(false)}
          onDone={(files) => { setShooting(false); upload(files) }} />
      )}

      {viewIdx != null && (
        <PhotoLightbox photos={visible} index={viewIdx} onIndex={setViewIdx}
          onClose={() => setViewIdx(null)} onDelete={remove} />
      )}
    </div>
  )
}
