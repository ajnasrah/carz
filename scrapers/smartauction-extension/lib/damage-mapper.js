// Damage Mapper — Maps AI damage output to SmartAuction dropdown values
if (typeof DamageMapper === 'undefined') {

'use strict';

var DamageMapper = {
  // ── SmartAuction Vehicle Entry Damage Types ──
  // These are the known dropdown values in SA's condition section
  SA_DAMAGE_TYPES: [
    'Dent', 'Scratch', 'Scuff', 'Paint Chip', 'Paint Damage',
    'Crack', 'Broken', 'Missing', 'Rust', 'Corrosion',
    'Tear', 'Stain', 'Burn', 'Worn', 'Faded',
    'Hail Damage', 'Water Damage', 'Other'
  ],

  // ── VIW/DirectInspect Damage Types ──
  VIW_DAMAGE_TYPES: [
    'Dent', 'Scratch', 'Scuff', 'Chip', 'Crack',
    'Rust', 'Tear', 'Stain', 'Burn', 'Worn',
    'Broken', 'Missing', 'Bent', 'Faded', 'Discolored',
    'Hail', 'Other'
  ],

  // ── Panel / Location mapping ──
  // AI might say "Front Bumper" but SA dropdown might say "Bumper - Front"
  PANEL_MAP: {
    // AI output → SmartAuction value
    'front bumper':         'Bumper - Front',
    'rear bumper':          'Bumper - Rear',
    'hood':                 'Hood',
    'roof':                 'Roof',
    'trunk':                'Trunk Lid',
    'trunk lid':            'Trunk Lid',
    'driver door':          'Door - Driver Front',
    'driver front door':    'Door - Driver Front',
    'driver rear door':     'Door - Driver Rear',
    'passenger door':       'Door - Passenger Front',
    'passenger front door': 'Door - Passenger Front',
    'passenger rear door':  'Door - Passenger Rear',
    'left front door':      'Door - Driver Front',
    'left rear door':       'Door - Driver Rear',
    'right front door':     'Door - Passenger Front',
    'right rear door':      'Door - Passenger Rear',
    'left fender':          'Fender - Left Front',
    'left front fender':    'Fender - Left Front',
    'right fender':         'Fender - Right Front',
    'right front fender':   'Fender - Right Front',
    'left quarter panel':   'Quarter Panel - Left',
    'left rear quarter':    'Quarter Panel - Left',
    'right quarter panel':  'Quarter Panel - Right',
    'right rear quarter':   'Quarter Panel - Right',
    'left rocker panel':    'Rocker Panel - Left',
    'right rocker panel':   'Rocker Panel - Right',
    'windshield':           'Windshield',
    'rear window':          'Rear Window',
    'left mirror':          'Mirror - Left',
    'right mirror':         'Mirror - Right',
    'left headlight':       'Headlight - Left',
    'right headlight':      'Headlight - Right',
    'left taillight':       'Taillight - Left',
    'right taillight':      'Taillight - Right',
    'grille':               'Grille',
    'front grille':         'Grille',
    'left wheel':           'Wheel - Left Front',
    'right wheel':          'Wheel - Right Front',
    'interior':             'Interior',
    'dashboard':            'Dashboard',
    'steering wheel':       'Steering Wheel',
    'driver seat':          'Seat - Driver',
    'passenger seat':       'Seat - Passenger',
    'rear seat':            'Seat - Rear',
    'headliner':            'Headliner',
    'carpet':               'Carpet/Floor',
    'console':              'Console',
    'tailgate':             'Tailgate',

    // Manheim CR abbreviations
    'f bumper':             'Bumper - Front',
    'f bumper cover':       'Bumper - Front',
    'f bumper cover lower': 'Bumper - Front',
    'f bumper cover upper': 'Bumper - Front',
    'r bumper':             'Bumper - Rear',
    'r bumper cover':       'Bumper - Rear',
    'r bumper cover lower': 'Bumper - Rear',
    'r bumper cover upper': 'Bumper - Rear',
    'lf door':              'Door - Driver Front',
    'lr door':              'Door - Driver Rear',
    'rf door':              'Door - Passenger Front',
    'rr door':              'Door - Passenger Rear',
    'l door':               'Door - Driver Front',
    'r door':               'Door - Passenger Front',
    'lf fender':            'Fender - Left Front',
    'rf fender':            'Fender - Right Front',
    'l fender':             'Fender - Left Front',
    'r fender':             'Fender - Right Front',
    'l qtr panel':          'Quarter Panel - Left',
    'r qtr panel':          'Quarter Panel - Right',
    'lf wheel':             'Wheel - Left Front',
    'rf wheel':             'Wheel - Right Front',
    'lr wheel':             'Wheel - Left Rear',
    'rr wheel':             'Wheel - Right Rear',
    'l rocker':             'Rocker Panel - Left',
    'r rocker':             'Rocker Panel - Right',
    'l mirror':             'Mirror - Left',
    'r mirror':             'Mirror - Right',
    'l headlamp':           'Headlight - Left',
    'r headlamp':           'Headlight - Right',
    'l taillamp':           'Taillight - Left',
    'r taillamp':           'Taillight - Right',
    'r headlight':          'Headlight - Right',
    'l headlight':          'Headlight - Left',
    'front bumper':         'Bumper - Front',
    'deck lid':             'Trunk Lid',
    'f tow hook cover':     'Bumper - Front',
    'r qtr panel':          'Quarter Panel - Right',
    'l qtr panel':          'Quarter Panel - Left'
  },

  // ── VIW Panel mapping (VIW uses slightly different labels) ──
  VIW_PANEL_MAP: {
    'front bumper':         'Front Bumper',
    'rear bumper':          'Rear Bumper',
    'hood':                 'Hood',
    'roof':                 'Roof',
    'trunk':                'Deck Lid/Trunk',
    'trunk lid':            'Deck Lid/Trunk',
    'driver door':          'Left Front Door',
    'driver front door':    'Left Front Door',
    'driver rear door':     'Left Rear Door',
    'passenger door':       'Right Front Door',
    'passenger front door': 'Right Front Door',
    'passenger rear door':  'Right Rear Door',
    'left front door':      'Left Front Door',
    'left rear door':       'Left Rear Door',
    'right front door':     'Right Front Door',
    'right rear door':      'Right Rear Door',
    'left fender':          'Left Front Fender',
    'left front fender':    'Left Front Fender',
    'right fender':         'Right Front Fender',
    'right front fender':   'Right Front Fender',
    'left quarter panel':   'Left Rear Quarter',
    'left rear quarter':    'Left Rear Quarter',
    'right quarter panel':  'Right Rear Quarter',
    'right rear quarter':   'Right Rear Quarter',
    'left rocker panel':    'Left Rocker',
    'right rocker panel':   'Right Rocker',
    'windshield':           'Windshield',
    'rear window':          'Rear Glass',
    'left mirror':          'Left Mirror',
    'right mirror':         'Right Mirror',
    'left headlight':       'Left Headlamp',
    'right headlight':      'Right Headlamp',
    'left taillight':       'Left Taillamp',
    'right taillight':      'Right Taillamp',
    'grille':               'Grille',
    'tailgate':             'Tailgate'
  },

  // ── Type Normalization ──
  // Maps various AI damage type outputs to the closest SA/VIW dropdown value
  TYPE_NORMALIZE: {
    'scratch':              'Scratch',
    'scratches':            'Scratch',
    'scuff':                'Scuff',
    'scuffed':              'Scuff',
    'dent':                 'Dent',
    'dented':               'Dent',
    'ding':                 'Dent',
    'paint chip':           'Paint Chip',
    'chip':                 'Chip',
    'chipped':              'Chip',
    'crack':                'Crack',
    'cracked':              'Crack',
    'rust':                 'Rust',
    'rusted':               'Rust',
    'corrosion':            'Rust',
    'tear':                 'Tear',
    'torn':                 'Tear',
    'rip':                  'Tear',
    'stain':                'Stain',
    'stained':              'Stain',
    'burn':                 'Burn',
    'burned':               'Burn',
    'cigarette burn':       'Burn',
    'worn':                 'Worn',
    'wear':                 'Worn',
    'faded':                'Faded',
    'faded paint':          'Faded',
    'clear coat peeling':   'Paint Damage',
    'clear coat peel':      'Paint Damage',
    'paint peel':           'Paint Damage',
    'peeling':              'Paint Damage',
    'paint damage':         'Paint Damage',
    'broken':               'Broken',
    'missing':              'Missing',
    'missing part':         'Missing',
    'bent':                 'Bent',
    'hail damage':          'Hail Damage',
    'hail':                 'Hail',
    'water damage':         'Water Damage',
    'discolored':           'Discolored',
    'discoloration':        'Discolored',

    // Manheim CR abbreviations
    'mult dents':           'Dent',
    'multiple dents':       'Dent',
    'mult dents/no paint dmg': 'Dent',
    'mult dents/paint dmg': 'Dent',
    'dent/no paint dmg':    'Dent',
    'dent/paint dmg':       'Dent',
    'heavy mult scratches': 'Scratch',
    'mult scratches':       'Scratch',
    'heavy scratch':        'Scratch',
    'light scratch':        'Scratch',
    'light scratches':      'Scratch',
    'deep scratch':         'Scratch',
    'prev repair':          'Other',
    'prev repaired':        'Other',
    'misaligned':           'Other',
    'curb rash':            'Scuff',
    'paint dmg':            'Paint Damage',
    'no paint dmg':         'Dent',
    'chipped':              'Chip',
    'gouge':                'Scratch'
  },

  // ── Public API ──

  // Map a single damage entry for SmartAuction Vehicle Entry
  mapForSA(damage) {
    return {
      panel: this._mapPanel(damage.panel, this.PANEL_MAP),
      type: this._mapType(damage.type, this.SA_DAMAGE_TYPES),
      severity: damage.severity || 'Minor',
      chargeable: damage.chargeable === 'Yes' || damage.chargeable === true,
      estimatedCost: damage.estimatedCost || 0,
      description: damage.description || ''
    };
  },

  // Map a single damage entry for VIW/DirectInspect
  mapForVIW(damage) {
    return {
      panel: this._mapPanel(damage.panel, this.VIW_PANEL_MAP),
      type: this._mapType(damage.type, this.VIW_DAMAGE_TYPES),
      severity: damage.severity || 'Minor',
      chargeable: damage.chargeable === 'Yes' || damage.chargeable === true,
      estimatedCost: damage.estimatedCost || 0,
      description: damage.description || ''
    };
  },

  // Map an array of damages
  mapAllForSA(damages) {
    return damages.map(d => this.mapForSA(d));
  },

  mapAllForVIW(damages) {
    return damages.map(d => this.mapForVIW(d));
  },

  // Get the best matching dropdown option value for a given text
  // Useful when the actual dropdown options differ from our map
  findBestOption(selectEl, targetText) {
    if (!selectEl || selectEl.tagName !== 'SELECT') return null;

    const target = targetText.toLowerCase().trim();
    let bestMatch = null;
    let bestScore = 0;

    for (const option of selectEl.options) {
      const optText = option.textContent.toLowerCase().trim();
      const optVal = option.value.toLowerCase().trim();

      // Exact match
      if (optText === target || optVal === target) {
        return option.value;
      }

      // Partial match scoring
      const score = this._matchScore(target, optText);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = option.value;
      }
    }

    // Only return if reasonable match (>40% of words match)
    return bestScore > 0.4 ? bestMatch : null;
  },

  // ── Private Helpers ──

  _mapPanel(panel, panelMap) {
    if (!panel) return '';
    const key = panel.toLowerCase().trim();
    if (panelMap[key]) return panelMap[key];

    // Fuzzy: find the closest key
    let bestMatch = panel; // fallback to original
    let bestScore = 0;
    for (const [mapKey, mapVal] of Object.entries(panelMap)) {
      const score = this._matchScore(key, mapKey);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = mapVal;
      }
    }
    return bestScore > 0.65 ? bestMatch : panel;
  },

  _mapType(type, validTypes) {
    if (!type) return 'Other';
    const key = type.toLowerCase().trim();

    // Check normalize map
    if (this.TYPE_NORMALIZE[key]) {
      const normalized = this.TYPE_NORMALIZE[key];
      // Verify it's in the valid types list
      if (validTypes.includes(normalized)) return normalized;
      // Close enough — find partial match in valid types
      for (const vt of validTypes) {
        if (vt.toLowerCase().includes(normalized.toLowerCase()) ||
            normalized.toLowerCase().includes(vt.toLowerCase())) {
          return vt;
        }
      }
      return normalized;
    }

    // Direct match in valid types
    for (const vt of validTypes) {
      if (vt.toLowerCase() === key) return vt;
    }

    // Partial match
    for (const vt of validTypes) {
      if (key.includes(vt.toLowerCase()) || vt.toLowerCase().includes(key)) {
        return vt;
      }
    }

    return 'Other';
  },

  _matchScore(a, b) {
    const wordsA = a.split(/[\s\-_/]+/).filter(Boolean);
    const wordsB = b.split(/[\s\-_/]+/).filter(Boolean);
    if (wordsA.length === 0 || wordsB.length === 0) return 0;

    let matches = 0;
    for (const wa of wordsA) {
      for (const wb of wordsB) {
        if (wa === wb || wa.includes(wb) || wb.includes(wa)) {
          matches++;
          break;
        }
      }
    }
    return matches / Math.max(wordsA.length, wordsB.length);
  }
};

// Export
if (typeof window !== 'undefined') {
  window.DamageMapper = DamageMapper;
}
} // end guard
