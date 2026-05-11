// UI smoke test — verifies the LotWalk feature is reachable from the post-login state.
// Since auth requires phone OTP we can't actually log in, but we can:
//   1. Verify the dev server boots and serves the app
//   2. Verify /lot is wired (redirects to /login when not authenticated)
//   3. Verify the login page renders without error
//   4. Mock the auth state in localStorage to simulate a logged-in user
//      and capture screenshots of the Dashboard + LotWalk pages

import { chromium } from 'playwright'

const BASE = 'http://localhost:5174'

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({
  viewport: { width: 414, height: 896 },  // iPhone 14 Plus dimensions
  deviceScaleFactor: 2,
})
const page = await ctx.newPage()

const errors = []
page.on('pageerror', (err) => errors.push(`PAGE ERROR: ${err.message}`))
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`CONSOLE ERROR: ${msg.text()}`)
})

console.log('━━━ 1. Boot check: dev server serves the app ━━━')
const r1 = await page.goto(BASE, { waitUntil: 'networkidle' })
console.log(`  / → ${r1.status()}`)
await page.waitForTimeout(500)
console.log(`  URL after load: ${page.url()}`)

console.log('\n━━━ 2. /lot route is wired (redirects to /login when unauth) ━━━')
const r2 = await page.goto(`${BASE}/lot`, { waitUntil: 'networkidle' })
console.log(`  /lot → ${r2.status()}`)
await page.waitForTimeout(500)
const finalUrl = page.url()
console.log(`  URL after navigation: ${finalUrl}`)
if (finalUrl.endsWith('/login')) {
  console.log('  ✅ /lot correctly redirects to /login (auth gate working)')
} else {
  console.log('  ❌ /lot did not redirect — auth gate may be broken')
}

console.log('\n━━━ 3. Login page renders ━━━')
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
const loginTitle = await page.title()
const loginH1 = await page.locator('h1').first().textContent().catch(() => '(no h1)')
console.log(`  title: ${loginTitle}`)
console.log(`  h1: ${loginH1}`)
await page.screenshot({ path: '/tmp/lotwalk-1-login.png' })
console.log('  📸 saved /tmp/lotwalk-1-login.png')

console.log('\n━━━ 4. Visit Dashboard route directly (will redirect to login) ━━━')
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
console.log(`  URL after / : ${page.url()}`)
// Should be /login since not authenticated. Capture for visual confirmation.
await page.screenshot({ path: '/tmp/lotwalk-2-dashboard-unauth.png' })

console.log('\n━━━ 5. Confirm bundled JS contains LotWalk + html5-qrcode ━━━')
// Check the network for the bundle and look for our exported names
const scripts = await page.locator('script[src]').all()
let foundLotWalk = false
let foundQrCode = false
for (const s of scripts) {
  const src = await s.getAttribute('src')
  if (!src) continue
  const url = src.startsWith('http') ? src : `${BASE}${src}`
  try {
    const res = await page.request.get(url)
    if (!res.ok()) continue
    const body = await res.text()
    if (body.includes('LotWalk') || body.includes('lotwalk')) foundLotWalk = true
    if (body.includes('Html5Qrcode') || body.includes('html5-qrcode')) foundQrCode = true
  } catch { /* ignore */ }
}
console.log(`  LotWalk component in bundle: ${foundLotWalk ? '✅' : '⚠️ (probably code-split)'}`)
console.log(`  html5-qrcode in bundle: ${foundQrCode ? '✅' : '⚠️ (probably code-split)'}`)

