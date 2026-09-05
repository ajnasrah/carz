// The damage reader's panel enum has to stay a subset of DamageMapper.PANEL_MAP.
//
// api/_lib/damageText.js tells the model which panel names it may emit, and the
// extension then hands those to DamageMapper.mapForSA(). A name that isn't a
// PANEL_MAP key doesn't fail — it falls through to fuzzy matching and files the
// damage on a plausible-looking wrong panel, which is worse than an error. So
// assert the two lists agree instead of trusting them to.
//
//   node scripts/check-damage-vocab.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PANELS, TYPES } from '../api/_lib/damageText.js';

const here = dirname(fileURLToPath(import.meta.url));
const mapperPath = join(here, '../../scrapers/smartauction-extension/lib/damage-mapper.js');

// damage-mapper.js is a plain browser global, not a module — read it the way
// the extension does rather than inventing an export for it.
const src = readFileSync(mapperPath, 'utf8');
const sandbox = {};
new Function('globalThis', `${src}\n;globalThis.__m = DamageMapper;`)(sandbox);
const mapper = sandbox.__m;

const panelKeys = new Set(Object.keys(mapper.PANEL_MAP));
const badPanels = PANELS.filter((p) => !panelKeys.has(p));
const badTypes = TYPES.filter((t) => !mapper.SA_DAMAGE_TYPES.includes(t));

if (badPanels.length || badTypes.length) {
  if (badPanels.length) {
    console.error(`Not keys of DamageMapper.PANEL_MAP: ${badPanels.join(', ')}`);
  }
  if (badTypes.length) {
    console.error(`Not in DamageMapper.SA_DAMAGE_TYPES: ${badTypes.join(', ')}`);
  }
  console.error('Fix api/_lib/damageText.js, or add the name to damage-mapper.js.');
  process.exit(1);
}

console.log(`damage vocabulary OK — ${PANELS.length} panels, ${TYPES.length} types`);
