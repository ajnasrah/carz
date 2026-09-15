import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autofillScript, PORTAL_HOSTS } from './portalAutofill.js'

// The filling itself was exercised in headless Chrome against a plain server
// form and a React form (sign-in, wrong password stops at two tries, other
// hosts and non-login pages untouched). These guard the parts that can break
// without a browser noticing.

const tricky = { username: 'shop@carzinc.ai', password: 'p@ss"w0rd\'</script>\\n`${x}`' }

test('a password full of quotes still yields valid JavaScript', () => {
  assert.doesNotThrow(() => new Function(autofillScript({ ...tricky, hosts: PORTAL_HOSTS.repairlink })))
})

// Runs the script with a fake page on the given host. If the host guard lets
// it through, it touches `window`, which this stub turns into a flag.
function runOn(hostname, hosts) {
  let reached = false
  const window = new Proxy({}, { get() { reached = true }, set() { reached = true; return true } })
  try {
    new Function('location', 'window', autofillScript({ ...tricky, hosts }))({ hostname }, window)
  } catch {
    // Past the guard it goes looking for `document`, which there isn't one of.
  }
  return reached
}

test('the saved login is only ever offered to the portal it belongs to', () => {
  assert.equal(runOn('www.repairlinkshop.com', PORTAL_HOSTS.repairlink), true)
  assert.equal(runOn('repairlinkshop.com', PORTAL_HOSTS.repairlink), true)
  assert.equal(runOn('app.partstech.com', PORTAL_HOSTS.partstech), true)
  // lookalikes and other sites get nothing
  assert.equal(runOn('repairlinkshop.com.evil.io', PORTAL_HOSTS.repairlink), false)
  assert.equal(runOn('notrepairlinkshop.com', PORTAL_HOSTS.repairlink), false)
  assert.equal(runOn('app.partstech.com', PORTAL_HOSTS.repairlink), false)
})
