import React, { useState } from 'react';
import { Upload, X, Check, AlertCircle } from 'lucide-react';
import { supabase } from '../services/supabase';

export default function BulkLocationEdit({ onClose, onSuccess }) {
  const [uploadData, setUploadData] = useState('');
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState(null);
  const [selectedLocation, setSelectedLocation] = useState('');
  const [customLocation, setCustomLocation] = useState('');

  const KNOWN_LOCATIONS = [
    { value: 'uax', label: 'UAX' },
    { value: 'daa', label: 'DAA' },
    { value: 'adesa', label: 'ADESA' },
    { value: 'super_dispatch', label: 'Super Dispatch (Dispatched)' },
    { value: 'in_transit', label: 'In Transit' },
    { value: 'body_shop', label: 'Body Shop' },
    { value: 'mechanic_section', label: 'Mechanic' },
    { value: 'jorge', label: "Jorge's Shop" },
    { value: 'muffler_cs', label: 'Muffler C&S' },
    { value: 'jim_keras_nissan', label: 'Jim Keras Nissan' },
    { value: 'front', label: 'Memphis - Front Lot' },
    { value: 'jackson', label: 'Jackson' },
    { value: 'pro_auto', label: 'Pro Auto' },
    { value: 'andys_auto', label: "Andy's Auto" },
    { value: 'summit_tire', label: 'Summit Tire' },
    { value: 'tri_state', label: 'Tri State' },
    { value: 'city_auto', label: 'City Auto' },
    { value: 'in_transit', label: 'In Transit' },
    // Denver + West Coast expansion
    { value: 'otta_body', label: 'Otta Body Shop' },
    { value: 'manheim_denver', label: 'Manheim Denver' },
    { value: 'daa_rockies', label: 'DAA Rockies' },
    { value: 'manheim_sf', label: 'Manheim San Francisco' },
    { value: 'manheim_riverside', label: 'Manheim Riverside' },
    { value: 'manheim_little_rock', label: 'Manheim Little Rock' },
    { value: 'loveland', label: 'Loveland Auto Auction' },
    { value: 'marc_pdr', label: 'Marc (PDR)' },
    { value: 'emich_kia', label: 'Emich Kia' },
    { value: '__other__', label: 'Custom Location' },
  ];

  async function handleBulkUpdate() {
    if (!uploadData.trim()) {
      alert('Please enter stock numbers or VINs');
      return;
    }

    const location = selectedLocation === '__other__' 
      ? customLocation.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
      : selectedLocation;

    if (!location || location === '__other__') {
      alert('Please select or enter a location');
      return;
    }

    setProcessing(true);
    setResults(null);

    try {
      // Parse input data - could be stock numbers or VINs
      const lines = uploadData.trim().split('\n');
      const identifiers = lines
        .map(line => line.trim())
        .filter(line => line.length > 0);

      if (identifiers.length === 0) {
        alert('No valid identifiers found');
        setProcessing(false);
        return;
      }

      const updateResults = {
        success: [],
        failed: [],
        notFound: []
      };

      // Process in batches
      const batchSize = 20;
      for (let i = 0; i < identifiers.length; i += batchSize) {
        const batch = identifiers.slice(i, i + batchSize);
        
        // First try to find vehicles by stock number or VIN
        const { data: vehicles, error: searchError } = await supabase
          .from('inventory')
          .select('stock_number, vehicle_vin, last_6_vin')
          .or(batch.map(id => 
            `stock_number.eq.${id},vehicle_vin.eq.${id},last_6_vin.eq.${id}`
          ).join(','));

        if (searchError) {
          console.error('Search error:', searchError);
          batch.forEach(id => updateResults.failed.push({ id, error: searchError.message }));
          continue;
        }

        // Track which identifiers were found
        const foundStockNumbers = new Set(vehicles.map(v => v.stock_number));
        const foundIdentifiers = new Set();
        
        for (const vehicle of vehicles) {
          foundIdentifiers.add(vehicle.stock_number);
          if (vehicle.vehicle_vin) foundIdentifiers.add(vehicle.vehicle_vin);
          if (vehicle.last_6_vin) foundIdentifiers.add(vehicle.last_6_vin);
        }

        // Mark not found items
        batch.forEach(id => {
          if (!foundIdentifiers.has(id)) {
            updateResults.notFound.push(id);
          }
        });

        // Update locations for found vehicles
        if (vehicles.length > 0) {
          const nowIso = new Date().toISOString();
          
          // For Super Dispatch, set location as in_transit
          const actualLocation = selectedLocation === 'super_dispatch' ? 'in_transit' : location;
          
          const updates = vehicles.map(v => ({
            stock_number: String(v.stock_number).trim(),
            vin: v.vehicle_vin || v.last_6_vin || '',
            physical_location: actualLocation,
            physical_source: selectedLocation === 'super_dispatch' ? 'super_dispatch' : 'bulk_manual',
            location_updated_at: nowIso,
            updated_at: nowIso,
            notes: {
              bulk_update: true,
              updated_at: nowIso,
              selected: selectedLocation,
              custom_input: selectedLocation === '__other__' ? customLocation : null,
              dispatched: selectedLocation === 'super_dispatch' ? true : undefined
            }
          }));

          const { error: updateError } = await supabase
            .from('vehicle_locations')
            .upsert(updates, { onConflict: 'stock_number' });

          if (updateError) {
            console.error('Update error:', updateError);
            vehicles.forEach(v => 
              updateResults.failed.push({ id: v.stock_number, error: updateError.message })
            );
          } else {
            vehicles.forEach(v => updateResults.success.push(v.stock_number));
          }
        }
      }

      setResults(updateResults);
      
      if (updateResults.success.length > 0) {
        setTimeout(() => {
          onSuccess();
          onClose();
        }, 2000);
      }
    } catch (error) {
      console.error('Bulk update error:', error);
      alert('Error during bulk update: ' + error.message);
    } finally {
      setProcessing(false);
    }
  }

  function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      setUploadData(e.target.result);
    };
    reader.readAsText(file);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Bulk Location Update</h2>
          <button 
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {!results ? (
          <>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">
                Select Location
              </label>
              <select
                value={selectedLocation}
                onChange={(e) => setSelectedLocation(e.target.value)}
                className="w-full border rounded px-3 py-2"
              >
                <option value="">-- Select Location --</option>
                {KNOWN_LOCATIONS.map(loc => (
                  <option key={loc.value} value={loc.value}>
                    {loc.label}
                  </option>
                ))}
              </select>
            </div>

            {selectedLocation === '__other__' && (
              <div className="mb-4">
                <label className="block text-sm font-medium mb-2">
                  Custom Location
                </label>
                <input
                  type="text"
                  value={customLocation}
                  onChange={(e) => setCustomLocation(e.target.value)}
                  placeholder="Enter custom location"
                  className="w-full border rounded px-3 py-2"
                />
              </div>
            )}

            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">
                Stock Numbers or VINs (one per line)
              </label>
              <textarea
                value={uploadData}
                onChange={(e) => setUploadData(e.target.value)}
                placeholder="Enter stock numbers or VINs, one per line"
                className="w-full border rounded px-3 py-2 h-48 font-mono text-sm"
              />
            </div>

            <div className="mb-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="file"
                  accept=".txt,.csv"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <div className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 flex items-center gap-2">
                  <Upload className="w-4 h-4" />
                  Upload File
                </div>
                <span className="text-sm text-gray-500">
                  Upload a .txt or .csv file with stock numbers/VINs
                </span>
              </label>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 border rounded hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkUpdate}
                disabled={processing || !uploadData.trim() || !selectedLocation}
                className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:opacity-50"
              >
                {processing ? 'Processing...' : 'Update Locations'}
              </button>
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <h3 className="font-semibold">Update Results</h3>
            
            {results.success.length > 0 && (
              <div className="bg-green-50 p-4 rounded">
                <div className="flex items-center gap-2 mb-2">
                  <Check className="w-5 h-5 text-green-600" />
                  <span className="font-medium text-green-900">
                    Successfully Updated ({results.success.length})
                  </span>
                </div>
                <div className="text-sm text-green-700 max-h-32 overflow-y-auto">
                  {results.success.join(', ')}
                </div>
              </div>
            )}

            {results.notFound.length > 0 && (
              <div className="bg-yellow-50 p-4 rounded">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="w-5 h-5 text-yellow-600" />
                  <span className="font-medium text-yellow-900">
                    Not Found ({results.notFound.length})
                  </span>
                </div>
                <div className="text-sm text-yellow-700 max-h-32 overflow-y-auto">
                  {results.notFound.join(', ')}
                </div>
              </div>
            )}

            {results.failed.length > 0 && (
              <div className="bg-red-50 p-4 rounded">
                <div className="flex items-center gap-2 mb-2">
                  <X className="w-5 h-5 text-red-600" />
                  <span className="font-medium text-red-900">
                    Failed ({results.failed.length})
                  </span>
                </div>
                <div className="text-sm text-red-700 max-h-32 overflow-y-auto">
                  {results.failed.map((f, i) => (
                    <div key={i}>{f.id}: {f.error}</div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}