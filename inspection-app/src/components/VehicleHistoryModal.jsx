import { useState, useEffect } from "react";
import {
  X,
  MapPin,
  ShoppingCart,
  Truck,
  Wrench,
  Clock,
  Package,
} from "lucide-react";
import { supabase } from "../services/supabase";

const eventIcons = {
  location_change: MapPin,
  marketplace_listed: ShoppingCart,
  marketplace_status: ShoppingCart,
  marketplace_sold: Package,
  transport_initiated: Truck,
  transport_completed: Truck,
  service_sent: Wrench,
  service_completed: Wrench,
  inventory_added: Package,
  inventory_removed: Package,
  manual_update: MapPin,
  scan_detected: MapPin,
  note_added: Clock,
};

const eventLabels = {
  location_change: "Location Changed",
  marketplace_listed: "Listed on Marketplace",
  marketplace_status: "Marketplace Status Update",
  marketplace_sold: "Sold",
  transport_initiated: "Transport Started",
  transport_completed: "Transport Completed",
  service_sent: "Sent to Service",
  service_completed: "Service Completed",
  inventory_added: "Added to Inventory",
  inventory_removed: "Removed from Inventory",
  manual_update: "Manual Update",
  scan_detected: "Scanned on Lot",
  note_added: "Note Added",
};

export default function VehicleHistoryModal({ stockNumber, vin, onClose }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentLocation, setCurrentLocation] = useState(null);

  useEffect(() => {
    loadHistory();
  }, [stockNumber]);

  async function loadHistory() {
    setLoading(true);
    try {
      // Get current location
      const { data: locData } = await supabase
        .from("vehicle_locations")
        .select("*")
        .eq("stock_number", stockNumber)
        .single();

      setCurrentLocation(locData);

      // Get history
      const { data, error } = await supabase
        .from("vehicle_location_history")
        .select("*")
        .eq("stock_number", stockNumber)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      setHistory(data || []);
    } catch (err) {
      console.error("Error loading history:", err);
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }

  function formatDate(dateStr) {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function getEventDescription(event) {
    const parts = [];

    if (event.previous_location && event.new_location) {
      parts.push(`${event.previous_location} → ${event.new_location}`);
    } else if (event.new_location) {
      parts.push(`Location: ${event.new_location}`);
    }

    if (event.marketplace && event.marketplace_status) {
      parts.push(`${event.marketplace}: ${event.marketplace_status}`);
    }

    if (event.sale_price) {
      parts.push(`Sale Price: $${event.sale_price.toLocaleString()}`);
    }

    if (event.buyer_name) {
      parts.push(`Buyer: ${event.buyer_name}`);
    }

    if (event.service_provider) {
      parts.push(`Service: ${event.service_provider}`);
    }

    if (event.transport_destination) {
      parts.push(`Destination: ${event.transport_destination}`);
    }

    return parts.join(" • ");
  }

  const Icon = ({ eventType }) => {
    const IconComponent = eventIcons[eventType] || Clock;
    return <IconComponent className="h-4 w-4" />;
  };

  return (
    <div 
      className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50"
      onClick={onClose}
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
            onClick={onClose}
            className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400"></div>
            </div>
          ) : history.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              No history records found
            </div>
          ) : (
            <div className="space-y-4">
              {history.map((event, idx) => (
                <div key={event.id} className="flex gap-3">
                  <div className="flex-shrink-0 mt-1">
                    <div
                      className={`p-2 rounded-full ${
                        event.event_type.includes("sold")
                          ? "bg-green-500/20 text-green-400"
                          : event.event_type.includes("service")
                            ? "bg-orange-500/20 text-orange-400"
                            : event.event_type.includes("transport")
                              ? "bg-blue-500/20 text-blue-400"
                              : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      <Icon eventType={event.event_type} />
                    </div>
                  </div>

                  <div className="flex-1">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium text-white">
                          {eventLabels[event.event_type] || event.event_type}
                        </p>
                        <p className="text-sm text-slate-400 mt-1">
                          {getEventDescription(event)}
                        </p>
                        {event.event_data &&
                          Object.keys(event.event_data).length > 0 && (
                            <details className="mt-2">
                              <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-300">
                                Additional details
                              </summary>
                              <pre className="text-xs text-slate-400 mt-1 p-2 bg-slate-800 rounded overflow-x-auto">
                                {JSON.stringify(event.event_data, null, 2)}
                              </pre>
                            </details>
                          )}
                      </div>
                      <div className="text-right text-sm text-slate-500 ml-4 flex-shrink-0">
                        <div>{formatDate(event.created_at)}</div>
                        {event.created_by && (
                          <div className="text-xs mt-1">
                            by {event.created_by}
                          </div>
                        )}
                      </div>
                    </div>

                    {idx < history.length - 1 && (
                      <div className="border-l-2 border-slate-700 ml-4 h-4 mt-2"></div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
