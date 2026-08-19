import { useEffect, useRef, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { initNativeShell } from './native/shell'
import { rememberRoute, recallRoute, onAppPause } from './native/routeMemory'
import { onAppStateChange } from './native/appState'
import { supabase } from './services/supabase'
import { useAuth } from './context/useAuth'
import { isPrimaryAdmin } from './services/adminSetup'
import { isBodyShopOnly } from './services/bodyShop'
import BottomNav from './components/BottomNav'

// The two screens that can be the FIRST thing rendered stay eagerly imported:
// Login for a signed-out visitor, Dashboard for everyone else. Making these
// lazy would buy nothing — the app can't paint until one of them arrives, so
// splitting them just inserts a second network round trip before first paint.
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'

// Everything else is fetched when its route is first visited.
//
// Why: these 39 pages were static imports, so every one of them — plus recharts,
// chart.js and html5-qrcode, which only three of them use — was compiled into a
// single 1.8MB entry bundle that the crew downloaded and parsed on the lot,
// on a phone, before the login screen could paint. Nothing here is needed to
// render the first screen. Adding a page? Add it as lazy() unless it is the
// first thing a user can possibly see.
const Setup = lazy(() => import('./pages/Setup'))
const PendingApproval = lazy(() => import('./pages/PendingApproval'))
const StartInspection = lazy(() => import('./pages/StartInspection'))
const StartupCheck = lazy(() => import('./pages/StartupCheck'))
const ExteriorDamage = lazy(() => import('./pages/ExteriorDamage'))
const InteriorDamage = lazy(() => import('./pages/InteriorDamage'))
const TestDrive = lazy(() => import('./pages/TestDrive'))
const PhotoCapture = lazy(() => import('./pages/PhotoCapture'))
const InspectionReview = lazy(() => import('./pages/InspectionReview'))
const Lookup = lazy(() => import('./pages/Lookup'))
const Inventory = lazy(() => import('./pages/Inventory'))
const Sold = lazy(() => import('./pages/Sold'))
const Admin = lazy(() => import('./pages/Admin'))
const LotWalk = lazy(() => import('./pages/LotWalk'))
const SoldReports = lazy(() => import('./pages/SoldReports'))
const Inspections = lazy(() => import('./pages/Inspections'))
const Marketplace = lazy(() => import('./pages/Marketplace'))
const MarketplaceListing = lazy(() => import('./pages/MarketplaceListing'))
const BuyerList = lazy(() => import('./pages/BuyerList'))
const PullList = lazy(() => import('./pages/PullList'))
const VinCheck = lazy(() => import('./pages/VinCheck'))
const VehicleAnalytics = lazy(() => import('./pages/VehicleAnalytics'))
const FrontLotAging = lazy(() => import('./pages/FrontLotAging'))
const UnmatchedVehicles = lazy(() => import('./pages/UnmatchedVehicles'))
const ExecutiveDashboard = lazy(() => import('./pages/ExecutiveDashboard'))
const Reports = lazy(() => import('./pages/Reports'))
const BuyerMatch = lazy(() => import('./pages/BuyerMatch'))
const ListBuilder = lazy(() => import('./pages/ListBuilder'))
const Listings = lazy(() => import('./pages/Listings'))
const BodyShop = lazy(() => import('./pages/BodyShop'))
const BodyShopJob = lazy(() => import('./pages/BodyShopJob'))
const BodyShopPayout = lazy(() => import('./pages/BodyShopPayout'))
// Inbound Inspection Pages
const InboundDashboard = lazy(() => import('./pages/InboundDashboard'))
const InboundStart = lazy(() => import('./pages/InboundStart'))
const ArrivalInspection = lazy(() => import('./pages/ArrivalInspection'))
const MechanicalInspection = lazy(() => import('./pages/MechanicalInspection'))

// Warm the chunks for the screens that are one tap away.
//
// Splitting the routes took the entry bundle from 1.8MB to 557KB, but it moved
// the cost of a page to the moment you open it — and Sold Reports pulls in
// recharts, which is 357KB on its own. On the lot that turned an instant tab
// into a wait. So once the app is idle and the first screen is up, the bottom
// nav's destinations are fetched in the background: first paint stays cheap,
// and the tabs are already local by the time anyone presses one.
//
// Deliberately only these three. Prefetching everything would just rebuild the
// old bundle a second late.
function prefetchTabs() {
  const warm = () => {
    import('./pages/Inventory')
    import('./pages/SoldReports')
    import('./pages/BuyerMatch')
  }
  if (typeof requestIdleCallback === 'function') requestIdleCallback(warm, { timeout: 4000 })
  else setTimeout(warm, 2000)
}

// The one loading screen the app uses, in three places: auth resolving, a
// profile-gated route waiting on auth, and a lazy page chunk arriving. They
// looked identical already; sharing it means a route chunk landing doesn't
// flash a different screen than the auth check that preceded it.
function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-emerald-400 mb-2">CARZ INC</h1>
        <p className="text-slate-400">Loading...</p>
      </div>
    </div>
  )
}

