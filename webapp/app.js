// ============================================================
// CARZ INC - Wholesale Vehicle Lookup App
// ============================================================

let currentVIN = '';
let lookupHistory = JSON.parse(localStorage.getItem('carz_history') || '[]');
let vehicleNotes = JSON.parse(localStorage.getItem('carz_notes') || '{}');
let apiKeys = JSON.parse(localStorage.getItem('carz_api_keys') || '{}');

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
    renderHistory();
    loadApiKeyStatus();

    // Focus VIN input
    document.getElementById('vin-input').focus();

    // Enter key triggers lookup
    document.getElementById('vin-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') lookupVIN();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Ctrl/Cmd + K = focus search
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            document.getElementById('vin-input').focus();
            document.getElementById('vin-input').select();
        }
        // Escape = close modal
        if (e.key === 'Escape') {
            closeSettings();
        }
    });
});

// ===== VIN VALIDATION =====
function isValidVIN(vin) {
    if (!vin || vin.length !== 17) return false;
    // Basic VIN format check (no I, O, Q)
    return /^[A-HJ-NPR-Z0-9]{17}$/i.test(vin);
}

// ===== MAIN LOOKUP =====
async function lookupVIN() {
    const input = document.getElementById('vin-input');
    const vin = input.value.trim().toUpperCase();

    if (!vin) {
        showToast('Enter a VIN to lookup', 'error');
        input.focus();
        return;
    }

    if (!isValidVIN(vin)) {
        showToast('Invalid VIN - must be 17 characters (no I, O, or Q)', 'error');
        input.focus();
        return;
    }

    currentVIN = vin;
    input.value = vin;

    // Show loading in all panels
    showLoading('mmr');
    showLoading('bb');
    showLoading('ac');

    // Decode VIN first (free NHTSA API)
    const vehicleInfo = await decodeVIN(vin);

    // Update panels with portal links + any API data
    updateMMRPanel(vin, vehicleInfo);
    updateBBPanel(vin, vehicleInfo);
    updateACPanel(vin, vehicleInfo);

    // Load saved notes for this VIN
    const notes = vehicleNotes[vin] || '';
    document.getElementById('vehicle-notes').value = notes;

    // Add to history
    addToHistory(vin, vehicleInfo);

    showToast(`Looking up ${vin}`, 'info');
}

// ===== NHTSA VIN DECODE (Free API) =====
async function decodeVIN(vin) {
    try {
        const resp = await fetch(`${NHTSA_API}/${vin}?format=json`);
        const data = await resp.json();

        const results = data.Results || [];
        const get = (id) => {
            const item = results.find(r => r.VariableId === id);
            return item && item.Value && item.Value.trim() ? item.Value.trim() : '';
        };

        const info = {
            year: get(29),
            make: get(26),
            model: get(28),
            trim: get(38),
            bodyClass: get(5),
            driveType: get(15),
            engineCylinders: get(13),
            engineDisplacement: get(11),
            fuelType: get(24),
            transmission: get(37),
            doors: get(14),
            plantCountry: get(75)
        };

        // Update VIN info display
        const vinInfo = document.getElementById('vin-info');
        if (info.year && info.make && info.model) {
            vinInfo.innerHTML = `
                <div class="decoded">${esc(info.year)} ${esc(info.make)} ${esc(info.model)} ${esc(info.trim || '')}</div>
                <div class="decoded-sub">${esc(info.bodyClass || '')} ${info.driveType ? '| ' + esc(info.driveType) : ''} ${info.engineCylinders ? '| ' + esc(info.engineCylinders) + ' Cyl' : ''}</div>
            `;
        }

        return info;
    } catch (err) {
        console.error('VIN decode error:', err);
        return {};
    }
}

