import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { Download, AlertCircle, RefreshCw } from 'lucide-react';

function FrontLotAging() {
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);

  const fetchFrontLotAging = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Calculate date 10 days ago
      const tenDaysAgo = new Date();
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
      
      // Query vehicles on front lot over 10 days old not on SmartAuction
      const { data, error: fetchError } = await supabase
        .from('vehicle_locations')
        .select('stock_number, vin, physical_location, location_updated_at, sa_status, notes')
        .or('sa_status.is.null,sa_status.neq.active')
        .lte('location_updated_at', tenDaysAgo.toISOString())
        .is('sold_on', null)
        .order('location_updated_at', { ascending: true });
      
      if (fetchError) throw fetchError;
      
      // Filter for front lot vehicles
      // Front lot = vehicles NOT in specific locations like body_shop, transport (Z), etc.
      const frontLotVehicles = (data || []).filter(v => {
        const location = (v.physical_location || '').toLowerCase();
        
        // Locations that are NOT considered front lot:
        const excludedLocations = [
          'z',
          'transport',
          'body_shop',
          'sold',
          'wholesale',
          'arbitrated',
          'arb_section'
        ];
        
        // Check if vehicle is in an excluded location
        const isExcluded = excludedLocations.some(loc => 
          location === loc || location.includes(loc)
        );
        
        // Vehicle is on front lot if not in any excluded location
        // Empty location is considered front lot
        const isFrontLot = !location || !isExcluded;
        
        return isFrontLot;
      });
      
      // Calculate days on lot
      const vehiclesWithAge = frontLotVehicles.map(v => {
        const daysOnLot = Math.floor(
          (new Date() - new Date(v.location_updated_at)) / (1000 * 60 * 60 * 24)
        );
        return { ...v, days_on_lot: daysOnLot };
      });
      
      setVehicles(vehiclesWithAge);
      setLastRefresh(new Date());
    } catch (err) {
      console.error('Error fetching front lot aging:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFrontLotAging();
  }, []);

  const exportToCSV = () => {
    const headers = ['Stock Number', 'VIN', 'Location', 'Days on Lot', 'Last Updated'];
    const rows = vehicles.map(v => [
      v.stock_number,
      v.vin || '',
      v.physical_location || 'Front Lot',
      v.days_on_lot,
      new Date(v.location_updated_at).toLocaleDateString()
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `front_lot_aging_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getRowClass = (daysOnLot) => {
    if (daysOnLot > 30) return 'bg-red-50 border-red-200';
    if (daysOnLot > 20) return 'bg-yellow-50 border-yellow-200';
    return '';
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-7xl mx-auto">
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Front Lot Aging Report</h1>
              <p className="text-gray-600 mt-1">
                Vehicles on front lot over 10 days old not listed on SmartAuction
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={fetchFrontLotAging}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
              <button
                onClick={exportToCSV}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                <Download className="w-4 h-4" />
                Export CSV
              </button>
            </div>
          </div>

          {lastRefresh && (
            <div className="mb-4 text-sm text-gray-600">
              Last updated: {lastRefresh.toLocaleTimeString()}
            </div>
          )}

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-800">
              <AlertCircle className="w-5 h-5" />
              <span>Error: {error}</span>
            </div>
          )}

          {loading ? (
            <div className="flex justify-center items-center h-64">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
          ) : vehicles.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p className="text-lg">No vehicles found</p>
              <p className="text-sm mt-2">
                All front lot vehicles are either listed on SmartAuction or less than 10 days old
              </p>
            </div>
          ) : (
            <div>
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-blue-800 font-semibold">
                  Found {vehicles.length} vehicles needing SmartAuction listing
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-100 border-b">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">
                        Stock #
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">
                        VIN (Last 6)
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">
                        Location
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">
                        Days on Lot
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">
                        Last Updated
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {vehicles.map((vehicle, index) => (
                      <tr
                        key={vehicle.stock_number || index}
                        className={`border-b ${getRowClass(vehicle.days_on_lot)}`}
                      >
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {vehicle.stock_number}
                        </td>
                        <td className="px-4 py-3 text-gray-700 font-mono">
                          {vehicle.vin ? vehicle.vin.slice(-6) : 'N/A'}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {vehicle.physical_location || 'Front Lot'}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`font-bold ${
                              vehicle.days_on_lot > 30
                                ? 'text-red-600'
                                : vehicle.days_on_lot > 20
                                ? 'text-yellow-600'
                                : 'text-gray-700'
                            }`}
                          >
                            {vehicle.days_on_lot} days
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600 text-sm">
                          {new Date(vehicle.location_updated_at).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-6 grid grid-cols-3 gap-4">
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-600">10-20 Days</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {vehicles.filter(v => v.days_on_lot <= 20).length}
                  </p>
                </div>
                <div className="p-4 bg-yellow-50 rounded-lg">
                  <p className="text-sm text-yellow-800">20-30 Days</p>
                  <p className="text-2xl font-bold text-yellow-900">
                    {vehicles.filter(v => v.days_on_lot > 20 && v.days_on_lot <= 30).length}
                  </p>
                </div>
                <div className="p-4 bg-red-50 rounded-lg">
                  <p className="text-sm text-red-800">Over 30 Days</p>
                  <p className="text-2xl font-bold text-red-900">
                    {vehicles.filter(v => v.days_on_lot > 30).length}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default FrontLotAging;