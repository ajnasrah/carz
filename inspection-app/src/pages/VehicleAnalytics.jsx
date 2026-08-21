import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase, selectAll } from "../services/supabase";
import { ArrowLeft, Calendar, TrendingUp, Users, DollarSign, Clock, Filter, ChevronDown, BarChart3, Package, Truck, MapPin, Search } from "lucide-react";

export default function VehicleAnalytics({ embedded = false }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [soldData, setSoldData] = useState([]);
  const [inventoryData, setInventoryData] = useState([]);
  const [inspectionData, setInspectionData] = useState([]);
  const [locationData, setLocationData] = useState([]);
  
  // Filter states
  const [selectedMake, setSelectedMake] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedYear, setSelectedYear] = useState("");
  const [mileageRange, setMileageRange] = useState({ min: "", max: "" });
  const [dateRange, setDateRange] = useState({ start: "", end: "" });
  const [selectedBuyer, setSelectedBuyer] = useState("");
  const [selectedVendor, setSelectedVendor] = useState("");
  const [activeTab, setActiveTab] = useState("overview");

  // Unique values for dropdowns
  const [makes, setMakes] = useState([]);
  const [models, setModels] = useState([]);
  const [years, setYears] = useState([]);
  const [buyers, setBuyers] = useState([]);
  const [vendors, setVendors] = useState([]);

  useEffect(() => {
    loadAllData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAllData() {
    setLoading(true);
    try {
      // Inventory takes two calls now. `select("*")` on the table is refused
      // outright since the money columns were revoked, which emptied the whole
      // inventory half of this page rather than just the cost on it —
      // "Current Inventory" read 0 and "Inventory Value" $0. So: the
      // descriptive columns off the table (make/model/year/mileage drive the
      // filters), and the money through inventory_costs(), which hands it to
      // admins and sold-reports users and nulls it for everyone else.
      const [soldRes, inventoryRes, invCostRes, inspectionRes, locationRes] = await Promise.all([
        supabase.from("sold_clean").select("*").order("sale_date", { ascending: false }),
        supabase
          .from("inventory")
          .select("stock_number, vehicle_year, vehicle_make, vehicle_model, vehicle_vin, mileage, days_on_lot"),
        supabase.rpc("inventory_costs"),
        supabase.from("inspections").select("*"),
        selectAll(() => supabase.from("vehicle_locations").select("*"))
      ]);

      if (invCostRes.error)
        console.error("inventory_costs failed — inventory value will read $0:", invCostRes.error);

      const costByStock = new Map(
        (invCostRes.data || []).map((c) => [c.stock_number, c])
      );
      const sold = soldRes.data || [];
      const inventory = (inventoryRes.data || []).map((v) => {
        const c = costByStock.get(v.stock_number);
        return { ...v, total_cost: c?.total_cost ?? null, added_costs: c?.added_costs ?? null };
      });
      const inspections = inspectionRes.data || [];
      const locations = locationRes || [];

      setSoldData(sold);
      setInventoryData(inventory);
      setInspectionData(inspections);
      setLocationData(locations);

      // Extract unique values for filters
      const allVehicles = [...sold, ...inventory];
      
      const uniqueMakes = [...new Set(allVehicles.map(v => v.vehicle_make || v.make).filter(Boolean))].sort();
      const uniqueYears = [...new Set(allVehicles.map(v => v.vehicle_year || v.year).filter(Boolean))].sort((a, b) => b - a);
      const uniqueBuyers = [...new Set(sold.map(v => v.buyer).filter(Boolean))].sort();
      const uniqueVendors = [...new Set(sold.map(v => v.vendor).filter(Boolean))].sort();

      setMakes(uniqueMakes);
      setYears(uniqueYears);
      setBuyers(uniqueBuyers);
      setVendors(uniqueVendors);

      // Set models based on selected make
      updateModels(allVehicles, selectedMake);
    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      setLoading(false);
    }
  }

  function updateModels(vehicles, make) {
    if (make) {
      const filteredModels = [...new Set(
        vehicles
          .filter(v => (v.vehicle_make || v.make) === make)
          .map(v => v.vehicle_model || v.model)
          .filter(Boolean)
      )].sort();
      setModels(filteredModels);
    } else {
      setModels([]);
    }
  }

  // Filter all data based on selected criteria
  const filteredData = useMemo(() => {
    let filtered = {
      sold: [...soldData],
      inventory: [...inventoryData],
      inspections: [...inspectionData],
      locations: [...locationData]
    };

    // Apply make filter
    if (selectedMake) {
      filtered.sold = filtered.sold.filter(v => (v.vehicle_make || v.make) === selectedMake);
      filtered.inventory = filtered.inventory.filter(v => (v.vehicle_make || v.make) === selectedMake);
    }

    // Apply model filter
    if (selectedModel) {
      filtered.sold = filtered.sold.filter(v => (v.vehicle_model || v.model) === selectedModel);
      filtered.inventory = filtered.inventory.filter(v => (v.vehicle_model || v.model) === selectedModel);
    }

    // Apply year filter
    if (selectedYear) {
      filtered.sold = filtered.sold.filter(v => String(v.vehicle_year || v.year) === selectedYear);
      filtered.inventory = filtered.inventory.filter(v => String(v.vehicle_year || v.year) === selectedYear);
    }

    // Apply mileage filter
    if (mileageRange.min || mileageRange.max) {
      const min = parseInt(mileageRange.min) || 0;
      const max = parseInt(mileageRange.max) || Infinity;
      filtered.sold = filtered.sold.filter(v => {
        const miles = parseInt(v.mileage) || 0;
        return miles >= min && miles <= max;
      });
      filtered.inventory = filtered.inventory.filter(v => {
        const miles = parseInt(v.mileage) || 0;
        return miles >= min && miles <= max;
      });
    }

    // Apply date range filter
    if (dateRange.start || dateRange.end) {
      const start = dateRange.start ? new Date(dateRange.start) : new Date(0);
      const end = dateRange.end ? new Date(dateRange.end) : new Date();
      
      filtered.sold = filtered.sold.filter(v => {
        const saleDate = v.sale_date ? new Date(v.sale_date) : null;
        return saleDate && saleDate >= start && saleDate <= end;
      });
    }

    // Apply buyer filter
    if (selectedBuyer) {
      filtered.sold = filtered.sold.filter(v => v.buyer === selectedBuyer);
    }

    // Apply vendor filter
    if (selectedVendor) {
      filtered.sold = filtered.sold.filter(v => v.vendor === selectedVendor);
    }

    // Match inspections and locations by VIN/stock
    const soldStocks = new Set(filtered.sold.map(v => v.stock_number).filter(Boolean));
    const inventoryStocks = new Set(filtered.inventory.map(v => v.stock_number).filter(Boolean));
    const allStocks = new Set([...soldStocks, ...inventoryStocks]);
    
    filtered.inspections = filtered.inspections.filter(i => 
      allStocks.has(i.stock_number) || 
      [...allStocks].some(s => s && i.vin_last6 && s.includes(i.vin_last6))
    );
    
    filtered.locations = filtered.locations.filter(l => allStocks.has(l.stock_number));

    return filtered;
  }, [soldData, inventoryData, inspectionData, locationData, 
      selectedMake, selectedModel, selectedYear, mileageRange, 
      dateRange, selectedBuyer, selectedVendor]);

  // Calculate metrics
  const metrics = useMemo(() => {
    const sold = filteredData.sold;
    const inventory = filteredData.inventory;
    
    // Sales metrics
    const totalSold = sold.length;
    const totalRevenue = sold.reduce((sum, v) => sum + (parseFloat(v.sales_price) || 0), 0);
    const totalProfit = sold.reduce((sum, v) => sum + (parseFloat(v.profit_on_sale) || 0), 0);
    const avgProfit = totalSold > 0 ? totalProfit / totalSold : 0;
    const avgSalePrice = totalSold > 0 ? totalRevenue / totalSold : 0;
    
    // Time metrics
    const avgDaysToSell = sold.reduce((sum, v) => {
      const days = parseInt(v.days_on_lot) || 0;
      return sum + days;
    }, 0) / (totalSold || 1);
    
    // Inventory metrics
    const currentInventory = inventory.length;
    const inventoryValue = inventory.reduce((sum, v) => {
      const cost = parseFloat(v.total_cost) || 0;
      const added = parseFloat(v.added_costs) || 0;
      return sum + cost + added;
    }, 0);
    
    // Performance by time period
    const last30Days = new Date();
    last30Days.setDate(last30Days.getDate() - 30);
    const last30DaysSales = sold.filter(v => 
      v.sale_date && new Date(v.sale_date) >= last30Days
    );
    
    // Buyer performance
    const buyerStats = {};
    sold.forEach(v => {
      if (v.buyer) {
        if (!buyerStats[v.buyer]) {
          buyerStats[v.buyer] = { count: 0, revenue: 0, profit: 0 };
        }
        buyerStats[v.buyer].count++;
        buyerStats[v.buyer].revenue += parseFloat(v.sales_price) || 0;
        buyerStats[v.buyer].profit += parseFloat(v.profit_on_sale) || 0;
      }
    });
    
    // Vendor performance
    const vendorStats = {};
    sold.forEach(v => {
      if (v.vendor) {
        if (!vendorStats[v.vendor]) {
          vendorStats[v.vendor] = { count: 0, cost: 0, profit: 0 };
        }
        vendorStats[v.vendor].count++;
        vendorStats[v.vendor].cost += parseFloat(v.total_cost) || 0;
        vendorStats[v.vendor].profit += parseFloat(v.profit_on_sale) || 0;
      }
    });

    return {
      totalSold,
      totalRevenue,
      totalProfit,
      avgProfit,
      avgSalePrice,
      avgDaysToSell,
      currentInventory,
      inventoryValue,
      last30DaysSales: last30DaysSales.length,
      last30DaysRevenue: last30DaysSales.reduce((sum, v) => sum + (parseFloat(v.sales_price) || 0), 0),
      buyerStats,
      vendorStats
    };
  }, [filteredData]);

  // Format currency
  const formatMoney = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-slate-400">Loading analytics data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white safe-top">
      <div className="max-w-7xl mx-auto p-4">
        {/* Header */}
        {!embedded && (
          <div className="mb-6">
            <button
              onClick={() => navigate('/reports')}
              aria-label="Back to reports"
              className="flex items-center gap-1 mb-2 -ml-2 p-2 rounded-lg text-slate-300 active:bg-slate-800 text-sm"
            >
              <ArrowLeft size={18} /> Reports
            </button>
            <h1 className="text-3xl font-bold mb-2">Vehicle Analytics</h1>
            <p className="text-slate-400">Comprehensive analysis of vehicle performance, sales, and operations</p>
          </div>
        )}

        {/* Filter Panel */}
        <div className="bg-slate-800 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="text-blue-400" size={20} />
            <h2 className="text-lg font-semibold">Filters</h2>
            <button
              onClick={() => {
                setSelectedMake("");
                setSelectedModel("");
                setSelectedYear("");
                setMileageRange({ min: "", max: "" });
                setDateRange({ start: "", end: "" });
                setSelectedBuyer("");
                setSelectedVendor("");
              }}
              className="ml-auto px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
            >
              Clear All
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {/* Make Dropdown */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">Make</label>
              <select
                value={selectedMake}
                onChange={(e) => {
                  setSelectedMake(e.target.value);
                  setSelectedModel("");
                  updateModels([...soldData, ...inventoryData], e.target.value);
                }}
                className="w-full px-3 py-2 bg-slate-700 rounded-lg border border-slate-600 focus:border-blue-400 focus:outline-none"
              >
                <option value="">All Makes</option>
                {makes.map(make => (
                  <option key={make} value={make}>{make}</option>
                ))}
              </select>
            </div>

            {/* Model Dropdown */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">Model</label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                disabled={!selectedMake}
                className="w-full px-3 py-2 bg-slate-700 rounded-lg border border-slate-600 focus:border-blue-400 focus:outline-none disabled:opacity-50"
              >
                <option value="">All Models</option>
                {models.map(model => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
            </div>

            {/* Year Dropdown */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">Year</label>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="w-full px-3 py-2 bg-slate-700 rounded-lg border border-slate-600 focus:border-blue-400 focus:outline-none"
              >
                <option value="">All Years</option>
                {years.map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </div>

            {/* Mileage Range */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">Mileage Range</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="Min"
                  value={mileageRange.min}
                  onChange={(e) => setMileageRange({ ...mileageRange, min: e.target.value })}
                  className="w-1/2 px-2 py-2 bg-slate-700 rounded-lg border border-slate-600 focus:border-blue-400 focus:outline-none"
                />
                <input
                  type="number"
                  placeholder="Max"
                  value={mileageRange.max}
                  onChange={(e) => setMileageRange({ ...mileageRange, max: e.target.value })}
                  className="w-1/2 px-2 py-2 bg-slate-700 rounded-lg border border-slate-600 focus:border-blue-400 focus:outline-none"
                />
              </div>
            </div>

            {/* Date Range */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">Sale Date Range</label>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={dateRange.start}
                  onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                  className="w-1/2 px-2 py-2 bg-slate-700 rounded-lg border border-slate-600 focus:border-blue-400 focus:outline-none text-sm"
                />
                <input
                  type="date"
                  value={dateRange.end}
                  onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                  className="w-1/2 px-2 py-2 bg-slate-700 rounded-lg border border-slate-600 focus:border-blue-400 focus:outline-none text-sm"
                />
              </div>
            </div>

            {/* Buyer Dropdown */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">Buyer</label>
              <select
                value={selectedBuyer}
                onChange={(e) => setSelectedBuyer(e.target.value)}
                className="w-full px-3 py-2 bg-slate-700 rounded-lg border border-slate-600 focus:border-blue-400 focus:outline-none"
              >
                <option value="">All Buyers</option>
                {buyers.map(buyer => (
                  <option key={buyer} value={buyer}>{buyer}</option>
                ))}
              </select>
            </div>

            {/* Vendor Dropdown */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">Vendor</label>
              <select
                value={selectedVendor}
                onChange={(e) => setSelectedVendor(e.target.value)}
                className="w-full px-3 py-2 bg-slate-700 rounded-lg border border-slate-600 focus:border-blue-400 focus:outline-none"
              >
                <option value="">All Vendors</option>
                {vendors.map(vendor => (
                  <option key={vendor} value={vendor}>{vendor}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Active Filters Display */}
          {(selectedMake || selectedModel || selectedYear || mileageRange.min || mileageRange.max || dateRange.start || dateRange.end || selectedBuyer || selectedVendor) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {selectedMake && (
                <span className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-sm">
                  Make: {selectedMake}
                </span>
              )}
              {selectedModel && (
                <span className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-sm">
                  Model: {selectedModel}
                </span>
              )}
              {selectedYear && (
                <span className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-sm">
                  Year: {selectedYear}
                </span>
              )}
              {(mileageRange.min || mileageRange.max) && (
                <span className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-sm">
                  Miles: {mileageRange.min || "0"} - {mileageRange.max || "∞"}
                </span>
              )}
              {selectedBuyer && (
                <span className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-sm">
                  Buyer: {selectedBuyer}
                </span>
              )}
              {selectedVendor && (
                <span className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-sm">
                  Vendor: {selectedVendor}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Metrics Overview */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-slate-800 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-400 text-sm">Total Sold</span>
              <Package className="text-green-400" size={20} />
            </div>
            <div className="text-2xl font-bold">{metrics.totalSold}</div>
            <div className="text-xs text-slate-500">Last 30d: {metrics.last30DaysSales}</div>
          </div>

          <div className="bg-slate-800 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-400 text-sm">Revenue</span>
              <DollarSign className="text-blue-400" size={20} />
            </div>
            <div className="text-2xl font-bold">{formatMoney(metrics.totalRevenue)}</div>
            <div className="text-xs text-slate-500">Avg: {formatMoney(metrics.avgSalePrice)}</div>
          </div>

          <div className="bg-slate-800 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-400 text-sm">Profit</span>
              <TrendingUp className="text-emerald-400" size={20} />
            </div>
            <div className="text-2xl font-bold">{formatMoney(metrics.totalProfit)}</div>
            <div className="text-xs text-slate-500">Avg: {formatMoney(metrics.avgProfit)}</div>
          </div>

          <div className="bg-slate-800 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-400 text-sm">Avg Days to Sell</span>
              <Clock className="text-orange-400" size={20} />
            </div>
            <div className="text-2xl font-bold">{Math.round(metrics.avgDaysToSell)}d</div>
            <div className="text-xs text-slate-500">In Stock: {metrics.currentInventory}</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-slate-800 rounded-lg">
          <div className="flex border-b border-slate-700">
            {["overview", "sales", "buyers", "vendors", "locations", "timeline"].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-3 capitalize font-medium transition-colors ${
                  activeTab === tab 
                    ? "text-blue-400 border-b-2 border-blue-400" 
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="p-4">
            {/* Overview Tab */}
            {activeTab === "overview" && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold mb-3">Performance Summary</h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Top Performing Vehicles */}
                  <div className="bg-slate-700/50 rounded-lg p-4">
                    <h4 className="font-medium mb-3 text-blue-400">Top Performing Vehicles</h4>
                    <div className="space-y-2">
                      {Object.entries(
                        filteredData.sold.reduce((acc, v) => {
                          const key = `${v.vehicle_year} ${v.vehicle_make} ${v.vehicle_model}`;
                          if (!acc[key]) acc[key] = { count: 0, profit: 0, days: 0 };
                          acc[key].count++;
                          acc[key].profit += parseFloat(v.profit_on_sale) || 0;
                          acc[key].days += parseInt(v.days_on_lot) || 0;
                          return acc;
                        }, {})
                      )
                        .map(([vehicle, stats]) => ({
                          vehicle,
                          ...stats,
                          avgProfit: stats.profit / stats.count,
                          avgDays: stats.days / stats.count
                        }))
                        .sort((a, b) => b.avgProfit - a.avgProfit)
                        .slice(0, 5)
                        .map(item => (
                          <div key={item.vehicle} className="flex justify-between text-sm">
                            <span className="text-slate-300">{item.vehicle}</span>
                            <div className="text-right">
                              <span className="text-green-400">{formatMoney(item.avgProfit)}</span>
                              <span className="text-slate-500 ml-2">({item.count} sold)</span>
                            </div>
                          </div>
                        ))
                      }
                    </div>
                  </div>

                  {/* Current Inventory Status */}
                  <div className="bg-slate-700/50 rounded-lg p-4">
                    <h4 className="font-medium mb-3 text-blue-400">Current Inventory</h4>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-300">Total Units</span>
                        <span className="text-white font-medium">{metrics.currentInventory}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-300">Total Value</span>
                        <span className="text-white font-medium">{formatMoney(metrics.inventoryValue)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-300">Inspected</span>
                        <span className="text-white font-medium">{filteredData.inspections.length}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-300">Ready for Sale</span>
                        <span className="text-white font-medium">
                          {filteredData.inventory.filter(v => 
                            filteredData.inspections.some(i => i.stock_number === v.stock_number && i.completed_at)
                          ).length}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Sales Tab */}
            {activeTab === "sales" && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold mb-3">Sales Details</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left border-b border-slate-700">
                        <th className="pb-2 text-slate-400">Stock #</th>
                        <th className="pb-2 text-slate-400">Vehicle</th>
                        <th className="pb-2 text-slate-400">Sale Date</th>
                        <th className="pb-2 text-slate-400">Days on Lot</th>
                        <th className="pb-2 text-slate-400">Cost</th>
                        <th className="pb-2 text-slate-400">Sale Price</th>
                        <th className="pb-2 text-slate-400">Profit</th>
                        <th className="pb-2 text-slate-400">ROI</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredData.sold.slice(0, 20).map(sale => {
                        const cost = (parseFloat(sale.total_cost) || 0);
                        const roi = cost > 0 ? ((parseFloat(sale.profit_on_sale) || 0) / cost * 100) : 0;
                        
                        return (
                          <tr key={sale.stock_number} className="border-b border-slate-700/50">
                            <td className="py-2">{sale.stock_number}</td>
                            <td className="py-2">
                              {sale.vehicle_year} {sale.vehicle_make} {sale.vehicle_model}
                            </td>
                            <td className="py-2">
                              {sale.sale_date ? new Date(sale.sale_date).toLocaleDateString() : "—"}
                            </td>
                            <td className="py-2">{sale.days_on_lot || "—"}</td>
                            <td className="py-2">{formatMoney(cost)}</td>
                            <td className="py-2">{formatMoney(parseFloat(sale.sales_price) || 0)}</td>
                            <td className="py-2">
                              <span className={parseFloat(sale.profit_on_sale) >= 0 ? "text-green-400" : "text-red-400"}>
                                {formatMoney(parseFloat(sale.profit_on_sale) || 0)}
                              </span>
                            </td>
                            <td className="py-2">
                              <span className={roi >= 0 ? "text-green-400" : "text-red-400"}>
                                {roi.toFixed(1)}%
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Buyers Tab */}
            {activeTab === "buyers" && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold mb-3">Buyer Performance</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Object.entries(metrics.buyerStats)
                    .sort((a, b) => b[1].profit - a[1].profit)
                    .map(([buyer, stats]) => (
                      <div key={buyer} className="bg-slate-700/50 rounded-lg p-4">
                        <h4 className="font-medium mb-2">{buyer}</h4>
                        <div className="space-y-1 text-sm">
                          <div className="flex justify-between">
                            <span className="text-slate-400">Units Sold</span>
                            <span>{stats.count}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Revenue</span>
                            <span>{formatMoney(stats.revenue)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Profit</span>
                            <span className="text-green-400">{formatMoney(stats.profit)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Avg Profit</span>
                            <span>{formatMoney(stats.profit / stats.count)}</span>
                          </div>
                        </div>
                      </div>
                    ))
                  }
                </div>
              </div>
            )}

            {/* Vendors Tab */}
            {activeTab === "vendors" && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold mb-3">Vendor Performance</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Object.entries(metrics.vendorStats)
                    .sort((a, b) => b[1].profit - a[1].profit)
                    .map(([vendor, stats]) => (
                      <div key={vendor} className="bg-slate-700/50 rounded-lg p-4">
                        <h4 className="font-medium mb-2">{vendor}</h4>
                        <div className="space-y-1 text-sm">
                          <div className="flex justify-between">
                            <span className="text-slate-400">Units Sold</span>
                            <span>{stats.count}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Avg Cost</span>
                            <span>{formatMoney(stats.cost / stats.count)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Total Profit</span>
                            <span className="text-green-400">{formatMoney(stats.profit)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Avg Profit</span>
                            <span>{formatMoney(stats.profit / stats.count)}</span>
                          </div>
                        </div>
                      </div>
                    ))
                  }
                </div>
              </div>
            )}

            {/* Locations Tab */}
            {activeTab === "locations" && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold mb-3">Vehicle Locations</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Object.entries(
                    filteredData.locations.reduce((acc, loc) => {
                      const place = loc.physical_location || "Unknown";
                      if (!acc[place]) acc[place] = { count: 0, stocks: [] };
                      acc[place].count++;
                      acc[place].stocks.push(loc.stock_number);
                      return acc;
                    }, {})
                  )
                    .sort((a, b) => b[1].count - a[1].count)
                    .map(([location, data]) => (
                      <div key={location} className="bg-slate-700/50 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-medium">{location}</h4>
                          <MapPin className="text-slate-400" size={16} />
                        </div>
                        <div className="text-2xl font-bold mb-1">{data.count}</div>
                        <div className="text-xs text-slate-400">vehicles</div>
                      </div>
                    ))
                  }
                </div>
              </div>
            )}

            {/* Timeline Tab */}
            {activeTab === "timeline" && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold mb-3">Sales Timeline</h3>
                <div className="space-y-2">
                  {Object.entries(
                    filteredData.sold.reduce((acc, sale) => {
                      if (sale.sale_date) {
                        const month = sale.sale_date.substring(0, 7);
                        if (!acc[month]) acc[month] = { count: 0, revenue: 0, profit: 0 };
                        acc[month].count++;
                        acc[month].revenue += parseFloat(sale.sales_price) || 0;
                        acc[month].profit += parseFloat(sale.profit_on_sale) || 0;
                      }
                      return acc;
                    }, {})
                  )
                    .sort((a, b) => b[0].localeCompare(a[0]))
                    .slice(0, 12)
                    .map(([month, stats]) => (
                      <div key={month} className="bg-slate-700/50 rounded-lg p-4">
                        <div className="flex justify-between items-center">
                          <div>
                            <h4 className="font-medium">{new Date(month + "-01").toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h4>
                            <div className="text-sm text-slate-400 mt-1">
                              {stats.count} vehicles sold
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-bold">{formatMoney(stats.revenue)}</div>
                            <div className="text-sm text-green-400">
                              Profit: {formatMoney(stats.profit)}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  }
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}