import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { isNative } from './native/platform'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Register service worker for PWA — web only.
//
// Inside the native shell the app is served from a custom scheme
// (capacitor://localhost on iOS, https://localhost on Android) by Capacitor's
// own asset handler. A service worker layered on top of that fights the native
// loader and can pin the app to a stale bundle after an app update, because the
// SW cache outlives the binary. The bundle already ships inside the app, so
// there's nothing for the SW to buy us there.
if ('serviceWorker' in navigator) {
  if (isNative()) {
    // Belt and braces: if a build ever shipped with a SW registered, tear it
    // down so an old cache can't outlive an app update.
    navigator.serviceWorker.getRegistrations?.()
      .then((regs) => regs.forEach((r) => r.unregister()))
      .catch(() => {})
  } else {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    })
  }
}
