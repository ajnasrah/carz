import { useState } from 'react'

const VIEWS = [
  { key: 'front', label: 'Front' },
  { key: 'driver', label: 'Driver' },
  { key: 'rear', label: 'Rear' },
  { key: 'passenger', label: 'Pass.' },
  { key: 'top', label: 'Top' },
]

function PanelShape({ d, panelId, damages, onTap, rect, cx, cy, label }) {
  const count = damages?.[panelId]?.damages?.length || 0
  const hasDamage = count > 0

  const fill = hasDamage ? '#ef4444' : '#334155'
  const stroke = hasDamage ? '#f87171' : '#64748b'
  const opacity = hasDamage ? 0.7 : 0.6

  return (
    <g
      onClick={() => onTap(panelId)}
      className="cursor-pointer"
      style={{ WebkitTapHighlightColor: 'transparent' }}
    >
      {d ? (
        <path
          d={d}
          fill={fill}
          fillOpacity={opacity}
          stroke={stroke}
          strokeWidth="1.5"
          className="active:opacity-100 transition-opacity"
        />
      ) : rect ? (
        <rect
          x={rect.x}
          y={rect.y}
          width={rect.w}
          height={rect.h}
          rx={rect.rx || 4}
          fill={fill}
          fillOpacity={opacity}
          stroke={stroke}
          strokeWidth="1.5"
          className="active:opacity-100 transition-opacity"
        />
      ) : null}

      {/* Label */}
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        fill="white"
        fontSize="10"
        fontWeight="600"
        pointerEvents="none"
        style={{ textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}
      >
        {label}
      </text>

      {/* Damage badge */}
      {hasDamage && (
        <>
          <circle cx={cx + 20} cy={cy - 12} r="9" fill="#ef4444" stroke="#991b1b" strokeWidth="1" />
          <text
            x={cx + 20}
            y={cy - 12}
            textAnchor="middle"
            dominantBaseline="central"
            fill="white"
            fontSize="9"
            fontWeight="700"
            pointerEvents="none"
          >
            {count}
          </text>
        </>
      )}
    </g>
  )
}

function FrontView({ damages, onTap }) {
  return (
    <svg viewBox="0 0 360 320" className="w-full mx-auto">
      {/* Car body outline */}
      <path
        d="M80,100 Q80,60 120,40 L240,40 Q280,60 280,100 L290,110 L300,120 L300,260 Q300,280 280,280 L80,280 Q60,280 60,260 L60,120 L70,110 Z"
        fill="none"
        stroke="#475569"
        strokeWidth="2"
        strokeDasharray="4,4"
      />

      {/* Windshield */}
      <PanelShape
        panelId="windshield"
        d="M110,45 L250,45 Q270,60 275,95 L85,95 Q90,60 110,45 Z"
        damages={damages}
        onTap={onTap}
        cx={180}
        cy={70}
        label="Windshield"
      />

      {/* Hood */}
      <PanelShape
        panelId="hood"
        d="M82,100 L278,100 L285,175 L75,175 Z"
        damages={damages}
        onTap={onTap}
        cx={180}
        cy={138}
        label="Hood"
      />

      {/* Left Headlight */}
      <PanelShape
        panelId="left_headlight"
        rect={{ x: 65, y: 180, w: 65, h: 35, rx: 6 }}
        damages={damages}
        onTap={onTap}
        cx={97}
        cy={197}
        label="L Light"
      />

      {/* Grille */}
      <PanelShape
        panelId="grille"
        rect={{ x: 135, y: 180, w: 90, h: 35, rx: 4 }}
        damages={damages}
        onTap={onTap}
        cx={180}
        cy={197}
        label="Grille"
      />

      {/* Right Headlight */}
      <PanelShape
        panelId="right_headlight"
        rect={{ x: 230, y: 180, w: 65, h: 35, rx: 6 }}
        damages={damages}
        onTap={onTap}
        cx={263}
        cy={197}
        label="R Light"
      />

      {/* Front Bumper */}
      <PanelShape
        panelId="front_bumper"
        d="M65,220 L295,220 L295,268 Q295,278 285,278 L75,278 Q65,278 65,268 Z"
        damages={damages}
        onTap={onTap}
        cx={180}
        cy={248}
        label="Front Bumper"
      />

      {/* Left Mirror */}
      <PanelShape
        panelId="left_mirror"
        rect={{ x: 40, y: 80, w: 28, h: 22, rx: 8 }}
        damages={damages}
        onTap={onTap}
        cx={54}
        cy={91}
        label="L"
      />

      {/* Right Mirror */}
      <PanelShape
        panelId="right_mirror"
        rect={{ x: 292, y: 80, w: 28, h: 22, rx: 8 }}
        damages={damages}
        onTap={onTap}
        cx={306}
        cy={91}
        label="R"
      />

      {/* Left Fender (visible from front) */}
      <PanelShape
        panelId="left_fender"
        d="M60,120 L80,100 L80,218 L60,218 Z"
        damages={damages}
        onTap={onTap}
        cx={55}
        cy={165}
        label=""
      />

      {/* Right Fender (visible from front) */}
      <PanelShape
        panelId="right_fender"
        d="M280,100 L300,120 L300,218 L280,218 Z"
        damages={damages}
        onTap={onTap}
        cx={305}
        cy={165}
        label=""
      />

      {/* Fender labels on outside */}
      <text x="38" y="165" textAnchor="middle" fill="#94a3b8" fontSize="8" transform="rotate(-90,38,165)">
        L Fender
      </text>
      <text x="322" y="165" textAnchor="middle" fill="#94a3b8" fontSize="8" transform="rotate(90,322,165)">
        R Fender
      </text>
    </svg>
  )
}

function DriverSideView({ damages, onTap }) {
  return (
    <svg viewBox="0 0 420 220" className="w-full mx-auto">
      {/* Car body outline */}
      <path
        d="M40,140 L40,100 L80,100 L120,50 L280,50 L310,100 L380,100 L380,140 L370,155 L360,160 L340,160 L330,145 L310,140 L120,140 L100,145 L80,160 L60,160 L50,155 Z"
        fill="none"
        stroke="#475569"
        strokeWidth="2"
        strokeDasharray="4,4"
      />

      {/* Wheels */}
      <circle cx="90" cy="152" r="22" fill="#1e293b" stroke="#475569" strokeWidth="2" />
      <circle cx="90" cy="152" r="14" fill="#0f172a" stroke="#475569" strokeWidth="1" />
      <circle cx="340" cy="152" r="22" fill="#1e293b" stroke="#475569" strokeWidth="2" />
      <circle cx="340" cy="152" r="14" fill="#0f172a" stroke="#475569" strokeWidth="1" />

      {/* Window area (reference) */}
      <path
        d="M125,55 L275,55 L305,100 L115,100 Z"
        fill="#1e293b"
        stroke="#475569"
        strokeWidth="1"
      />

      {/* Left Fender */}
      <PanelShape
        panelId="left_fender"
        d="M42,102 L80,102 L80,138 L68,138 L42,138 Z"
        damages={damages}
        onTap={onTap}
        cx={60}
        cy={118}
        label="Fender"
      />

      {/* Driver Front Door */}
      <PanelShape
        panelId="driver_front_door"
        d="M83,55 L200,55 L200,138 L83,138 Z"
        damages={damages}
        onTap={onTap}
        cx={141}
        cy={100}
        label="Front Door"
      />

      {/* Driver Rear Door */}
      <PanelShape
        panelId="driver_rear_door"
        d="M203,55 L300,55 L300,138 L203,138 Z"
        damages={damages}
        onTap={onTap}
        cx={251}
        cy={100}
        label="Rear Door"
      />

      {/* Left Quarter Panel */}
      <PanelShape
        panelId="left_quarter"
        d="M303,80 L375,102 L375,138 L363,138 L303,138 Z"
        damages={damages}
        onTap={onTap}
        cx={342}
        cy={115}
        label="Quarter"
      />

      {/* Left Rocker Panel - taller for better touch target */}
      <PanelShape
        panelId="left_rocker"
        d="M115,140 L115,155 L315,155 L315,140 Z"
        damages={damages}
        onTap={onTap}
        cx={215}
        cy={147}
        label="Rocker Panel"
      />

      {/* Left Mirror - bigger touch target */}
      <PanelShape
        panelId="left_mirror"
        rect={{ x: 95, y: 85, w: 26, h: 28, rx: 6 }}
        damages={damages}
        onTap={onTap}
        cx={108}
        cy={99}
        label=""
      />

      {/* Direction arrow */}
      <text x="210" y="185" textAnchor="middle" fill="#475569" fontSize="11" fontWeight="600">
        DRIVER SIDE (Left)
      </text>
      <path d="M160,192 L260,192" stroke="#475569" strokeWidth="1" markerEnd="url(#arrow)" />
      <text x="158" y="196" textAnchor="end" fill="#64748b" fontSize="9">Front</text>
      <text x="262" y="196" textAnchor="start" fill="#64748b" fontSize="9">Rear</text>
    </svg>
  )
}

function PassengerSideView({ damages, onTap }) {
  return (
    <svg viewBox="0 0 420 220" className="w-full mx-auto">
      {/* Car body outline (mirrored - facing right) */}
      <path
        d="M380,140 L380,100 L340,100 L300,50 L140,50 L110,100 L40,100 L40,140 L50,155 L60,160 L80,160 L90,145 L110,140 L300,140 L320,145 L340,160 L360,160 L370,155 Z"
        fill="none"
        stroke="#475569"
        strokeWidth="2"
        strokeDasharray="4,4"
      />

      {/* Wheels */}
      <circle cx="330" cy="152" r="22" fill="#1e293b" stroke="#475569" strokeWidth="2" />
      <circle cx="330" cy="152" r="14" fill="#0f172a" stroke="#475569" strokeWidth="1" />
      <circle cx="80" cy="152" r="22" fill="#1e293b" stroke="#475569" strokeWidth="2" />
      <circle cx="80" cy="152" r="14" fill="#0f172a" stroke="#475569" strokeWidth="1" />

      {/* Window area */}
      <path
        d="M295,55 L145,55 L115,100 L305,100 Z"
        fill="#1e293b"
        stroke="#475569"
        strokeWidth="1"
      />

      {/* Right Fender */}
      <PanelShape
        panelId="right_fender"
        d="M378,102 L340,102 L340,138 L352,138 L378,138 Z"
        damages={damages}
        onTap={onTap}
        cx={360}
        cy={118}
        label="Fender"
      />

      {/* Passenger Front Door */}
      <PanelShape
        panelId="pass_front_door"
        d="M337,55 L220,55 L220,138 L337,138 Z"
        damages={damages}
        onTap={onTap}
        cx={279}
        cy={100}
        label="Front Door"
      />

      {/* Passenger Rear Door */}
      <PanelShape
        panelId="pass_rear_door"
        d="M217,55 L120,55 L120,138 L217,138 Z"
        damages={damages}
        onTap={onTap}
        cx={169}
        cy={100}
        label="Rear Door"
      />

      {/* Right Quarter Panel */}
      <PanelShape
        panelId="right_quarter"
        d="M117,80 L45,102 L45,138 L57,138 L117,138 Z"
        damages={damages}
        onTap={onTap}
        cx={78}
        cy={115}
        label="Quarter"
      />

      {/* Right Rocker Panel - taller for better touch target */}
      <PanelShape
        panelId="right_rocker"
        d="M305,140 L305,155 L105,155 L105,140 Z"
        damages={damages}
        onTap={onTap}
        cx={205}
        cy={147}
        label="Rocker Panel"
      />

      {/* Right Mirror - bigger touch target */}
      <PanelShape
        panelId="right_mirror"
        rect={{ x: 299, y: 85, w: 26, h: 28, rx: 6 }}
        damages={damages}
        onTap={onTap}
        cx={312}
        cy={99}
        label=""
      />

      {/* Direction label */}
      <text x="210" y="185" textAnchor="middle" fill="#475569" fontSize="11" fontWeight="600">
        PASSENGER SIDE (Right)
      </text>
      <path d="M260,192 L160,192" stroke="#475569" strokeWidth="1" />
      <text x="262" y="196" textAnchor="start" fill="#64748b" fontSize="9">Front</text>
      <text x="158" y="196" textAnchor="end" fill="#64748b" fontSize="9">Rear</text>
    </svg>
  )
}

function RearView({ damages, onTap }) {
  return (
    <svg viewBox="0 0 360 320" className="w-full mx-auto">
      {/* Car body outline */}
      <path
        d="M80,100 Q80,60 120,40 L240,40 Q280,60 280,100 L290,110 L300,120 L300,260 Q300,280 280,280 L80,280 Q60,280 60,260 L60,120 L70,110 Z"
        fill="none"
        stroke="#475569"
        strokeWidth="2"
        strokeDasharray="4,4"
      />

      {/* Rear Window */}
      <PanelShape
        panelId="rear_window"
        d="M110,45 L250,45 Q270,60 275,95 L85,95 Q90,60 110,45 Z"
        damages={damages}
        onTap={onTap}
        cx={180}
        cy={70}
        label="Rear Window"
      />

      {/* Trunk / Tailgate */}
      <PanelShape
        panelId="trunk"
        d="M82,100 L278,100 L285,175 L75,175 Z"
        damages={damages}
        onTap={onTap}
        cx={180}
        cy={138}
        label="Trunk / Tailgate"
      />

      {/* Left Taillight */}
      <PanelShape
        panelId="left_taillight"
        rect={{ x: 65, y: 180, w: 65, h: 35, rx: 6 }}
        damages={damages}
        onTap={onTap}
        cx={97}
        cy={197}
        label="L Tail"
      />

      {/* Center panel / license plate area */}
      <rect
        x="135"
        y="185"
        width="90"
        height="25"
        rx="3"
        fill="#1e293b"
        stroke="#475569"
        strokeWidth="1"
      />
      <text x="180" y="200" textAnchor="middle" fill="#64748b" fontSize="9">
        LICENSE PLATE
      </text>

      {/* Right Taillight */}
      <PanelShape
        panelId="right_taillight"
        rect={{ x: 230, y: 180, w: 65, h: 35, rx: 6 }}
        damages={damages}
        onTap={onTap}
        cx={263}
        cy={197}
        label="R Tail"
      />

      {/* Rear Bumper */}
      <PanelShape
        panelId="rear_bumper"
        d="M65,220 L295,220 L295,268 Q295,278 285,278 L75,278 Q65,278 65,268 Z"
        damages={damages}
        onTap={onTap}
        cx={180}
        cy={248}
        label="Rear Bumper"
      />

      {/* Quarter panel edges */}
      <PanelShape
        panelId="left_quarter"
        d="M60,120 L80,100 L80,218 L60,218 Z"
        damages={damages}
        onTap={onTap}
        cx={55}
        cy={165}
        label=""
      />
      <PanelShape
        panelId="right_quarter"
        d="M280,100 L300,120 L300,218 L280,218 Z"
        damages={damages}
        onTap={onTap}
        cx={305}
        cy={165}
        label=""
      />

      <text x="38" y="165" textAnchor="middle" fill="#94a3b8" fontSize="8" transform="rotate(-90,38,165)">
        L Quarter
      </text>
      <text x="322" y="165" textAnchor="middle" fill="#94a3b8" fontSize="8" transform="rotate(90,322,165)">
        R Quarter
      </text>
    </svg>
  )
}

function TopView({ damages, onTap }) {
  return (
    <svg viewBox="0 0 240 440" className="w-full max-w-xs mx-auto">
      {/* Car body outline */}
      <path
        d="M50,80 Q50,40 80,25 L160,25 Q190,40 190,80 L195,90 L200,100 L200,380 Q200,410 180,420 L60,420 Q40,410 40,380 L40,100 L45,90 Z"
        fill="none"
        stroke="#475569"
        strokeWidth="2"
        strokeDasharray="4,4"
      />

      {/* Windshield (from top) */}
      <PanelShape
        panelId="windshield"
        d="M65,80 L175,80 L180,120 L60,120 Z"
        damages={damages}
        onTap={onTap}
        cx={120}
        cy={100}
        label="Windshield"
      />

      {/* Hood */}
      <PanelShape
        panelId="hood"
        d="M55,30 Q55,22 80,22 L160,22 Q185,22 185,30 L190,78 L50,78 Z"
        damages={damages}
        onTap={onTap}
        cx={120}
        cy={52}
        label="Hood"
      />

      {/* Roof */}
      <PanelShape
        panelId="roof"
        d="M55,125 L185,125 L185,290 L55,290 Z"
        damages={damages}
        onTap={onTap}
        cx={120}
        cy={208}
        label="Roof"
      />

      {/* Rear Window */}
      <PanelShape
        panelId="rear_window"
        d="M60,295 L180,295 L175,335 L65,335 Z"
        damages={damages}
        onTap={onTap}
        cx={120}
        cy={315}
        label="Rear Glass"
      />

      {/* Trunk */}
      <PanelShape
        panelId="trunk"
        d="M60,340 L180,340 Q195,410 180,418 L60,418 Q45,410 60,340 Z"
        damages={damages}
        onTap={onTap}
        cx={120}
        cy={380}
        label="Trunk"
      />

      {/* Left Mirror */}
      <PanelShape
        panelId="left_mirror"
        rect={{ x: 28, y: 95, w: 18, h: 22, rx: 6 }}
        damages={damages}
        onTap={onTap}
        cx={37}
        cy={106}
        label=""
      />

      {/* Right Mirror */}
      <PanelShape
        panelId="right_mirror"
        rect={{ x: 194, y: 95, w: 18, h: 22, rx: 6 }}
        damages={damages}
        onTap={onTap}
        cx={203}
        cy={106}
        label=""
      />

      {/* Side labels */}
      <text x="25" y="210" textAnchor="middle" fill="#64748b" fontSize="9" transform="rotate(-90,25,210)">
        DRIVER SIDE
      </text>
      <text x="215" y="210" textAnchor="middle" fill="#64748b" fontSize="9" transform="rotate(90,215,210)">
        PASSENGER SIDE
      </text>

      {/* Direction */}
      <text x="120" y="12" textAnchor="middle" fill="#475569" fontSize="9" fontWeight="600">FRONT</text>
      <text x="120" y="436" textAnchor="middle" fill="#475569" fontSize="9" fontWeight="600">REAR</text>
    </svg>
  )
}

export default function CarDiagram({ damages, onPanelTap }) {
  const [view, setView] = useState('front')

  return (
    <div>
      {/* View tabs */}
      <div className="flex gap-1 mb-4">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors ${
              view === v.key
                ? 'bg-emerald-500 text-slate-900'
                : 'bg-slate-800 text-slate-400'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* Diagram */}
      <div className="bg-slate-900/50 rounded-xl p-3 border border-slate-700">
        {view === 'front' && <FrontView damages={damages} onTap={onPanelTap} />}
        {view === 'driver' && <DriverSideView damages={damages} onTap={onPanelTap} />}
        {view === 'rear' && <RearView damages={damages} onTap={onPanelTap} />}
        {view === 'passenger' && <PassengerSideView damages={damages} onTap={onPanelTap} />}
        {view === 'top' && <TopView damages={damages} onTap={onPanelTap} />}

        {/* no hint text - they know what to do */}
      </div>
    </div>
  )
}
