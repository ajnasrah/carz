#!/usr/bin/env node
/**
 * Manheim run-list recon estimator.
 *
 * Reads the per-VIN `{VIN}_data.json` folders that the manheim-extension drops
 * into a directory (default: ~/Downloads), sends each car's parsed condition
 * report to Claude for an itemized recon-cost estimate, and writes a single
 * .xlsx with a Summary sheet (one row per car) and a Detail sheet (line items).
 *
 * Usage (from inspection-app/):
 *   ANTHROPIC_API_KEY=sk-ant-... node scripts/manheim-recon.mjs [inputDir] [outFile]
 *
 *   inputDir  directory to scan for VIN folders containing {VIN}_data.json (default: ~/Downloads)
 *   outFile   .xlsx path to write   (default: <inputDir>/manheim_recon_estimates.xlsx)
 *
 * Env:
 *   ANTHROPIC_API_KEY   required
 *   RECON_MODEL         override model (default: claude-opus-4-8)
 *   RECON_CONCURRENCY   parallel API calls (default: 4)
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';

// ─────────────────────────────────────────────────────────────────────────────
// SHOP RATE CARD — edit these to match Carz Inc's actual recon costs.
// The AI uses this as its pricing reference; it does not invent numbers from
// thin air. Numbers are wholesale/auction "make-it-sellable" costs, not retail.
// ─────────────────────────────────────────────────────────────────────────────
const RATE_CARD = `
RECON RATE CARD (USD, wholesale/auction-prep costs — get the car sellable, not showroom):

PAINT & BODY
- PDR (paintless dent repair), per panel, light (1-3 dents): $75
- PDR per panel, moderate (4-8 dents / "PDR/6"): $125
- PDR per panel, heavy (10+ dents): $200
- Hail PDR, per panel (severity 6-10 as noted): $150-350 depending on count/depth
- Refinish / repaint one panel (dent WITH paint damage, chips, scratches through paint): $300
- Wet sand + buff (scuffs, light scratches, "Wet Sand"): $60
- Partial repair / spot blend: $150

BUMPERS & PLASTICS
- Front or rear bumper cover, replace + paint: $450
- Bumper cover repair (crack/scrape, no replace): $200
- Bumper molding / trim, replace: $120
- Grille, replace: $200
- Rocker panel molding / body side molding, replace: $120
- Fender liner / splash shield, replace: $90
- Mirror housing / cap, replace + paint: $150

LIGHTS & GLASS
- Headlight assembly, replace: $250 (LED/HID up to $500 — use judgment)
- Tail light, replace: $150
- Windshield, replace: $350
- Side/back glass, replace: $250

WHEELS & TIRES
- Wheel curb rash repair (cosmetic, "Curb Rash"), per wheel: $120
- Alloy wheel replace: $250
- Tire replace (mount+balance incl.), each: $150 (premium/large up to $250)

BUMPER SENSORS / ELECTRONICS
- Parking / blind-spot sensor, replace + calibrate: $175

INTERIOR
- Headliner replace/dye (stained "Dyeing"): $150
- Seat/console/trim repair: $100
- Full detail (always include, baseline): $150

MECHANICAL
- "Mech Ck" / warning light / TPMS on: $75 diagnostic minimum; add repair if obvious
- Note any structural/frame/airbag/salvage announcement as a RISK, not a fixed cost.

RULES
- Read the severity hints in each damage line (e.g. "PDR/6" = 6 dents on that panel,
  "GR 12\"" = 12-inch curb rash, "10 or More" = heavy). Scale the estimate accordingly.
- One physical repair per line — do NOT double-count (a dent line and a paint line on the
  same panel that describe the same damage = one refinish, not two).
- Hail damage across many panels is common; total it realistically (a hail car can be
  $1,500-$4,000 in PDR alone).
- Always include the $150 baseline detail as its own line item.
`.trim();

const SYSTEM_PROMPT = `You are a used-car reconditioning estimator for an independent wholesale/retail dealer.
You are given a vehicle and its Manheim/SmartAuction condition-report damage list (already parsed,
with the suggested repair action after the em-dash). Using ONLY the rate card provided, produce a
realistic recon estimate to make the car sellable. Be practical and slightly conservative — these
are wholesale prep costs, not insurance retail. Return your answer strictly in the required schema.

${RATE_CARD}`;

// JSON schema for structured output. Note API constraints: every object needs
// additionalProperties:false and a required[] list; no min/max on numbers.
const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    condition_summary: {
      type: 'string',
      description: 'One-sentence plain-English summary of the car\'s condition.',
    },
    risk_flags: {
      type: 'array',
      description: 'Red flags from announcements (frame, structural, airbag, salvage/TMU, flood, etc.). Empty if none.',
      items: { type: 'string' },
    },
    line_items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: ['Paint & Body', 'Bumpers & Plastics', 'Lights & Glass', 'Wheels & Tires', 'Electronics', 'Interior', 'Mechanical', 'Detail', 'Other'],
          },
          description: { type: 'string', description: 'What is being fixed and where.' },
          action: { type: 'string', description: 'Repair method (PDR, Refinish, Replace, etc.).' },
          estimate: { type: 'number', description: 'USD cost for this line.' },
        },
        required: ['category', 'description', 'action', 'estimate'],
        additionalProperties: false,
      },
    },
    recon_total: { type: 'number', description: 'Sum of all line_items estimates, USD.' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    notes: { type: 'string', description: 'Assumptions or anything the buyer should verify in person.' },
  },
  required: ['condition_summary', 'risk_flags', 'line_items', 'recon_total', 'confidence', 'notes'],
  additionalProperties: false,
};

const MODEL = process.env.RECON_MODEL || 'claude-opus-4-8';
const CONCURRENCY = Number(process.env.RECON_CONCURRENCY || 4);
const API_KEY = process.env.ANTHROPIC_API_KEY;

// ── helpers ──────────────────────────────────────────────────────────────────

/** Pull a clean "2022 Mitsubishi Outlander SE" out of the messy `vehicle` field. */
function parseVehicle(raw) {
  if (!raw) return { year: '', makeModel: '' };
  // e.g. "3443 VEHICLE DETAILS - 2022  MITSUBISHI  OUTLANDER  BLACK EDIT\n\nVIN"
  let s = raw.replace(/\s+/g, ' ').replace(/VEHICLE DETAILS\s*-\s*/i, '').replace(/\bVIN\b.*$/i, '').trim();
  s = s.replace(/^\d+\s+/, ''); // drop leading lane/stock number
  const m = s.match(/\b(19|20)\d{2}\b/);
  const year = m ? m[0] : '';
  const makeModel = m ? s.slice(m.index + 4).trim() : s;
  return { year, makeModel: titleCase(makeModel) };
}

