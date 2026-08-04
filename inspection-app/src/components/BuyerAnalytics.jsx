import { useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, Cell, CartesianGrid,
} from 'recharts'
import { TrendingUp, TrendingDown, Minus, Sparkle, ChevronDown, ChevronUp, Copy, Mail, Phone, Check } from 'lucide-react'
import { computeBuyerAnalytics, buyerMonthlySeries } from '../services/buyerAnalytics'
import { computeBuyerTrends } from '../services/buyerTrends'
import { copyText } from '../native/clipboard'

// Dark categorical slots (validated on the slate surface). Color follows the
// buyer entity by rank index; "Other" is neutral gray, never a hue.
const SERIES = ['#3987e5', '#199e70', '#c98500', '#008300', '#9085e9', '#e66767']
const OTHER = '#64748b'
const SURFACE = '#0f172a'   // slate-900 — the chart surface, used for segment gaps
const AXIS = '#475569'
const GRID = '#1e293b'
const INK2 = '#94a3b8'

const money = (n) => (n == null ? '—' : `$${Math.round(n).toLocaleString()}`)
const kmoney = (n) => {
  if (!n) return '$0'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${Math.round(n / 1000)}k`
  return `$${Math.round(n)}`
}

const PERIOD_LABEL = { mtd: 'MTD', qtd: 'QTD', ytd: 'YTD', d90: 'Last 90d', lastYear: 'Last Year', all: 'All-time' }

export default function BuyerAnalytics({ sold }) {
  const [period, setPeriod] = useState('ytd')
  const [openKey, setOpenKey] = useState(null)
  const [q, setQ] = useState('')
  const [copied, setCopied] = useState('')

  const a = useMemo(() => computeBuyerAnalytics(sold, { months: 12, topN: 6 }), [sold])
  // Rolling 30-day momentum ("buying more or less"), indexed by buyer key for badges.
  const momentum = useMemo(() => {
    const t = computeBuyerTrends(sold, { periodDays: 30, periods: 6 })
    return new Map(t.buyers.map((b) => [b.key, b]))
  }, [sold])

  const pd = a.periods[period]
  const leaderboard = useMemo(() => {
    const term = q.trim().toLowerCase()
    const list = term ? pd.buyers.filter((b) => (b.name || '').toLowerCase().includes(term) || (b.state || '').toLowerCase().includes(term)) : pd.buyers
    return list
  }, [pd, q])

  // Give each charted bar a UNIQUE y-axis label — two distinct buyers can share a
  // display name (e.g. different rep contacts), which would collapse into one bar
  // on a category axis. Disambiguate only the colliding names.
  const chartTop = useMemo(() => {
    const slice = leaderboard.slice(0, 12)
    const nameCount = {}
    for (const b of slice) { const n = b.name || b.key; nameCount[n] = (nameCount[n] || 0) + 1 }
    return slice.map((b) => {
      const n = b.name || b.key
      return { ...b, label: nameCount[n] > 1 ? `${n} · ${b.state || b.key.slice(-4)}` : n }
    })
  }, [leaderboard])

  function copy(text, tag) {
    copyText(text)
    setCopied(tag); setTimeout(() => setCopied(''), 1200)
  }

  if (!a.periods.all.buyerCount) {
    return <p className="text-slate-400 text-sm p-6 text-center">No sold history with dates yet — upload a SmartAuction report to build buyer trends.</p>
  }

  return (
    <div className="space-y-5">
      {/* KPI strip for the selected period */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Kpi label={`Cars bought · ${pd.label}`} value={pd.totalCount.toLocaleString()} />
        <Kpi label={`Spend · ${pd.label}`} value={kmoney(pd.totalSpend)} />
        <Kpi label={`Active buyers · ${pd.label}`} value={pd.buyerCount.toLocaleString()} />
        <Kpi label="Trending (30d)"
          value={<span className="flex items-center gap-2 text-base">
            <span className="text-emerald-400 flex items-center gap-0.5"><TrendingUp size={14} />{countTrend(momentum, 'up')}</span>
            <span className="text-red-400 flex items-center gap-0.5"><TrendingDown size={14} />{countTrend(momentum, 'down')}</span>
          </span>} />
      </div>

      {/* Monthly top buyers — stacked, last 12 months */}
      <Card title="Top buyers by month" sub={`Cars bought · last 12 months · as of ${a.asOf}`}>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={a.monthlySeries} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="month" tick={{ fill: INK2, fontSize: 11 }} axisLine={{ stroke: AXIS }} tickLine={false} />
            <YAxis tick={{ fill: INK2, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip cursor={{ fill: 'rgba(148,163,184,0.08)' }} content={<StackTip />} />
            <Legend wrapperStyle={{ fontSize: 11, color: INK2 }} iconType="circle" iconSize={8}
              formatter={(v) => <span style={{ color: INK2 }}>{String(v).length > 18 ? String(v).slice(0, 17) + '…' : v}</span>} />
            {a.seriesDefs.map((sd) => (
              <Bar key={sd.id} dataKey={sd.id} stackId="m" fill={SERIES[sd.colorIndex]} stroke={SURFACE} strokeWidth={1} maxBarSize={48} />
            ))}
            <Bar dataKey="Other" stackId="m" fill={OTHER} stroke={SURFACE} strokeWidth={1} radius={[3, 3, 0, 0]} maxBarSize={48} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Period selector + leaderboard */}
      <div className="flex flex-wrap items-center gap-1.5">
        {a.periodOrder.map((k) => (
          <button key={k} onClick={() => setPeriod(k)}
            className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
              period === k ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-slate-800/50 text-slate-400 border-slate-700 hover:border-slate-500'}`}>
            {PERIOD_LABEL[k]}
          </button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search buyer / state"
          className="ml-auto bg-slate-800 border border-slate-700 rounded px-3 py-1 text-xs text-slate-200 placeholder-slate-500 w-44" />
      </div>

      <Card title={`Top buyers · ${pd.label}`} sub={`${pd.buyerCount} active · ${pd.totalCount} cars`}>
        {chartTop.length === 0 ? (
          <p className="text-slate-500 text-sm py-6 text-center">No purchases in this period.</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(120, chartTop.length * 30)}>
            <BarChart data={chartTop} layout="vertical" margin={{ top: 0, right: 28, left: 8, bottom: 0 }}>
              <XAxis type="number" hide allowDecimals={false} />
              <YAxis type="category" dataKey="label" width={140} tick={<BuyerTick />} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: 'rgba(148,163,184,0.08)' }} content={<BarTip />} />
              <Bar dataKey="count" fill={SERIES[0]} radius={[0, 4, 4, 0]} barSize={16}
                label={{ position: 'right', fill: INK2, fontSize: 11 }}>
                {chartTop.map((b) => <Cell key={b.key} cursor="pointer" onClick={() => setOpenKey(openKey === b.key ? null : b.key)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Leaderboard table with drill-down */}
      <div className="space-y-1.5">
        {leaderboard.slice(0, 60).map((b, i) => {
          const m = momentum.get(b.key)
          const open = openKey === b.key
          return (
            <div key={b.key} className="bg-slate-800/50 border border-slate-700 rounded-lg overflow-hidden">
              <button onClick={() => setOpenKey(open ? null : b.key)} className="w-full flex items-center gap-3 p-2.5 text-left">
                <span className="w-6 text-center text-xs text-slate-500 tabular-nums shrink-0">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-100 truncate">{b.name || '—'}</div>
                  <div className="text-[11px] text-slate-500">{b.state || ''}{b.state ? ' · ' : ''}{money(b.spend)} spend</div>
                </div>
                <MomentumBadge m={m} />
                <div className="text-right shrink-0 w-14">
                  <div className="text-emerald-400 font-bold tabular-nums">{b.count}</div>
                  <div className="text-[10px] text-slate-500">cars</div>
                </div>
                {open ? <ChevronUp size={15} className="text-slate-500 shrink-0" /> : <ChevronDown size={15} className="text-slate-500 shrink-0" />}
              </button>
              {open && <BuyerDetail analytics={a} b={b} m={momentum.get(b.key)} copied={copied} copy={copy} />}
            </div>
          )
        })}
        {leaderboard.length > 60 && <p className="text-[11px] text-slate-500 text-center py-1">Showing top 60 of {leaderboard.length}. Search to narrow.</p>}
      </div>
    </div>
  )
}

