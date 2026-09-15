// Opening PartsTech and RepairLink already signed in.
//
// The shop saves its login once (an admin, from the parts panel; stored by
// api/portal-login.js). What happens when a tech taps the portal depends on
// where they are:
//
// IN THE APP — our own in-app browser (@capgo/inappbrowser), not the system one.
// Two reasons, both learned the hard way:
//   1. SFSafariViewController does NOT share Safari's cookies (it hasn't since
//      iOS 11 — each app gets a private jar), and a session cookie with no
//      expiry doesn't reliably survive it being dismissed. RepairLink's login
//      has no "stay signed in" at all, only "remember my username". So the old
//      promise that a login "sticks" was true for nobody.
//   2. The system browser can't be scripted. This one can: every page load
//      runs the script in portalAutofill.js, which fills the portal's own login form with the
//      shop login and submits it. If the session survived, there is no form
//      and nothing happens; if it didn't, the tech watches it sign in.
//
// ON THE WEB — no web page can type into another site, so the panel opens the
// portal in a tab and offers the username and password to copy. The browser's
// own password manager takes it from there after the first sign-in.

import { InAppBrowser, ToolBarType } from '@capgo/inappbrowser'
import { supabase } from './supabase'
import { API_BASE_URL, isNative } from '../native/platform'
import { openWeb } from '../native/links'
import { autofillScript, PORTAL_HOSTS } from './portalAutofill'

async function authed(path, init = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Sign in again')
  const res = await fetch(`${API_BASE_URL}/api/portal-login${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      ...(init.headers || {}),
    },
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(out.error || `Request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return out
}

export const portalStatus = () => authed('?status=1')

// { username, password }, or null when none is saved / this person isn't
// shop staff — either way the portal still opens, just not signed in.
export async function portalLogin(portal) {
  try {
    return await authed(`?portal=${encodeURIComponent(portal)}`)
  } catch (e) {
    if (e.status === 404 || e.status === 403) return null
    throw e
  }
}

export const savePortalLogin = (portal, username, password) =>
  authed('', { method: 'POST', body: JSON.stringify({ portal, username, password }) })

export const clearPortalLogin = (portal) =>
  authed('', { method: 'POST', body: JSON.stringify({ portal, clear: true }) })

// Open a portal for this car. `url` is the vendor's landing page.
export async function openPortal(portal, url) {
  if (!isNative()) {
    await openWeb(url)
    return { signedIn: false }
  }

  // Fetched per open, not cached: an admin changing the password should take
  // effect on the very next tap.
  let login = null
  try { login = await portalLogin(portal) } catch { /* open unsigned rather than not at all */ }

  const handles = []
  const { id } = await InAppBrowser.openWebView({
    url,
    title: portal === 'partstech' ? 'PartsTech' : 'RepairLink',
    toolbarType: ToolBarType.NAVIGATION,
    showReloadButton: true,
    activeNativeNavigationForWebview: true,
  })

  if (login) {
    const code = autofillScript({ ...login, hosts: PORTAL_HOSTS[portal] })
    const run = () => InAppBrowser.executeScript({ code, id }).catch(() => {})
    handles.push(await InAppBrowser.addListener('browserPageLoaded', (e) => {
      if (!e?.id || e.id === id) run()
    }))
    run()
  }
  handles.push(await InAppBrowser.addListener('closeEvent', () => {
    handles.forEach((hd) => hd.remove())
  }))
  return { signedIn: !!login }
}
