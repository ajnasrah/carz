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
      
      // First get inventory to match VINs and get location codes
      const { data: inventory } = await supabase
        .from('inventory')
        .select('stock_number, last_6_vin, vehicle_vin, vehicle_year, vehicle_make, vehicle_model, location_code, days_on_lot');
      
      // Query vehicles on front lot over 10 days old not on SmartAuction
      const { data, error: fetchError } = await supabase
        .from('vehicle_locations')
        .select('stock_number, vin, physical_location, location_updated_at, sa_status, notes')
        .or('sa_status.is.null,sa_status.neq.active')
        .lte('location_updated_at', tenDaysAgo.toISOString())
        .is('sold_on', null)
        .order('location_updated_at', { ascending: true });
      
      if (fetchError) throw fetchError;
      
      // Create inventory lookup maps
      const invByStock = new Map();
      const invByVin6 = new Map();
      const invByFullVin = new Map();
      
      if (inventory) {
        inventory.forEach(item => {
          if (item.stock_number) invByStock.set(item.stock_number, item);
          if (item.last_6_vin) invByVin6.set(item.last_6_vin.toUpperCase(), item);
          if (item.vehicle_vin) invByFullVin.set(item.vehicle_vin.toUpperCase(), item);
        });
      }
      
      // Filter for front lot vehicles and match with inventory
      const frontLotVehicles = (data || []).filter(v => {
        const location = (v.physical_location || '').toLowerCase();
        
        // Try to match with inventory to get Frazer location code
        let invMatch = null;
        if (v.stock_number) {
          invMatch = invByStock.get(v.stock_number);
        }
        if (!invMatch && v.vin) {
          // Try full VIN match
          invMatch = invByFullVin.get(v.vin.toUpperCase());
          // Try last 6 match
          if (!invMatch && v.vin.length >= 6) {
            const last6 = v.vin.slice(-6).toUpperCase();
            invMatch = invByVin6.get(last6);
          }
        }
        
        // Update vehicle with inventory data
        if (invMatch) {
          v.stock_number = invMatch.stock_number || v.stock_number;
          v.vin = invMatch.vehicle_vin || v.vin;
          v.vehicle_info = `${invMatch.vehicle_year || ''} ${invMatch.vehicle_make || ''} ${invMatch.vehicle_model || ''}`.trim();
          v.location_code = invMatch.location_code;
          v.inv_days_on_lot = invMatch.days_on_lot;
        }
        
        // Locations that are NOT considered front lot:
        const excludedLocations = [
          'transport',
          'in_transit',
          'in transit',
          'body_shop',
          'body shop',
          'sold',
          'wholesale',
          'arbitrated',
          'arb_section'
        ];
        
        // Check if vehicle is in an excluded location
        const isExcluded = excludedLocations.some(loc => 
          location.includes(loc.replace('_', ' ').replace('-', ' '))
        );
        
        // IMPORTANT: Check Frazer location code Z (transport)
        // This is the key check - if location_code is Z, it's in transport
        const isTransport = v.location_code === 'Z';
        
        // Vehicle is on front lot if:
        // 1. NOT in transport (location code Z)
        // 2. NOT in any excluded physical location
        // 3. Empty location is considered front lot
        const isFrontLot = !isTransport && (!location || !isExcluded);
        
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
    const headers = ['Stock Number', 'VIN', 'Vehicle', 'Location', 'Location Code', 'Days on Lot', 'Last Updated'];
    const rows = vehicles.map(v => [
      v.stock_number || 'N/A',
      v.vin || '',
      v.vehicle_info || '',
      v.physical_location || 'Front Lot',
      v.location_code || '',
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
              <p className="text-gray-500 text-sm mt-1">
                Excludes vehicles with location code Z (in transport)
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
                All front lot vehicles are either:
              </p>
              <ul className="text-sm mt-2 space-y-1">
                <li>• Listed on SmartAuction</li>
                <li>• Less than 10 days old</li>
                <li>• In transport (location code Z)</li>
              </ul>
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
                        Vehicle
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
                        key={vehicle.stock_number || vehicle.vin || index}
                        className={`border-b ${getRowClass(vehicle.days_on_lot)}`}
                      >
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {vehicle.stock_number || 'N/A'}
                        </td>
                        <td className="px-4 py-3 text-gray-700 font-mono">
                          {vehicle.vin ? vehicle.vin.slice(-6).toUpperCase() : 'N/A'}
                        </td>
                        <td className="px-4 py-3 text-gray-700 text-sm">
                          {vehicle.vehicle_info || ''}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          <div>
                            {vehicle.physical_location || 'Front Lot'}
                            {vehicle.location_code && vehicle.location_code !== 'Z' && (
                              <span className="ml-2 text-xs text-gray-500">
                                (Code: {vehicle.location_code})
                              </span>
                            )}
                          </div>
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