function ProtectedRoute({ children, requireSetup = true }) {
  const { user, profile, loading } = useAuth()
  const { pathname } = useLocation()

  if (loading) return <LoadingScreen />

  if (!user) return <Navigate to="/login" replace />

  // Logged in but the profile failed to load (network/RLS error → profile===null after
  // loading finished). Fail CLOSED on gated routes: never render internal pages without a
  // profile to check. /setup and /pending (requireSetup=false) stay reachable so the user
  // isn't trapped. This closes an auth bypass where a transient load failure granted access.
  if (requireSetup && !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-emerald-400 mb-2">CARZ INC</h1>
          <p className="text-slate-400 mb-4">Couldn't load your account. Check your connection and try again.</p>
          <button onClick={() => window.location.reload()} className="bg-emerald-500 text-slate-900 font-bold py-2 px-5 rounded-lg">
            Retry
          </button>
        </div>
      </div>
    )
  }

  // Force unfinished profiles through the Setup page before they can use the app
  if (requireSetup && profile && profile.setup_complete === false) {
    return <Navigate to="/setup" replace />
  }

  // Approval gate + buyer scoping. Admins always pass. Skipped when requireSetup is
  // false (the /setup and /pending screens must stay reachable for new/pending users).
  if (requireSetup && profile) {
    const isAdmin = profile.role === 'admin' || isPrimaryAdmin(profile.phone)
    if (!isAdmin) {
      // New users can't use the app until an admin approves them.
      if (profile.approval_status !== 'approved') {
        return <Navigate to="/pending" replace />
      }
      // Approved buyers are marketplace-only — no internal pages.
      if (profile.account_type === 'buyer') {
        return <Navigate to="/listings" replace />
      }
      // The body shop crew (techs + shop manager, no other role) sees the Body
      // Shop section and nothing else. Their home is the board, so a deep link
      // or the "*" catch-all lands there instead of the dashboard.
      if (isBodyShopOnly(profile) && !pathname.startsWith('/body-shop')) {
        return <Navigate to="/body-shop" replace />
      }
    }
  }
  return children
}

