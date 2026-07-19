import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { supabase } from "../services/supabase";
import HistoryTimeline from "./HistoryTimeline";

export default function VehicleHistoryModal({ stockNumber, vin, onClose }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentLocation, setCurrentLocation] = useState(null);

  useEffect(() => {
    loadHistory();
  }, [stockNumber, vin]);

  // Add escape key handler
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  async function loadHistory() {
    setLoading(true);
    try {
      // A VIN may arrive full (17) or as a last-6 (some list views only have
      // that). Full → exact match; partial → tail match. History/location VINs
      // are always stored full, so eq on a last-6 would match nothing.
      const cleanVin = (vin || "").toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
      const byVin = (q) => (cleanVin.length === 17 ? q.eq("vin", cleanVin) : q.ilike("vin", `%${cleanVin}`));

      // Current location — query by whichever key we have. Use limit(1) instead
      // of .single() so a removed car (0 location rows) doesn't abort the whole
      // load; it just leaves currentLocation null.
      let locQ = supabase.from("vehicle_locations").select("*");
      locQ = stockNumber ? locQ.eq("stock_number", stockNumber) : byVin(locQ);
      const { data: locRows } = await locQ.limit(1);
      setCurrentLocation(locRows?.[0] || null);

      // History key priority:
      //   1. Full 17-char VIN — exact and collision-proof (best).
      //   2. Stock number — precise; preferred over a partial VIN, whose
      //      last-6 `ilike` can collide across cars and merge timelines.
      //   3. Partial VIN — best-effort tail match when nothing better exists.
      let histQ = supabase
        .from("vehicle_location_history")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (cleanVin.length === 17) histQ = histQ.eq("vin", cleanVin);
      else if (stockNumber) histQ = histQ.eq("stock_number", stockNumber);
      else if (cleanVin.length >= 4) histQ = histQ.ilike("vin", `%${cleanVin}`);
      else {
        setHistory([]);
        return;
      }

      const { data, error } = await histQ;
      if (error) throw error;
      setHistory(data || []);
    } catch (err) {
      console.error("Error loading history:", err);
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div 
      className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50"
      onClick={(e) => {
        // Only close if clicking the backdrop directly
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div 
        className="bg-slate-900 border border-slate-700 rounded-xl max-w-3xl w-full max-h-[80vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <div>
            <h2 className="text-xl font-semibold text-emerald-400">Vehicle History</h2>
            <p className="text-sm text-slate-400 mt-1">
              Stock: {stockNumber} {vin && `• VIN: ${vin}`}
            </p>
            {currentLocation && (
              <p className="text-sm text-slate-400 mt-1">
                Current Location:{" "}
                <span className="font-medium text-white">
                  {currentLocation.physical_location || "Unknown"}
                </span>
                {currentLocation.sa_status &&
                  ` • SA: ${currentLocation.sa_status}`}
                {currentLocation.manheim_status &&
                  ` • Manheim: ${currentLocation.manheim_status}`}
                {currentLocation.ove_status &&
                  ` • OVE: ${currentLocation.ove_status}`}
              </p>
            )}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400"></div>
            </div>
          ) : (
            <HistoryTimeline events={history} />
          )}
        </div>
        
        {/* Footer with additional close button */}
        <div className="p-4 border-t border-slate-700 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
