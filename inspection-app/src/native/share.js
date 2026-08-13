import { Share } from '@capacitor/share'
import { isNative } from './platform'
import { copyText } from './clipboard'

// One share that works everywhere: the OS share sheet in the app, the Web Share
// API on a phone browser, clipboard on a desktop browser that has neither.
//
// Returns 'shared' | 'copied' | 'cancelled' so the caller can say what happened
// instead of flashing "Shared!" at someone who just got a clipboard copy.
export async function shareText({ title, text, url }) {
  const payload = [text, url].filter(Boolean).join('\n')

  // `title` is CONTENT on most targets, not a heading — Messages and WhatsApp
  // paste it above the body. Passing the car's name as the title is what put
  // "2016 INFINITI QX60" on its own line above a body that already opened with
  // "2016 INFINITI QX60". It now goes only to dialogTitle, which is the Android
  // chooser's own header and never travels with the message.
  if (isNative()) {
    try {
      await Share.share({ text: payload, dialogTitle: title })
      return 'shared'
    } catch (err) {
      // The sheet resolves by throwing when dismissed on iOS.
      if (/cancel/i.test(err?.message || '')) return 'cancelled'
    }
  } else if (navigator.share) {
    try {
      await navigator.share({ text: payload })
      return 'shared'
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled'
    }
  }

  return (await copyText(payload)) ? 'copied' : 'cancelled'
}
