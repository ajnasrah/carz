import { App } from '@capacitor/app'
import { isNative } from './platform'

// "Is the app in front of the user right now?" — one listener, both shells.
//
// Capacitor's appStateChange covers the native app. visibilitychange covers the
// home-screen PWA and the browser, and also catches the odd Android path where
// appStateChange doesn't fire. Callers get cb(isActive) either way.
export function onAppStateChange(cb) {
  const onVisibility = () => cb(!document.hidden)
  document.addEventListener('visibilitychange', onVisibility)

  let handle
  let cancelled = false
  if (isNative()) {
    App.addListener('appStateChange', ({ isActive }) => cb(isActive))
      .then((h) => {
        if (cancelled) h.remove?.()
        else handle = h
      })
      .catch(() => {})
  }

  return () => {
    cancelled = true
    document.removeEventListener('visibilitychange', onVisibility)
    handle?.remove?.()
  }
}