// ===== PANEL UPDATES =====
function updateMMRPanel(vin, info) {
    const body = document.getElementById('mmr-body');
    const vehicleLabel = esc(info.year ? `${info.year} ${info.make} ${info.model}` : vin);

    if (apiKeys.mmr) {
        // API mode - fetch real data
        fetchMMRData(vin, body);
    } else {
        // Portal link mode
        body.innerHTML = `
            <div class="value-grid" style="margin-bottom: 16px;">
                <div class="value-row">
                    <div>
                        <div class="value-label">Vehicle</div>
                        <div style="font-weight: 600; margin-top: 4px;">${vehicleLabel}</div>
                    </div>
                    <div style="text-align: right;">
                        <div class="value-label">VIN</div>
                        <div style="font-family: monospace; font-size: 12px; margin-top: 4px;">${vin}</div>
                    </div>
                </div>
            </div>
            <div class="portal-links">
                <a class="portal-link" href="${SERVICES.mmr.portalUrl(vin)}" target="_blank">
                    <span class="link-icon mmr-icon">MMR</span>
                    <div>
                        <div>Open MMR Lookup</div>
                        <div style="font-size: 11px; color: var(--text-dim);">Get wholesale market values</div>
                    </div>
                    <span class="link-arrow">&#8599;</span>
                </a>
                <a class="portal-link" href="${SERVICES.mmr.searchUrl(vin)}" target="_blank">
                    <span class="link-icon mmr-icon">M</span>
                    <div>
                        <div>Search Manheim</div>
                        <div style="font-size: 11px; color: var(--text-dim);">Find active listings</div>
                    </div>
                    <span class="link-arrow">&#8599;</span>
                </a>
            </div>
            <div class="api-status" id="mmr-status" style="margin-top: auto; padding-top: 12px;">
                <span class="status-dot portal"></span>
                <span>Portal Link Mode - Add API key in settings for inline data</span>
            </div>
        `;
    }
}

function updateBBPanel(vin, info) {
    const body = document.getElementById('bb-body');
    const vehicleLabel = esc(info.year ? `${info.year} ${info.make} ${info.model}` : vin);

    if (apiKeys.bb) {
        fetchBBData(vin, body);
    } else {
        body.innerHTML = `
            <div class="value-grid" style="margin-bottom: 16px;">
                <div class="value-row">
                    <div>
                        <div class="value-label">Vehicle</div>
                        <div style="font-weight: 600; margin-top: 4px;">${vehicleLabel}</div>
                    </div>
                    <div style="text-align: right;">
                        <div class="value-label">VIN</div>
                        <div style="font-family: monospace; font-size: 12px; margin-top: 4px;">${vin}</div>
                    </div>
                </div>
            </div>
            <div class="portal-links">
                <a class="portal-link" href="${SERVICES.bb.portalUrl(vin)}" target="_blank">
                    <span class="link-icon bb-icon">BB</span>
                    <div>
                        <div>Open Black Book Lookup</div>
                        <div style="font-size: 11px; color: var(--text-dim);">Get trade-in & retail values</div>
                    </div>
                    <span class="link-arrow">&#8599;</span>
                </a>
                <a class="portal-link" href="${SERVICES.bb.searchUrl(vin)}" target="_blank">
                    <span class="link-icon bb-icon">iV</span>
                    <div>
                        <div>Open iValue Portal</div>
                        <div style="font-size: 11px; color: var(--text-dim);">Dealer Black Book access</div>
                    </div>
                    <span class="link-arrow">&#8599;</span>
                </a>
            </div>
            <div class="api-status" id="bb-status" style="margin-top: auto; padding-top: 12px;">
                <span class="status-dot portal"></span>
                <span>Portal Link Mode - Add API key in settings for inline data</span>
            </div>
        `;
    }
}

