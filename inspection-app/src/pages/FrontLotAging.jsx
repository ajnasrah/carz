import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, selectAll } from '../services/supabase';
import { Download, AlertCircle, RefreshCw, Copy, Check, ArrowLeft, Clock } from 'lucide-react';
import HistoryButton from '../components/HistoryButton';
import { saveCsv } from '../native/files';
import { copyText } from '../native/clipboard';

// A car only counts as "front lot" if it's actually sitting on a sellable lot.
// Everything else — mechanic, pro auto, body shop, wash, detail, in transit,
// waiting on parts, sold, etc. — is in-process and must be excluded. We use an
// allowlist (not a blocklist) so the dozens of ad-hoc location labels in the
// data can't leak in; an empty/unknown location is treated as front lot.
const FRONT_LOT = new Set([
  'front', 'front_lot', 'frontlot', 'front lot',
  'on_lot', 'onlot', 'on lot', 'gravel',
]);

function isFrontLot(physical_location) {
  const loc = (physical_location || '').toLowerCase().trim();
  return !loc || FRONT_LOT.has(loc);
}

function prettyLocation(loc) {
  if (!loc) return 'Front Lot';
  return loc.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function FrontLotAging() {
  const navigate = useNavigate();
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [copied, setCopied] = useState(null);

  const fetchFrontLotAging = async () => {
    setLoading(true);
    setError(null);

    try {
      const tenDaysAgo = new Date();
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

      // Current inventory — the source of truth for which cars exist + their info
      const { data: inventory } = await supabase
        .from('inventory')
        .select('stock_number, last_6_vin, vehicle_vin, vehicle_year, vehicle_make, vehicle_model, location_code, days_on_lot');

      // Location rows >10 days old, not sold, not on an active SmartAuction listing
      const data = await selectAll(() => supabase
        .from('vehicle_locations')
        .select('stock_number, vin, physical_location, location_updated_at, sa_status, notes')
        .or('sa_status.is.null,sa_status.neq.active')
        .lte('location_updated_at', tenDaysAgo.toISOString())
        .is('sold_on', null)
        .order('location_updated_at', { ascending: true }));

      const invByStock = new Map();
      const invByVin6 = new Map();
      const invByFullVin = new Map();
      (inventory || []).forEach((item) => {
        if (item.stock_number) invByStock.set(item.stock_number, item);
        if (item.last_6_vin) invByVin6.set(item.last_6_vin.toUpperCase(), item);
        if (item.vehicle_vin) invByFullVin.set(item.vehicle_vin.toUpperCase(), item);
      });

      const result = (data || [])
        .map((v) => {
          // Match to current inventory (stock first, then VIN, then last 6)
          let inv = v.stock_number ? invByStock.get(v.stock_number) : null;
          if (!inv && v.vin) {
            inv = invByFullVin.get(v.vin.toUpperCase());
            if (!inv && v.vin.length >= 6) inv = invByVin6.get(v.vin.slice(-6).toUpperCase());
          }
          if (!inv) return null; // ghost row, not current inventory

          return {
            stock_number: inv.stock_number || v.stock_number,
            vin: inv.vehicle_vin || v.vin || '',
            vehicle_info: `${inv.vehicle_year || ''} ${inv.vehicle_make || ''} ${inv.vehicle_model || ''}`.trim(),
            physical_location: v.physical_location,
            location_code: inv.location_code,
            location_updated_at: v.location_updated_at,
            days_on_lot: Math.floor((Date.now() - new Date(v.location_updated_at)) / 86400000),
          };
        })
        .filter((v) => v && v.location_code !== 'Z' && isFrontLot(v.physical_location))
        .sort((a, b) => b.days_on_lot - a.days_on_lot);

      setVehicles(result);
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

  const copyVin = (vin, key) => {
    if (!vin) return;
    copyText(vin);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  const copyAllVins = () => {
    const vins = vehicles.map((v) => v.vin).filter(Boolean).join('\n');
    if (!vins) return;
    copyText(vins);
    setCopied('all');
    setTimeout(() => setCopied(null), 1500);
  };

  const exportToCSV = async () => {
    const headers = ['Stock Number', 'VIN', 'Vehicle', 'Location', 'Days on Lot', 'Last Updated'];
    const rows = vehicles.map((v) => [
      v.stock_number || '', v.vin || '', v.vehicle_info || '',
      prettyLocation(v.physical_location), v.days_on_lot,
      new Date(v.location_updated_at).toLocaleDateString(),
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
    try {
      await saveCsv(
        csv,
        `front_lot_aging_${new Date().toISOString().split('T')[0]}.csv`,
        { title: 'Front lot aging' },
      );
    } catch (err) {
      console.error('Front lot aging export failed', err);
      setError('Could not export: ' + (err?.message || err));
    }
  };

  const c1020 = vehicles.filter((v) => v.days_on_lot <= 20).length;
  const c2030 = vehicles.filter((v) => v.days_on_lot > 20 && v.days_on_lot <= 30).length;
  const c30 = vehicles.filter((v) => v.days_on_lot > 30).length;

  const daysColor = (d) => (d > 30 ? 'text-red-400' : d > 20 ? 'text-amber-400' : 'text-emerald-400');
  const daysBg = (d) => (d > 30 ? 'bg-red-500/10 border-red-500/30' : d > 20 ? 'bg-amber-500/10 border-amber-500/30' : 'bg-slate-800 border-slate-700');

  return (
    <div className="page">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate('/')} className="p-2 rounded-lg bg-slate-800">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-emerald-400">Front Lot Aging</h1>
          <p className="text-xs text-slate-400">On the lot 10+ days · not on SmartAuction</p>
        </div>
        <button
          onClick={fetchFrontLotAging}
          className="p-2 rounded-lg bg-slate-800 text-slate-300 active:bg-slate-700"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="card border-red-500/40 bg-red-500/10 flex items-center gap-2 text-red-300 text-sm mb-4">
          <AlertCircle size={18} /> <span>{error}</span>
        </div>
      )}

      {/* Summary chips */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <Stat label="10–20 days" value={c1020} className="bg-slate-800 text-white" />
        <Stat label="20–30 days" value={c2030} className="bg-amber-500/15 text-amber-300" />
        <Stat label="30+ days" value={c30} className="bg-red-500/15 text-red-300" />
      </div>

      {/* Actions */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={copyAllVins}
          disabled={!vehicles.length}
          className="btn-secondary flex-1 flex items-center justify-center gap-2 text-sm disabled:opacity-40"
        >
          {copied === 'all' ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
          {copied === 'all' ? 'Copied!' : `Copy ${vehicles.length} VINs`}
        </button>
        <button
          onClick={exportToCSV}
          disabled={!vehicles.length}
          className="btn-secondary flex-1 flex items-center justify-center gap-2 text-sm disabled:opacity-40"
        >
          <Download size={14} /> Export CSV
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <RefreshCw size={32} className="animate-spin text-emerald-400" />
        </div>
      ) : vehicles.length === 0 ? (
        <div className="text-center py-16">
          <Clock size={48} className="mx-auto text-slate-600 mb-4" />
          <p className="text-slate-300 font-semibold">No front-lot cars aging</p>
          <p className="text-slate-500 text-xs mt-1">
            Every front-lot car is either listed on SmartAuction or under 10 days old.
          </p>
        </div>
      ) : (
        <div className="space-y-2 md:space-y-0 md:grid md:grid-cols-2 md:gap-2">
          {vehicles.map((v, i) => {
            const key = v.stock_number || v.vin || i;
            const last6 = v.vin ? v.vin.slice(-6).toUpperCase() : '—';
            return (
              <div key={key} className={`rounded-xl border p-3 flex items-center gap-3 ${daysBg(v.days_on_lot)}`}>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-white truncate">{v.vehicle_info || 'Unknown Vehicle'}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    <span className="font-mono">{v.stock_number}</span>
                    <span className="text-slate-600"> · </span>
                    <span className="font-mono">…{last6}</span>
                  </p>
                  <span className="inline-block mt-1.5 px-2 py-0.5 rounded-md bg-slate-700/60 text-[10px] font-semibold text-slate-300">
                    {prettyLocation(v.physical_location)}
                  </span>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <div className={`text-lg font-bold leading-none ${daysColor(v.days_on_lot)}`}>
                    {v.days_on_lot}<span className="text-xs font-semibold">d</span>
                  </div>
                  <button
                    onClick={() => copyVin(v.vin, key)}
                    className="flex items-center gap-1 px-2 py-1 rounded-md bg-slate-700 text-slate-300 text-[11px] font-semibold active:bg-slate-600"
                  >
                    {copied === key ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                    {copied === key ? 'Copied' : 'VIN'}
                  </button>
                  <HistoryButton
                    showPhotos
                    stockNumber={v.stock_number}
                    vin={v.vin}
                    size={11}
                    label="History"
                    className="flex items-center gap-1 px-2 py-1 rounded-md bg-slate-700 text-slate-300 text-[11px] font-semibold active:bg-slate-600"
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {lastRefresh && (
        <p className="text-center text-[10px] text-slate-600 mt-4">
          Updated {lastRefresh.toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, className }) {
  return (
    <div className={`rounded-xl p-3 text-center ${className}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-[10px] uppercase tracking-wide opacity-80 mt-0.5">{label}</div>
    </div>
  );
}

export default FrontLotAging;