function titleCase(s) {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Find every `<dir>/<VIN>/<VIN>_data.json` under inputDir. */
async function findDataFiles(inputDir) {
  const entries = await readdir(inputDir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const candidate = path.join(inputDir, e.name, `${e.name}_data.json`);
    try {
      await stat(candidate);
      files.push(candidate);
    } catch {
      // no data.json in this folder; skip
    }
  }
  return files;
}

/** Call Claude for one car; returns the parsed estimate object. */
async function estimateRecon(car) {
  const { year, makeModel } = parseVehicle(car.vehicle);
  const userText = [
    `VEHICLE: ${year} ${makeModel}`.trim(),
    `VIN: ${car.vin}`,
    `ODOMETER: ${car.odometer || 'unknown'}`,
    `ANNOUNCEMENTS: ${(car.announcements || []).join('; ') || 'none'}`,
    '',
    'CONDITION REPORT DAMAGES (location: type (severity) — suggested action):',
    ...(car.damages || []).map((d) => `- ${d}`),
    '',
    'Estimate recon to make this car sellable. Always include the baseline detail line.',
  ].join('\n');

  const body = {
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userText }],
    output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`API ${res.status} for ${car.vin}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  if (data.stop_reason === 'refusal') {
    throw new Error(`Refused for ${car.vin}`);
  }
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  if (!textBlock) throw new Error(`No text block for ${car.vin}`);
  const est = JSON.parse(textBlock.text);
  return { year, makeModel, est, usage: data.usage };
}

/** Run tasks with bounded concurrency, preserving input order in results. */
async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!API_KEY) {
    console.error('ERROR: set ANTHROPIC_API_KEY in the environment.');
    console.error('  ANTHROPIC_API_KEY=sk-ant-... node scripts/manheim-recon.mjs');
    process.exit(1);
  }

  const inputDir = process.argv[2] || path.join(homedir(), 'Downloads');
  const outFile = process.argv[3] || path.join(inputDir, 'manheim_recon_estimates.xlsx');

  console.log(`Scanning ${inputDir} for *_data.json …`);
  const files = await findDataFiles(inputDir);
  if (files.length === 0) {
    console.error(`No {VIN}/{VIN}_data.json folders found in ${inputDir}.`);
    console.error('Run the Manheim extension on the run list first.');
    process.exit(1);
  }
  console.log(`Found ${files.length} car(s). Estimating with ${MODEL} (concurrency ${CONCURRENCY})…\n`);

  const cars = [];
  for (const f of files) {
    try {
      cars.push(JSON.parse(await readFile(f, 'utf8')));
    } catch (e) {
      console.warn(`  skip (bad JSON): ${f}`);
    }
  }

  let done = 0;
  const rows = await pool(cars, CONCURRENCY, async (car) => {
    try {
      const r = await estimateRecon(car);
      done++;
      console.log(`  [${done}/${cars.length}] ${car.vin}  $${r.est.recon_total}  (${r.est.line_items.length} items)`);
      return { car, ...r };
    } catch (e) {
      done++;
      console.warn(`  [${done}/${cars.length}] ${car.vin}  FAILED: ${e.message}`);
      return { car, error: e.message };
    }
  });

  // ── build workbook ──
  const summary = [];
  const detail = [];
  for (const row of rows) {
    const { car, year, makeModel, est, error } = row;
    if (error || !est) {
      summary.push({
        VIN: car.vin, Year: '', 'Make/Model': '', Odometer: car.odometer,
        'Recon Total': '', Confidence: '', 'Risk Flags': '', 'Condition': `ERROR: ${error}`, '# Damages': (car.damages || []).length,
      });
      continue;
    }
    summary.push({
      VIN: car.vin,
      Year: year,
      'Make/Model': makeModel,
      Odometer: Number(car.odometer) || car.odometer || '',
      'Recon Total': est.recon_total,
      Confidence: est.confidence,
      'Risk Flags': (est.risk_flags || []).join('; '),
      Condition: est.condition_summary,
      '# Damages': (car.damages || []).length,
      Notes: est.notes,
    });
    for (const li of est.line_items) {
      detail.push({
        VIN: car.vin,
        Vehicle: `${year} ${makeModel}`.trim(),
        Category: li.category,
        Description: li.description,
        Action: li.action,
        Estimate: li.estimate,
      });
    }
  }

  const wb = XLSX.utils.book_new();
  const wsSummary = XLSX.utils.json_to_sheet(summary);
  wsSummary['!cols'] = [
    { wch: 20 }, { wch: 6 }, { wch: 26 }, { wch: 10 }, { wch: 12 },
    { wch: 11 }, { wch: 26 }, { wch: 50 }, { wch: 10 }, { wch: 50 },
  ];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

  const wsDetail = XLSX.utils.json_to_sheet(detail);
  wsDetail['!cols'] = [{ wch: 20 }, { wch: 26 }, { wch: 18 }, { wch: 50 }, { wch: 16 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, wsDetail, 'Detail');

  XLSX.writeFile(wb, outFile);

  const ok = rows.filter((r) => r.est).length;
  const totalRecon = rows.reduce((s, r) => s + (r.est?.recon_total || 0), 0);
  console.log(`\nDone. ${ok}/${cars.length} estimated. Total recon across list: $${totalRecon.toLocaleString()}`);
  console.log(`Wrote ${outFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
