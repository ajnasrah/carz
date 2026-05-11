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

export const STARTUP_ITEMS = [
  {
    id: 'dash_lights',
    label: 'Dashboard — all warning lights off?',
    parts: 'Check engine, ABS, airbag, TPMS, traction/stability, oil pressure, battery, temperature, any other warning',
    failNote: 'Which lights are on?',
  },
  {
    id: 'accessories',
    label: 'Accessories — everything works?',
    parts: 'Radio, touchscreen, bluetooth, backup camera, sunroof, A/C & heat, windows, locks, mirrors, seats, wipers, horn, battery',
    failNote: "What's not working?",
  },
  {
    id: 'engine',
    label: 'Engine — idles smooth, runs clean?',
    parts: 'Rev 3–4 times in park. Listen for knocks, ticks, whines. Check for exhaust smoke and fluid leaks.',
    failNote: 'Describe the issue',
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

export const TEST_DRIVE_ITEMS = [
  {
    id: 'drivetrain',
    label: 'Drivetrain — shifts smooth, strong power?',
    parts: 'Transmission shifts cleanly through all gears, no slipping. Strong acceleration. Rear diff / AWD quiet and engages properly.',
    failNote: 'Describe the issue (slipping, hard shift, sluggish, noise...)',
  },
  {
    id: 'brakes_steering',
    label: 'Brakes & steering — stops straight, tracks true?',
    parts: 'Brakes stop straight with no grinding, pulling, or soft pedal. Steering centered and tight. Cruise control engages and holds.',
    failNote: 'Describe the issue (pulling, grinding, loose, drift...)',
  },
  {
    id: 'ride_tires',
    label: 'Ride & tires — no vibration or noise?',
    parts: 'No vibration or pulling at highway speed. Suspension quiet over bumps and turns. No tire cupping noise.',
    failNote: 'Describe the issue (vibration, clunking, rattle, road noise...)',
  },
]

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
