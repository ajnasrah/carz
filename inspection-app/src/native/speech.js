import { SpeechRecognition } from '@capacitor-community/speech-recognition'
import { isNative, isIOS } from './platform'

// The lot walk lets the guy walking the rows call out stock numbers instead of
// typing them. That was built on the Web Speech API, which is a Safari-only,
// browser-chrome-level feature — `webkitSpeechRecognition` is simply undefined
// inside WKWebView, so voice entry disappears the moment the app goes native.
//
// This wraps both engines behind one session object with the semantics the lot
// walk actually needs: continuous listening, interim results as you speak, and
// auto-restart when the engine cuts out (iOS caps a single recognition at about
// a minute, and the Web Speech API drops the session on every pause).

export async function speechAvailable() {
  if (!isNative()) {
    return typeof window !== 'undefined' &&
      !!(window.SpeechRecognition || window.webkitSpeechRecognition)
  }
  try {
    const { available } = await SpeechRecognition.available()
    return !!available
  } catch {
    return false
  }
}

// Ask for mic + speech permission. Native only — on web the getUserMedia prompt
// is raised by the recognition engine itself.
export async function requestSpeechPermission() {
  if (!isNative()) return true
  try {
    const res = await SpeechRecognition.requestPermissions()
    return res?.speechRecognition === 'granted'
  } catch {
    return false
  }
}

/**
 * @param {object} handlers
 * @param {(r: {text: string, isFinal: boolean}) => void} handlers.onResult
 * @param {(code: string) => void} [handlers.onError]  'not-allowed' | 'no-speech' | 'unknown'
 * @returns {{start: () => Promise<void>, stop: () => Promise<void>, destroy: () => void}}
 */
export function createSpeechSession({ onResult, onError, lang = 'en-US' }) {
  return isNative()
    ? nativeSession({ onResult, onError, lang })
    : webSession({ onResult, onError, lang })
}

function webSession({ onResult, onError, lang }) {
  const SR = typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null
  if (!SR) {
    return { start: async () => {}, stop: async () => {}, destroy: () => {} }
  }

  let wantOn = false
  const rec = new SR()
  rec.continuous = true
  rec.interimResults = true
  rec.lang = lang

  rec.onresult = (e) => {
    let interim = ''
    let final = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript
      if (e.results[i].isFinal) final += t
      else interim += t
    }
    if (final) onResult({ text: final.trim(), isFinal: true })
    else if (interim) onResult({ text: interim.trim(), isFinal: false })
  }

  rec.onend = () => {
    // The engine ends the session on every natural pause. Restart so the
    // walker can keep calling out cars without re-tapping the mic.
    if (wantOn) {
      try { rec.start() } catch { /* already starting */ }
    }
  }

  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
      wantOn = false
      onError?.('not-allowed')
    } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
      onError?.('unknown')
    }
  }

  return {
    async start() {
      wantOn = true
      try { rec.start() } catch { /* already started */ }
    },
    async stop() {
      wantOn = false
      try { rec.stop() } catch { /* not running */ }
    },
    destroy() {
      wantOn = false
      try { rec.stop() } catch { /* not running */ }
    },
  }
}

function nativeSession({ onResult, onError, lang }) {
  let wantOn = false
  let listeners = []
  let restarting = false

  async function beginListening() {
    try {
      await SpeechRecognition.start({
        language: lang,
        partialResults: true,
        // No system popup — the lot walk draws its own live transcript so the
        // walker can see what was heard without losing the section selector.
        popup: false,
      })
      // Android resolves start() with the final matches; iOS resolves
      // immediately and delivers everything through partialResults.
    } catch (err) {
      const msg = String(err?.message || err)
      if (/permission|denied|authoriz/i.test(msg)) {
        wantOn = false
        onError?.('not-allowed')
        return
      }
      onError?.('unknown')
    }
  }

  async function restart() {
    // iOS ends recognition after roughly a minute of audio, and both platforms
    // stop on a long silence. Re-arm so continuous listening actually is.
    if (!wantOn || restarting) return
    restarting = true
    try {
      await SpeechRecognition.stop().catch(() => {})
      if (wantOn) await beginListening()
    } finally {
      restarting = false
    }
  }

  return {
    async start() {
      if (wantOn) return
      const granted = await requestSpeechPermission()
      if (!granted) {
        onError?.('not-allowed')
        return
      }
      wantOn = true

      const partial = await SpeechRecognition.addListener('partialResults', (data) => {
        const text = (data?.matches?.[0] || '').trim()
        // Treat every partial as interim; the lot walk matches on digits and
        // submits as soon as exactly one car matches, so waiting for a "final"
        // would add a needless pause on every car.
        if (text) onResult({ text, isFinal: false })
      })
      listeners.push(partial)

      const state = await SpeechRecognition.addListener('listeningState', (data) => {
        if (data?.status === 'stopped' && wantOn) restart()
      })
      listeners.push(state)

      await beginListening()
    },

    async stop() {
      wantOn = false
      await SpeechRecognition.stop().catch(() => {})
      for (const l of listeners) await l.remove?.()
      listeners = []
    },

    destroy() {
      wantOn = false
      SpeechRecognition.stop().catch(() => {})
      for (const l of listeners) l.remove?.()
      listeners = []
    },
  }
}

// iOS routes speech through Apple's servers unless on-device recognition is
// available; exposed so the UI can warn about it on a dead-zone lot walk.
export const speechNeedsNetwork = () => isNative() && isIOS()
