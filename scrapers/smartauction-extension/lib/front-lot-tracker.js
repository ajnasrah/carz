// Front Lot Aging Tracker for SmartAuction Integration
// Tracks vehicles on front lot (not in location Z) over 10 days old that aren't on SmartAuction

class FrontLotTracker {
    constructor() {
        this.SUPABASE_URL = 'https://yprihgygmreibcuybwoy.supabase.co';
        this.SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlwcmloZ3lnbXJlaWJjdXlid295Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzODYzNTAsImV4cCI6MjA4ODk2MjM1MH0.L1oDMq7wYnyZwjZOYcYhNvrP0I5wFxf5BZPAwRM3m0o';
    }

    // Update SmartAuction status when list is uploaded
    async updateSmartAuctionStatus(stockNumbers) {
        try {
            const updates = stockNumbers.map(stockNumber => ({
                stock_number: stockNumber,
                sa_status: 'active',
                sa_updated_at: new Date().toISOString()
            }));

            const response = await fetch(`${this.SUPABASE_URL}/rest/v1/vehicle_locations`, {
                method: 'POST',
                headers: {
                    'apikey': this.SUPABASE_KEY,
                    'Content-Type': 'application/json',
                    'Prefer': 'resolution=merge-duplicates'
                },
                body: JSON.stringify(updates)
            });

            if (!response.ok) {
                throw new Error(`Failed to update SA status: ${response.statusText}`);
            }

            console.log(`Updated SmartAuction status for ${stockNumbers.length} vehicles`);
            return true;
        } catch (error) {
            console.error('Error updating SmartAuction status:', error);
            return false;
        }
    }

    // Get vehicles on front lot over 10 days old not on SmartAuction
    async getFrontLotAging() {
        try {
            // Calculate date 10 days ago
            const tenDaysAgo = new Date();
            tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
            const tenDaysAgoISO = tenDaysAgo.toISOString();

            // Start from CURRENT inventory, NOT vehicle_locations. The locations
            // table carries thousands of dead historical rows (sold/gone cars,
            // Frazer stock-number reuse) — querying it directly floods the report
            // with ghost cars showing "unknown". Only current, non-transport (Z)
            // inventory can be aging on the front lot.
            const invResp = await fetch(`${this.SUPABASE_URL}/rest/v1/inventory?select=stock_number,vehicle_vin,last_6_vin,vehicle_year,vehicle_make,vehicle_model,location_code,days_on_lot`, {
                headers: { 'apikey': this.SUPABASE_KEY }
            });
            if (!invResp.ok) {
                throw new Error(`Failed to fetch inventory: ${invResp.statusText}`);
            }
            const inventory = await invResp.json();
            const invByStock = new Map(inventory.map(c => [c.stock_number, c]));
            const candidateStocks = inventory
                .filter(c => c.location_code !== 'Z')
                .map(c => c.stock_number);
            if (candidateStocks.length === 0) return [];

            // Fetch the location rows for those stocks only, chunked to keep the
            // .in() URL short. >10 days since last seen, not sold, not on SA.
            const locRows = [];
            for (let i = 0; i < candidateStocks.length; i += 150) {
                const chunk = candidateStocks.slice(i, i + 150);
                const inList = chunk.map(s => `"${s}"`).join(',');
                const query = new URLSearchParams({
                    select: 'stock_number,vin,physical_location,location_updated_at,sa_status,notes',
                    or: '(sa_status.is.null,sa_status.neq.active)',
                    sold_on: 'is.null',
                    location_updated_at: `lte.${tenDaysAgoISO}`
                });
                const resp = await fetch(`${this.SUPABASE_URL}/rest/v1/vehicle_locations?${query}&stock_number=in.(${encodeURIComponent(inList)})`, {
                    headers: { 'apikey': this.SUPABASE_KEY }
                });
                if (!resp.ok) {
                    throw new Error(`Failed to fetch data: ${resp.statusText}`);
                }
                locRows.push(...await resp.json());
            }

            // Locations that are NOT front lot (body shop, sold, wholesale, etc.)
            const excludedLocations = ['transport', 'body_shop', 'sold', 'wholesale', 'arbitrated', 'arb_section'];

            const vehiclesWithAge = locRows
                .filter(v => {
                    const inv = invByStock.get(v.stock_number);
                    if (!inv) return false;                 // ghost row, not current inventory
                    if (inv.location_code === 'Z') return false; // transport
                    const location = (v.physical_location || '').toLowerCase();
                    const isExcluded = excludedLocations.some(loc => location.includes(loc));
                    return !location || !isExcluded;
                })
                .map(v => {
                    const inv = invByStock.get(v.stock_number) || {};
                    const daysOnLot = Math.floor((new Date() - new Date(v.location_updated_at)) / (1000 * 60 * 60 * 24));
                    return {
                        ...v,
                        vin: v.vin || inv.vehicle_vin || '',
                        vehicle_info: `${inv.vehicle_year || ''} ${inv.vehicle_make || ''} ${inv.vehicle_model || ''}`.trim(),
                        days_on_lot: daysOnLot,
                        needs_smartauction: true
                    };
                });

            // Oldest first so the most overdue cars surface at the top
            vehiclesWithAge.sort((a, b) => b.days_on_lot - a.days_on_lot);
            return vehiclesWithAge;
        } catch (error) {
            console.error('Error fetching front lot aging:', error);
            return [];
        }
    }

