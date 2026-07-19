import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, Filter, TrendingUp, AlertTriangle, Clock, CheckCircle, DollarSign, Package, FileText, BarChart3 } from 'lucide-react'
import { supabase } from '../services/supabase'
import { getInboundStats, INSPECTION_PRIORITIES, CONDITION_GRADES, calculateConditionGrade } from '../services/inboundInspection'
import HistoryButton from '../components/HistoryButton'

export default function InboundDashboard() {
  const navigate = useNavigate()
  const [inspections, setInspections] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterPriority, setFilterPriority] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [dateRange, setDateRange] = useState(30)

  useEffect(() => {
    loadData()
  }, [dateRange])

  async function loadData() {
    try {
      // Load inspections
      const startDate = new Date()
      startDate.setDate(startDate.getDate() - dateRange)
      
      const { data, error } = await supabase
        .from('inspections')
        .select(`
          *,
          profiles!inspections_user_id_fkey(name),
          mechanical_issues(count),
          damage_estimates(count)
        `)
        .eq('type', 'inbound')
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: false })

      if (error) throw error
      
      // Process and calculate grades
      const processedInspections = data.map(inspection => ({
        ...inspection,
        calculated_grade: calculateConditionGrade(inspection),
        total_issues: (inspection.mechanical_issues?.[0]?.count || 0) + (inspection.damage_estimates?.[0]?.count || 0)
      }))
      
      setInspections(processedInspections)
      
      // Load stats
      const statsData = await getInboundStats(dateRange)
      setStats(statsData)
    } catch (err) {
      console.error('Failed to load data:', err)
    } finally {
      setLoading(false)
    }
  }

  function filteredInspections() {
    return inspections.filter(inspection => {
      // Search filter
      if (searchTerm) {
        const search = searchTerm.toLowerCase()
        if (!inspection.vin?.toLowerCase().includes(search) &&
            !inspection.stock_number?.toLowerCase().includes(search) &&
            !inspection.year?.toString().includes(search) &&
            !inspection.make?.toLowerCase().includes(search) &&
            !inspection.model?.toLowerCase().includes(search)) {
          return false
        }
      }
      
      // Priority filter
      if (filterPriority !== 'all' && inspection.inspection_priority !== filterPriority) {
        return false
      }
      
      // Status filter
      if (filterStatus !== 'all' && inspection.status !== filterStatus) {
        return false
      }
      
      return true
    })
  }

  if (loading) {
    return (
      <div className="page">
        <div className="flex items-center justify-center py-12">
          <div className="text-slate-500">Loading dashboard...</div>
        </div>
      </div>
    )
  }

  const priorityColors = {
    urgent: 'bg-red-500',
    high: 'bg-orange-500',
    normal: 'bg-blue-500',
    low: 'bg-gray-500'
  }

  const gradeColors = {
    A: 'text-green-500',
    B: 'text-blue-500',
    C: 'text-yellow-500',
    D: 'text-orange-500',
    F: 'text-red-500'
  }

  return (
    <div className="page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Inbound Inspections</h1>
          <p className="text-sm text-slate-400">Monitor and manage incoming vehicles</p>
        </div>
        <button
          onClick={() => navigate('/inbound/start')}
          className="px-4 py-2 bg-blue-600 rounded-lg font-medium flex items-center gap-2"
        >
          <Plus size={18} />
          New Inspection
        </button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-slate-800 rounded-xl p-4">
            <div className="flex items-center gap-2 text-slate-400 mb-1">
              <Package size={16} />
              <span className="text-xs">Total Inspections</span>
            </div>
            <div className="text-2xl font-bold">{stats.total}</div>
            <div className="text-xs text-slate-500">Last {dateRange} days</div>
          </div>

          <div className="bg-slate-800 rounded-xl p-4">
            <div className="flex items-center gap-2 text-slate-400 mb-1">
              <CheckCircle size={16} />
              <span className="text-xs">Completed</span>
            </div>
            <div className="text-2xl font-bold">{stats.completed}</div>
            <div className="text-xs text-slate-500">
              {stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0}% completion
            </div>
          </div>

          <div className="bg-slate-800 rounded-xl p-4">
            <div className="flex items-center gap-2 text-slate-400 mb-1">
              <DollarSign size={16} />
              <span className="text-xs">Avg Repair Cost</span>
            </div>
            <div className="text-2xl font-bold">
              ${stats.avgRepairCost ? stats.avgRepairCost.toFixed(0) : '0'}
            </div>
            <div className="text-xs text-slate-500">Per vehicle</div>
          </div>

          <div className="bg-slate-800 rounded-xl p-4">
            <div className="flex items-center gap-2 text-slate-400 mb-1">
              <TrendingUp size={16} />
              <span className="text-xs">Grade Distribution</span>
            </div>
            <div className="flex gap-2 mt-1">
              {Object.entries(CONDITION_GRADES).map(([grade]) => (
                <div key={grade} className="text-center">
                  <div className={`text-xs font-bold ${gradeColors[grade]}`}>{grade}</div>
                  <div className="text-xs text-slate-500">{stats.byGrade[grade] || 0}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-slate-800 rounded-xl p-4 mb-4">
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-3 py-2 bg-slate-900 rounded-lg"
                placeholder="Search VIN, stock #, or vehicle..."
              />
            </div>
          </div>

          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
            className="px-3 py-2 bg-slate-900 rounded-lg"
          >
            <option value="all">All Priorities</option>
            {Object.entries(INSPECTION_PRIORITIES).map(([key, val]) => (
              <option key={key} value={key}>{val.label}</option>
            ))}
          </select>

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-2 bg-slate-900 rounded-lg"
          >
            <option value="all">All Status</option>
            <option value="in_progress">In Progress</option>
            <option value="complete">Complete</option>
            <option value="archived">Archived</option>
          </select>

          <select
            value={dateRange}
            onChange={(e) => setDateRange(parseInt(e.target.value))}
            className="px-3 py-2 bg-slate-900 rounded-lg"
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last year</option>
          </select>
        </div>
      </div>

      {/* Inspections List */}
      <div className="space-y-3">
        {filteredInspections().length === 0 ? (
          <div className="bg-slate-800 rounded-xl p-8 text-center">
            <Package size={48} className="mx-auto mb-3 text-slate-600" />
            <p className="text-slate-400">No inspections found</p>
            <button
              onClick={() => navigate('/inbound/start')}
              className="mt-4 px-4 py-2 bg-blue-600 rounded-lg text-sm"
            >
              Start New Inspection
            </button>
          </div>
        ) : (
          filteredInspections().map(inspection => (
            <div
              key={inspection.id}
              onClick={() => navigate(`/inspect/${inspection.id}`)}
              className="bg-slate-800 rounded-xl p-4 hover:bg-slate-700 cursor-pointer transition-colors"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="font-semibold">
                      {inspection.year} {inspection.make} {inspection.model}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-xs ${priorityColors[inspection.inspection_priority]}`}>
                      {INSPECTION_PRIORITIES[inspection.inspection_priority]?.label}
                    </span>
                    {inspection.calculated_grade && (
                      <span className={`font-bold ${gradeColors[inspection.calculated_grade]}`}>
                        Grade {inspection.calculated_grade}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-sm text-slate-400">
                    <span>VIN: {inspection.vin}</span>
                    <span>Stock: #{inspection.stock_number}</span>
                    <span>{inspection.mileage?.toLocaleString()} mi</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <HistoryButton stockNumber={inspection.stock_number} vin={inspection.vin} />
                  {inspection.status === 'complete' ? (
                    <CheckCircle size={20} className="text-green-500" />
                  ) : (
                    <Clock size={20} className="text-yellow-500" />
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-700">
                <div className="flex items-center gap-4 text-xs text-slate-500">
                  <span>Inspector: {inspection.profiles?.name || 'Unknown'}</span>
                  <span>{new Date(inspection.created_at).toLocaleDateString()}</span>
                  {inspection.arrival_date && (
                    <span>Arrived: {new Date(inspection.arrival_date).toLocaleDateString()}</span>
                  )}
                </div>

                <div className="flex items-center gap-3 text-sm">
                  {inspection.total_issues > 0 && (
                    <div className="flex items-center gap-1 text-yellow-500">
                      <AlertTriangle size={14} />
                      <span>{inspection.total_issues} issues</span>
                    </div>
                  )}
                  {inspection.estimated_repair_cost > 0 && (
                    <div className="flex items-center gap-1 text-slate-400">
                      <DollarSign size={14} />
                      <span>${inspection.estimated_repair_cost.toFixed(0)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Quick Actions */}
      <div className="fixed bottom-20 right-4 space-y-2">
        <button
          onClick={() => navigate('/inbound/reports')}
          className="w-12 h-12 bg-slate-700 rounded-full flex items-center justify-center shadow-lg"
        >
          <BarChart3 size={20} />
        </button>
        <button
          onClick={() => navigate('/inbound/pending-approvals')}
          className="w-12 h-12 bg-orange-600 rounded-full flex items-center justify-center shadow-lg"
        >
          <FileText size={20} />
        </button>
      </div>
    </div>
  )
}