// Find a part for this car, without retyping the car.
//
// Four vendors, two very different kinds of link:
//
//   eBay and Amazon take a plain keyword search in the URL, so we can open them
//   straight onto results for this exact car and this exact part. No account, no
//   API, nothing to maintain.
//
//   PartsTech and RepairLink are login-only shop/dealer portals. Their catalogue
//   sits behind auth and they take no useful search parameters, so they open on
//   their own site with the VIN on the clipboard, ready to paste into their
//   vehicle picker — signed in with the shop's saved login (see
//   services/partsPortals.js): automatically inside the app, and on the web by
//   copying the username and password from this panel.
//
// Deliberately NOT attempting eBay's fitment parameters (the _vhc / epid
// machinery). They break constantly and a wrong fitment link is worse than a
// keyword search, because it looks authoritative while filtering out the part
// you wanted.

import { useEffect, useState } from 'react'
import { ExternalLink, Copy, Check, KeyRound } from 'lucide-react'
import { normalizeVehicle, buildQuery, carLabel, VENDORS } from '../services/partsSearch'
import { openWeb } from '../native/links'
import { isNative } from '../native/platform'
import { copyText } from '../native/clipboard'
import { portalStatus, portalLogin, openPortal, savePortalLogin } from '../services/partsPortals'