function AppRoutes() {
  const { user, loading } = useAuth()

  // Once there's a signed-in user the bottom nav is on screen, so its
  // destinations are worth having locally before they're pressed.
  useEffect(() => { if (user) prefetchTabs() }, [user])

  if (loading) return <LoadingScreen />

  return (
    <Suspense fallback={<LoadingScreen />}>
    <Routes>
      <Route path="/login" element={user ? <AfterLogin /> : <Login />} />
      <Route path="/setup" element={<ProtectedRoute requireSetup={false}><Setup /></ProtectedRoute>} />
      <Route path="/pending" element={<ProtectedRoute requireSetup={false}><PendingApproval /></ProtectedRoute>} />
      <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/inspections" element={<ProtectedRoute><Inspections /></ProtectedRoute>} />
      <Route path="/new" element={<ProtectedRoute><StartInspection /></ProtectedRoute>} />

      {/* Inspection flow steps */}
      <Route path="/inspect/:id/startup" element={<ProtectedRoute><StartupCheck /></ProtectedRoute>} />
      <Route path="/inspect/:id/exterior" element={<ProtectedRoute><ExteriorDamage /></ProtectedRoute>} />
      <Route path="/inspect/:id/interior" element={<ProtectedRoute><InteriorDamage /></ProtectedRoute>} />
      <Route path="/inspect/:id/testdrive" element={<ProtectedRoute><TestDrive /></ProtectedRoute>} />
      <Route path="/inspect/:id/photos" element={<ProtectedRoute><PhotoCapture /></ProtectedRoute>} />
      <Route path="/inspect/:id/review" element={<ProtectedRoute><InspectionReview /></ProtectedRoute>} />

      {/* VIN Lookup */}
      <Route path="/lookup" element={<ProtectedRoute><Lookup /></ProtectedRoute>} />
      <Route path="/vin-check" element={<ProtectedRoute><VinCheck /></ProtectedRoute>} />

      {/* Inventory + Sold (from Frazer via Power Automate) */}
      <Route path="/inventory" element={<ProtectedRoute><Inventory /></ProtectedRoute>} />
      <Route path="/sold" element={<ProtectedRoute><Sold /></ProtectedRoute>} />

      {/* Lot Walk — track inventory location */}
      <Route path="/lot" element={<ProtectedRoute><LotWalk /></ProtectedRoute>} />
      <Route path="/unmatched" element={<ProtectedRoute><UnmatchedVehicles /></ProtectedRoute>} />

      {/* Sold Reports — profit trends + recommendations */}
      <Route path="/sold-reports" element={<ProtectedRoute><SoldReports /></ProtectedRoute>} />

      {/* Buyer Match — top-3 likely buyers per active car (SmartAuction) */}
      <Route path="/buyer-match" element={<ProtectedRoute><BuyerMatch /></ProtectedRoute>} />

      {/* List Builder — auction run list -> cars worth bidding on */}
      <Route path="/list-builder" element={<ProtectedRoute><ListBuilder /></ProtectedRoute>} />

      {/* Pull List — sold cars that need to be removed from auctions */}
      <Route path="/pull-list" element={<ProtectedRoute><PullList /></ProtectedRoute>} />
      
      {/* Vehicle Analytics — comprehensive filtering and analysis */}
      <Route path="/analytics" element={<ProtectedRoute><VehicleAnalytics /></ProtectedRoute>} />
      
      {/* Front Lot Aging — vehicles on lot over 10 days not on SmartAuction */}
      <Route path="/front-lot-aging" element={<ProtectedRoute><FrontLotAging /></ProtectedRoute>} />

      {/* Reports hub — Executive metrics · Sold reports · Vehicle Analytics */}
      <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
      {/* Back-compat: standalone routes still resolve (deep links / bottom nav) */}
      <Route path="/reports/executive" element={<ProtectedRoute><ExecutiveDashboard /></ProtectedRoute>} />
      
      {/* Body Shop — cars in the shop, priced, parts-tracked, assigned to techs.
          Jobs open themselves from the Telegram body shop group. */}
      <Route path="/body-shop" element={<ProtectedRoute><BodyShop /></ProtectedRoute>} />
      <Route path="/body-shop/payout" element={<ProtectedRoute><BodyShopPayout /></ProtectedRoute>} />
      <Route path="/body-shop/:id" element={<ProtectedRoute><BodyShopJob /></ProtectedRoute>} />

      {/* Inbound Inspection System */}
      <Route path="/inbound" element={<ProtectedRoute><InboundDashboard /></ProtectedRoute>} />
      <Route path="/inbound/new" element={<ProtectedRoute><InboundStart /></ProtectedRoute>} />
      <Route path="/inbound/:id/arrival" element={<ProtectedRoute><ArrivalInspection /></ProtectedRoute>} />
      <Route path="/inbound/:id/mechanical" element={<ProtectedRoute><MechanicalInspection /></ProtectedRoute>} />

      {/* Admin */}
      <Route path="/admin" element={<ProtectedRoute><Admin /></ProtectedRoute>} />

      {/* Public marketplace — no auth required, shareable links */}
      <Route path="/listings" element={<Listings />} />
      <Route path="/marketplace" element={<Marketplace />} />
      <Route path="/marketplace/:id" element={<MarketplaceListing />} />
      {/* A buyer's hand-picked list, sent to him by text. Public by design. */}
      <Route path="/m/:slug" element={<BuyerList />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  )
}

// Bridges the native shell to the router. Must live inside <BrowserRouter> so
// it can navigate. No-ops entirely on web.
function NativeBridge() {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    // initNativeShell is async, so the teardown may not exist yet when the
    // effect is torn down (StrictMode's immediate double-invoke). Park it in a
    // local and call whatever has arrived by then.
    let teardown
    let cancelled = false
    initNativeShell({
      // A shared marketplace link (carzinc.ai/marketplace/:id) opens the car
      // in the app instead of bouncing out to Safari.
      onDeepLink: (path) => navigate(path, { replace: false }),

      // Android hardware back. Default behaviour suspends the app on any
      // screen; here back means "up one screen", and on the dashboard or an
      // in-flight inspection it does nothing rather than dropping the
      // inspector out of a half-finished car.
      onBack: ({ canGoBack }) => {
        const path = window.location.pathname
        if (path === '/' || path.startsWith('/inspect/') || path.startsWith('/inbound/')) return
        if (canGoBack) navigate(-1)
      },
    }).then((fn) => {
      teardown = fn
      if (cancelled) teardown?.()
    })

    return () => {
      cancelled = true
      teardown?.()
    }
  }, [navigate])

  // Scroll to top on route change — the webview keeps scroll position between
  // routes, which lands you mid-page on every navigation.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  return null
}