function BuyerDetail({ analytics, b, m, copied, copy }) {
  const series = useMemo(() => buyerMonthlySeries(analytics, b.key), [analytics, b.key])
  const full = analytics.buyersByKey.get(b.key)
  return (
    <div className="border-t border-slate-700 p-3 space-y-3">
      {/* Period totals for THIS buyer */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
        {analytics.periodOrder.map((k) => (
          <div key={k} className="bg-slate-900/60 rounded px-2 py-1.5 text-center">
            <div className="text-[10px] text-slate-500">{PERIOD_LABEL[k]}</div>
            <div className="text-sm font-bold text-slate-100 tabular-nums">{full.periodTotals[k].count}</div>
            <div className="text-[9px] text-slate-500">{kmoney(full.periodTotals[k].spend)}</div>
          </div>
        ))}
      </div>
      {/* Monthly bars for this buyer */}
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={series} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="month" tick={{ fill: INK2, fontSize: 10 }} axisLine={{ stroke: AXIS }} tickLine={false} />
          <YAxis tick={{ fill: INK2, fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
          <Tooltip cursor={{ fill: 'rgba(148,163,184,0.08)' }} content={<BarTip single />} />
          <Bar dataKey="cars" fill={SERIES[0]} radius={[3, 3, 0, 0]} maxBarSize={34} />
        </BarChart>
      </ResponsiveContainer>
      {/* Contact + momentum sentence */}
      <div className="flex flex-wrap items-center gap-1.5">
        {m && <span className="text-[11px] text-slate-400">{momentumSentence(m)}</span>}
        <span className="ml-auto flex gap-1.5">
          {b.email && <Act onClick={() => copy(b.email, `e${b.key}`)} icon={copied === `e${b.key}` ? Check : Copy} label="Email" />}
          {b.phone && <Act onClick={() => copy(b.phone, `p${b.key}`)} icon={copied === `p${b.key}` ? Check : Phone} label="Phone" />}
          {b.email && <Act href={`mailto:${b.email}`} icon={Mail} label="Draft" primary />}
        </span>
      </div>
    </div>
  )
}

// ── momentum helpers ──
function countTrend(momentum, dir) {
  let n = 0
  for (const b of momentum.values()) {
    if (dir === 'up' && (b.trend === 'up' || b.trend === 'new')) n++
    if (dir === 'down' && (b.trend === 'down' || b.trend === 'cooling')) n++
  }
  return n
}
function MomentumBadge({ m }) {
  if (!m) return <span className="w-16" />
  const map = {
    up: ['text-emerald-300 bg-emerald-500/10 border-emerald-500/30', TrendingUp, `+${m.deltaPct}%`],
    new: ['text-emerald-300 bg-emerald-500/10 border-emerald-500/30', Sparkle, 'new'],
    down: ['text-red-300 bg-red-500/10 border-red-500/30', TrendingDown, `${m.deltaPct}%`],
    cooling: ['text-amber-300 bg-amber-500/10 border-amber-500/30', TrendingDown, 'cooling'],
    flat: ['text-slate-400 bg-slate-700/40 border-slate-600', Minus, 'flat'],
  }
  const [cls, Icon, txt] = map[m.trend] || map.flat
  return (
    <span className={`hidden sm:flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${cls}`} title="Last 30d vs prior 30d">
      <Icon size={11} /> {txt}
    </span>
  )
}
function momentumSentence(m) {
  if (m.trend === 'up') return `▲ Bought ${m.last30} in the last 30d, up from ${m.prev30} the prior 30d (+${m.deltaPct}%).`
  if (m.trend === 'new') return `✦ Bought ${m.last30} in the last 30d after none the prior 30d — new or returning.`
  if (m.trend === 'down') return `▼ Bought ${m.last30} in the last 30d, down from ${m.prev30} (${m.deltaPct}%).`
  if (m.trend === 'cooling') return `▼ No purchases in the last 30d, after ${m.prev30} the prior 30d — cooling off.`
  return `Bought ${m.last30} in each of the last two 30-day periods — steady.`
}

// ── small UI atoms ──
function Kpi({ label, value }) {
  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2">
      <div className="text-[10px] text-slate-500 uppercase tracking-wide truncate">{label}</div>
      <div className="text-lg font-bold text-slate-100 tabular-nums">{value}</div>
    </div>
  )
}
function Card({ title, sub, children }) {
  return (
    <div className="bg-slate-800/40 border border-slate-700 rounded-lg p-3">
      <div className="mb-2">
        <div className="text-sm font-semibold text-slate-200">{title}</div>
        {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
      </div>
      {children}
    </div>
  )
}
function BuyerTick({ x, y, payload }) {
  const name = String(payload.value || '')
  const short = name.length > 20 ? name.slice(0, 19) + '…' : name
  return <text x={x} y={y} dy={4} textAnchor="end" fill={INK2} fontSize={11}>{short}</text>
}
function StackTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const rows = payload.filter((p) => p.value > 0)
  const total = rows.reduce((s, p) => s + p.value, 0)
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs shadow-xl">
      <div className="text-slate-300 font-semibold mb-1">{label} · {total} cars</div>
      {rows.slice().reverse().map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-slate-400 flex-1 truncate max-w-[150px]">{p.dataKey}</span>
          <span className="text-slate-200 tabular-nums">{p.value}</span>
        </div>
      ))}
    </div>
  )
}
function BarTip({ active, payload, single }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs shadow-xl">
      <div className="text-slate-200 font-semibold">{single ? p.month : p.name}</div>
      <div className="text-slate-400">{single ? p.cars : p.count} cars · {money(single ? p.spend : p.spend)}</div>
    </div>
  )
}
function Act({ icon, label, onClick, href, primary }) {
  const Icon = icon
  const cls = `flex items-center gap-1 text-[11px] px-2 py-1 rounded border ${
    primary ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-slate-700/50 text-slate-300 border-slate-600'}`
  return href ? <a href={href} className={cls}><Icon size={12} /> {label}</a>
    : <button onClick={onClick} className={cls}><Icon size={12} /> {label}</button>
}
