// ADESA to SmartAuction Data Bridge
// Converts ADESA scraped data to SmartAuction-compatible format

'use strict';

window.AdesaBridge = {
  
  // Convert ADESA damages to SmartAuction format
  convertDamages: function(adesaDamages) {
    if (!Array.isArray(adesaDamages)) return [];
    
    return adesaDamages.map(damage => {
      // ADESA format: { part, type, severity, panel, damageType }
      // SmartAuction expects: { panel, type, description, chargeable, estimatedCost, category }
      
      // Determine if interior or exterior
      const interiorParts = ['dashboard', 'seat', 'console', 'steering', 'carpet', 'headliner', 'interior'];
      const isInterior = interiorParts.some(part => 
        (damage.part || damage.panel || '').toLowerCase().includes(part)
      );
      
      // Map severity to chargeable
      const severityLower = (damage.severity || '').toLowerCase();
      const isChargeable = severityLower.includes('unacceptable') || 
                          severityLower.includes('replace') || 
                          severityLower.includes('required');
      
      return {
        panel: damage.part || damage.panel || 'Unknown',
        type: damage.type || damage.damageType || 'Damage',
        description: damage.description || `${damage.type} on ${damage.part}`,
        severity: damage.severity || '',
        chargeable: isChargeable ? 'Yes' : 'No',
        estimatedCost: damage.estimatedCost || 0,
        category: isInterior ? 'Interior' : 'Exterior'
      };
    });
  },
  
  // Convert ADESA vehicle data to SmartAuction format
  convertVehicleData: function(adesaData) {
    return {
      vin: adesaData.vin || '',
      year: adesaData.year || '',
      make: adesaData.make || '',
      model: adesaData.model || '',
      mileage: adesaData.odometer || adesaData.mileage || '',
      location: adesaData.location || '',
      seller: adesaData.seller || '',
      currentBid: adesaData.currentBid || '',
      damages: this.convertDamages(adesaData.damages),
      images: adesaData.images || []
    };
  },
  
  // Parse ADESA damage table text (for manual entry)
  parseDamageText: function(text) {
    // Expected format from ADESA:
    // "Tailgate | Prev Repair | Subst Repaired"
    // "Tire - RR | Worn | Replacement Required"
    
    const damages = [];
    const lines = text.split('\n').filter(line => line.trim());
    
    lines.forEach(line => {
      // Try to parse pipe-separated format
      if (line.includes('|')) {
        const parts = line.split('|').map(p => p.trim());
        if (parts.length >= 2) {
          damages.push({
            part: parts[0],
            type: parts[1],
            severity: parts[2] || '',
            description: `${parts[1]} on ${parts[0]}`
          });
        }
      }
      // Try to parse dash-separated format
      else if (line.includes(' - ')) {
        const match = line.match(/^(.+?)\s*-\s*(.+?)(?:\s*-\s*(.+))?$/);
        if (match) {
          damages.push({
            part: match[1],
            type: match[2],
            severity: match[3] || '',
            description: `${match[2]} on ${match[1]}`
          });
        }
      }
    });
    
    return this.convertDamages(damages);
  },
  
  // Load ADESA data into SmartAuction form fields
  loadIntoForm: function(adesaData) {
    const converted = this.convertVehicleData(adesaData);
    
    // Fill VIN
    const vinInput = document.querySelector('#vin6');
    if (vinInput && converted.vin) {
      vinInput.value = converted.vin.slice(-6);
    }
    
    // Fill full VIN
    const fullVinInput = document.querySelector('#fullVin');
    if (fullVinInput && converted.vin) {
      fullVinInput.value = converted.vin;
    }
    
    // Fill mileage
    const mileageInput = document.querySelector('#miles');
    if (mileageInput && converted.mileage) {
      mileageInput.value = converted.mileage;
    }
    
    // Clear existing damages
    const damageContainer = document.querySelector('#damageList');
    if (damageContainer) {
      damageContainer.innerHTML = '';
      
      // Add each damage
      converted.damages.forEach((damage, index) => {
        const damageRow = document.createElement('div');
        damageRow.className = 'damage-row';
        damageRow.innerHTML = `
          <div class="damage-item">
            <strong>${index + 1}. ${damage.panel}</strong> - ${damage.type}
            ${damage.severity ? `<em>(${damage.severity})</em>` : ''}
          </div>
        `;
        damageContainer.appendChild(damageRow);
      });
    }
    
    return converted;
  }
};

// Make available globally
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AdesaBridge;
}