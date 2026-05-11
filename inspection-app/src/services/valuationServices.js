// Valuation service config — MMR / Black Book / AutoCheck portal links + API bases.

const NHTSA_API = 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin'

export const SERVICES = {
  mmr: {
    name: 'Manheim MMR',
    short: 'MMR',
    color: 'amber',
    portalUrl: (vin) => `https://mmr.manheim.com/?vin=${vin}`,
    searchUrl: (vin) => `https://www.manheim.com/members/searchresults.do?vin=${vin}`,
    description: 'Wholesale market values',
  },
  bb: {
    name: 'Black Book',
    short: 'BB',
    color: 'emerald',
    portalUrl: (vin) => `https://www.blackbook.com/vin-lookup/?vin=${vin}`,
    searchUrl: () => `https://ivalue.blackbook.com/`,
    description: 'Trade-in & retail book values',
  },
  ac: {
    name: 'AutoCheck',
    short: 'AC',
    color: 'violet',
    portalUrl: (vin) => `https://www.autocheck.com/vehiclehistory/autocheck/en/search-by-vin?vin=${vin}`,
    searchUrl: (vin) => `https://www.autocheck.com/members/?vin=${vin}`,
    description: 'Vehicle history report',
  },
}

// Decode a VIN via the free NHTSA API. Returns a clean object or {} on failure.
export async function decodeVIN(vin) {
  try {
    const resp = await fetch(`${NHTSA_API}/${vin}?format=json`)
    if (!resp.ok) return {}
    const data = await resp.json()
    const results = data.Results || []
    const get = (id) => {
      const item = results.find((r) => r.VariableId === id)
      return item && item.Value && item.Value.trim() ? item.Value.trim() : ''
    }
    return {
      year: get(29) || null,
      make: get(26) || null,
      model: get(28) || null,
      trim: get(38) || null,
      body_class: get(5) || null,
      drive_type: get(15) || null,
      engine_cylinders: get(13) || null,
      engine_displacement: get(11) || null,
      fuel_type: get(24) || null,
      transmission: get(37) || null,
    }
  } catch (err) {
    console.error('[decodeVIN] failed:', err)
    return {}
  }
}

export function isValidVIN(vin) {
  if (!vin || typeof vin !== 'string') return false
  const cleaned = vin.trim().toUpperCase()
  return cleaned.length === 17 && /^[A-HJ-NPR-Z0-9]+$/.test(cleaned)
}
