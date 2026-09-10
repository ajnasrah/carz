// Turn what the guys type in the Ready-to-Sell group into SmartAuction damage
// rows.
//
// WHAT THE REAL MESSAGES LOOK LIKE
// The damage line is one run-on sentence, and the team writes it both ways
// round, often in the same message:
//
//   damage first, panel second   "Scratch on passenger side quarter panel rear"
//                                "Small chips in hood trunk two passenger doors"
//   panel first, damage second   "Front bumper has scratches"
//                                "Gas door scuffed"
//
// Two things make a regex the wrong tool here.
//
// One damage word covers a LIST of panels. "Some scratches driver fender front
// bumper rear bumper left rear fender" is four damages, not one, and the next
// damage word starts the next group. Getting that wrong either drops three
// panels or files them under the wrong damage.
//
// And the text is dictated, so it is full of near-misses: "lift rear fender"
// (left), "right defender" (right fender), "left through door" (left rear
// door), "scratchs", "scratchS". A lookup table never recovers those; reading
// the sentence does.
//
// WHAT THE MODEL IS AND ISN'T ALLOWED TO DECIDE
// It reads the sentence. It does NOT invent vocabulary: `panel` and `type` are
// enums of the names DamageMapper already knows, so the output drops straight
// into the same mapForSA() the inspection and Manheim-CR paths use. The
// writer's own words survive in `description` — that is the field that actually
// reaches SmartAuction, because SA's add-damage form has no type dropdown.
//
// Env: ANTHROPIC_API_KEY

const API = 'https://api.anthropic.com/v1/messages';

// The caller (api/parse-damages.js) runs with maxDuration 120. Stop a little
// short of that: a model call that never comes back should surface as this
// function's own "damage read failed" — which the extension prints — and not as
// the platform killing the request out from under it, which is what the lister
// saw when this ran on the edge and got 25 seconds.
const READ_TIMEOUT_MS = 105_000;

// The natural-language half of DamageMapper.PANEL_MAP (scrapers/
// smartauction-extension/lib/damage-mapper.js). Its Manheim abbreviations
// ("lf door", "r qtr panel") are deliberately left out — those exist to read
// condition reports, and a model emitting them here would be writing in a
// dialect nobody types in the group. Every value below must stay a key of
// PANEL_MAP; `npm run check:damage-vocab` fails the build if one drifts.
export const PANELS = [
  'front bumper', 'rear bumper', 'hood', 'roof', 'trunk lid', 'grille',
  'driver front door', 'driver rear door', 'passenger front door', 'passenger rear door',
  'left front fender', 'right front fender',
  'left quarter panel', 'right quarter panel',
  'left rocker panel', 'right rocker panel',
  'windshield', 'rear window', 'left mirror', 'right mirror',
  'left headlight', 'right headlight', 'left taillight', 'right taillight',
  'left wheel', 'right wheel', 'lf wheel', 'rf wheel', 'lr wheel', 'rr wheel',
  'tailgate', 'liftgate',
  'interior', 'dashboard', 'steering wheel', 'headliner', 'carpet', 'console',
  'driver seat', 'passenger seat', 'rear seat',
  // All four door panels, not two. "All 4 interior door panels have scratches
  // and scuffs" is a real and common line, and with only the fronts in the list
  // it could only ever produce half the rows.
  'driver door panel', 'passenger door panel',
  'rear door panel - left', 'rear door panel - right',
  'warning light',
];

// DamageMapper.SA_DAMAGE_TYPES verbatim.
export const TYPES = [
  'Dent', 'Scratch', 'Scuff', 'Paint Chip', 'Paint Damage',
  'Crack', 'Broken', 'Missing', 'Rust', 'Corrosion',
  'Tear', 'Stain', 'Burn', 'Worn', 'Faded',
  'Hail Damage', 'Water Damage', 'Other',
];

// Tires come back as a GRADE per corner, not a tread depth. The model's job is
// reading English; what "good" is worth in 32nds is a commercial decision that
// changes without the prompt changing (content.js TIRE_TREAD holds the
// numbers). Same split as the damage vocabulary.
const TIRE_GRADES = ['good', 'ok', 'bad'];

const SCHEMA = {
  type: 'object',
  properties: {
    tires: {
      type: ['object', 'null'],
      description: 'Null when the message says nothing about tires at all.',
      properties: {
        lf: { type: 'string', enum: TIRE_GRADES },
        rf: { type: 'string', enum: TIRE_GRADES },
        lr: { type: 'string', enum: TIRE_GRADES },
        rr: { type: 'string', enum: TIRE_GRADES },
      },
      required: ['lf', 'rf', 'lr', 'rr'],
      additionalProperties: false,
    },
    damages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          panel: { type: 'string', enum: PANELS },
          type: { type: 'string', enum: TYPES },
          description: {
            type: 'string',
            description:
              "What the writer said about THIS panel, in their words, cleaned up only "
              + "for spelling. Keep size and position detail — 'small chips', 'gap around "
              + "the driver side headlight', 'lower valance below the grille is loose'. "
              + "Empty string if they only named the damage and the panel.",
          },
        },
        required: ['panel', 'type', 'description'],
        additionalProperties: false,
      },
    },
  },
  required: ['tires', 'damages'],
  additionalProperties: false,
};