function updateACPanel(vin, info) {
    const body = document.getElementById('ac-body');
    const vehicleLabel = esc(info.year ? `${info.year} ${info.make} ${info.model}` : vin);

    if (apiKeys.ac) {
        fetchACData(vin, body);
    } else {
        body.innerHTML = `
            <div class="value-grid" style="margin-bottom: 16px;">
                <div class="value-row">
                    <div>
                        <div class="value-label">Vehicle</div>
                        <div style="font-weight: 600; margin-top: 4px;">${vehicleLabel}</div>
                    </div>
                    <div style="text-align: right;">
                        <div class="value-label">VIN</div>
                        <div style="font-family: monospace; font-size: 12px; margin-top: 4px;">${vin}</div>
                    </div>
                </div>
            </div>
            <div class="portal-links">
                <a class="portal-link" href="${SERVICES.ac.portalUrl(vin)}" target="_blank">
                    <span class="link-icon ac-icon">AC</span>
                    <div>
                        <div>Open AutoCheck Report</div>
                        <div style="font-size: 11px; color: var(--text-dim);">Get full vehicle history</div>
                    </div>
                    <span class="link-arrow">&#8599;</span>
                </a>
                <a class="portal-link" href="https://www.carfax.com/VehicleHistory/p/Report.cfx?vin=${vin}" target="_blank">
                    <span class="link-icon ac-icon">CF</span>
                    <div>
                        <div>Open Carfax Report</div>
                        <div style="font-size: 11px; color: var(--text-dim);">Alternative history report</div>
                    </div>
                    <span class="link-arrow">&#8599;</span>
                </a>
            </div>
            <div class="api-status" id="ac-status" style="margin-top: auto; padding-top: 12px;">
                <span class="status-dot portal"></span>
                <span>Portal Link Mode - Add API key in settings for inline data</span>
            </div>
        `;
    }
}

// ===== API FETCH FUNCTIONS (ready for when keys are added) =====

async function fetchMMRData(vin, container) {
    try {
        // Cox Automotive MMR API call
        // Documentation: https://developer.coxautoinc.com
        const resp = await fetch(`${SERVICES.mmr.apiBase}/values?vin=${vin}`, {
            headers: {
                'Authorization': `Bearer ${apiKeys.mmr}`,
                'Content-Type': 'application/json'
            }
        });

        if (!resp.ok) throw new Error(`MMR API error: ${resp.status}`);
        const data = await resp.json();

        // Parse MMR response and display values
        const mmr = data.mmr || data;
        container.innerHTML = `
            <div class="value-grid">
                <div class="value-row">
                    <span class="value-label">MMR Above Average</span>
                    <div>
                        <span class="value-amount high">$${formatNum(mmr.above_average || mmr.aboveAverage || 0)}</span>
                    </div>
                </div>
                <div class="value-row">
                    <span class="value-label">MMR Average</span>
                    <div>
                        <span class="value-amount mid">$${formatNum(mmr.average || 0)}</span>
                    </div>
                </div>
                <div class="value-row">
                    <span class="value-label">MMR Below Average</span>
                    <div>
                        <span class="value-amount low">$${formatNum(mmr.below_average || mmr.belowAverage || 0)}</span>
                    </div>
                </div>
            </div>
            <div class="api-status" style="margin-top: 12px;">
                <span class="status-dot api"></span>
                <span>Live API Data</span>
            </div>
        `;
    } catch (err) {
        console.error('MMR API error:', err);
        // Fall back to portal mode
        apiKeys.mmr = null;
        updateMMRPanel(vin, {});
        showToast('MMR API error - switched to portal mode', 'error');
    }
}

async function fetchBBData(vin, container) {
    try {
        const resp = await fetch(`${SERVICES.bb.apiBase}/values/vin/${vin}`, {
            headers: {
                'Authorization': `Bearer ${apiKeys.bb}`,
                'Content-Type': 'application/json'
            }
        });

        if (!resp.ok) throw new Error(`Black Book API error: ${resp.status}`);
        const data = await resp.json();

        const values = data.values || data;
        container.innerHTML = `
            <div class="value-grid">
                <div class="value-row">
                    <span class="value-label">Wholesale Extra Clean</span>
                    <div>
                        <span class="value-amount high">$${formatNum(values.wholesale_extra_clean || 0)}</span>
                    </div>
                </div>
                <div class="value-row">
                    <span class="value-label">Wholesale Clean</span>
                    <div>
                        <span class="value-amount mid">$${formatNum(values.wholesale_clean || 0)}</span>
                    </div>
                </div>
                <div class="value-row">
                    <span class="value-label">Wholesale Average</span>
                    <div>
                        <span class="value-amount mid">$${formatNum(values.wholesale_average || 0)}</span>
                    </div>
                </div>
                <div class="value-row">
                    <span class="value-label">Wholesale Rough</span>
                    <div>
                        <span class="value-amount low">$${formatNum(values.wholesale_rough || 0)}</span>
                    </div>
                </div>
            </div>
            <div class="api-status" style="margin-top: 12px;">
                <span class="status-dot api"></span>
                <span>Live API Data</span>
            </div>
        `;
    } catch (err) {
        console.error('Black Book API error:', err);
        apiKeys.bb = null;
        updateBBPanel(vin, {});
        showToast('Black Book API error - switched to portal mode', 'error');
    }
}

