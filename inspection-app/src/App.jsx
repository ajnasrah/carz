import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { useAuth } from './context/useAuth'
import Login from './pages/Login'
import Setup from './pages/Setup'
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
import Listings from './pages/Listings'
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
  // Force unfinished profiles through the Setup page before they can use the app
  if (requireSetup && profile && profile.setup_complete === false) {
    return <Navigate to="/setup" replace />
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

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <div className="max-w-lg mx-auto pb-20">
          <AppRoutes />
        </div>
        <BottomNav />
      </AuthProvider>
    </BrowserRouter>
  )
}
