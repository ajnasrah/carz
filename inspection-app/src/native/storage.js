import { Preferences } from '@capacitor/preferences'
import { isNative } from './platform'

// Supabase keeps the auth session in localStorage. Inside WKWebView that store
// is evictable — iOS clears it under memory pressure and on its 7-day
// intelligent-tracking sweep — so the crew gets logged out mid-shift and has to
// re-do the SMS OTP dance, often on a phone with one bar on the back lot.
//
// Preferences is backed by UserDefaults (iOS) / SharedPreferences (Android),
// which the OS does not evict. Supabase accepts an async storage adapter — it's
// the same contract used for AsyncStorage in React Native — so this drops
// straight into createClient.
//
// Returns undefined on web so Supabase keeps its own localStorage default and
// existing browser sessions stay valid.
export const authStorage = isNative()
  ? {
      getItem: async (key) => {
        const { value } = await Preferences.get({ key })
        return value
      },
      setItem: async (key, value) => {
        await Preferences.set({ key, value })
      },
      removeItem: async (key) => {
        await Preferences.remove({ key })
      },
    }
  : undefined

// General-purpose durable key/value for app preferences (e.g. the lot walk's
// last-selected section). Mirrors the localStorage API but async, so callers
// await it on both platforms and behave identically.
export const store = {
  async get(key) {
    if (!isNative()) {
      try {
        return localStorage.getItem(key)
      } catch {
        return null
      }
    }
    const { value } = await Preferences.get({ key })
    return value
  },
  async set(key, value) {
    if (!isNative()) {
      try {
        localStorage.setItem(key, value)
      } catch {
        /* private mode / quota — non-fatal, it's only a convenience */
      }
      return
    }
    await Preferences.set({ key, value })
  },
  async remove(key) {
    if (!isNative()) {
      try {
        localStorage.removeItem(key)
      } catch {
        /* non-fatal */
      }
      return
    }
    await Preferences.remove({ key })
  },
}
