import { Clipboard } from '@capacitor/clipboard'
import { isNative } from './platform'

// navigator.clipboard needs a secure context AND a user-gesture-adjacent call.
// Inside WKWebView it's present but flaky — it rejects silently often enough
// that the "Copied!" toast in this app would lie. The native Clipboard plugin
// goes straight to UIPasteboard / ClipboardManager and always works.
//
// Every caller in the app is fire-and-forget ("copy, flash a checkmark"), so
// this resolves to a boolean instead of throwing.
export async function copyText(text) {
  const value = String(text ?? '')
  if (!value) return false

  if (isNative()) {
    try {
      await Clipboard.write({ string: value })
      return true
    } catch {
      return false
    }
  }

  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    // Older Safari / insecure context: fall back to the execCommand trick.
    try {
      const ta = document.createElement('textarea')
      ta.value = value
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}
