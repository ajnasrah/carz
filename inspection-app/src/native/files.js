import { Filesystem, Directory } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { isNative } from './platform'

// WKWebView has no download manager. The `<a download>` + createObjectURL
// trick every export in this app used just silently does nothing inside the
// native shell — no file, no error, no feedback. So on native we write the
// file to the app's cache directory and hand it to the OS share sheet, which
// is where a phone user wants an export anyway (Mail it, drop it in Files,
// AirDrop it to the office Mac).
//
// On web this is byte-for-byte the old behaviour, so nothing about the Vercel
// app changes.

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    // readAsDataURL gives "data:<mime>;base64,<payload>" — Filesystem wants
    // just the payload.
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error || new Error('Could not read file data'))
    reader.readAsDataURL(blob)
  })
}

/**
 * Save a Blob as a file the user can keep.
 *
 * @param {Blob} blob      file contents
 * @param {string} filename  e.g. 'inventory-2026-08-03.csv'
 * @param {object} [opts]
 * @param {string} [opts.title]  share-sheet title on native
 * @returns {Promise<boolean>} false if the user dismissed the share sheet
 */
export async function saveFile(blob, filename, opts = {}) {
  if (!isNative()) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    // Revoking immediately races the download in Safari; 5s is what the
    // xlsx export already used and it's reliable.
    setTimeout(() => URL.revokeObjectURL(url), 5000)
    return true
  }

  const data = await blobToBase64(blob)
  // Cache, not Documents: these are throwaway exports and the OS is free to
  // reclaim them. Once shared, the receiving app owns its own copy.
  const { uri } = await Filesystem.writeFile({
    path: filename,
    data,
    directory: Directory.Cache,
  })

  try {
    await Share.share({
      title: opts.title || filename,
      files: [uri],
      dialogTitle: opts.title || 'Export',
    })
    return true
  } catch (err) {
    // Capacitor rejects when the user swipes the sheet away. That's a normal
    // outcome, not an error worth surfacing.
    if (/cancel/i.test(err?.message || '')) return false
    throw err
  }
}

/** Convenience wrapper for the CSV exports, which all build a string. */
export function saveCsv(csvText, filename, opts) {
  return saveFile(new Blob([csvText], { type: 'text/csv;charset=utf-8' }), filename, opts)
}
