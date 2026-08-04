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