// Keeps the login alive across app switches.
//
// Supabase refreshes the access token on a timer, and that timer does not run
// while the page is backgrounded or frozen — a phone parked on another app all
// afternoon comes back with an expired token and the first request fails, which
// reads to the crew as "it logged me out again". Stopping the ticker on the way
// out and restarting it on the way back in is the supported fix; getSession()
// on resume forces the refresh immediately rather than on the next tick.
//
// How long a session may sit idle before it's genuinely dead is a Supabase Auth
// project setting, not something the client decides.
function SessionKeeper() {
  useEffect(() => {
    supabase.auth.startAutoRefresh().catch(() => {})
    return onAppStateChange((isActive) => {
      if (isActive) {
        supabase.auth.startAutoRefresh().catch(() => {})
        supabase.auth.getSession().catch(() => {})
      } else {
        supabase.auth.stopAutoRefresh().catch(() => {})
      }
    })
  }, [])
  return null
}

// Keeps "where I was" across an app switch. Native-only in effect — every call
// into routeMemory no-ops on web, so the browser app keeps its normal
// open-on-the-dashboard behaviour.
function RouteMemory() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, loading } = useAuth()
  const path = location.pathname + location.search
  const restored = useRef(false)

  // Replay, once, after auth resolves — otherwise it restores into a login
  // redirect. Two shapes of the same problem:
  //
  //   • The native app cold starts at '/', having lost the route entirely, so
  //     the saved path has to be navigated back to.
  //   • A discarded home-screen PWA reloads the SAME url, so the route is
  //     already right and only the scroll (and the data behind it) is gone.
  //     This case looked like "nothing to do" to the old check and got no
  //     restore at all, which is exactly the "starts over" complaint.
  //
  // A launch that already has its own intent — a deep link, a typed url, a
  // reload mid-inspection — is left alone in both.
  useEffect(() => {
    if (loading || restored.current || !user) return
    restored.current = true

    let cancelled = false
    // The moment they touch the screen the restore is no longer helpful, it's
    // a fight over the scroll position. Let them win.
    const stop = () => {
      cancelled = true
    }
    window.addEventListener('touchstart', stop, { passive: true })
    window.addEventListener('wheel', stop, { passive: true })

    // The restored page fetches its own data, so it has no height yet and a
    // single scrollTo lands on nothing. Nudge until it sticks or we give up.
    const restoreScroll = (y) => {
      if (!y) return
      let tries = 0
      const tick = () => {
        if (cancelled || tries++ > 12) return
        window.scrollTo(0, y)
        if (Math.abs(window.scrollY - y) > 2) setTimeout(tick, 150)
      }
      setTimeout(tick, 80)
    }

    recallRoute().then((saved) => {
      if (cancelled || !saved) return
      const here = window.location.pathname + window.location.search
      if (here === saved.path) {
        restoreScroll(saved.scrollY) // reloaded in place — just put them back down the page
      } else if (window.location.pathname === '/') {
        navigate(saved.path, { replace: true })
        restoreScroll(saved.scrollY)
      }
    })

    return () => {
      window.removeEventListener('touchstart', stop)
      window.removeEventListener('wheel', stop)
    }
  }, [loading, user, navigate])

  // Record the current page as we go, and flush the scroll depth when the app
  // is backgrounded — that's the last tick we're promised before iOS may kill
  // the webview.
  useEffect(() => {
    rememberRoute(path, 0)
    let timer
    const flush = () => rememberRoute(path, window.scrollY)
    const onScroll = () => {
      clearTimeout(timer)
      timer = setTimeout(flush, 400)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    const offPause = onAppPause(flush)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('scroll', onScroll)
      offPause()
    }
  }, [path])

  return null
}

