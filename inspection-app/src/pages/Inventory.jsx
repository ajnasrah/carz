import { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Search,
  RefreshCw,
  MapPin,
  Download,
  Pencil,
  X,
  Copy,
  History,
  Upload,
} from "lucide-react";
import { supabase } from "../services/supabase";
import { toInt, toMoney } from "../services/utils";
import {
  staleness,
  STALENESS_STYLES,
  formatLastSeen,
} from "../services/lotTracking";
import VehicleHistoryModal from "../components/VehicleHistoryModal";
import BulkLocationEdit from "../components/BulkLocationEdit";

// A car physically at one of these "settled" out-of-town destinations has
// already been moved — it should NOT clutter Needs Dispatch or the Stale aging
// bucket. It still surfaces in Stuck (>=21d) and Never Tracked, which are
// location-agnostic, so a genuinely forgotten car still shows up. Covers every
// Manheim lot (manheim_*) plus the Denver auctions/shops.
const SETTLED_TRANSPORT_LOCS = new Set([
  "otta_body",
  "daa_rockies",
  "marc_pdr",
]);
function isSettledTransportLoc(physLoc) {
  if (!physLoc) return false;
  return physLoc.startsWith("manheim_") || SETTLED_TRANSPORT_LOCS.has(physLoc);
}

// A car "needs dispatch" only until we know where it physically is. The moment
// it's tracked at ANY real location (in_transit, mechanic, a body shop, an
// auction, etc.) it's been handled and drops off Needs Dispatch — it's no
// longer a "we don't know where this Z car is" case. Only null / "unknown"
// counts as un-located.
function hasBeenLocated(physLoc) {
  return !!physLoc && physLoc !== "unknown";
}