export default function PartsSearch({ vehicle, defaultTerm = '', onSearched }) {
  const [term, setTerm] = useState(defaultTerm)
  const [copied, setCopied] = useState(false)
  // Which portals have a shop login saved. null = unknown, or this person isn't
  // shop staff (the endpoint says 403) — the portals still open, unsigned.
  const [logins, setLogins] = useState(null)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    let alive = true
    portalStatus().then((s) => alive && setLogins(s)).catch(() => {})
    return () => { alive = false }
  }, [])

  const car = normalizeVehicle(vehicle)
  const vin = car.vin || ''
  const q = buildQuery(car, term)
  const label = carLabel(car)

  async function copyVin() {
    if (!vin) return
    // copyText, not navigator.clipboard: inside the app the web clipboard
    // rejects often enough that the VIN wasn't there to paste. If it fails
    // anyway, the VIN stays visible and selectable above.
    if (await copyText(vin)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  // openWeb / openPortal, never a bare window.open. Inside the native shell
  // window.open is not a tab: Capacitor hands the URL to the OS, which opens a
  // separate browser app, and on Android it returns null and does nothing.
  //
  // The login-only vendors go through openPortal, which in the app uses our own
  // in-app browser so the shop login can be filled in for them. (The system
  // in-app browser can't be scripted, and does NOT share Safari's cookies —
  // the old belief that a login there "sticks" is why techs signed in every
  // single time.)
  function open(vendor) {
    // The login-only vendors get the VIN put on the clipboard first, because the
    // very next thing anyone does on their site is paste it into a vehicle
    // picker. Fire and forget — a blocked clipboard must not stop the tab.
    if (vendor.needsLogin) copyVin()
    // Not awaited: on the web both call window.open synchronously, before their
    // first await, so the click still counts as the gesture that authorises
    // the tab. A rejection here must not take the panel down with it.
    const url = vendor.url({ q })
    Promise.resolve(vendor.needsLogin ? openPortal(vendor.key, url) : openWeb(url)).catch(() => {})
    onSearched?.({ vendor: vendor.key, query: q })
  }

  const loginVendors = VENDORS.filter((v) => v.needsLogin && logins?.portals?.[v.key]?.set)

  return (
    <div className="rounded-xl bg-slate-900 border border-slate-700 p-3 space-y-3">
      {/* The car, always on screen while you shop. For the login-only sites this
          IS the integration — you paste from here. */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Searching for</div>
          <div className="text-sm font-semibold truncate">
            {label || 'Unknown vehicle'}
          </div>
          {vin && (
            <div className="text-[11px] font-mono text-slate-400 truncate mt-0.5 select-all">{vin}</div>
          )}
        </div>
        {vin && (
          <button onClick={copyVin} type="button"
            className="shrink-0 flex items-center gap-1 px-2 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-[11px] font-semibold active:bg-slate-700">
            {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
            {copied ? 'Copied' : 'Copy VIN'}
          </button>
        )}
      </div>

      <input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="water pump, front rotors, alternator…"
        className="text-sm"
      />

      <div className="grid grid-cols-2 gap-1.5">
        {VENDORS.map((v) => (
          <button key={v.key} type="button" onClick={() => open(v)}
            title={v.needsLogin
              ? `Opens ${v.label} and copies the VIN — paste it into their vehicle picker`
              : `Search ${v.label} for this car`}
            className="flex items-center justify-between gap-1 px-2.5 py-2 rounded-lg bg-slate-800 border border-slate-700 text-xs font-semibold active:bg-slate-700">
            <span className="truncate">{v.emoji} {v.label}</span>
            <ExternalLink size={12} className="shrink-0 text-slate-500" />
          </button>
        ))}
      </div>

      {/* Web only: a page can't type into another site, so the shop login is
          one tap away to copy. In the app the in-app browser fills it in. */}
      {!isNative() && loginVendors.length > 0 && (
        <div className="space-y-1.5">
          {loginVendors.map((v) => <ShopLogin key={v.key} vendor={v} />)}
        </div>
      )}

      {/* Admins set the shop logins right here, where they get used. */}
      {logins?.can_edit && (
        editing
          ? <ShopLoginEditor status={logins.portals} onDone={(s) => { setEditing(false); if (s) setLogins(s) }} />
          : (
            <button type="button" onClick={() => setEditing(true)}
              className="w-full flex items-center justify-center gap-1 text-[11px] text-slate-400 py-1">
              <KeyRound size={12} />
              {VENDORS.filter((v) => v.needsLogin).every((v) => logins.portals?.[v.key]?.set)
                ? 'Change shop logins'
                : 'Save shop logins so techs never sign in'}
            </button>
          )
      )}

      {label ? (
        <p className="text-[10px] text-slate-500 leading-snug">
          eBay and Amazon open on results for this car. PartsTech and RepairLink open
          with the VIN copied, ready to paste{isNative() && loginVendors.length > 0
            ? ', and sign in with the shop login automatically.'
            : '.'}
        </p>
      ) : (
        <p className="text-[10px] text-amber-400 leading-snug">
          No year/make/model on this car, so the search is the part name only —
          check the fitment yourself before you buy.
        </p>
      )}
    </div>
  )
}

// The shop login for one portal, on the web. Fetched only when tapped — the
// password never loads just because someone opened the parts panel — and then
// each field is its own copy button, so the copy is a direct tap (Safari drops
// clipboard writes that happen after a network wait).
function ShopLogin({ vendor }) {
  const [login, setLogin] = useState(null)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  async function reveal() {
    setError('')
    try {
      const l = await portalLogin(vendor.key)
      if (l) setLogin(l)
      else setError('No saved login')
    } catch (e) {
      setError(e.message)
    }
  }

  async function copy(which) {
    if (await copyText(login[which])) {
      setDone(which)
      setTimeout(() => setDone(''), 1500)
    }
  }

  const btn = 'flex items-center gap-1 px-2 py-1 rounded-md bg-slate-800 border border-slate-700 text-[11px] font-semibold active:bg-slate-700'
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-800/50 px-2 py-1.5">
      <span className="text-[11px] text-slate-400 flex items-center gap-1 min-w-0 truncate">
        <KeyRound size={12} className="shrink-0" /> {vendor.label} shop login
      </span>
      {error ? (
        <span className="text-[11px] text-red-400 truncate">{error}</span>
      ) : !login ? (
        <button type="button" onClick={reveal} className={btn}>Show</button>
      ) : (
        <span className="flex gap-1 shrink-0">
          <button type="button" onClick={() => copy('username')} className={btn}>
            {done === 'username' ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />} User
          </button>
          <button type="button" onClick={() => copy('password')} className={btn}>
            {done === 'password' ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />} Password
          </button>
        </span>
      )}
    </div>
  )
}

// Admin only (the endpoint enforces it; this just hides the form from others).
// The password field is never pre-filled — an existing password isn't sent to
// this form at all, so leaving it blank on a portal keeps what's saved.
function ShopLoginEditor({ status, onDone }) {
  const portals = VENDORS.filter((v) => v.needsLogin)
  const [form, setForm] = useState(() => Object.fromEntries(portals.map((v) => [
    v.key, { username: status?.[v.key]?.username || '', password: '' },
  ])))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (key, field, value) => setForm((f) => ({ ...f, [key]: { ...f[key], [field]: value } }))

  async function save() {
    setSaving(true)
    setError('')
    try {
      for (const v of portals) {
        const { username, password } = form[v.key]
        if (username.trim() && password) await savePortalLogin(v.key, username.trim(), password)
      }
      onDone(await portalStatus())
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-2 space-y-2">
      <p className="text-[11px] text-slate-400">
        The shop&apos;s own logins. Stored encrypted; the app signs the shop team in with them.
      </p>
      {portals.map((v) => (
        <div key={v.key} className="space-y-1">
          <p className="text-[11px] font-semibold">
            {v.emoji} {v.label}{status?.[v.key]?.set ? <span className="text-emerald-400 font-normal"> · saved</span> : null}
          </p>
          <input value={form[v.key].username} onChange={(e) => set(v.key, 'username', e.target.value)}
            placeholder="Username / email" autoComplete="off" autoCapitalize="off" className="text-sm" />
          <input type="password" value={form[v.key].password} onChange={(e) => set(v.key, 'password', e.target.value)}
            placeholder={status?.[v.key]?.set ? 'New password (blank keeps the saved one)' : 'Password'}
            autoComplete="new-password" className="text-sm" />
        </div>
      ))}
      {error && <p className="text-[11px] text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={() => onDone(null)}
          className="flex-1 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs">Cancel</button>
        <button type="button" onClick={save} disabled={saving}
          className="flex-1 py-1.5 rounded-lg bg-emerald-500 text-slate-900 text-xs font-bold disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