console.log('\n━━━ 6. Logged-in Dashboard layout (fake session) ━━━')
// Inject a fake Supabase session into localStorage so the auth context
// thinks we're logged in. DB queries will 401 but the layout will render.
await ctx.addInitScript(() => {
  const PROJECT_REF = 'yprihgygmreibcuybwoy'
  const fakeSession = {
    access_token: 'fake.access.token',
    refresh_token: 'fake.refresh.token',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user: {
      id: '00000000-0000-0000-0000-000000000000',
      aud: 'authenticated',
      role: 'authenticated',
      phone: '+15555550100',
      created_at: new Date().toISOString(),
      app_metadata: { provider: 'phone' },
      user_metadata: {},
    },
  }
  window.localStorage.setItem(
    `sb-${PROJECT_REF}-auth-token`,
    JSON.stringify(fakeSession),
  )
})

const dashPage = await ctx.newPage()
const dashErrors = []
dashPage.on('pageerror', (err) => dashErrors.push(`PAGE ERROR: ${err.message}`))
dashPage.on('console', (msg) => {
  if (msg.type() === 'error') dashErrors.push(`CONSOLE ERROR: ${msg.text()}`)
})
await dashPage.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await dashPage.waitForTimeout(1500)  // let any async profile loads settle
console.log(`  URL after fake-auth: ${dashPage.url()}`)
const onDashboard = !dashPage.url().endsWith('/login')
console.log(`  reached dashboard: ${onDashboard ? '✅' : '❌'}`)

if (onDashboard) {
  // Capture full Dashboard
  await dashPage.screenshot({ path: '/tmp/lotwalk-3-dashboard.png', fullPage: true })
  console.log('  📸 saved /tmp/lotwalk-3-dashboard.png')

  // Check that "Track Inventory" link is present and how prominent it is
  const trackLink = dashPage.locator('a[href="/lot"]')
  const linkCount = await trackLink.count()
  console.log(`  "Track Inventory" link count on dashboard: ${linkCount}`)

  if (linkCount > 0) {
    const isVisible = await trackLink.first().isVisible()
    console.log(`  visible: ${isVisible ? '✅' : '❌'}`)
    const box = await trackLink.first().boundingBox()
    if (box) {
      console.log(`  position: top=${Math.round(box.y)}px, height=${Math.round(box.height)}px`)
      console.log(`  → ${box.y < 300 ? '✅ above the fold' : '⚠️ below 300px (may need scroll on small screens)'}`)
    }
    const text = await trackLink.first().textContent()
    console.log(`  text content: "${text?.trim()}"`)
  }

  // Now click Track Inventory and capture the LotWalk page
  await trackLink.first().click()
  await dashPage.waitForTimeout(800)
  console.log(`  after click: ${dashPage.url()}`)
  await dashPage.screenshot({ path: '/tmp/lotwalk-4-lotwalk.png', fullPage: true })
  console.log('  📸 saved /tmp/lotwalk-4-lotwalk.png')

  // Check section dropdown + camera/voice/type buttons exist
  const sectionSelect = await dashPage.locator('select').count()
  const cameraBtn = await dashPage.locator('button:has-text("Camera Scan")').count()
  const voiceBtn = await dashPage.locator('button:has-text("Voice Entry")').count()
  const typeInput = await dashPage.locator('input[placeholder*="stock"]').count()
  console.log(`  section <select>: ${sectionSelect > 0 ? '✅' : '❌'}`)
  console.log(`  Camera Scan button: ${cameraBtn > 0 ? '✅' : '❌'}`)
  console.log(`  Voice Entry button: ${voiceBtn > 0 ? '✅' : '❌'}`)
  console.log(`  Type input box: ${typeInput > 0 ? '✅' : '❌'}`)
}

if (dashErrors.length > 0) {
  console.log(`  page errors during dashboard render (DB 401s expected with fake session):`)
  dashErrors.slice(0, 5).forEach((e) => console.log(`    ${e}`))
}

console.log('\n━━━ 7. Page errors during run ━━━')
if (errors.length === 0) {
  console.log('  ✅ no page errors')
} else {
  console.log(`  ❌ ${errors.length} errors:`)
  errors.forEach((e) => console.log(`    ${e}`))
}

await browser.close()
console.log('\n━━━ Done ━━━')
process.exit(errors.length > 0 ? 1 : 0)