async function fetchACData(vin, container) {
    try {
        const resp = await fetch(`${SERVICES.ac.apiBase}/reports/${vin}`, {
            headers: {
                'Authorization': `Bearer ${apiKeys.ac}`,
                'Content-Type': 'application/json'
            }
        });

        if (!resp.ok) throw new Error(`AutoCheck API error: ${resp.status}`);
        const data = await resp.json();

        const report = data.report || data;
        const score = report.score || 0;
        const scoreClass = score >= 80 ? 'good' : score >= 50 ? 'fair' : 'poor';

        container.innerHTML = `
            <div class="score-display">
                <div class="score-circle ${scoreClass}">${score}</div>
                <div class="score-details">
                    <h4>AutoCheck Score</h4>
                    <p>${score >= 80 ? 'Clean history' : score >= 50 ? 'Some concerns' : 'Major issues'}</p>
                </div>
            </div>
            <div class="alert-list">
                ${(report.alerts || []).map(a => `
                    <div class="alert-badge ${esc(a.severity || 'warning')}">
                        ${a.severity === 'clean' ? '&#10003;' : '&#9888;'} ${esc(a.message || '')}
                    </div>
                `).join('')}
                ${(!report.alerts || report.alerts.length === 0) ? '<div class="alert-badge clean">&#10003; No issues found</div>' : ''}
            </div>
            <div class="api-status" style="margin-top: 12px;">
                <span class="status-dot api"></span>
                <span>Live API Data</span>
            </div>
        `;
    } catch (err) {
        console.error('AutoCheck API error:', err);
        apiKeys.ac = null;
        updateACPanel(vin, {});
        showToast('AutoCheck API error - switched to portal mode', 'error');
    }
}

// ===== OPEN IN TAB =====
function openInTab(service) {
    if (!currentVIN) {
        showToast('Enter a VIN first', 'error');
        return;
    }
    const url = SERVICES[service].portalUrl(currentVIN);
    window.open(url, '_blank');
}

// ===== LOADING STATE =====
function showLoading(panel) {
    const body = document.getElementById(`${panel}-body`);
    body.innerHTML = `
        <div class="loading">
            <div class="spinner"></div>
            <span class="loading-text">Looking up vehicle...</span>
        </div>
    `;
}

// ===== HISTORY =====
function addToHistory(vin, info) {
    // Remove if already exists
    lookupHistory = lookupHistory.filter(h => h.vin !== vin);

    // Add to front
    lookupHistory.unshift({
        vin: vin,
        vehicle: info.year ? `${info.year} ${info.make} ${info.model}` : '',
        time: new Date().toISOString()
    });

    // Keep last 20
    lookupHistory = lookupHistory.slice(0, 20);
    localStorage.setItem('carz_history', JSON.stringify(lookupHistory));
    renderHistory();
}

function renderHistory() {
    const container = document.getElementById('lookup-history');
    if (lookupHistory.length === 0) {
        container.innerHTML = '<div class="history-empty">No recent lookups</div>';
        return;
    }

    container.innerHTML = lookupHistory.map(h => `
        <div class="history-item" onclick="quickLookup('${esc(h.vin)}')">
            <div>
                <div class="history-vin">${esc(h.vin)}</div>
                <div class="history-vehicle">${esc(h.vehicle || 'Unknown')}</div>
            </div>
            <span class="history-time">${esc(timeAgo(h.time))}</span>
        </div>
    `).join('');
}

function quickLookup(vin) {
    document.getElementById('vin-input').value = vin;
    lookupVIN();
}

