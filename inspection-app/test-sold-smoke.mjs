import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 414, height: 896 } })
await ctx.addInitScript(() => {
  const fakeSession = {
    access_token: 'fake.access.token',
    refresh_token: 'fake.refresh.token',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user: {
      id: '00000000-0000-0000-0000-000000000000',
      aud: 'authenticated', role: 'authenticated',
      phone: '+15555550100', created_at: new Date().toISOString(),
    },
  }
  localStorage.setItem('sb-yprihgygmreibcuybwoy-auth-token', JSON.stringify(fakeSession))
})
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(`PAGE: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`CON: ${m.text()}`) })

// First check the new dashboard tile layout
console.log('━━━ Dashboard tile grid ━━━')
await page.goto('http://localhost:5174/', { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
console.log('URL:', page.url())
const tileLinks = await page.locator('a[href]').all()
const tiles = []
for (const t of tileLinks) {
  const href = await t.getAttribute('href')
  const text = (await t.textContent()) || ''
  if (href && href.startsWith('/')) tiles.push({ href, text: text.trim().slice(0, 30) })
}
console.log(`tiles found: ${tiles.length}`)
tiles.forEach((t) => console.log(`  ${t.href} → "${t.text}"`))
await page.screenshot({ path: '/tmp/dashboard-tiles.png', fullPage: true })
console.log('📸 /tmp/dashboard-tiles.png\n')

console.log('━━━ Inspections page (post-extraction) ━━━')
await page.goto('http://localhost:5174/inspections', { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
const inspH1 = await page.locator('h1').first().textContent().catch(() => '')
console.log('h1:', inspH1)
const filterChips = await page.locator('button:has-text("In Progress")').count()
console.log('filter chips:', filterChips)

console.log('\n━━━ Sold Reports ━━━')
await page.goto('http://localhost:5174/sold-reports', { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
console.log('URL:', page.url())
const h1 = await page.locator('h1').first().textContent().catch(() => '(none)')
console.log('h1:', h1)
const hasPeriodChips = await page.locator('button:has-text("Last 90d")').count()
console.log('period chips found:', hasPeriodChips)
const hasMonthlyTrend = await page.locator('h2:has-text("Monthly Trend")').count()
console.log('monthly trend section:', hasMonthlyTrend)
const hasDaysChart = await page.locator('h2:has-text("Days on Lot")').count()
console.log('days on lot section:', hasDaysChart)
const hasMakes = await page.locator('h2:has-text("Make Performance")').count()
console.log('make performance section:', hasMakes)
await page.screenshot({ path: '/tmp/sold-reports.png', fullPage: true })
console.log('screenshot: /tmp/sold-reports.png')
const fatal = errors.filter((e) => !e.includes('401') && !e.includes('JWT'))
console.log(`errors (excluding expected 401/JWT): ${fatal.length}`)
fatal.slice(0, 5).forEach((e) => console.log(' ', e))
const isLoading = await page.locator('text=Loading sold data').count()
const isError = await page.locator('text=Failed to load').count()
console.log('loading state visible:', isLoading > 0)
console.log('error state visible:', isError > 0)
const bodyText = await page.locator('body').innerText()
console.log('body text (first 400 chars):', bodyText.slice(0, 400))
await browser.close()
process.exit(fatal.length > 0 ? 1 : 0)
