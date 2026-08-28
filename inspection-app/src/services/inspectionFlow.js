// Inspection Flow — Data structures for the 6-step vehicle inspection

export const STEPS = [
  { key: 'startup', label: 'Startup', short: 'Start' },
  { key: 'exterior', label: 'Exterior', short: 'Ext' },
  { key: 'interior', label: 'Interior', short: 'Int' },
  { key: 'testdrive', label: 'Test Drive', short: 'Drive' },
  { key: 'photos', label: 'Photos', short: 'Pics' },
  { key: 'review', label: 'Review', short: 'Done' },
]

// ── Step 2: Startup Check ──────────────────────────────────────────

// How bad it is, in the inspector's words rather than the shop's. The `key` is
// the vocabulary mechanic_lines.severity uses, so a finding carries its own
// severity all the way to the tech's board and the router never has to guess.
//
// Captured per finding, not per check: a car can have a dead radio and a failing
// alternator under the same "accessories" heading, and they are not the same
// kind of problem.
export const FINDING_SEVERITIES = [
  { key: 'critical', label: "Don't drive it", hint: 'Unsafe — nobody moves this car until it is fixed' },
  { key: 'severe',   label: 'Before it sells', hint: 'Must be right before the car goes out' },
  { key: 'moderate', label: 'Should fix',      hint: 'Worth doing while it is here' },
  { key: 'minor',    label: 'Note only',       hint: 'Write it down, no work needed' },
]

// ── Step 2: Startup Check ──────────────────────────────────────────
//
// Three checks, but each one holds AS MANY FINDINGS AS THE CAR HAS. That is the
// whole point of the rewrite: `accessories` used to be one pass/fail and one
// single-line text box covering fourteen different things, so an inspector who
// found a dead radio and a broken window had to compress both into one sentence
// — and by the time he was writing it up, one of them was gone.
//
// `symptoms` are one tap each and every tap is its own finding. Picking from a
// list also beats recalling from memory, which is the actual failure mode: the
// inspector is not forgetting that something was wrong, he is failing to
// reconstruct a list at the end of a drive.
//
// `system` and `severity` ride along so a finding arrives at the mechanic's
// board already classified.

export const STARTUP_ITEMS = [
  {
    id: 'dash_lights',
    label: 'Warning lights',
    parts: 'Key on, engine running. Which lights stayed on?',
    system: 'electrical',
    severity: 'moderate',
    symptoms: [
      'Check engine', 'ABS', 'Airbag / SRS', 'TPMS', 'Traction / stability',
      'Oil pressure', 'Battery / charging', 'Temperature', 'Other light',
    ],
  },
  {
    id: 'accessories',
    label: 'Accessories',
    parts: 'Work through the cabin. Tap everything that does not work.',
    system: 'electrical',
    severity: 'moderate',
    symptoms: [
      'Radio / speakers', 'Touchscreen', 'Bluetooth', 'Backup camera', 'Sunroof',
      'A/C not cold', 'Heat not hot', 'Window', 'Door lock', 'Mirror',
      'Power seat', 'Wipers', 'Horn', 'Interior lights', 'Key fob',
    ],
  },
  {
    id: 'engine',
    label: 'Engine — idle & noise',
    parts: 'Rev 3–4 times in park. Listen, then look underneath.',
    system: 'engine',
    severity: 'severe',
    symptoms: [
      'Knock', 'Tick / lifter', 'Whine', 'Rough idle', 'Stalls', 'Hard start',
      'Exhaust smoke', 'Oil leak', 'Coolant leak', 'Belt squeal',
    ],
  },
]

export const KEY_FOBS_ITEM = { id: 'key_fobs', label: 'Key fobs on hand' }

// ── Step 3: Exterior Panels ────────────────────────────────────────

