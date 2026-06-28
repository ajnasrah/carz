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
  
  // Priority order for quarter panel matching - check these FIRST
  QUARTER_PANEL_PRIORITY: [
    ['quarter panel left', 'Quarter Panel - Left'],
    ['quarter panel right', 'Quarter Panel - Right'],
    ['qtr panel left', 'Quarter Panel - Left'],
    ['qtr panel right', 'Quarter Panel - Right'],
    ['left quarter panel', 'Quarter Panel - Left'],
    ['right quarter panel', 'Quarter Panel - Right'],
    ['left rear quarter', 'Quarter Panel - Left'],
    ['right rear quarter', 'Quarter Panel - Right']
  ],
  
  PANEL_MAP: {
    // AI output → SmartAuction value
    'quarter panel left':   'Quarter Panel - Left',
    'quarter panel right':  'Quarter Panel - Right',
    'left quarter panel':   'Quarter Panel - Left',
    'right quarter panel':  'Quarter Panel - Right',
    'qtr panel left':       'Quarter Panel - Left',
    'qtr panel right':      'Quarter Panel - Right',
    'left rear quarter':    'Quarter Panel - Left',
    'right rear quarter':   'Quarter Panel - Right',
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
    // Interior door trim panels — identity maps so mapForSA preserves the
    // interior value instead of fuzzy-collapsing it to the exterior door.
    // ("driver door panel" shares 2/3 words with "driver door" → 0.667 score,
    // over the 0.65 fuzzy threshold → "Door - Driver Front".) The popup stores
    // these values via EXTRA_PANEL_SYNONYMS; this keeps them intact on fill.
    'driver door panel':         'Driver Door Panel',
    'driver front door panel':   'Driver Door Panel',
    'passenger door panel':      'Passenger Door Panel',
    'passenger front door panel':'Passenger Door Panel',
    'rear door panel - left':    'Rear Door Panel - Left',
    'rear door panel - right':   'Rear Door Panel - Right',
    'left fender':          'Fender - Left Front',
    'left front fender':    'Fender - Left Front',
    'right fender':         'Fender - Right Front',
    'right front fender':   'Fender - Right Front',
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
    'dash':                 'Dashboard',
    'tpms light':           'Warning Light',
    'tpms':                 'Warning Light', 
    'check engine light':   'Warning Light',
    'check engine':         'Warning Light',
    'warning light':        'Warning Light',
    'warning lights':       'Warning Light',
    'abs light':            'Warning Light',
    'airbag light':         'Warning Light',
    'service light':        'Warning Light',
    'tire pressure light':  'Warning Light',
    'tire pressure':        'Warning Light',
    'steering wheel':       'Steering Wheel',
    'driver seat':          'Seat - Driver',
    'passenger seat':       'Seat - Passenger',
    'rear seat':            'Seat - Rear',
    'headliner':            'Headliner',
    'carpet':               'Carpet/Floor',
    'console':              'Console',
    'tailgate':             'Tailgate',
    'tail gate':            'Tailgate',
    'lift gate':            'Tailgate',
    'liftgate':             'Tailgate',
    'hatch':                'Tailgate',
    'rear hatch':           'Tailgate',
    'rear gate':            'Tailgate',

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
    'f tow hook cover':     'Bumper - Front'
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
    'tailgate':             'Tailgate',
    'tail gate':            'Tailgate',
    'liftgate':             'Tailgate',
    'dashboard':            'Dashboard',
    'dash':                 'Dashboard',
    'tpms light':           'Warning Light',
    'tpms':                 'Warning Light',
    'check engine light':   'Warning Light', 
    'check engine':         'Warning Light',
    'warning light':        'Warning Light',
    'warning lights':       'Warning Light',
    'abs light':            'Warning Light',
    'airbag light':         'Warning Light',
    'service light':        'Warning Light',
    'tire pressure light':  'Warning Light',
    'tire pressure':        'Warning Light'
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
    'previous repair':      'Other',
    'prior repair':         'Other',
    'substandard repair':   'Other',
    'poor repair':          'Other',
    'bad repair':           'Other',
    'repair needed':        'Other',
    'needs repair':         'Other',
    'aftermarket':          'Other',
    'aftermarket part':     'Other',
    'replaced':             'Other',
    'replacement':          'Other',
    'misaligned':           'Other',
    'curb rash':            'Scuff',
    'curbed':               'Scuff',
    'curb':                 'Scuff',
    'curbing':              'Scuff',
    'scraped':              'Scuff',
    'paint dmg':            'Paint Damage',
    'no paint dmg':         'Dent',
    'chipped':              'Chip',
    'gouge':                'Scratch',
    // Compound Manheim conditions that don't match a single keyword
    'prev repair chipped':  'Other',
    'pitted':               'Other',
    'pitting':              'Other'
  },

  // ── Public API ──

  // Map a single damage entry for SmartAuction Vehicle Entry
  mapForSA(damage) {
    const mappedPanel = this._mapPanel(damage.panel, this.PANEL_MAP);
    let mappedType = this._mapType(damage.type, this.SA_DAMAGE_TYPES);
    let description = damage.description || '';

    // The type field didn't resolve to a standard SA type, but the damage may
    // have been entered as free text in the description ("multiple dents",
    // "scratches", "left quarter panel multiple dents/scratches"). SA's
    // add-damage form has NO type dropdown — the type only reaches SA as the
    // description prefix the filler prepends — so a description-only damage
    // lands verbatim ("multiple dents") instead of normalized ("Dent"). Pull a
    // recognized type out of the description and strip it so the row reads
    // "Dent — ...". Only runs when the type field gave us nothing usable.
    if (!this.SA_DAMAGE_TYPES.includes(mappedType) && description) {
      const ext = this._extractTypeFromText(description, this.SA_DAMAGE_TYPES);
      if (ext) { mappedType = ext.type; description = ext.remainder; }
    }

    // Preserve the original condition text verbatim. TYPE_NORMALIZE collapses
    // rich Manheim phrases ("Multiple Dents And Scratches", "Light Scratches",
    // "Ding") to a single bare SA type, dropping the count/severity/secondary-
    // damage detail a buyer reads. Keep the original phrase as the description
    // whenever it carries more than the bare type word; a description-less,
    // exactly-bare type ("scratch" / "dents") still lands as the clean "Scratch"
    // / "Dent". The SA filler skips its type prefix when the text already names a
    // damage, so this reads back as "multiple dents", not "Dent - multiple dents".
    if (this.SA_DAMAGE_TYPES.includes(mappedType) && !description && damage.type) {
      const orig = damage.type.trim();
      const bare = orig.toLowerCase(), t = mappedType.toLowerCase();
      const isBareType = bare === t || bare === t + 's' || bare === t + 'es' ||
                         bare === t.replace(/y$/, 'ies');
      if (!isBareType) description = orig;
    }

    // Clean up description for warning lights
    if (mappedPanel === 'Warning Light' || (damage.panel && damage.panel.toLowerCase().includes('light'))) {
      // Remove redundant "is on" or "on" from description
      description = description.replace(/\s*is\s+on\s*$/i, '').replace(/\s*on\s*$/i, '');
      // If the description is empty after cleaning, use the original panel name
      if (!description && damage.panel) {
        description = damage.panel.replace(/\s*light\s*$/i, '').toUpperCase();
      }
    }

    // Conditions that have no standard SA damage type collapse to 'Other'
    // ("Prev Repair", "Pitted", "Replaced", "Aftermarket"...). SA's add-damage
    // form has no type dropdown — the type is only surfaced as a description
    // prefix, and the filler drops it when it's 'Other'. Manheim CR damages
    // carry only panel + type (no description), so without this the row lands
    // with just a location and a blank description and the condition is lost.
    // Carry the original condition text into the description so it survives.
    if (mappedType === 'Other' && !description && damage.type &&
        damage.type.trim().toLowerCase() !== 'other') {
      description = damage.type.trim();
    }

    return {
      panel: mappedPanel,
      type: mappedType,
      severity: damage.severity || 'Minor',
      chargeable: damage.chargeable === 'Yes' || damage.chargeable === true,
      estimatedCost: damage.estimatedCost || 0,
      description: description
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

  // Pull a recognized damage type out of free-text and strip it from the text.
  // Used when a damage has no explicit type field and the type is embedded in
  // the description ("multiple dents/scratches" → type "Dent", remainder
  // "scratches"). Returns { type, remainder } or null when nothing matches.
  _extractTypeFromText(text, validTypes) {
    if (!text) return null;
    const lower = text.toLowerCase();
    // Append \w* so stripping "dent" also removes the trailing "s" of "dents"
    // (and "scratch" removes "scratches") instead of leaving an orphan letter.
    const strip = (phrase) => text
      .replace(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\w*', 'gi'), ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s,;.:/_-]+|[\s,;.:/_-]+$/g, '')
      .trim();

    // Longest known phrase first so "multiple dents" beats "dent".
    const phrases = Object.keys(this.TYPE_NORMALIZE).sort((a, b) => b.length - a.length);
    for (const ph of phrases) {
      if (lower.includes(ph)) {
        const t = this._mapType(ph, validTypes);
        if (validTypes.includes(t)) return { type: t, remainder: strip(ph) };
      }
    }
    // Fall back to a bare valid type name appearing in the text ("dent").
    const direct = [...validTypes].filter(v => v !== 'Other').sort((a, b) => b.length - a.length);
    for (const vt of direct) {
      if (lower.includes(vt.toLowerCase())) return { type: vt, remainder: strip(vt.toLowerCase()) };
    }
    return null;
  },

  // True when free text already names a damage — a TYPE_NORMALIZE key ("ding",
  // "gouge", "curb rash") or a bare SA type word ("scratch", "dent"). The SA
  // filler uses this to decide whether to prepend the normalized type: "multiple
  // dings" already reads as damage so it needs no "Dent - " prefix, but a bare
  // location like "lower valance" does. Substring match, mirroring the mapper's
  // existing fuzzy tolerance — damage tokens don't collide with real CR text.
  descriptionNamesType(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    for (const key of Object.keys(this.TYPE_NORMALIZE)) {
      if (lower.includes(key)) return true;
    }
    for (const t of this.SA_DAMAGE_TYPES) {
      if (t !== 'Other' && lower.includes(t.toLowerCase())) return true;
    }
    return false;
  },

  // ── Private Helpers ──

  _mapPanel(panel, panelMap) {
    if (!panel) return '';
    const key = panel.toLowerCase().trim();
    
    // Exact match first
    if (panelMap[key]) return panelMap[key];
    
    // Special handling for quarter panels to avoid left/right confusion
    if (key.includes('quarter') || key.includes('qtr')) {
      // More specific checks for left quarter panel
      if (key.includes('left') || key.includes(' l ') || key.startsWith('l ') || 
          key.includes('lf ') || key.includes('lr ') || key === 'l quarter' ||
          key === 'l qtr' || key === 'left quarter' || key === 'lf quarter' ||
          key === 'lr quarter') {
        return 'Quarter Panel - Left';
      }
      // More specific checks for right quarter panel  
      if (key.includes('right') || key.includes(' r ') || key.startsWith('r ') ||
          key.includes('rf ') || key.includes('rr ') || key === 'r quarter' ||
          key === 'r qtr' || key === 'right quarter' || key === 'rf quarter' ||
          key === 'rr quarter') {
        return 'Quarter Panel - Right';
      }
      // Default to checking if it contains 'panel' for generic quarter panel
      // Don't default to either side - let it fall through to fuzzy matching
      // which will preserve the original panel name if no good match is found
    }

    // Special handling for tailgate variations
    if (key.includes('tailgate') || key.includes('tail gate') || 
        key.includes('liftgate') || key.includes('lift gate') ||
        key === 'hatch' || key.includes('rear hatch') || 
        key.includes('rear gate') || key.includes('hatch door')) {
      return 'Tailgate';
    }

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
    if (!type) return type; // Return empty/null as-is
    const key = type.toLowerCase().trim();
    
    // Handle multiple/multi scratch variations
    if (key.includes('multiple') && key.includes('scratch')) {
      return 'Scratch';
    }
    if (key.includes('mult') && key.includes('scratch')) {
      return 'Scratch';
    }
    if (key === 'scratch multiple' || key === 'scratches multiple') {
      return 'Scratch';
    }
    
    // Resolve a normalized value to whatever the target list actually calls it.
    // SA and VIW disagree on a few names (SA: "Paint Chip"/"Hail Damage";
    // VIW: "Chip"/"Hail"), so a single TYPE_NORMALIZE value must map per-list.
    const SYNONYMS = {
      'Chip':        ['Paint Chip'], 'Paint Chip':  ['Chip'],
      'Hail':        ['Hail Damage'], 'Hail Damage': ['Hail'],
      'Rust':        ['Corrosion'],  'Corrosion':   ['Rust']
    };
    const resolve = (norm) => {
      if (!norm) return null;
      if (validTypes.includes(norm)) return norm;
      for (const alt of (SYNONYMS[norm] || [])) {
        if (validTypes.includes(alt)) return alt;
      }
      return null;
    };

    // Check normalize map for standard damage types (exact key)
    if (this.TYPE_NORMALIZE[key]) {
      const r = resolve(this.TYPE_NORMALIZE[key]);
      if (r) return r;
    }

    // Direct match in valid types
    for (const vt of validTypes) {
      if (vt.toLowerCase() === key) return vt;
    }

    // Partial match for compound conditions ("prev repair chipped",
    // "dent/paint dmg scratches"...). Scan known phrases longest-first so the
    // most specific phrase wins, and only accept one valid for the target list.
    const phrases = Object.keys(this.TYPE_NORMALIZE).sort((a, b) => b.length - a.length);
    for (const ph of phrases) {
      if (key.includes(ph)) {
        const r = resolve(this.TYPE_NORMALIZE[ph]);
        if (r) return r;
      }
    }

    // For everything else, preserve exact user input (like "substandard repair")
    // Don't auto-map to 'Other'
    return type;
  },

  _matchScore(a, b) {
    const wordsA = a.split(/[\s\-_/]+/).filter(Boolean);
    const wordsB = b.split(/[\s\-_/]+/).filter(Boolean);
    if (wordsA.length === 0 || wordsB.length === 0) return 0;

    let matches = 0;
    for (const wa of wordsA) {
      for (const wb of wordsB) {
        // Exact word match always counts. Substring matching is restricted to
        // words of 3+ chars — otherwise a single-letter map token ("l"/"r" for
        // left/right, or "a"/"c" from "a/c") matches any word that merely
        // contains that letter ("pAnel", "exteRior"), producing false fuzzy
        // hits like "A/C Condensor" → "Rocker Panel" or "Hood Release" →
        // "Bumper - Rear". Short directional codes must match exactly.
        if (wa === wb) { matches++; break; }
        if (wa.length >= 3 && wb.length >= 3 && (wa.includes(wb) || wb.includes(wa))) {
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
