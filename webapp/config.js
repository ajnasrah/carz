// ============================================================
// CARZ INC - Service Configuration
// ============================================================
// Portal URLs for each service. These open in new tabs with
// the VIN pre-filled when possible.
//
// When you get API keys, add them in the app settings (gear icon)
// and the panels will switch from "Portal Link" mode to "API" mode
// showing live data inline.
// ============================================================

const SERVICES = {
    mmr: {
        name: 'Manheim MMR',
        // Manheim MMR lookup URL - opens their site with VIN
        portalUrl: (vin) => `https://mmr.manheim.com/?vin=${vin}`,
        // Alternative: search on main Manheim site
        searchUrl: (vin) => `https://www.manheim.com/members/searchresults.do?vin=${vin}`,
        // Cox Automotive API base (when you have API key)
        apiBase: 'https://api.manheim.com/mmr/v2'
    },
    bb: {
        name: 'Black Book',
        // Black Book VIN lookup
        portalUrl: (vin) => `https://www.blackbook.com/vin-lookup/?vin=${vin}`,
        // Black Book iValue (dealer portal)
        searchUrl: (vin) => `https://ivalue.blackbook.com/`,
        // Black Book API base (when you have API key)
        apiBase: 'https://api.blackbook.com/v2'
    },
    ac: {
        name: 'AutoCheck',
        // AutoCheck VIN lookup
        portalUrl: (vin) => `https://www.autocheck.com/vehiclehistory/autocheck/en/search-by-vin?vin=${vin}`,
        // Experian AutoCheck dealer portal
        searchUrl: (vin) => `https://www.autocheck.com/members/?vin=${vin}`,
        // AutoCheck API base (when you have API key)
        apiBase: 'https://api.autocheck.com/v1'
    }
};

// NHTSA VIN Decoder API (free, no key needed) - for basic vehicle info
const NHTSA_API = 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin';
