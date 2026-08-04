import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { rm } from 'node:fs/promises'
import path from 'node:path'

// `npm run build:native` sets this. The same source builds both the Vercel web
// app and the App Store / Play Store binary — only the asset set differs.
const isNativeBuild = process.env.VITE_NATIVE_BUILD === '1'

// public/training is a 181MB checkout of the training course (mostly PDFs).
// Vite copies publicDir verbatim into dist, which is fine for Vercel but would
// put 181MB of course material inside the app binary — past the App Store's
// cellular-download threshold and pointless, since the course is a read-once
// web resource. On a native build we drop it after the bundle is written; the
// app links out to the hosted copy instead.
function dropTrainingAssets() {
  return {
    name: 'carz:drop-training-assets',
    apply: 'build',
    async closeBundle() {
      if (!isNativeBuild) return
      // Resolve against this config file, not the CWD — `cap sync` and CI can
      // invoke the build from a different working directory, and a silent
      // no-op here would ship 181MB of PDFs inside the app binary.
      const dist = path.resolve(import.meta.dirname, 'dist')
      await rm(path.join(dist, 'training'), { recursive: true, force: true })
      // Local debugging page, not part of the product.
      await rm(path.join(dist, 'test-location.html'), { force: true })
      // The service worker must not ship in the native build at all. main.jsx
      // already skips registration and unregisters on native, but that code
      // only runs if the new bundle loads — and a stale SW serves the OLD
      // bundle, so it never does. The app then keeps showing a previous build
      // through reinstalls, since simctl install preserves WebKit storage.
      // Deleting the file makes the state unreachable rather than recoverable.
      await rm(path.join(dist, 'sw.js'), { force: true })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), dropTrainingAssets()],
})