// Where a signed-in visitor on /login actually belongs.
//
// This used to be a flat <Navigate to="/" />, which threw away the whole point
// of the trip: someone presses "Buy it now" on a car, signs in, and lands on the
// home screen with no idea what happened to the car they wanted. reserveAfterSignup
// remembers it. Setup consumes the same key for brand-new accounts; this covers
// the returning buyer, who never sees Setup at all.
function AfterLogin() {
  let target = '/'
  try {
    const pending = sessionStorage.getItem('reserveAfterSignup')
    // Only ever an in-app path — never trust it to be absolute, or a poisoned
    // sessionStorage value becomes an open redirect off the site.
    if (pending && pending.startsWith('/') && !pending.startsWith('//')) target = pending
  } catch { /* private mode */ }
  // The flag rides on navigation state so the destination can open its confirm
  // step during render — no effect, no second read of sessionStorage.
  return <Navigate to={target} replace state={{ reserve: target !== '/' }} />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <NativeBridge />
        <SessionKeeper />
        <RouteMemory />
        <div className="max-w-lg mx-auto app-shell">
          <AppRoutes />
        </div>
        <BottomNav />
        {/* The status bar strip. viewport-fit=cover means the webview runs the
            full height of the phone, under the notch and the speaker, so every
            page pads its FIRST screen clear of it (.page) — and then the second
            screen scrolls straight underneath, which is what puts a row of the
            list half-behind the speaker.
            This covers that strip in the app's own background, so what scrolls
            past disappears behind it instead of showing through. Exactly what
            BottomNav already does for the home indicator, at the other end.
            Zero height in a browser, where the inset is 0. */}
        <div aria-hidden className="fixed top-0 left-0 right-0 z-50 bg-slate-900 safe-top pointer-events-none" />
      </AuthProvider>
    </BrowserRouter>
  )
}
