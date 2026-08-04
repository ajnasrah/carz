import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { isNative, isAndroid } from './platform'

// window.open() and `window.location = 'sms:...'` do nothing inside WKWebView —
// the webview refuses to navigate to a scheme it doesn't handle, so the "Text
// us about this car" button on a marketplace listing was a dead button in the
// native shell. App.openUrl hands the URL to the OS, which opens Messages.

/** Open sms:, tel:, mailto:, or maps: — anything the OS should handle. */
export async function openExternal(url) {
  if (!isNative()) {
    window.open(url, '_self')
    return
  }
  await App.openUrl({ url })
}

/**
 * Open a web page. On native this uses the in-app browser (SFSafariViewController
 * / Custom Tabs) so the user stays in the app and can swipe back — leaving to
 * Safari and losing the app is a bad flow for a link tapped mid-inspection.
 */
export async function openWeb(url) {
  if (!isNative()) {
    window.open(url, '_blank', 'noopener,noreferrer')
    return
  }
  await Browser.open({ url, presentationStyle: 'popover' })
}

/** SMS deep link with a prefilled body, formatted per platform. */
export function smsUrl(phone, body) {
  const digits = String(phone).replace(/\D/g, '')
  // iOS wants `&body=`, Android wants `?body=`. Getting this wrong drops the
  // message text silently — the SMS app opens with an empty draft.
  //
  // Check the native platform first, then fall back to the user agent so a
  // buyer opening a marketplace listing in Android Chrome (not the app) also
  // gets a working prefill. That case was broken before this existed.
  const android = isNative()
    ? isAndroid()
    : typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)
  return `sms:${digits}${android ? '?' : '&'}body=${encodeURIComponent(body)}`
}