const PROMPT = `You are reading the damage line from a used-car dealer's intake message. A lot tech walked around the car and typed or dictated what he saw. Turn it into one row per damaged panel.

The message may also carry a stock/VIN number, an odometer, a condition grade like "9/10", and a tire line like "Tires Good on Rear Front Poor". Ignore all of that. Tire wear and condition grades are NOT damages. Only report damage to a panel or part.

READ BOTH WORD ORDERS. The team writes it both ways, sometimes in the same sentence:
  "Scratch on passenger side quarter panel rear"   -> damage first, panel second
  "Front bumper has scratches"                     -> panel first, damage second
  "Gas door scuffed"                               -> panel first, damage second
  "Small chips in hood trunk two passenger doors"  -> damage first, then a LIST of panels

ONE DAMAGE WORD CAN COVER SEVERAL PANELS. When a damage word is followed by a run of panel names, it applies to every one of them, and the next damage word starts a new group. So:
  "Some scratches driver fender front bumper rear bumper left rear fender Small chips right rear door"
gives four Scratch rows (left front fender, front bumper, rear bumper, left quarter panel) and one Paint Chip row (passenger rear door). Emit a separate row per panel — never one row listing several panels.

THE TEXT IS DICTATED, SO EXPECT NEAR-MISSES. Read through them:
  "lift rear fender" / "left rear fender"  -> left quarter panel (the rear fender IS the quarter panel)
  "right defender"                         -> right front fender
  "left through door"                      -> driver rear door
  "scratchs", "scratchS"                   -> Scratch
  "two passenger doors"                    -> passenger front door AND passenger rear door
Driver = left, passenger = right. A plain "driver door" or "passenger door" with no front/rear means the FRONT door.

CHOOSING THE TYPE:
  chip / chips / nick            -> Paint Chip
  scratch / scratches / gouge    -> Scratch
  scuff / scuffed / curb rash    -> Scuff
  dent / ding                    -> Dent
  clear coat peeling, paint peel -> Paint Damage
  gap, misaligned, loose, not aligned, previous repair, aftermarket -> Other
  cracked glass                  -> Crack
  hail                           -> Hail Damage
If a part is described as damaged but no word fits, use Other and say what it is in the description.

TIRES ARE A SEPARATE FIELD, NOT A DAMAGE. The message usually carries a tire line — "Tires Good", "Tires bad except 1", "Back Tires Great Front poor". Never emit a damage row for it. Grade each of the four corners instead: lf (left/driver front), rf (right/passenger front), lr (left/driver rear), rr (right/passenger rear).

  good  great, good, new, "new tires", "tires are great"
  ok    ok, okay, medium, fair, "not bad", low, worn, "little worn", "almost bad"
  bad   bad, poor, bald, "needs tires"

The tire line often names an AXLE or a single corner, and the axle words are the opposite way round from the damage sentence — read it carefully:
  "Tires Good on Rear Front Poor"    -> lr/rr good,  lf/rf bad
  "Back Tires Great Front poor"      -> lr/rr good,  lf/rf bad
  "Tires Good front Poor on back"    -> lf/rf good,  lr/rr bad
  "Rear tires bald"                  -> lr/rr bad,   lf/rf ok
  "Tires great except driver front tire. It's bald." -> lf bad, rf/lr/rr good

WHEN ONLY SOME CORNERS ARE CALLED OUT, grade the rest 'ok' — not 'good'. "Front tires bad" tells you the fronts are bad and that he did not think the rears worth mentioning; it is not a measurement of the rears, and this number is shown to buyers. 'ok' is the honest floor.

A condition grade is not a tire grade: in "7/10 tires is good" the 7/10 is the car and the tires are good. If the message says nothing about tires at all, return null for tires — do not guess.

WHAT NOT TO DO. Do not invent damage the message doesn't state. Do not split one damage into several rows for emphasis. If the message says the car is clean, or names no damage at all, return an empty list. If a panel named isn't in the list you're allowed to use, pick the closest one that is, and keep the original words in the description.`;

// Never throws: the damage read is an assist. A model outage must not stop
// somebody listing the car by hand.
export async function readDamages(text) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('damageText: ANTHROPIC_API_KEY not set');
    return null;
  }
  const body = String(text || '').trim();
  if (!body) return { tires: null, damages: [] };

  try {
    const httpRes = await fetch(API, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      body: JSON.stringify({
        model: 'claude-opus-5',
        max_tokens: 4000,
        // Grouping a damage word across a run of panels is the part worth
        // thinking about; it is also two sentences of input, so this stays
        // cheap even at high effort.
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{ role: 'user', content: `${PROMPT}\n\nMessage:\n"""\n${body}\n"""` }],
      }),
    });
    if (!httpRes.ok) {
      console.error('damageText: anthropic', httpRes.status, (await httpRes.text()).slice(0, 200));
      return null;
    }
    const res = await httpRes.json();
    if (res.stop_reason === 'refusal') return null;
    const out = res.content?.find((b) => b.type === 'text')?.text;
    if (!out) return null;

    let parsed;
    try { parsed = JSON.parse(out); } catch { return null; }
    if (!Array.isArray(parsed?.damages)) return null;

    const t = parsed.tires;
    const tires = t && TIRE_GRADES.includes(t.lf) && TIRE_GRADES.includes(t.rf)
      && TIRE_GRADES.includes(t.lr) && TIRE_GRADES.includes(t.rr)
      ? { corners: { lf: t.lf, rf: t.rf, lr: t.lr, rr: t.rr } }
      : null;

    // The enum is enforced server-side, but a row that somehow arrives outside
    // it would map to the wrong panel rather than fail loudly — drop it instead.
    return {
      tires,
      damages: parsed.damages.filter((d) => PANELS.includes(d.panel) && TYPES.includes(d.type)),
    };
  } catch (e) {
    console.error('damageText failed:', e?.message || e);
    return null;
  }
}
