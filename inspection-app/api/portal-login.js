// The shop's PartsTech and RepairLink logins — typed once, used by everyone.
//
// Techs were signing in to both portals every time they opened them from a
// job. Now an admin saves the shop's login once (from the parts panel itself —
// the place it's used), and the panel signs
// each tech in with it (src/services/partsPortals.js): inside the app the
// in-app browser fills the portal's own login form, and on the web the panel
// offers the username and password to copy.
//
//   GET  ?status=1           shop roles — { can_edit, portals: { partstech: { set } … } } (no passwords)
//   GET  ?portal=partstech   shop roles — { username, password }
//   POST { portal, username, password }   admins — save (replaces)
//   POST { portal, clear: true }          admins — remove
//
// WHO. Handing out a password is the whole point, so the gate is who may have
// it: admins, and the people who actually buy parts — body shop manager and
// tech, mechanic shop manager. Any other employee gets 403, a buyer never gets
// past employeeFromToken.
//
// STORAGE. shop_portal_logins is revoked from every app role; only this
// function's service key reaches it. The password is AES-256-GCM encrypted
// with a key derived from SUPABASE_SERVICE_KEY, so the nightly database backup
// holds ciphertext only. Rotating the service key makes saved logins
// undecryptable — this says so, and an admin re-enters them.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY

import crypto from 'node:crypto'
import { employeeFromToken, bearer } from './_lib/employee.js'
import { appCors } from './_lib/cors.js'

export const config = { runtime: 'nodejs' }

const PORTALS = new Set(['partstech', 'repairlink'])
const SHOP_ROLES = ['owner_admin', 'body_shop_manager', 'body_shop_tech', 'mechanic_manager']

const isAdmin = (p) => p?.role === 'admin' || (p?.roles || []).includes('owner_admin')
const isShop = (p) => isAdmin(p) || (p?.roles || []).some((r) => SHOP_ROLES.includes(r))

function key() {
  return crypto.createHash('sha256')
    .update(`shop-portal-logins:${process.env.SUPABASE_SERVICE_KEY}`)
    .digest()
}

export function encrypt(plain, k = key()) {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', k, iv)
  const body = Buffer.concat([c.update(String(plain), 'utf8'), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64')
}

export function decrypt(enc, k = key()) {
  const buf = Buffer.from(enc, 'base64')
  const d = crypto.createDecipheriv('aes-256-gcm', k, buf.subarray(0, 12))
  d.setAuthTag(buf.subarray(12, 28))
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8')
}

function sb(path, init = {}) {
  return fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
}

export default async function handler(req, res) {
  if (appCors(req, res, 'GET, POST, OPTIONS')) return
  // A password must never sit in a shared cache.
  res.setHeader('Cache-Control', 'no-store')

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    res.status(503).json({ error: 'Server is not configured' }); return
  }
  const user = await employeeFromToken(bearer(req))
  if (!user) { res.status(401).json({ error: 'Sign in again' }); return }
  if (!isShop(user.profile)) { res.status(403).json({ error: 'Parts portal logins are for the shop team' }); return }

  try {
    if (req.method === 'GET') {
      if (req.query.status) {
        const r = await sb('shop_portal_logins?select=portal,username,updated_at')
        if (!r.ok) throw new Error(`read ${r.status}`)
        const rows = await r.json()
        const admin = isAdmin(user.profile)
        const portals = {}
        for (const p of PORTALS) {
          const row = rows.find((x) => x.portal === p)
          // Usernames only to admins: a tech needs the portal to open signed
          // in, not a list of the shop's accounts.
          portals[p] = row
            ? { set: true, updated_at: row.updated_at, ...(admin ? { username: row.username } : {}) }
            : { set: false }
        }
        res.status(200).json({ can_edit: admin, portals }); return
      }

      const portal = String(req.query.portal || '')
      if (!PORTALS.has(portal)) { res.status(400).json({ error: 'Unknown portal' }); return }
      const r = await sb(`shop_portal_logins?portal=eq.${portal}&select=username,password_enc`)
      if (!r.ok) throw new Error(`read ${r.status}`)
      const [row] = await r.json()
      if (!row) { res.status(404).json({ error: 'No shop login saved for this portal yet' }); return }
      let password
      try {
        password = decrypt(row.password_enc)
      } catch {
        res.status(409).json({ error: 'The saved login can no longer be read — an admin needs to re-enter it' }); return
      }
      res.status(200).json({ username: row.username, password }); return
    }

    if (req.method === 'POST') {
      if (!isAdmin(user.profile)) { res.status(403).json({ error: 'Only an admin can change the shop logins' }); return }
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
      const portal = String(body.portal || '')
      if (!PORTALS.has(portal)) { res.status(400).json({ error: 'Unknown portal' }); return }

      if (body.clear) {
        const r = await sb(`shop_portal_logins?portal=eq.${portal}`, { method: 'DELETE' })
        if (!r.ok) throw new Error(`delete ${r.status}`)
        res.status(200).json({ ok: true }); return
      }

      const username = String(body.username || '').trim()
      const password = String(body.password || '')
      if (!username || !password) { res.status(400).json({ error: 'Username and password are both required' }); return }

      const r = await sb('shop_portal_logins?on_conflict=portal', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({
          portal, username, password_enc: encrypt(password),
          updated_by: user.id, updated_at: new Date().toISOString(),
        }),
      })
      if (!r.ok) throw new Error(`save ${r.status}: ${(await r.text()).slice(0, 120)}`)
      res.status(200).json({ ok: true }); return
    }

    res.status(405).json({ error: 'GET or POST' })
  } catch (e) {
    res.status(500).json({ error: String(e.message || e).slice(0, 200) })
  }
}
