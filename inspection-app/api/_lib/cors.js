// Let the native app call this endpoint.
//
// The iOS/Android shell serves the bundle from capacitor://localhost, which is
// cross-origin to www.carzinc.ai, and an Authorization header always triggers a
// preflight. Without these headers the browser layer blocks the call before it
// leaves the phone — the web app keeps working and the App Store build quietly
// doesn't. Allow-Origin '*' is safe: the session token is the gate and it is
// sent explicitly, so no ambient credentials ride along. Same headers as
// api/delete-account.js and api/reserve-car.js.
//
// Returns true when it answered a preflight, so the handler can stop there.
export function appCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Max-Age', '86400')
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return true
  }
  return false
}
