// Fix for UAX/DAA/ADESA vehicles showing as "Front Lot"
// This patch updates the Smart Auction extension to properly handle auction locations

// Add this function to the extension's popup.js or create as a separate module

function getDisplayLocation(vehicleData) {
  // Check physical_location first (from vehicle_locations table)
  const physicalLoc = vehicleData.physical_location;
  const physicalSrc = vehicleData.physical_source;
  const locationCode = vehicleData.location_code;
  
  // Priority 1: Auction locations (UAX, DAA, ADESA)
  if (physicalLoc === 'uax') return 'UAX';
  if (physicalLoc === 'daa') return 'DAA';
  if (physicalLoc === 'adesa') return 'ADESA';
  
  // Priority 2: In transit
  if (physicalLoc === 'in_transit') return 'In Transit';
  
  // Priority 3: Chat-based locations (mechanic, body shop, etc)
  if (physicalLoc === 'mechanic') return 'Mechanic';
  if (physicalLoc === 'body_shop') return 'Jorge (Body Shop)';
  if (physicalLoc === 'detail') return 'Ready / Detail';
  if (physicalLoc === 'seller_group') return 'Seller Group';
  
  // Priority 4: Location codes from Frazer
  const LOC_CODES = {
    'M': 'Memphis',
    'J': 'Jackson', 
    'Z': 'Transport',
    'X': 'Dispatched',
    'A': 'Auction',
    'F': 'Front Lot',
    'R': 'Ready / Detail',
    'W': 'Waiting On Parts',
    'S': 'Sold Lot'
  };
  
  if (locationCode && LOC_CODES[locationCode]) {
    return LOC_CODES[locationCode];
  }
  
  // Priority 5: Unknown location
  if (physicalLoc === 'unknown' || !physicalLoc) {
    // If we have a location code, use Front Lot as default
    if (locationCode) return 'Front Lot';
    // Otherwise mark as unknown
    return 'Unknown Location';
  }
  
  // Priority 6: Use physical_location as-is if not mapped
  if (physicalLoc) return physicalLoc;
  
  // Final fallback
  return 'Front Lot';
}

// Export for use in the extension
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getDisplayLocation };
}

// Usage example:
// When displaying vehicle info in the extension, use:
// const displayLoc = getDisplayLocation(vehicleData);
// Instead of defaulting to 'Front Lot'