    // Generate HTML report for display
    generateAgingReport(vehicles) {
        if (!vehicles || vehicles.length === 0) {
            return '<p>No vehicles on front lot over 10 days old without SmartAuction listing.</p>';
        }

        const html = `
            <div class="aging-report">
                <h3>Front Lot Vehicles Over 10 Days (Not on SmartAuction)</h3>
                <p class="summary">Found ${vehicles.length} vehicles needing SmartAuction listing</p>
                <table class="aging-table">
                    <thead>
                        <tr>
                            <th>Stock #</th>
                            <th>Vehicle</th>
                            <th>VIN (Last 6)</th>
                            <th>Location</th>
                            <th>Days on Lot</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${vehicles.map(v => `
                            <tr class="${v.days_on_lot > 30 ? 'critical' : v.days_on_lot > 20 ? 'warning' : ''}">
                                <td class="stock-number">${v.stock_number}</td>
                                <td>${v.vehicle_info || ''}</td>
                                <td>${v.vin ? v.vin.slice(-6) : 'N/A'}</td>
                                <td>${v.physical_location || 'Front Lot'}</td>
                                <td class="days-count">${v.days_on_lot} days</td>
                                <td>
                                    <input type="checkbox" class="select-vehicle" data-stock="${v.stock_number}">
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                <div class="actions">
                    <button id="select-all-aging">Select All</button>
                    <button id="add-to-upload">Add Selected to Upload List</button>
                    <button id="export-aging">Export Report</button>
                </div>
            </div>
            <style>
                .aging-report {
                    margin: 20px 0;
                    padding: 15px;
                    background: #f5f5f5;
                    border-radius: 8px;
                }
                .aging-report h3 {
                    margin: 0 0 10px 0;
                    color: #333;
                }
                .summary {
                    color: #666;
                    margin-bottom: 15px;
                }
                .aging-table {
                    width: 100%;
                    border-collapse: collapse;
                    background: white;
                    border-radius: 4px;
                    overflow: hidden;
                }
                .aging-table th {
                    background: #4CAF50;
                    color: white;
                    padding: 10px;
                    text-align: left;
                }
                .aging-table td {
                    padding: 8px 10px;
                    border-bottom: 1px solid #ddd;
                }
                .aging-table tr:hover {
                    background: #f9f9f9;
                }
                .aging-table tr.warning {
                    background: #fff3cd;
                }
                .aging-table tr.critical {
                    background: #f8d7da;
                }
                .stock-number {
                    font-weight: bold;
                }
                .days-count {
                    font-weight: bold;
                    color: #d9534f;
                }
                .actions {
                    margin-top: 15px;
                    display: flex;
                    gap: 10px;
                }
                .actions button {
                    padding: 8px 16px;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    background: #4CAF50;
                    color: white;
                }
                .actions button:hover {
                    background: #45a049;
                }
                #export-aging {
                    background: #2196F3;
                }
                #export-aging:hover {
                    background: #0b7dda;
                }
            </style>
        `;

        return html;
    }

    // Export report to CSV
    exportToCSV(vehicles) {
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
    }

    // Initialize event listeners
    initEventListeners(container) {
        // Select all checkbox
        container.querySelector('#select-all-aging')?.addEventListener('click', () => {
            const checkboxes = container.querySelectorAll('.select-vehicle');
            const allChecked = Array.from(checkboxes).every(cb => cb.checked);
            checkboxes.forEach(cb => cb.checked = !allChecked);
        });

        // Add to upload list
        container.querySelector('#add-to-upload')?.addEventListener('click', () => {
            const selected = Array.from(container.querySelectorAll('.select-vehicle:checked'))
                .map(cb => cb.dataset.stock);
            
            if (selected.length > 0) {
                // Trigger event to add these vehicles to the main upload list
                window.dispatchEvent(new CustomEvent('addToUploadList', {
                    detail: { stockNumbers: selected }
                }));
                alert(`Added ${selected.length} vehicles to upload list`);
            } else {
                alert('Please select vehicles to add');
            }
        });

        // Export report
        container.querySelector('#export-aging')?.addEventListener('click', async () => {
            const vehicles = await this.getFrontLotAging();
            this.exportToCSV(vehicles);
        });
    }
}

// Export for use in popup.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FrontLotTracker;
}