export default function Inventory() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [costMap, setCostMap] = useState(new Map());
  const [locMap, setLocMap] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sectionFilter, setSectionFilter] = useState(() => {
    const f = searchParams.get("filter");
    if (f === "stuck21") return "__stuck21__";
    if (f === "never") return "__never__";
    if (f === "stale") return "__stale__";
    if (f === "needs_dispatch") return "__needs_dispatch__";
    if (f === "front_lot_aging") return "__front_lot_aging__";
    return "";
  });
  const [sections, setSections] = useState([]);
  const [buyerFilter, setBuyerFilter] = useState(""); // filter by buyer
  const [buyers, setBuyers] = useState([]); // unique buyers list
  const [vendorFilter, setVendorFilter] = useState(""); // filter by vendor/auction
  const [vendors, setVendors] = useState([]); // unique vendors/auctions list
  const [editingRow, setEditingRow] = useState(null); // stock of row being edited
  const [editLocation, setEditLocation] = useState("");
  const [editCustom, setEditCustom] = useState("");
  const [saving, setSaving] = useState(false);
  const [reloadTimeout, setReloadTimeout] = useState(null); // track reload timeout
  const [historyStock, setHistoryStock] = useState(null); // stock number for history modal
  const [historyVin, setHistoryVin] = useState(null); // VIN for history modal
  const [showBulkEdit, setShowBulkEdit] = useState(false); // bulk location edit modal

  async function load() {
    setLoading(true);
    
    // First get inventory stock numbers to filter vehicle_locations
    const { data: inventoryStocks } = await supabase
      .from("inventory")
      .select("stock_number");
    const stockNumbers = (inventoryStocks || []).map(r => r.stock_number);
    
    // Pull from vehicle_lot_status view (joins inventory + latest scan).
    // Falls back to the plain inventory table if the view doesn't exist yet
    // (i.e. the lot-tracking-schema.sql migration hasn't been run).
    const [statusRes, costRes, secsRes, locRes] = await Promise.all([
      supabase.from("vehicle_lot_status").select("*"),
      supabase
        .from("inventory")
        .select(
          "stock_number, total_cost, added_costs, buyer, vendor, location_code",
        ),
      supabase
        .from("lot_sections")
        .select("name")
        .eq("active", true)
        .order("sort_order"),
      stockNumbers.length > 0
        ? supabase
            .from("vehicle_locations")
            .select(
              "stock_number, physical_location, physical_source, location_updated_at, sa_status, manheim_status, ove_status, sold_on",
            )
            .in('stock_number', stockNumbers)
        : Promise.resolve({ data: [], error: null })
    ]);

    let statusRows = statusRes.data;
    if (statusRes.error || statusRows == null) {
      // View missing — query plain inventory table so the page still works
      const fallback = await supabase.from("inventory").select("*");
      statusRows = (fallback.data || []).map((r) => ({
        ...r,
        current_section: null,
        last_seen_at: null,
        days_since_seen: null,
      }));
    }

    // Location-update times from vehicle_locations — a list upload (UAX/DAA/ADESA/
    // Super Dispatch) or chat-sourced entry counts as tracking too, not just  
    // physical lot scans.
    const lm = new Map();
    for (const r of locRes.data || []) lm.set(r.stock_number, r);
    
    // Debug in production
    console.log('Vehicle locations loaded:', {
      count: (locRes.data || []).length,
      has05_234_26: lm.has('05-234-26'),
      data05_234_26: lm.get('05-234-26')
    });
    window._DEBUG_LOCMAP = lm; // Expose for console debugging
    

    // Annotate each row with effective_last_seen = max(scan, location_updated_at)
    // and effective_days_since. Z-code (Transport) cars without any other signal
    // fall back to their Frazer days_on_lot — Transport status is itself a
    // tracking signal, so they're not "never tracked" and still trip the
    // stuck-21d warning based on how long they've been sitting in Transport.
    const cmLocal = new Map();
    for (const r of costRes.data || []) cmLocal.set(r.stock_number, r);
    const now = Date.now();
    for (const r of statusRows) {
      const scanMs = r.last_seen_at ? new Date(r.last_seen_at).getTime() : 0;
      const locRow = lm.get(r.stock_number) || {};
      const locMs = locRow.location_updated_at
        ? new Date(locRow.location_updated_at).getTime()
        : 0;
      let bestMs = Math.max(scanMs, locMs);
      let daysSince = bestMs ? Math.floor((now - bestMs) / 86400000) : null;

      // A car can't be somewhere longer than it's been in inventory — Frazer
      // re-uses stock numbers, so vehicle_locations can carry stale rows from
      // a previous car with the same stock. Cap effective_days_since at
      // days_on_lot when Frazer's number is shorter.
      const dol = parseInt(r.days_on_lot, 10);
      if (
        Number.isFinite(dol) &&
        dol >= 0 &&
        daysSince != null &&
        daysSince > dol
      ) {
        daysSince = dol;
        bestMs = now - dol * 86400000;
      }

      if (!bestMs) {
        // Frazer Z-code fallback: treat as tracked since purchase, using days_on_lot.
        const cost = cmLocal.get(r.stock_number) || {};
        if (cost.location_code === "Z") {
          if (Number.isFinite(dol) && dol >= 0) {
            daysSince = dol;
            bestMs = now - dol * 86400000;
          }
        }
      }
      r.effective_last_seen_ms = bestMs || null;
      r.effective_days_since = daysSince;
    }

    // Sort: most days since last tracked first (never-tracked at top), then
    // most days on lot as a tiebreaker.
    statusRows.sort((a, b) => {
      const aDays =
        a.effective_days_since == null
          ? Number.MAX_SAFE_INTEGER
          : a.effective_days_since;
      const bDays =
        b.effective_days_since == null
          ? Number.MAX_SAFE_INTEGER
          : b.effective_days_since;
      if (aDays !== bDays) return bDays - aDays;
      const aOnLot = parseInt(a.days_on_lot, 10) || 0;
      const bOnLot = parseInt(b.days_on_lot, 10) || 0;
      return bOnLot - aOnLot;
    });
    setRows(statusRows);

    const cm = new Map();
    for (const r of costRes.data || []) cm.set(r.stock_number, r);
    setCostMap(cm);
    setLocMap(lm);
    setSections((secsRes.data || []).map((s) => s.name));
    
    // Extract unique buyers for filter dropdown
    const uniqueBuyers = [...new Set((costRes.data || []).map(r => r.buyer).filter(Boolean))].sort();
    setBuyers(uniqueBuyers);
    // Extract unique vendors/auctions for filter dropdown
    const uniqueVendors = [...new Set((costRes.data || []).map(r => r.vendor).filter(Boolean))].sort();
    setVendors(uniqueVendors);
    setLoading(false);
  }

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    load();
    
    // Cleanup function to clear any pending timeouts
    return () => {
      if (reloadTimeout) {
        clearTimeout(reloadTimeout);
      }
    };
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps */

  const LOCATION_FILTERS = [
    "__loc_M__",
    "__loc_J__",
    "__loc_transit__",
    "__loc_A__",
    "uax",
    "daa",
    "adesa",
    "body_shop",
    "mechanic_section",
    "front",
    "jackson",
  ];
  const LOCATION_LABELS = {
    __loc_M__: "Memphis",
    __loc_J__: "Jackson",
    __loc_transit__: "In Transit",
    __loc_A__: "Auction",
    uax: "UAX",
    daa: "DAA",
    adesa: "ADESA",
    in_transit: "In Transit",
    // Chat-sourced destinations (CARZ INC, Body shop, Mechanics, Seller Group)
    body_shop: "Body Shop",
    mechanic_section: "Mechanic",
    mechanic: "Mechanic",
    jorge: "Jorge's Shop",
    front: "Memphis - Front Lot",
    seller_group: "Memphis - Front Lot",
    carz_inc: "Memphis - Front Lot",
    gravel_front: "Memphis - Front Lot",
    gravel_front_lot: "Memphis - Front Lot",
    jackson: "Jackson",
    pro_auto: "Pro Auto",
    andys_auto: "Andy's Auto",
    summit_tire: "Summit Tire",
    tri_state: "Tri State",
    tri_state_glass: "Tri State Glass",
    city_auto: "City Auto",
    upholstery: "Upholstery",
    jim_keras_nissan: "Jim Keras Nissan",
    jim_keras_chevy_service: "Jim Keras Chevy Svc",
    muffler_cs: "Muffler C&S",
    // Denver + West Coast expansion
    otta_body: "Otta Body Shop",
    manheim_denver: "Manheim Denver",
    daa_rockies: "DAA Rockies",
    manheim_sf: "Manheim San Francisco",
    manheim_riverside: "Manheim Riverside",
    manheim_little_rock: "Manheim Little Rock",
    loveland: "Loveland Auto Auction",
    marc_pdr: "Marc Dent Doctor (Denver)",
    emich_kia: "Emich Kia",
  };
  // Format any location value for display: use the label if we have one,
  // otherwise prettify the raw slug (snake_case → Title Case) so chat entries
  // like "901_sound" render as "901 Sound" instead of "901_SOUND".
  function formatLocationLabel(slug) {
    if (!slug) return "";
    if (LOCATION_LABELS[slug]) return LOCATION_LABELS[slug];
    return String(slug)
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  const LOCATION_COLORS = {
    uax: "bg-teal-500",
    daa: "bg-blue-500",
    adesa: "bg-purple-500",
    in_transit: "bg-orange-500",
    __dispatched__: "bg-yellow-500",
    __jackson__: "bg-sky-500",
    body_shop: "bg-rose-500",
    mechanic_section: "bg-indigo-500",
    mechanic: "bg-indigo-500",
    jorge: "bg-rose-500",
    front: "bg-emerald-500",
    seller_group: "bg-emerald-500",
    carz_inc: "bg-emerald-500",
    gravel_front: "bg-emerald-500",
    gravel_front_lot: "bg-emerald-500",
    jackson: "bg-sky-500",
    pro_auto: "bg-cyan-500",
    andys_auto: "bg-lime-500",
    muffler_cs: "bg-fuchsia-500",
    jim_keras_nissan: "bg-violet-500",
    summit_tire: "bg-amber-500",
    // Denver + West Coast expansion
    otta_body: "bg-pink-500",
    manheim_denver: "bg-red-500",
    daa_rockies: "bg-blue-600",
    manheim_sf: "bg-red-600",
    manheim_riverside: "bg-red-400",
    manheim_little_rock: "bg-red-700",
    loveland: "bg-sky-600",
    marc_pdr: "bg-fuchsia-600",
    emich_kia: "bg-violet-600",
  };

  // Frazer location_code → human-readable name
  const LOCATION_CODE_MAP = {
    M: "Memphis",
    J: "Jackson",
    Z: "Needs Transport",  // Z means needs transport/pickup
    X: "In Transit",  // X means in transit/dispatched (was arbitration)
    A: "Auction",
  };

  const filtered = useMemo(() => {
    let result = rows;
    
    // Apply buyer filter first
    if (buyerFilter) {
      result = result.filter(r => {
        const cost = costMap.get(r.stock_number);
        return cost && cost.buyer === buyerFilter;
      });
    }

    // Vendor/auction filter — composes with the section filter (Stuck, Needs
    // Dispatch, etc.) so you can narrow those lists to one vendor/auction.
    if (vendorFilter) {
      result = result.filter(r => {
        const cost = costMap.get(r.stock_number);
        return cost && cost.vendor === vendorFilter;
      });
    }

    if (sectionFilter) {
      if (sectionFilter === "__stale__") {
        // Anything sitting in one spot 21+ days is stale — no exceptions, any
        // location. Under 21d, the far-away auction/shop cars are expected to
        // sit, so they don't trip the 7d mark; everything else does.
        result = result.filter((r) => {
          const days = r.effective_days_since;
          if (days != null && days >= 21) return true; // 21d+ => always stale
          if (days != null && days < 7) return false; // fresh
          return !isSettledTransportLoc(
            locMap.get(r.stock_number)?.physical_location,
          );
        });
      } else if (sectionFilter === "__stuck21__") {
        result = result.filter(
          (r) => r.effective_days_since != null && r.effective_days_since >= 21,
        );
      } else if (sectionFilter === "__needs_dispatch__") {
        // Frazer Z (Transport) that we haven't physically located yet. Once a
        // car is tracked ANYWHERE (in transit, a shop, an auction, …) it's been
        // handled and no longer needs dispatch.
        result = result.filter((r) => {
          const c = costMap.get(r.stock_number) || {};
          const loc = locMap.get(r.stock_number) || {};
          return (
            c.location_code === "Z" && !hasBeenLocated(loc.physical_location)
          );
        });
      } else if (sectionFilter === "__front_lot_aging__") {
        // Front lot vehicles over 10 days not listed on SmartAuction
        result = result.filter((r) => {
          const loc = locMap.get(r.stock_number) || {};
          const daysOnLot = parseInt(r.days_on_lot, 10) || 0;
          return (
            loc.physical_location === "front_lot" && 
            daysOnLot >= 10 &&
            !loc.sa_status  // Not listed on SmartAuction
          );
        });
      } else if (sectionFilter === "__other_small__") {
        // Consolidated "Other": any physical_location with <5 cars
        const counts = {};
        for (const r of rows) {
          const p = locMap.get(r.stock_number)?.physical_location;
          if (p) counts[p] = (counts[p] || 0) + 1;
        }
        const smallSet = new Set(
          Object.keys(counts).filter((l) => counts[l] < 5),
        );
        result = result.filter((r) =>
          smallSet.has(locMap.get(r.stock_number)?.physical_location),
        );
      } else if (sectionFilter === "__never__") {
        result = result.filter((r) => r.effective_last_seen_ms == null);
      } else if (sectionFilter === "__dispatched__") {
        result = result.filter((r) => {
          const c = costMap.get(r.stock_number) || {};
          return (
            c.location_code === "X" ||
            locMap.get(r.stock_number)?.physical_location === "in_transit"
          );
        });
      } else if (sectionFilter === "__loc_Z_no_disp__") {
        result = result.filter((r) => {
          const c = costMap.get(r.stock_number) || {};
          const loc = locMap.get(r.stock_number) || {};
          return (
            c.location_code === "Z" &&
            c.location_code !== "X" &&
            !hasBeenLocated(loc.physical_location)
          );
        });
      } else if (
        sectionFilter.startsWith("__loc_") &&
        sectionFilter.endsWith("__")
      ) {
        const code = sectionFilter.slice(6, -2);
        result = result.filter(
          (r) => (costMap.get(r.stock_number) || {}).location_code === code,
        );
      } else {
        // Dynamic routing: if the filter value matches any physical_location
        // currently in the data, treat it as a vehicle_locations filter;
        // otherwise treat it as a lot_scans section (legacy). Supports any
        // new location that flows in from chat without code changes.
        const isPhysLoc = rows.some(
          (r) =>
            locMap.get(r.stock_number)?.physical_location === sectionFilter,
        );
        if (isPhysLoc) {
          result = result.filter(
            (r) =>
              locMap.get(r.stock_number)?.physical_location === sectionFilter,
          );
        } else {
          result = result.filter((r) => r.current_section === sectionFilter);
        }
      }
    }
    if (search.trim()) {
      const q = search.toUpperCase();
      result = result.filter((r) => {
        const cost = costMap.get(r.stock_number) || {};
        return [
          r.stock_number,
          r.vehicle_vin,
          r.last_6_vin,
          r.vehicle_year,
          r.vehicle_make,
          r.vehicle_model,
          cost.buyer,
          cost.vendor,
        ]
          .filter(Boolean)
          .some((v) => String(v).toUpperCase().includes(q));
      });
    }
    return result;
  }, [rows, search, sectionFilter, costMap, locMap, buyerFilter, vendorFilter]);

  const totalCost = useMemo(
    () =>
      filtered.reduce((sum, r) => {
        const c = costMap.get(r.stock_number) || {};
        return sum + toInt(c.total_cost);
      }, 0),
    [filtered, costMap],
  );

  // Avg added costs + avg days on lot for the FILTERED (tab/search) view — so
  // switching tabs or filters recomputes.
  const filteredStats = useMemo(() => {
    let addedSum = 0,
      addedN = 0;
    let daysSum = 0,
      daysN = 0;
    for (const r of filtered) {
      const c = costMap.get(r.stock_number) || {};
      const ac = toInt(c.added_costs);
      if (ac > 0) {
        addedSum += ac;
        addedN += 1;
      }
      const dol = parseInt(r.days_on_lot, 10);
      if (Number.isFinite(dol) && dol >= 0) {
        daysSum += dol;
        daysN += 1;
      }
    }
    return {
      avgAdded: addedN ? Math.round(addedSum / addedN) : null,
      avgDays: daysN ? Math.round(daysSum / daysN) : null,
    };
  }, [filtered, costMap]);

  function openLocationEditor(row) {
    if (saving) return; // Prevent opening while another save is in progress
    
    try {
      const currentLoc = locMap.get(row.stock_number)?.physical_location || "";
      
      // If current is a known option, select it; otherwise fall back to "other" + prefill
      const KNOWN = [
        "front",
        "jackson",
        "uax",
        "daa",
        "adesa",
        "in_transit",
        "body_shop",
        "pro_auto",
        "summit_tire",
        "tri_state",
        "tri_state_glass",
        "city_auto",
        "upholstery",
        "jim_keras_nissan",
        "jim_keras_chevy_service",
        "muffler_cs",
        "unknown",
      ];
      
      // Batch all state updates together
      if (KNOWN.includes(currentLoc)) {
        setEditLocation(currentLoc);
        setEditCustom("");
      } else if (currentLoc) {
        setEditLocation("__other__");
        setEditCustom(currentLoc);
      } else {
        setEditLocation("");
        setEditCustom("");
      }
      
      // Set editing row last to ensure other state is ready
      setEditingRow(row);
    } catch (error) {
      console.error('Error opening location editor:', error);
      alert('Failed to open location editor: ' + error.message);
    }
  }

  async function saveLocation() {
    if (!editingRow || saving) return; // Prevent multiple simultaneous saves
    
    const finalLoc =
      editLocation === "__other__"
        ? editCustom
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "")
        : editLocation;
    
    // Validate location
    if (!finalLoc || finalLoc === "__other__") {
      alert("Please select a location or enter a custom one.");
      return;
    }
    
    setSaving(true);
    const stockNumber = editingRow.stock_number;
    const vin = editingRow.vehicle_vin || editingRow.last_6_vin || "";
    
    try {
      const nowIso = new Date().toISOString();
      const prevLoc = locMap.get(stockNumber)?.physical_location || null;
      const prevSource = locMap.get(stockNumber)?.physical_source || null;
      
      // First update the vehicle_locations table
      const { data: locData, error: locError } = await supabase
        .from("vehicle_locations")
        .upsert(
          {
            stock_number: String(stockNumber).trim(),
            vin: vin,
            physical_location: finalLoc,
            physical_source: "manual",
            location_updated_at: nowIso,
            updated_at: nowIso,
            notes: {
              selected: editLocation,
              raw_input: editLocation === "__other__" ? editCustom.trim() : null,
              previous_location: prevLoc,
              previous_source: prevSource,
              edited_at: nowIso,
            },
          },
          { onConflict: "stock_number" }
        )
        .select();
      
      if (locError) {
        console.error('Location update failed:', locError);
        alert(`Failed to update location: ${locError.message}\n\nDetails: ${JSON.stringify(locError)}`);
        setSaving(false);
        return;
      }
      
      // IMPORTANT: We do NOT modify location_code - it comes from Frazer
      // The physical_location is what we track manually
      let locationCodeUpdated = false;
      
      // Optimistically update local state
      const nextLoc = {
        ...(locMap.get(stockNumber) || {}),
        stock_number: stockNumber,
        vin: vin,
        physical_location: finalLoc,
        physical_source: "manual",
        location_updated_at: nowIso,
      };
      const nextLocMap = new Map(locMap);
      nextLocMap.set(stockNumber, nextLoc);
      setLocMap(nextLocMap);
      
      // Update costMap if location code changed
      if (locationCodeUpdated) {
        const currentCost = costMap.get(stockNumber);
        if (currentCost) {
          const nextCostMap = new Map(costMap);
          nextCostMap.set(stockNumber, {
            ...currentCost,
            location_code: "X"
          });
          setCostMap(nextCostMap);
        }
      }
      
      // Update the row's effective_last_seen
      const nowMs = Date.now();
      setRows((prev) =>
        prev.map((r) => {
          if (r.stock_number === stockNumber) {
            return {
              ...r,
              effective_last_seen_ms: nowMs,
              effective_days_since: 0,
              current_section: finalLoc // Update current section display
            };
          }
          return r;
        })
      );
      
      // Success - close modal
      setEditingRow(null);
      setEditLocation("");
      setEditCustom("");
      
      // Cancel any existing reload timeout
      if (reloadTimeout) {
        clearTimeout(reloadTimeout);
      }
      
      // Don't automatically reload after manual edits - it can overwrite the changes
      // The user can manually refresh if needed
      // Comment out automatic reload:
      // const timeout = setTimeout(() => {
      //   load();
      //   setReloadTimeout(null);
      // }, 3000);
      // setReloadTimeout(timeout);
      
    } catch (err) {
      console.error('Save failed:', err);
      alert(err.message || "Failed to save location. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function exportCsv() {
    const fmtDate = (iso) =>
      iso ? new Date(iso).toISOString().slice(0, 10) : "";
    const csvEscape = (v) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const headers = [
      "Stock #",
      "VIN",
      "Last 6",
      "Year",
      "Make",
      "Model",
      "Color",
      "Mileage",
      "Days on Lot",
      "Frazer Location",
      "Auction Location",
      "Lot Section",
      "Last Scan",
      "Location Updated",
      "Last Updated",
      "SA Status",
      "Manheim Status",
      "OVE Status",
      "Sold On",
    ];
    const lines = [headers.join(",")];
    for (const r of filtered) {
      const c = costMap.get(r.stock_number) || {};
      const loc = locMap.get(r.stock_number) || {};
      const frazerLabel =
        LOCATION_CODE_MAP[c.location_code] || c.location_code || "";
      const physLabel =
        loc.physical_location && loc.physical_location !== "unknown"
          ? LOCATION_LABELS[loc.physical_location] || loc.physical_location
          : "";
      const lastSeenMs = r.last_seen_at
        ? new Date(r.last_seen_at).getTime()
        : 0;
      const locUpdMs = loc.location_updated_at
        ? new Date(loc.location_updated_at).getTime()
        : 0;
      const lastUpdatedIso =
        lastSeenMs || locUpdMs
          ? new Date(Math.max(lastSeenMs, locUpdMs)).toISOString()
          : null;
      lines.push(
        [
          r.stock_number,
          r.vehicle_vin,
          r.last_6_vin || (r.vehicle_vin || "").slice(-6),
          r.vehicle_year,
          r.vehicle_make,
          r.vehicle_model,
          r.vehicle_color,
          r.mileage,
          r.days_on_lot,
          frazerLabel,
          physLabel,
          r.current_section || "",
          fmtDate(r.last_seen_at),
          fmtDate(loc.location_updated_at),
          fmtDate(lastUpdatedIso),
          loc.sa_status || "",
          loc.manheim_status || "",
          loc.ove_status || "",
          loc.sold_on || "",
        ]
          .map(csvEscape)
          .join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="page">
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => navigate("/")}
          className="p-2 rounded-lg bg-slate-800"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-emerald-400">Inventory</h1>
          <p className="text-sm text-slate-400">
            {rows.length} in stock · sorted by last tracked
          </p>
        </div>
        <button
          onClick={() => navigate("/lot")}
          className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400"
          title="Track Inventory"
        >
          <MapPin size={18} />
        </button>
        <button
          onClick={exportCsv}
          disabled={filtered.length === 0}
          className="p-2 rounded-lg bg-slate-800 text-slate-400 disabled:opacity-40"
          title={`Export ${filtered.length} rows to CSV`}
        >
          <Download size={18} />
        </button>
        <button
          onClick={() => setShowBulkEdit(true)}
          className="p-2 rounded-lg bg-slate-800 text-slate-400 hover:text-emerald-400"
          title="Bulk edit locations"
        >
          <Upload size={18} />
        </button>
        <button
          onClick={load}
          className="p-2 rounded-lg bg-slate-800 text-slate-400"
        >
          <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Stat strip — recomputes for whatever is filtered */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="rounded-lg p-2 bg-slate-800 text-center">
          <div className="text-lg font-bold text-white">{filtered.length}</div>
          <div className="text-[9px] uppercase tracking-wide text-slate-500">
            Cars
          </div>
        </div>
        <div className="rounded-lg p-2 bg-slate-800 text-center">
          <div className="text-lg font-bold text-white">
            {filteredStats.avgDays != null ? `${filteredStats.avgDays}d` : "—"}
          </div>
          <div className="text-[9px] uppercase tracking-wide text-slate-500">
            Avg Age
          </div>
        </div>
        <div className="rounded-lg p-2 bg-slate-800 text-center">
          <div className="text-lg font-bold text-emerald-400">
            {filteredStats.avgAdded != null
              ? toMoney(filteredStats.avgAdded)
              : "—"}
          </div>
          <div className="text-[9px] uppercase tracking-wide text-slate-500">
            Avg Add
          </div>
        </div>
      </div>

      {/* Tab bar — top-level filters */}
      {(() => {
        const stuckCount = rows.filter(
          (r) => r.effective_days_since != null && r.effective_days_since >= 21,
        ).length;
        const missingCount = rows.filter(
          (r) => r.effective_last_seen_ms == null,
        ).length;
        const needsDispatchCount = rows.filter((r) => {
          const c = costMap.get(r.stock_number) || {};
          const loc = locMap.get(r.stock_number) || {};
          return (
            c.location_code === "Z" && !hasBeenLocated(loc.physical_location)
          );
        }).length;
        const frontLotAgingCount = rows.filter((r) => {
          const loc = locMap.get(r.stock_number) || {};
          const daysOnLot = parseInt(r.days_on_lot, 10) || 0;
          return (
            loc.physical_location === "front_lot" && 
            daysOnLot >= 10 &&
            !loc.sa_status
          );
        }).length;
        const isPlaces =
          sectionFilter &&
          ![
            "__stuck21__",
            "__stale__",
            "__never__",
            "__needs_dispatch__",
            "__front_lot_aging__",
          ].includes(sectionFilter);
        const Pill = ({ active, onClick, children }) => (
          <button
            onClick={onClick}
            className={`px-3 py-2 rounded-lg text-xs font-bold flex-shrink-0 ${
              active
                ? "bg-emerald-500 text-slate-900"
                : "bg-slate-800 text-slate-300"
            }`}
          >
            {children}
          </button>
        );
        return (
          <>
            <div className="flex gap-1.5 mb-2 overflow-x-auto">
              <Pill
                active={!sectionFilter}
                onClick={() => setSectionFilter("")}
              >
                All ({rows.length})
              </Pill>
              <Pill
                active={sectionFilter === "__stuck21__"}
                onClick={() => setSectionFilter("__stuck21__")}
              >
                🔴 Stuck ({stuckCount})
              </Pill>
              <Pill
                active={sectionFilter === "__needs_dispatch__"}
                onClick={() => setSectionFilter("__needs_dispatch__")}
              >
                🚛 Needs Dispatch ({needsDispatchCount})
              </Pill>
              <Pill
                active={sectionFilter === "__front_lot_aging__"}
                onClick={() => setSectionFilter("__front_lot_aging__")}
              >
                📅 Front Lot 10d+ ({frontLotAgingCount})
              </Pill>
              <Pill
                active={sectionFilter === "__never__"}
                onClick={() => setSectionFilter("__never__")}
              >
                🟡 Missing ({missingCount})
              </Pill>
              <Pill
                active={isPlaces}
                onClick={() => setSectionFilter(isPlaces ? "" : "__loc_M__")}
              >
                📍 Places
              </Pill>
            </div>
            {isPlaces &&
              (() => {
                // Second-row place chips: big locations (≥5 cars) + Other rollup
                const counts = {};
                for (const r of rows) {
                  const p = locMap.get(r.stock_number)?.physical_location;
                  if (p) counts[p] = (counts[p] || 0) + 1;
                }
                const fixed = [
                  { key: "__loc_M__", label: "Memphis" },
                  { key: "__loc_J__", label: "Jackson" },
                  { key: "__loc_transit__", label: "In Transit" },
                ].map((p) => ({
                  ...p,
                  count: rows.filter((r) => {
                    const c = costMap.get(r.stock_number) || {};
                    if (p.key === "__loc_transit__")
                      return (
                        c.location_code === "Z" ||
                        c.location_code === "X" ||
                        locMap.get(r.stock_number)?.physical_location === "in_transit"
                      );
                    const code = p.key.slice(6, -2);
                    return c.location_code === code;
                  }).length,
                }));
                const bigLocs = Object.keys(counts)
                  .filter((l) => counts[l] >= 5)
                  .sort();
                const smallLocs = Object.keys(counts).filter(
                  (l) => counts[l] < 5,
                );
                const otherCount = smallLocs.reduce((n, l) => n + counts[l], 0);
                return (
                  <div className="flex gap-1.5 mb-3 overflow-x-auto">
                    {fixed
                      .filter((p) => p.count > 0)
                      .map((p) => (
                        <Pill
                          key={p.key}
                          active={sectionFilter === p.key}
                          onClick={() => setSectionFilter(p.key)}
                        >
                          {p.label} ({p.count})
                        </Pill>
                      ))}
                    {bigLocs.map((loc) => (
                      <Pill
                        key={loc}
                        active={sectionFilter === loc}
                        onClick={() => setSectionFilter(loc)}
                      >
                        {formatLocationLabel(loc)} ({counts[loc]})
                      </Pill>
                    ))}
                    {otherCount > 0 && (
                      <Pill
                        active={sectionFilter === "__other_small__"}
                        onClick={() => setSectionFilter("__other_small__")}
                      >
                        Small Lots ({otherCount})
                      </Pill>
                    )}
                  </div>
                );
              })()}
          </>
        );
      })()}
      
      {/* Buyer Filter */}
      <div className="mb-3">
        <select
          value={buyerFilter}
          onChange={(e) => setBuyerFilter(e.target.value)}
          className="w-full px-3 py-2 bg-slate-800 text-white rounded-lg border border-slate-700 focus:border-emerald-400 focus:outline-none text-sm"
        >
          <option value="">All Buyers</option>
          {buyers.map(buyer => (
            <option key={buyer} value={buyer}>{buyer}</option>
          ))}
        </select>
        {buyerFilter && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-slate-400">Filtering by buyer:</span>
            <span className="px-2 py-1 text-xs bg-emerald-500/20 text-emerald-400 rounded">
              {buyerFilter}
            </span>
            <button
              onClick={() => setBuyerFilter("")}
              className="text-xs text-slate-500 hover:text-white"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Vendor / Auction Filter — narrows the current view (incl. Stuck /
          Needs Dispatch) to one vendor or auction source. */}
      <div className="mb-3">
        <select
          value={vendorFilter}
          onChange={(e) => setVendorFilter(e.target.value)}
          className="w-full px-3 py-2 bg-slate-800 text-white rounded-lg border border-slate-700 focus:border-emerald-400 focus:outline-none text-sm"
        >
          <option value="">All Vendors / Auctions</option>
          {vendors.map(vendor => (
            <option key={vendor} value={vendor}>{vendor}</option>
          ))}
        </select>
        {vendorFilter && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-slate-400">Filtering by vendor:</span>
            <span className="px-2 py-1 text-xs bg-emerald-500/20 text-emerald-400 rounded">
              {vendorFilter}
            </span>
            <button
              onClick={() => setVendorFilter("")}
              className="text-xs text-slate-500 hover:text-white"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      <div className="relative mb-4">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
        />
        <input
          type="text"
          placeholder="Search stock, VIN, make, model, buyer..."
          value={search}
          onChange={(e) => setSearch(e.target.value.toUpperCase())}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          className="pl-9"
        />
      </div>

      {/* Warning banners */}
      {!loading &&
        rows.length > 0 &&
        (() => {
          const stuck = rows.filter(
            (r) =>
              r.effective_days_since != null && r.effective_days_since >= 21,
          );
          const never = rows.filter((r) => r.effective_last_seen_ms == null);
          return (
            <div className="mb-3 grid grid-cols-2 gap-2">
              {stuck.length > 0 && (
                <button
                  onClick={() => setSectionFilter("__stuck21__")}
                  className="px-3 py-2 rounded-lg bg-red-500/15 border border-red-500/40 text-left hover:bg-red-500/20"
                >
                  <div className="text-[10px] uppercase tracking-wide text-red-300">
                    Stuck &ge;21d
                  </div>
                  <div className="text-sm font-bold text-red-400">
                    ⚠ {stuck.length} car{stuck.length === 1 ? "" : "s"}
                  </div>
                </button>
              )}
              {never.length > 0 && (
                <button
                  onClick={() => setSectionFilter("__never__")}
                  className="px-3 py-2 rounded-lg bg-slate-700/40 border border-slate-600 text-left hover:bg-slate-700/60"
                >
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">
                    Never Tracked
                  </div>
                  <div className="text-sm font-bold text-slate-300">
                    {never.length} car{never.length === 1 ? "" : "s"}
                  </div>
                </button>
              )}
            </div>
          );
        })()}

      {loading ? (
        <div className="text-center text-slate-400 py-12">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-slate-400 mb-2">No inventory yet</p>
          <p className="text-slate-500 text-xs">
            Waiting for Frazer CSV to land via Power Automate → frazer-ingest
            edge function
          </p>
        </div>
      ) : (
        <>
          <div className="card mb-3 text-center">
            <p className="text-xs text-slate-400">Total Cost (filtered)</p>
            <p className="text-2xl font-bold text-emerald-400">
              {toMoney(totalCost)}
            </p>
          </div>
          <div className="space-y-2">
            {filtered.map((r) => {
              const label = [r.vehicle_year, r.vehicle_make, r.vehicle_model]
                .filter(Boolean)
                .join(" ");
              const c = costMap.get(r.stock_number) || {};
              const loc = locMap.get(r.stock_number) || {};
              
              const cost = toInt(c.total_cost);
              const sl = STALENESS_STYLES[staleness(r.effective_days_since)];
              const physLoc = loc.physical_location;
              const locCode = c.location_code;
              const locUpdated = loc.location_updated_at
                ? new Date(loc.location_updated_at).getTime()
                : (physLoc ? Date.now() : 0); // If we have a physical location but no timestamp, assume it's current
              const scanUpdated = r.last_seen_at
                ? new Date(r.last_seen_at).getTime()
                : 0;
              // If we have a physical location from vehicle_locations, ALWAYS use it
              // Don't care about timestamps or Frazer codes
              const locBadge = (physLoc && physLoc !== "unknown")
                ? LOCATION_COLORS[physLoc] || "bg-slate-600"
                : null;
              // Check if dispatched - prioritize physical location over Frazer code
              const isDispatched = physLoc === "in_transit" || 
                                   (locCode === "X" && physLoc !== "front" && physLoc !== "jackson");
              const frazerLocLabel = LOCATION_CODE_MAP[locCode];
              const isStuck21 =
                r.effective_days_since != null && r.effective_days_since >= 21;
              const isNeverTracked = r.effective_last_seen_ms == null;
              return (
                <div
                  key={r.stock_number}
                  className={`card ${isStuck21 ? "ring-1 ring-red-500/40" : ""}`}
                >
                  <div className="flex justify-between items-start">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-white truncate">
                        {label}
                      </p>
                      <p className="text-xs text-slate-400 font-mono flex items-center gap-1.5">
                        <span>
                          {r.stock_number} ·{" "}
                          {r.last_6_vin || r.vehicle_vin?.slice(-6)}
                        </span>
                        {r.vehicle_vin && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard?.writeText(r.vehicle_vin);
                              const el = e.currentTarget;
                              const orig = el.textContent;
                              el.textContent = "✓";
                              setTimeout(() => {
                                el.textContent = orig;
                              }, 1200);
                            }}
                            className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-emerald-400"
                            title={`Copy full VIN ${r.vehicle_vin}`}
                          >
                            COPY VIN
                          </button>
                        )}
                      </p>
                      <div className="flex gap-2 mt-1 text-xs text-slate-500 flex-wrap items-center">
                        <span>{toInt(r.mileage).toLocaleString()} mi</span>
                        {r.days_on_lot && (
                          <span>· {r.days_on_lot}d on lot</span>
                        )}
                        {/* Only show Frazer code if no physical location or if different from expected */}
                        {locCode && (!physLoc || 
                          (physLoc === "in_transit" && locCode !== "X") || 
                          (physLoc !== "in_transit" && locCode === "Z")) && (
                          <span className="px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 font-bold text-[10px]">
                            {locCode} · {frazerLocLabel || "—"}
                          </span>
                        )}
                        {c.buyer && <span>· {c.buyer}</span>}
                        {c.vendor && (
                          <span className="text-slate-400">· {c.vendor}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${sl.chip}`}
                        >
                          {formatLastSeen(r.effective_days_since)}
                        </span>
                        {isStuck21 && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-red-500 text-white">
                            ⚠ STUCK {r.effective_days_since}d
                          </span>
                        )}
                        {/* Single source of truth for current location:
                             1. Dispatched (Frazer X / physical_location=in_transit) — yellow
                             2. Physical location from chat/list upload — colored badge
                             3. Lot-scan section — gray with MapPin
                             4. Frazer billing code fallback — only shown for codes that
                                imply a confirmed physical location (auction). M/J suppressed
                                when never-tracked so the NEVER TRACKED tag is the only label
                                and the user knows to manually verify. */}
                        {isDispatched ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-yellow-500 text-slate-900">
                            IN TRANSIT
                          </span>
                        ) : locBadge ? (
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full font-bold text-white ${locBadge}`}
                          >
                            {formatLocationLabel(physLoc).toUpperCase()}
                          </span>
                        ) : r.current_section ? (
                          <span className="text-[10px] text-slate-400 truncate">
                            <MapPin size={9} className="inline -mt-0.5" />{" "}
                            {r.current_section}
                          </span>
                        ) : frazerLocLabel &&
                          !(
                            isNeverTracked &&
                            (locCode === "M" || locCode === "J")
                          ) ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-sky-500/20 text-sky-400">
                            {frazerLocLabel}
                          </span>
                        ) : null}
                        {loc.sa_status === "active" && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-purple-500/20 text-purple-400">
                            SA
                          </span>
                        )}
                        {loc.ove_status === "active" && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-orange-500/20 text-orange-400">
                            OVE
                          </span>
                        )}
                        {loc.manheim_status === "active" && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-500/20 text-amber-400">
                            MH
                          </span>
                        )}
                        {loc.sold_on && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-red-500/20 text-red-400">
                            SOLD ({loc.sold_on})
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-3 flex flex-col items-end gap-1">
                      <p className="text-sm font-bold text-emerald-400">
                        {toMoney(cost)}
                      </p>
                      {r.vehicle_color && (
                        <p className="text-[10px] text-slate-500 uppercase">
                          {r.vehicle_color}
                        </p>
                      )}
                      <div className="flex gap-1">
                        {isNeverTracked && (
                          <button
                            onClick={() =>
                              navigate(
                                `/lot?stock=${encodeURIComponent(r.stock_number)}`,
                              )
                            }
                            className="px-2 py-1 rounded-md bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 text-[10px] font-bold"
                            title="Track via lot walk"
                          >
                            TRACK
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setHistoryStock(r.stock_number);
                            setHistoryVin(r.vehicle_vin);
                          }}
                          className="p-1.5 rounded-md bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-blue-400"
                          title="View history"
                        >
                          <History size={12} />
                        </button>
                        <button
                          onClick={() => openLocationEditor(r)}
                          className="p-1.5 rounded-md bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-emerald-400"
                          title="Update location"
                        >
                          <Pencil size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Location editor modal */}
      {editingRow && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
          onClick={(e) => {
            // Only close on direct background click, not during save
            if (e.target === e.currentTarget && !saving) {
              setEditingRow(null);
              setEditLocation("");
              setEditCustom("");
            }
          }}
        >
          <div
            className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-xl p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-emerald-400">
                Update Location
              </h2>
              <button
                onClick={() => {
                  if (!saving) {
                    setEditingRow(null);
                    setEditLocation("");
                    setEditCustom("");
                  }
                }}
                className="text-slate-500 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-xs text-slate-400 mb-1">
              {[
                editingRow.vehicle_year,
                editingRow.vehicle_make,
                editingRow.vehicle_model,
              ]
                .filter(Boolean)
                .join(" ")}
            </p>
            <p className="text-xs text-slate-500 font-mono mb-4">
              {editingRow.stock_number} ·{" "}
              {editingRow.last_6_vin || editingRow.vehicle_vin?.slice(-6)}
              {locMap.get(editingRow.stock_number)?.physical_location && (
                <span className="ml-2 text-slate-400">
                  (currently:{" "}
                  {formatLocationLabel(
                    locMap.get(editingRow.stock_number).physical_location,
                  )}
                  )
                </span>
              )}
            </p>
            <label className="block text-[10px] uppercase tracking-wide text-slate-400 mb-1">
              New Location
            </label>
            <select
              value={editLocation}
              onChange={(e) => setEditLocation(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-emerald-400 focus:outline-none focus:border-emerald-500 mb-2"
              disabled={saving}
            >
              <option value="">— pick one —</option>
              <optgroup label="Memphis">
                <option value="front">Front Lot</option>
                <option value="body_shop">Body Shop</option>
                <option value="mechanic_section">Mechanic</option>
              </optgroup>
              <optgroup label="Jackson">
                <option value="jackson">Jackson</option>
              </optgroup>
              <optgroup label="Auction">
                <option value="uax">UAX</option>
                <option value="daa">DAA</option>
                <option value="adesa">ADESA</option>
                <option value="in_transit">In Transit</option>
              </optgroup>
              <optgroup label="External Shop">
                <option value="pro_auto">Pro Auto</option>
                <option value="summit_tire">Summit Tire</option>
                <option value="tri_state_glass">Tri State Glass</option>
                <option value="upholstery">Upholstery</option>
                <option value="muffler_cs">Muffler C&amp;S</option>
              </optgroup>
              <optgroup label="Dealer">
                <option value="jim_keras_nissan">Jim Keras Nissan</option>
                <option value="jim_keras_chevy_service">
                  Jim Keras Chevy Svc
                </option>
                <option value="city_auto">City Auto</option>
              </optgroup>
              <optgroup label="Other">
                <option value="unknown">Unknown</option>
                <option value="__other__">✏️ Type custom…</option>
              </optgroup>
            </select>
            {editLocation === "__other__" && (
              <input
                type="text"
                value={editCustom}
                onChange={(e) => setEditCustom(e.target.value)}
                placeholder="e.g. Andy's Auto, 901 Sound…"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white mb-2"
                disabled={saving}
              />
            )}
            <div className="flex gap-2 mt-3">
              <button
                onClick={saveLocation}
                disabled={saving || !editLocation}
                className="flex-1 bg-emerald-500 text-slate-900 font-bold py-2 rounded-lg disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                onClick={() => {
                  if (!saving) {
                    setEditingRow(null);
                    setEditLocation("");
                    setEditCustom("");
                  }
                }}
                disabled={saving}
                className="px-4 bg-slate-800 text-slate-300 rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Vehicle History Modal */}
      {historyStock && (
        <VehicleHistoryModal
          stockNumber={historyStock}
          vin={historyVin}
          onClose={() => {
            setHistoryStock(null);
            setHistoryVin(null);
          }}
        />
      )}

      {/* Bulk Location Edit Modal */}
      {showBulkEdit && (
        <BulkLocationEdit
          onClose={() => setShowBulkEdit(false)}
          onSuccess={() => {
            setShowBulkEdit(false);
            load(); // Reload data after bulk update
          }}
        />
      )}
    </div>
  );
}
