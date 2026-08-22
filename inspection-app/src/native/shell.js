import { StatusBar, Style } from '@capacitor/status-bar'
import { SplashScreen } from '@capacitor/splash-screen'
import { App } from '@capacitor/app'
import { isNative, isAndroid } from './platform'

// One-time native shell setup, called from main.jsx. Everything here is a
// no-op on web.

// Returns a teardown function. React StrictMode runs effects twice in dev, and
// Capacitor's addListener stacks rather than replaces — without teardown every
// deep link would navigate twice and every back press would pop two screens.
export async function initNativeShell({ onDeepLink, onBack } = {}) {
  if (!isNative()) return () => {}

  // The app is dark-on-slate-900 everywhere; matching the status bar keeps the
  // notch area from flashing white on launch and route changes.
  await StatusBar.setStyle({ style: Style.Dark }).catch(() => {})
  if (isAndroid()) {
    await StatusBar.setBackgroundColor({ color: '#0f172a' }).catch(() => {})
  }

  await SplashScreen.hide().catch(() => {})

  // Put the zoom lock back, native only. index.html ships an unlocked viewport
  // so Chrome on Android can pinch — a browser has an address bar and a reload
  // to recover with. The app has neither: a pinch there sticks, the fixed
  // header and bottom nav are pinned to a viewport that no longer matches the
  // content, and there is no obvious way back to 100%. Inputs are 16px so this
  // costs nothing (iOS never honoured user-scalable=no anyway; maximum-scale is
  // the half it does honour).
  document.querySelector('meta[name="viewport"]')?.setAttribute(
    'content',
    'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover',
  )

  // Universal Links / App Links: a shared marketplace listing should open the
  // car in the app rather than bouncing to Safari.
  const urlOpen = await App.addListener('appUrlOpen', ({ url }) => {
    try {
      const { pathname, search } = new URL(url)
      onDeepLink?.(pathname + search)
    } catch {
      /* malformed link — ignore rather than crash the launch */
    }
  })

  // Android hardware back button. Without this, back from the dashboard
  // suspends the app instead of doing nothing, and back mid-inspection can
  // drop the inspector out entirely.
  const back = await App.addListener('backButton', (e) => onBack?.(e))

  // Deliberately NOT calling Keyboard.setScroll or setting a keyboard resize
  // mode. Those touch the WKWebView's scroll view, and the page wouldn't scroll
  // at all in the native shell while scrolling fine in a browser. Leave the
  // scroll view alone unless there's a concrete keyboard problem to solve.

  return () => {
    urlOpen.remove?.()
    back.remove?.()
  }
}