export const EXTERIOR_PANELS = {
  // Front view panels
  hood: { label: 'Hood', views: ['front', 'top'] },
  front_bumper: { label: 'Front Bumper', views: ['front'] },
  grille: { label: 'Grille', views: ['front'] },
  windshield: { label: 'Windshield', views: ['front', 'top'] },
  left_headlight: { label: 'Left Headlight', views: ['front'] },
  right_headlight: { label: 'Right Headlight', views: ['front'] },
  left_mirror: { label: 'Left Mirror', views: ['front', 'driver'] },
  right_mirror: { label: 'Right Mirror', views: ['front', 'passenger'] },

  // Driver side panels
  left_fender: { label: 'Driver Fender', views: ['front', 'driver'] },
  driver_front_door: { label: 'Driver Front Door', views: ['driver'] },
  driver_rear_door: { label: 'Driver Rear Door', views: ['driver'] },
  left_quarter: { label: 'Driver Quarter Panel', views: ['driver'] },
  left_rocker: { label: 'Driver Rocker Panel', views: ['driver'] },

  // Passenger side panels
  right_fender: { label: 'Passenger Fender', views: ['front', 'passenger'] },
  pass_front_door: { label: 'Passenger Front Door', views: ['passenger'] },
  pass_rear_door: { label: 'Passenger Rear Door', views: ['passenger'] },
  right_quarter: { label: 'Passenger Quarter Panel', views: ['passenger'] },
  right_rocker: { label: 'Passenger Rocker Panel', views: ['passenger'] },

  // Rear view panels
  trunk: { label: 'Trunk / Tailgate', views: ['rear', 'top'] },
  rear_bumper: { label: 'Rear Bumper', views: ['rear'] },
  rear_window: { label: 'Rear Window', views: ['rear', 'top'] },
  left_taillight: { label: 'Left Taillight', views: ['rear'] },
  right_taillight: { label: 'Right Taillight', views: ['rear'] },

  // Top view panels
  roof: { label: 'Roof', views: ['top'] },

  // Wheels — track wheel (rim) damage separately from tire condition
  wheel_lf: { label: 'LF Wheel', views: ['front', 'driver'] },
  wheel_rf: { label: 'RF Wheel', views: ['front', 'passenger'] },
  wheel_lr: { label: 'LR Wheel', views: ['rear', 'driver'] },
  wheel_rr: { label: 'RR Wheel', views: ['rear', 'passenger'] },
}

export const DAMAGE_TYPES = [
  'Scratch',
  'Scuff',
  'Dent',
  'Previous Repair',
  'Paint Chip',
  'Paint Damage',
  'Crack',
  'Rust',
  'Hail Damage',
  'Broken',
  'Missing',
  'Faded',
  // Wheel-specific
  'Curb Rash',
  'Bent',
  'Peeling Clearcoat',
  'Corrosion',
  'Other',
]

export const DAMAGE_SIZES = [
  'Pin',
  'Coin',
  'Credit card',
  'Hand',
  'Forearm',
  'Large',
  'Multiple',
]

// ── Step 4: Interior Zones — organized by quadrant ────────────────

