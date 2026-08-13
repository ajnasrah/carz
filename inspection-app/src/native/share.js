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

  if (isNative()) {
    try {
      await Share.share({ title, text, url, dialogTitle: title })
      return 'shared'
    } catch (err) {
      // The sheet resolves by throwing when dismissed on iOS.
      if (/cancel/i.test(err?.message || '')) return 'cancelled'
    }
  } else if (navigator.share) {
    try {
      await navigator.share({ title, text, url })
      return 'shared'
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled'
    }
  }

  return (await copyText(payload)) ? 'copied' : 'cancelled'
}
