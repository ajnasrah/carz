import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { initNativeShell } from './native/shell'
import { useAuth } from './context/useAuth'
import { isPrimaryAdmin } from './services/adminSetup'
import Login from './pages/Login'
import Setup from './pages/Setup'
import PendingApproval from './pages/PendingApproval'
import Dashboard from './pages/Dashboard'
import StartInspection from './pages/StartInspection'
import StartupCheck from './pages/StartupCheck'
import ExteriorDamage from './pages/ExteriorDamage'
import InteriorDamage from './pages/InteriorDamage'
import TestDrive from './pages/TestDrive'
import PhotoCapture from './pages/PhotoCapture'
import InspectionReview from './pages/InspectionReview'
import Lookup from './pages/Lookup'
import Inventory from './pages/Inventory'
import Sold from './pages/Sold'
import Admin from './pages/Admin'
import LotWalk from './pages/LotWalk'
import SoldReports from './pages/SoldReports'
import Inspections from './pages/Inspections'
import Marketplace from './pages/Marketplace'
import MarketplaceListing from './pages/MarketplaceListing'
import PullList from './pages/PullList'
import VinCheck from './pages/VinCheck'
import VehicleAnalytics from './pages/VehicleAnalytics'
import FrontLotAging from './pages/FrontLotAging'
import UnmatchedVehicles from './pages/UnmatchedVehicles'
import ExecutiveDashboard from './pages/ExecutiveDashboard'
import Reports from './pages/Reports'
import BuyerMatch from './pages/BuyerMatch'
import ListBuilder from './pages/ListBuilder'
import Listings from './pages/Listings'
import BodyShop from './pages/BodyShop'
import BodyShopJob from './pages/BodyShopJob'
// Inbound Inspection Pages
import InboundDashboard from './pages/InboundDashboard'
import InboundStart from './pages/InboundStart'
import ArrivalInspection from './pages/ArrivalInspection'
import MechanicalInspection from './pages/MechanicalInspection'
import BottomNav from './components/BottomNav'

function ProtectedRoute({ children, requireSetup = true }) {
  const { user, profile, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-emerald-400 mb-2">CARZ INC</h1>
          <p className="text-slate-400">Loading...</p>
        </div>
      </div>
    )
  }

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
    }
  }
  return children
}

function AppRoutes() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-emerald-400 mb-2">CARZ INC</h1>
          <p className="text-slate-400">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
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

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
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

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <NativeBridge />
        <div className="max-w-lg mx-auto app-shell">
          <AppRoutes />
        </div>
        <BottomNav />
      </AuthProvider>
    </BrowserRouter>
  )
}