export const INTERIOR_ZONES = [
  {
    category: 'Driver Front',
    zones: [
      { id: 'driver_seat', label: 'Driver Seat', icon: 'Armchair' },
      { id: 'driver_door_panel', label: 'Driver Door Panel', icon: 'PanelLeft' },
      { id: 'steering_wheel', label: 'Steering Wheel', icon: 'Circle' },
      { id: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
      { id: 'driver_floor', label: 'Driver Floor / Mat', icon: 'Square' },
    ],
  },
  {
    category: 'Passenger Front',
    zones: [
      { id: 'passenger_seat', label: 'Passenger Seat', icon: 'Armchair' },
      { id: 'pass_door_panel', label: 'Passenger Door Panel', icon: 'PanelRight' },
      { id: 'glove_box', label: 'Glove Box', icon: 'Archive' },
      { id: 'center_console', label: 'Center Console', icon: 'Smartphone' },
      { id: 'passenger_floor', label: 'Pass. Floor / Mat', icon: 'Square' },
    ],
  },
  {
    category: 'Driver Rear',
    zones: [
      { id: 'rear_seat_left', label: 'Rear Seat L', icon: 'Armchair' },
      { id: 'rear_door_left', label: 'Rear Door Panel L', icon: 'PanelLeft' },
      { id: 'rear_floor_left', label: 'Rear Floor L', icon: 'Square' },
    ],
  },
  {
    category: 'Passenger Rear',
    zones: [
      { id: 'rear_seat_right', label: 'Rear Seat R', icon: 'Armchair' },
      { id: 'rear_door_right', label: 'Rear Door Panel R', icon: 'PanelRight' },
      { id: 'rear_floor_right', label: 'Rear Floor R', icon: 'Square' },
    ],
  },
  {
    category: 'Shared / Top',
    zones: [
      { id: 'headliner', label: 'Headliner', icon: 'ArrowUpFromLine' },
      { id: 'rear_seat_center', label: 'Rear Seat (Center)', icon: 'Armchair' },
      { id: 'rear_deck', label: 'Rear Deck / Cargo', icon: 'Package' },
      { id: 'sun_visors', label: 'Sun Visors', icon: 'SunDim' },
    ],
  },
]

// Shorter core damage types for the modal — aggregated related terms.
export const INTERIOR_DAMAGE_TYPES = [
  'Stain',
  'Tear',
  'Burn',
  'Worn',
  'Cracked',
  'Broken',
  'Other',
]


// ── Step 5: Test Drive Questions ───────────────────────────────────

// Eight checks where there used to be three, because a tech does not fix
// "drivetrain" — he fixes a slipping transmission, or a whining differential,
// or both, and they are different jobs with different parts. Three questions
// covering ten systems is what made a car with three problems arrive at the
// shop as one line.
//
// The order is the order of the drive: what you notice pulling out, then at
// speed, then stopping.
export const TEST_DRIVE_ITEMS = [
  {
    id: 'transmission',
    label: 'Transmission',
    parts: 'Through every gear, up and down.',
    system: 'transmission',
    severity: 'severe',
    symptoms: [
      'Slips', 'Hard shift', 'Delayed engagement', "Won't downshift",
      'Noise in gear', "Won't go into gear", 'Shudder',
    ],
  },
  {
    id: 'power',
    label: 'Power & acceleration',
    parts: 'Get on it once, safely.',
    system: 'engine',
    severity: 'severe',
    symptoms: ['Sluggish', 'Hesitation', 'Misfire', 'Loss of power', 'Surging'],
  },
  {
    id: 'driveline',
    label: 'Driveline & axles',
    parts: 'Listen from the rear and on full-lock turns.',
    system: 'transmission',
    severity: 'severe',
    symptoms: [
      'Whine from rear', 'Clunk on takeoff', 'AWD / 4WD not engaging',
      'Vibration under acceleration', 'Click on turns',
    ],
  },
  {
    id: 'brakes',
    label: 'Brakes',
    parts: 'One hard stop from speed, somewhere empty.',
    system: 'brakes',
    severity: 'severe',
    symptoms: [
      'Grinding', 'Squealing', 'Pulls left', 'Pulls right', 'Soft / spongy pedal',
      'Pulsating', 'ABS light under braking', 'Parking brake',
    ],
  },
  {
    id: 'steering',
    label: 'Steering & alignment',
    parts: 'Hands light on the wheel on a straight road.',
    system: 'suspension',
    severity: 'moderate',
    symptoms: [
      'Wheel off-centre', 'Pulls left', 'Pulls right', 'Loose / play',
      'Hard to turn', 'Noise turning', 'Vibration in the wheel',
    ],
  },
  {
    id: 'suspension',
    label: 'Suspension & ride',
    parts: 'Find a rough patch on purpose.',
    system: 'suspension',
    severity: 'moderate',
    symptoms: ['Clunk over bumps', 'Bouncy / floaty', 'Rattle', 'Bottoms out', 'Leaking shock'],
  },
  {
    id: 'tires',
    label: 'Tires',
    parts: 'All four and the spare.',
    system: 'suspension',
    severity: 'moderate',
    symptoms: [
      'Low tread', 'Cupping', 'Uneven wear', 'Sidewall damage / bulge',
      'Mismatched sizes', 'TPMS sensor',
    ],
  },
  {
    id: 'road_check',
    label: 'At speed',
    parts: 'Highway run — cruise on, watch the gauges.',
    system: 'other',
    severity: 'moderate',
    symptoms: [
      "Cruise won't set", 'Warning light came on driving', 'Runs hot',
      'Speedometer', 'Noise at highway speed', 'Wanders',
    ],
  },
]

// Every mechanical check in one list, with the section it belongs to. The
// review screen and the work order router both want "all of them" more often
// than they want one section.
export const MECHANICAL_CHECKS = [
  ...STARTUP_ITEMS.map((c) => ({ ...c, section: 'startup' })),
  ...TEST_DRIVE_ITEMS.map((c) => ({ ...c, section: 'test_drive' })),
]

export function findCheck(id) {
  return MECHANICAL_CHECKS.find((c) => c.id === id) || null
}

// ── Step 6: Required Photos ────────────────────────────────────────
// outline keys: 'car_fl' | 'car_fr' | 'car_rr' | 'car_rl' | 'dashboard' | 'interior' | 'engine' | 'tire'

export const REQUIRED_PHOTOS = [
  {
    id: 'driver_front_corner',
    label: 'Front Left',
    outline: 'car_fl',
    instructions: 'Stand at the driver-side front corner. Frame the whole car diagonally — you should see the front grille and the driver side.',
  },
  {
    id: 'pass_front_corner',
    label: 'Front Right',
    outline: 'car_fr',
    instructions: 'Stand at the passenger-side front corner. Frame the whole car — front grille and passenger side visible.',
  },
  {
    id: 'pass_rear_corner',
    label: 'Rear Right',
    outline: 'car_rr',
    instructions: 'Stand at the passenger-side rear corner. Frame the whole car — rear end and passenger side visible.',
  },
  {
    id: 'driver_rear_corner',
    label: 'Rear Left',
    outline: 'car_rl',
    instructions: 'Stand at the driver-side rear corner. Frame the whole car — rear end and driver side visible.',
  },
  {
    id: 'dash_odo',
    label: 'Dashboard / Odometer',
    outline: 'dashboard',
    instructions: 'Open driver door, sit inside. Frame the instrument cluster so the odometer reading is sharp and readable.',
  },
  {
    id: 'interior_front',
    label: 'Interior — Front',
    outline: 'interior',
    instructions: 'From driver door or passenger door, shoot across toward the opposite side. Show front seats, dash, center console.',
  },
  {
    id: 'interior_rear',
    label: 'Interior — Rear',
    outline: 'interior',
    instructions: 'From rear door, shoot across toward the opposite side. Show both rear seats and floor.',
  },
  {
    id: 'tire_lf',
    label: 'Tire — Left Front',
    outline: 'tire',
    instructions: 'Squat in front of the left-front wheel. Fill the frame with the tire — show tread depth clearly.',
  },
  {
    id: 'tire_rf',
    label: 'Tire — Right Front',
    outline: 'tire',
    instructions: 'Squat in front of the right-front wheel. Fill the frame with the tire — tread visible.',
  },
  {
    id: 'tire_lr',
    label: 'Tire — Left Rear',
    outline: 'tire',
    instructions: 'Squat in front of the left-rear wheel. Fill the frame with the tire — tread visible.',
  },
  {
    id: 'tire_rr',
    label: 'Tire — Right Rear',
    outline: 'tire',
    instructions: 'Squat in front of the right-rear wheel. Fill the frame with the tire — tread visible.',
  },
]

// ── Tracks (3 parallel workstreams per inspection) ────────────────

export const TRACKS = [
  {
    key: 'quick',
    label: 'Quick Check',
    short: 'Quick',
    description: 'Startup + dashboard + accessories + engine idle',
    entryPath: (id) => `/inspect/${id}/startup`,
    color: 'amber',
  },
  {
    key: 'condition',
    label: 'Condition & Photos',
    short: 'Condition',
    description: 'Exterior damage → interior damage → required photos',
    entryPath: (id) => `/inspect/${id}/exterior`,
    color: 'sky',
  },
  {
    key: 'drive',
    label: 'Test Drive',
    short: 'Drive',
    description: 'Drivetrain, brakes, steering, ride',
    entryPath: (id) => `/inspect/${id}/testdrive`,
    color: 'violet',
  },
]

export function getTrackStatuses(checklist) {
  const t = checklist?.tracks || {}
  return {
    quick: t.quick || 'not_started',
    condition: t.condition || 'not_started',
    drive: t.drive || 'not_started',
  }
}

export function allTracksComplete(checklist) {
  const s = getTrackStatuses(checklist)
  return s.quick === 'complete' && s.condition === 'complete' && s.drive === 'complete'
}

// ── Helpers ────────────────────────────────────────────────────────

export function buildEmptyInspection() {
  // Minimal checklist — pages treat missing slots as empty/default.
  // Smaller payload = faster insert over mobile networks.
  return {
    v: 2,
    tracks: {
      quick: 'not_started',
      condition: 'not_started',
      drive: 'not_started',
    },
    startup: {},
    exterior: {},
    interior: {},
    test_drive: {},
    photos: {},
  }
}