// ===== NOTES =====
function saveNotes() {
    if (!currentVIN) {
        showToast('Look up a VIN first', 'error');
        return;
    }
    const notes = document.getElementById('vehicle-notes').value;
    vehicleNotes[currentVIN] = notes;
    localStorage.setItem('carz_notes', JSON.stringify(vehicleNotes));
    showToast('Notes saved', 'success');
}

function copyAllData() {
    if (!currentVIN) {
        showToast('Look up a VIN first', 'error');
        return;
    }
    const vinInfo = document.getElementById('vin-info').textContent;
    const notes = document.getElementById('vehicle-notes').value;

    const summary = [
        `VIN: ${currentVIN}`,
        vinInfo ? `Vehicle: ${vinInfo.trim()}` : '',
        notes ? `Notes: ${notes}` : '',
        '',
        `MMR: ${SERVICES.mmr.portalUrl(currentVIN)}`,
        `Black Book: ${SERVICES.bb.portalUrl(currentVIN)}`,
        `AutoCheck: ${SERVICES.ac.portalUrl(currentVIN)}`
    ].filter(Boolean).join('\n');

    navigator.clipboard.writeText(summary).then(() => {
        showToast('Summary copied to clipboard', 'success');
    }).catch(() => {
        showToast('Could not copy to clipboard', 'error');
    });
}

// ===== SETTINGS =====
function openSettings() {
    document.getElementById('mmr-api-key').value = apiKeys.mmr || '';
    document.getElementById('bb-api-key').value = apiKeys.bb || '';
    document.getElementById('ac-api-key').value = apiKeys.ac || '';
    document.getElementById('settings-modal').style.display = 'flex';
}

function closeSettings() {
    document.getElementById('settings-modal').style.display = 'none';
}

function saveSettings() {
    apiKeys = {
        mmr: document.getElementById('mmr-api-key').value.trim() || null,
        bb: document.getElementById('bb-api-key').value.trim() || null,
        ac: document.getElementById('ac-api-key').value.trim() || null
    };
    localStorage.setItem('carz_api_keys', JSON.stringify(apiKeys));
    loadApiKeyStatus();
    closeSettings();
    showToast('Settings saved', 'success');

    // Re-lookup if we have a VIN
    if (currentVIN) lookupVIN();
}

function loadApiKeyStatus() {
    ['mmr', 'bb', 'ac'].forEach(service => {
        const statusEl = document.getElementById(`${service}-status`);
        if (statusEl) {
            if (apiKeys[service]) {
                statusEl.innerHTML = '<span class="status-dot api"></span><span>API Connected</span>';
            } else {
                statusEl.innerHTML = '<span class="status-dot portal"></span><span>Portal Link Mode</span>';
            }
        }
    });
}

// ===== CLEAR =====
function clearAll() {
    currentVIN = '';
    document.getElementById('vin-input').value = '';
    document.getElementById('vin-info').innerHTML = '';
    document.getElementById('vehicle-notes').value = '';

    ['mmr', 'bb', 'ac'].forEach(service => {
        const body = document.getElementById(`${service}-body`);
        const colors = { mmr: 'M', bb: 'BB', ac: 'AC' };
        const names = { mmr: 'Manheim Market Report', bb: 'Black Book Values', ac: 'AutoCheck Vehicle History' };
        const subs = { mmr: 'wholesale market values', bb: 'trade-in & retail values', ac: 'history report' };

        body.innerHTML = `
            <div class="panel-placeholder">
                <div class="placeholder-icon">${colors[service]}</div>
                <p>${names[service]}</p>
                <p class="sub">Enter a VIN to get ${subs[service]}</p>
                <div class="api-status" id="${service}-status">
                    <span class="status-dot ${apiKeys[service] ? 'api' : 'portal'}"></span>
                    <span>${apiKeys[service] ? 'API Connected' : 'Portal Link Mode'}</span>
                </div>
            </div>
        `;
    });

    document.getElementById('vin-input').focus();
}

// ===== UTILITIES =====
function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

function formatNum(n) {
    return Number(n).toLocaleString();
}

function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function showToast(msg, type = 'info') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 3000);
}
