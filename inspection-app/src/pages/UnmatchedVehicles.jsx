import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, CheckCircle, XCircle, Search, RefreshCw } from 'lucide-react';
import { supabase } from '../services/supabase';
import HistoryButton from '../components/HistoryButton';

export default function UnmatchedVehicles() {
  const navigate = useNavigate();
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pending'); // pending, resolved, all
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchUnmatchedVehicles();
  }, [filter]);

  const fetchUnmatchedVehicles = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('unmatched_vehicles_summary')
        .select('*')
        .order('scanned_at', { ascending: false });
      
      if (filter !== 'all') {
        query = query.eq('resolution_status', filter);
      }
      
      const { data, error } = await query;
      
      if (error) throw error;
      setVehicles(data || []);
    } catch (err) {
      console.error('Error fetching unmatched vehicles:', err);
    } finally {
      setLoading(false);
    }
  };

  const checkForMatches = async () => {
    try {
      const { data, error } = await supabase
        .rpc('check_unmatched_against_inventory');
      
      if (error) throw error;
      
      if (data && data.length > 0) {
        alert(`Found ${data.length} vehicles that now match inventory! Refreshing...`);
        
        // Mark them as resolved
        for (const match of data) {
          await resolveVehicle(match.unmatched_id, `Matched to ${match.matched_stock}`);
        }
        
        fetchUnmatchedVehicles();
      } else {
        alert('No new matches found');
      }
    } catch (err) {
      console.error('Error checking for matches:', err);
      alert('Error checking for matches');
    }
  };

  const resolveVehicle = async (id, notes = '') => {
    try {
      const { error } = await supabase
        .from('unmatched_vehicles')
        .update({
          resolution_status: 'resolved',
          resolution_notes: notes,
          resolved_at: new Date().toISOString(),
          resolved_by: (await supabase.auth.getUser()).data.user?.id
        })
        .eq('id', id);
      
      if (error) throw error;
      fetchUnmatchedVehicles();
    } catch (err) {
      console.error('Error resolving vehicle:', err);
      alert('Failed to resolve vehicle');
    }
  };

  const ignoreVehicle = async (id, notes = '') => {
    try {
      const { error } = await supabase
        .from('unmatched_vehicles')
        .update({
          resolution_status: 'ignored',
          resolution_notes: notes,
          resolved_at: new Date().toISOString(),
          resolved_by: (await supabase.auth.getUser()).data.user?.id
        })
        .eq('id', id);
      
      if (error) throw error;
      fetchUnmatchedVehicles();
    } catch (err) {
      console.error('Error ignoring vehicle:', err);
      alert('Failed to ignore vehicle');
    }
  };

  const filteredVehicles = vehicles.filter(v => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      v.scanned_value?.toLowerCase().includes(query) ||
      v.section?.toLowerCase().includes(query) ||
      v.resolution_notes?.toLowerCase().includes(query)
    );
  });

  const getStatusColor = (status) => {
    switch (status) {
      case 'pending': return 'text-yellow-400 bg-yellow-500/20';
      case 'resolved': return 'text-green-400 bg-green-500/20';
      case 'ignored': return 'text-gray-400 bg-gray-500/20';
      default: return 'text-gray-400';
    }
  };

  const formatDaysAgo = (days) => {
    if (days < 1) return 'Today';
    if (days === 1) return '1 day ago';
    return `${Math.floor(days)} days ago`;
  };

  return (
    <div className="page pb-24">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-lg bg-slate-800 text-slate-400"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-white">Unmatched Vehicles</h1>
            <p className="text-xs text-slate-400">Found during lot walk but not in inventory</p>
          </div>
        </div>
        <button
          onClick={checkForMatches}
          className="p-2 rounded-lg bg-emerald-500 text-slate-900"
          title="Check if any unmatched vehicles now match inventory"
        >
          <RefreshCw size={20} />
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setFilter('pending')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold ${
            filter === 'pending' 
              ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500'
              : 'bg-slate-800 text-slate-400'
          }`}
        >
          Pending
        </button>
        <button
          onClick={() => setFilter('resolved')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold ${
            filter === 'resolved'
              ? 'bg-green-500/20 text-green-400 border border-green-500'
              : 'bg-slate-800 text-slate-400'
          }`}
        >
          Resolved
        </button>
        <button
          onClick={() => setFilter('all')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold ${
            filter === 'all'
              ? 'bg-slate-700 text-white border border-slate-600'
              : 'bg-slate-800 text-slate-400'
          }`}
        >
          All
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-3 text-slate-500" size={18} />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search scanned value, section..."
          className="w-full pl-10 pr-4 py-3 bg-slate-800 text-white rounded-lg border border-slate-700 focus:border-emerald-500 focus:outline-none"
        />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="bg-slate-800 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-yellow-400">
            {vehicles.filter(v => v.resolution_status === 'pending').length}
          </div>
          <div className="text-xs text-slate-400">Pending</div>
        </div>
        <div className="bg-slate-800 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-green-400">
            {vehicles.filter(v => v.resolution_status === 'resolved').length}
          </div>
          <div className="text-xs text-slate-400">Resolved</div>
        </div>
        <div className="bg-slate-800 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-gray-400">
            {vehicles.filter(v => v.resolution_status === 'ignored').length}
          </div>
          <div className="text-xs text-slate-400">Ignored</div>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center items-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400"></div>
        </div>
      ) : filteredVehicles.length === 0 ? (
        <div className="text-center py-8 text-slate-400">
          <AlertTriangle size={48} className="mx-auto mb-2 opacity-50" />
          <p>No unmatched vehicles found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredVehicles.map((vehicle) => (
            <div
              key={vehicle.id}
              className="bg-slate-800 rounded-lg p-4 border border-slate-700"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-lg font-bold text-white">
                      {vehicle.scanned_value}
                    </span>
                    {vehicle.vin_last6 && (
                      <span className="text-xs text-slate-500">
                        Last 6: {vehicle.vin_last6}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`px-2 py-0.5 rounded-full ${getStatusColor(vehicle.resolution_status)}`}>
                      {vehicle.resolution_status}
                    </span>
                    <span className="text-slate-400">
                      {vehicle.scan_type}
                    </span>
                    <span className="text-slate-400">•</span>
                    <span className="text-slate-400">
                      {vehicle.section}
                    </span>
                    <span className="text-slate-400">•</span>
                    <span className="text-slate-400">
                      {formatDaysAgo(vehicle.days_unmatched)}
                    </span>
                  </div>
                </div>
                
                <div className="flex gap-1">
                  <HistoryButton showPhotos vin={vehicle.vin_last6} className="p-1.5 rounded bg-slate-700/50 text-slate-400" size={16} />
                  {vehicle.resolution_status === 'pending' && (
                    <>
                      <button
                        onClick={() => {
                          const notes = prompt('Resolution notes (optional):');
                          if (notes !== null) resolveVehicle(vehicle.id, notes);
                        }}
                        className="p-1.5 rounded bg-green-500/20 text-green-400"
                        title="Mark as resolved"
                      >
                        <CheckCircle size={16} />
                      </button>
                      <button
                        onClick={() => {
                          const notes = prompt('Why ignore this vehicle?');
                          if (notes) ignoreVehicle(vehicle.id, notes);
                        }}
                        className="p-1.5 rounded bg-gray-500/20 text-gray-400"
                        title="Ignore"
                      >
                        <XCircle size={16} />
                      </button>
                    </>
                  )}
                </div>
              </div>
              
              {vehicle.notes && (
                <p className="text-xs text-slate-500 mt-1">
                  Note: {vehicle.notes}
                </p>
              )}
              
              {vehicle.resolution_notes && (
                <p className="text-xs text-emerald-400 mt-1">
                  Resolution: {vehicle.resolution_notes}
                </p>
              )}
              
              <div className="flex items-center justify-between mt-2 text-xs text-slate-500">
                <span>Scanned by {vehicle.scanned_by_name || 'Unknown'}</span>
                {vehicle.resolved_by_name && (
                  <span>Resolved by {vehicle.resolved_by_name}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}