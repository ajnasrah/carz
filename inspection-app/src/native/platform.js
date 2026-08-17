import { Capacitor } from '@capacitor/core'

// Single source of truth for "are we inside the native shell?".
//
// Everything under src/native/ is written so the SAME bundle runs unchanged on
// Vercel and inside the iOS/Android app: each adapter checks isNative() and
// falls back to the browser behaviour the web app already had. Never branch on
// a build-time flag for behaviour — only for assets (see vite.config.js).

export const isNative = () => Capacitor.isNativePlatform()

export const platform = () => Capacitor.getPlatform() // 'ios' | 'android' | 'web'

export const isIOS = () => Capacitor.getPlatform() === 'ios'

export const isAndroid = () => Capacitor.getPlatform() === 'android'

// Where the training course lives. It's stripped from the native bundle
// (181MB of PDFs, see vite.config.js), so in the app we point at the hosted
// copy on the production domain.
export const TRAINING_BASE_URL = isNative()
  ? 'https://carzinc.ai/training'
  : '/training'

// Where the serverless functions in api/ live. On the web they're same-origin,
// so a relative path is right and keeps preview deployments talking to their own
// functions. The native shell serves the bundle off capacitor://localhost, where
// a relative /api/… resolves inside the app package and 404s — it has to name the
// production host.
//
// www, not the apex, unlike TRAINING_BASE_URL: carzinc.ai 307s to www.carzinc.ai,
// and that hop is cross-origin, so the browser drops the Authorization header on
// the way. A call that authenticates itself with a bearer token would arrive
// anonymous and be rejected. Verified: www answers with no redirect.
export const API_BASE_URL = isNative() ? 'https://www.carzinc.ai' : ''
