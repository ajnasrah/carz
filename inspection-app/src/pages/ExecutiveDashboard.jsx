import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { 
  ArrowLeft, TrendingUp, TrendingDown, DollarSign, Package, 
  AlertTriangle, CheckCircle, BarChart3, PieChart, Activity,
  Calendar, MapPin, Users, Truck, Clock, Target, AlertCircle
} from 'lucide-react'
import { supabase } from '../services/supabase'
import { Line, Bar, Doughnut } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js'

// Register ChartJS components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
)

export default function ExecutiveDashboard() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [timeRange, setTimeRange] = useState('30') // days
  const [metrics, setMetrics] = useState({
    // Current Inventory
    totalInventory: 0,
    inventoryValue: 0,
    avgDaysOnLot: 0,
    stuckInventory: 0,
    needsDispatch: 0,
    
    // Sales Performance
    unitsSold: 0,
    totalRevenue: 0,
    totalProfit: 0,
    avgProfit: 0,
    profitMargin: 0,
    
    // Operational
    activeInspections: 0,
    pendingTitles: 0,
    floorPlanBalance: 0,
    avgTurnaround: 0,
    
    // Location Distribution
    memphisCount: 0,
    jacksonCount: 0,
    transitCount: 0,
    auctionCount: 0
  })
  
  const [chartData, setChartData] = useState({
    salesTrend: null,
    profitTrend: null,
    locationBreakdown: null,
    ageDistribution: null,
    vendorPerformance: null
  })

  useEffect(() => {
    loadDashboardData()
  }, [timeRange])

  async function loadDashboardData() {
    setLoading(true)
    try {
      const startDate = new Date()
      startDate.setDate(startDate.getDate() - parseInt(timeRange))
      
      // Load all data in parallel
      const [
        inventoryRes,
        salesRes,
        locationsRes,
        inspectionsRes,
        titleRes,
        floorPlanRes,
        trendsRes
      ] = await Promise.all([
        // Current inventory metrics
        supabase
          .from('inventory')
          .select('stock_number, total_cost, days_on_lot, vendor, location_code, added_costs'),
          
        // Sales performance
        supabase
          .from('sold')
          .select('*')
          .gte('sale_date', startDate.toISOString())
          .order('sale_date', { ascending: false }),
          
        // Location distribution
        supabase
          .from('vehicle_locations')
          .select('stock_number, physical_location, location_updated_at'),
          
        // Active inspections
        supabase
          .from('inspections')
          .select('id, status, type')
          .eq('status', 'in_progress'),
          
        // Title tracking (simulated - add real query when table exists)
        Promise.resolve({ data: [] }),
        
        // Floor plan (simulated)
        Promise.resolve({ data: [] }),
        
        // Sales trends for charts
        supabase
          .from('sold')
          .select('sale_date, sales_price, total_cost, profit_on_sale, days_on_lot')
          .gte('sale_date', new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString())
          .order('sale_date', { ascending: true })
      ])
      
      // Process inventory metrics
      const inventory = inventoryRes.data || []
      const inventoryValue = inventory.reduce((sum, car) => {
        const cost = parseFloat(car.total_cost || 0)
        return sum + (isNaN(cost) ? 0 : cost)
      }, 0)
      
      const avgDaysOnLot = inventory.length > 0
        ? Math.round(inventory.reduce((sum, car) => sum + (parseInt(car.days_on_lot) || 0), 0) / inventory.length)
        : 0
      
      // Process sales metrics
      const sales = salesRes.data || []
      const totalRevenue = sales.reduce((sum, sale) => sum + parseFloat(sale.sales_price || 0), 0)
      const totalCost = sales.reduce((sum, sale) => sum + parseFloat(sale.total_cost || 0), 0)
      const totalProfit = sales.reduce((sum, sale) => sum + parseFloat(sale.profit_on_sale || 0), 0)
      const avgProfit = sales.length > 0 ? totalProfit / sales.length : 0
      const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0
      
      // Process location distribution
      const locations = locationsRes.data || []
      const locationCounts = locations.reduce((acc, loc) => {
        const location = loc.physical_location || 'unknown'
        if (location.includes('memphis') || location === 'front') acc.memphis++
        else if (location.includes('jackson')) acc.jackson++
        else if (location === 'in_transit') acc.transit++
        else if (location.includes('auction') || location === 'uax' || location === 'daa') acc.auction++
        return acc
      }, { memphis: 0, jackson: 0, transit: 0, auction: 0 })
      
      // Count stuck and needs dispatch
      const now = Date.now()
      let stuckCount = 0
      let needsDispatchCount = 0
      
      inventory.forEach(car => {
        const loc = locations.find(l => l.stock_number === car.stock_number)
        if (loc && loc.location_updated_at) {
          const daysSinceUpdate = Math.floor((now - new Date(loc.location_updated_at).getTime()) / 86400000)
          if (daysSinceUpdate >= 21) stuckCount++
        }
        if (car.location_code === 'Z' && (!loc || loc.physical_location !== 'in_transit')) {
          needsDispatchCount++
        }
      })
      
      // Prepare chart data
      const salesTrends = trendsRes.data || []
      const chartLabels = [...new Set(salesTrends.map(s => 
        new Date(s.sale_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      ))]
      
      // Sales trend chart
      const salesByDate = salesTrends.reduce((acc, sale) => {
        const date = new Date(sale.sale_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        if (!acc[date]) acc[date] = { revenue: 0, profit: 0, units: 0 }
        acc[date].revenue += parseFloat(sale.sales_price || 0)
        acc[date].profit += parseFloat(sale.profit_on_sale || 0)
        acc[date].units++
        return acc
      }, {})
      
      // Age distribution
      const ageRanges = { '0-10': 0, '11-30': 0, '31-60': 0, '60+': 0 }
      inventory.forEach(car => {
        const days = parseInt(car.days_on_lot) || 0
        if (days <= 10) ageRanges['0-10']++
        else if (days <= 30) ageRanges['11-30']++
        else if (days <= 60) ageRanges['31-60']++
        else ageRanges['60+']++
      })
      
      // Vendor performance
      const vendorStats = inventory.reduce((acc, car) => {
        const vendor = car.vendor || 'Unknown'
        if (!acc[vendor]) acc[vendor] = { count: 0, value: 0 }
        acc[vendor].count++
        acc[vendor].value += parseFloat(car.total_cost || 0)
        return acc
      }, {})
      
      // Set all metrics
      setMetrics({
        totalInventory: inventory.length,
        inventoryValue,
        avgDaysOnLot,
        stuckInventory: stuckCount,
        needsDispatch: needsDispatchCount,
        unitsSold: sales.length,
        totalRevenue,
        totalProfit,
        avgProfit,
        profitMargin,
        activeInspections: inspectionsRes.data?.length || 0,
        pendingTitles: 0, // Will be updated when title tracking is implemented
        floorPlanBalance: 0, // Will be updated when floor plan is implemented
        avgTurnaround: sales.length > 0 
          ? Math.round(sales.reduce((sum, s) => sum + (parseInt(s.days_on_lot) || 0), 0) / sales.length)
          : 0,
        memphisCount: locationCounts.memphis,
        jacksonCount: locationCounts.jackson,
        transitCount: locationCounts.transit,
        auctionCount: locationCounts.auction
      })
      
      // Set chart data
      setChartData({
        salesTrend: {
          labels: Object.keys(salesByDate),
          datasets: [
            {
              label: 'Revenue',
              data: Object.values(salesByDate).map(d => d.revenue),
              borderColor: 'rgb(16, 185, 129)',
              backgroundColor: 'rgba(16, 185, 129, 0.1)',
              tension: 0.3,
              fill: true
            },
            {
              label: 'Profit',
              data: Object.values(salesByDate).map(d => d.profit),
              borderColor: 'rgb(59, 130, 246)',
              backgroundColor: 'rgba(59, 130, 246, 0.1)',
              tension: 0.3,
              fill: true
            }
          ]
        },
        
        locationBreakdown: {
          labels: ['Memphis', 'Jackson', 'In Transit', 'Auction'],
          datasets: [{
            data: [
              locationCounts.memphis,
              locationCounts.jackson,
              locationCounts.transit,
              locationCounts.auction
            ],
            backgroundColor: [
              'rgba(16, 185, 129, 0.8)',
              'rgba(59, 130, 246, 0.8)',
              'rgba(251, 146, 60, 0.8)',
              'rgba(147, 51, 234, 0.8)'
            ]
          }]
        },
        
        ageDistribution: {
          labels: Object.keys(ageRanges),
          datasets: [{
            label: 'Vehicles',
            data: Object.values(ageRanges),
            backgroundColor: [
              'rgba(16, 185, 129, 0.8)',
              'rgba(251, 146, 60, 0.8)',
              'rgba(239, 68, 68, 0.8)',
              'rgba(127, 29, 29, 0.8)'
            ]
          }]
        },
        
        vendorPerformance: {
          labels: Object.keys(vendorStats).slice(0, 10),
          datasets: [{
            label: 'Units',
            data: Object.values(vendorStats).slice(0, 10).map(v => v.count),
            backgroundColor: 'rgba(16, 185, 129, 0.8)'
          }]
        }
      })
      
    } catch (error) {
      console.error('Dashboard load error:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0
    }).format(amount)
  }

  const MetricCard = ({ title, value, subtitle, icon: Icon, trend, color = 'emerald' }) => (
    <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
      <div className="flex items-start justify-between mb-2">
        <div className={`p-2 rounded-lg bg-${color}-500/20`}>
          <Icon size={20} className={`text-${color}-400`} />
        </div>
        {trend !== undefined && (
          <div className={`flex items-center gap-1 text-xs ${trend >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {trend >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            <span>{Math.abs(trend)}%</span>
          </div>
        )}
      </div>
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="text-xs text-slate-500 mt-1">{title}</div>
      {subtitle && <div className="text-xs text-slate-400 mt-0.5">{subtitle}</div>}
    </div>
  )

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false
      },
      tooltip: {
        backgroundColor: 'rgba(15, 23, 42, 0.9)',
        borderColor: 'rgba(100, 116, 139, 0.5)',
        borderWidth: 1
      }
    },
    scales: {
      y: {
        ticks: { color: 'rgb(148, 163, 184)' },
        grid: { color: 'rgba(148, 163, 184, 0.1)' }
      },
      x: {
        ticks: { color: 'rgb(148, 163, 184)' },
        grid: { display: false }
      }
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-2xl font-bold text-emerald-400 mb-2">Loading Dashboard...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="page pb-20">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="p-2 rounded-lg bg-slate-800">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-emerald-400">Executive Dashboard</h1>
            <p className="text-xs text-slate-500">Real-time business metrics</p>
          </div>
        </div>
        <select
          value={timeRange}
          onChange={(e) => setTimeRange(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
        >
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="180">Last 6 months</option>
        </select>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <MetricCard
          title="Total Inventory"
          value={metrics.totalInventory}
          subtitle={formatMoney(metrics.inventoryValue)}
          icon={Package}
          color="emerald"
        />
        <MetricCard
          title="Units Sold"
          value={metrics.unitsSold}
          subtitle={`Avg ${metrics.avgTurnaround} days`}
          icon={CheckCircle}
          color="blue"
        />
        <MetricCard
          title="Total Revenue"
          value={formatMoney(metrics.totalRevenue)}
          subtitle={`Margin ${metrics.profitMargin.toFixed(1)}%`}
          icon={DollarSign}
          color="emerald"
        />
        <MetricCard
          title="Total Profit"
          value={formatMoney(metrics.totalProfit)}
          subtitle={`Avg ${formatMoney(metrics.avgProfit)}`}
          icon={TrendingUp}
          color="emerald"
        />
      </div>

      {/* Alerts */}
      {(metrics.stuckInventory > 0 || metrics.needsDispatch > 0) && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          {metrics.stuckInventory > 0 && (
            <button
              onClick={() => navigate('/inventory?filter=stuck21')}
              className="p-3 rounded-xl bg-red-500/15 border border-red-500/40 text-left"
            >
              <div className="flex items-center gap-2 mb-1">
                <AlertCircle size={16} className="text-red-400" />
                <span className="text-sm font-bold text-red-400">{metrics.stuckInventory} Stuck</span>
              </div>
              <div className="text-xs text-red-300/80">Over 21 days</div>
            </button>
          )}
          {metrics.needsDispatch > 0 && (
            <button
              onClick={() => navigate('/inventory?filter=needs_dispatch')}
              className="p-3 rounded-xl bg-orange-500/15 border border-orange-500/40 text-left"
            >
              <div className="flex items-center gap-2 mb-1">
                <Truck size={16} className="text-orange-400" />
                <span className="text-sm font-bold text-orange-400">{metrics.needsDispatch} Need Dispatch</span>
              </div>
              <div className="text-xs text-orange-300/80">Awaiting transport</div>
            </button>
          )}
        </div>
      )}

      {/* Charts */}
      <div className="space-y-4">
        {/* Sales Trend */}
        {chartData.salesTrend && (
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <h3 className="text-sm font-bold text-emerald-400 mb-3">Revenue & Profit Trend</h3>
            <div style={{ height: '200px' }}>
              <Line data={chartData.salesTrend} options={chartOptions} />
            </div>
          </div>
        )}

        {/* Location & Age Distribution */}
        <div className="grid grid-cols-2 gap-4">
          {chartData.locationBreakdown && (
            <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
              <h3 className="text-sm font-bold text-emerald-400 mb-3">Location Distribution</h3>
              <div style={{ height: '150px' }}>
                <Doughnut data={chartData.locationBreakdown} options={{
                  ...chartOptions,
                  plugins: { ...chartOptions.plugins, legend: { display: true, position: 'bottom' } }
                }} />
              </div>
            </div>
          )}
          
          {chartData.ageDistribution && (
            <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
              <h3 className="text-sm font-bold text-emerald-400 mb-3">Age Distribution</h3>
              <div style={{ height: '150px' }}>
                <Bar data={chartData.ageDistribution} options={chartOptions} />
              </div>
            </div>
          )}
        </div>

        {/* Vendor Performance */}
        {chartData.vendorPerformance && (
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <h3 className="text-sm font-bold text-emerald-400 mb-3">Top Vendors by Units</h3>
            <div style={{ height: '150px' }}>
              <Bar data={chartData.vendorPerformance} options={chartOptions} />
            </div>
          </div>
        )}
      </div>

      {/* Operational Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
        <div className="bg-slate-800 rounded-xl p-3 text-center">
          <MapPin size={16} className="text-emerald-400 mx-auto mb-1" />
          <div className="text-lg font-bold">{metrics.memphisCount}</div>
          <div className="text-xs text-slate-500">Memphis</div>
        </div>
        <div className="bg-slate-800 rounded-xl p-3 text-center">
          <MapPin size={16} className="text-blue-400 mx-auto mb-1" />
          <div className="text-lg font-bold">{metrics.jacksonCount}</div>
          <div className="text-xs text-slate-500">Jackson</div>
        </div>
        <div className="bg-slate-800 rounded-xl p-3 text-center">
          <Truck size={16} className="text-orange-400 mx-auto mb-1" />
          <div className="text-lg font-bold">{metrics.transitCount}</div>
          <div className="text-xs text-slate-500">In Transit</div>
        </div>
        <div className="bg-slate-800 rounded-xl p-3 text-center">
          <Activity size={16} className="text-purple-400 mx-auto mb-1" />
          <div className="text-lg font-bold">{metrics.activeInspections}</div>
          <div className="text-xs text-slate-500">Inspecting</div>
        </div>
      </div>
    </div>
  )
}