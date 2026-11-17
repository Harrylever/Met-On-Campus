'use client'
import { useId, useState } from 'react'

// Thin bars, 4px rounded data ends anchored to the baseline, 2px gaps, recessive grid, hover readout, table fallback.
// One series = one colour and no legend box (the title names it). Colours are tokens, so dark mode is selected, not flipped.
type Point = { label: string; value: number }
const W = 640, H = 150, PAD = { l: 34, r: 8, t: 8, b: 22 }

function niceMax(v: number) {
  if (v <= 4) return 4
  const p = 10 ** Math.floor(Math.log10(v)); const n = v / p
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p
}
function barPath(x: number, y: number, w: number, h: number, r = 4) {
  if (h <= 0) return ''
  const rr = Math.min(r, w / 2, h) // round only the data end; the baseline end stays flat
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`
}

export function BarChart({ title, unit, data, errors }: { title: string; unit: string; data: Point[]; errors?: number[] }) {
  const id = useId()
  const [hover, setHover] = useState<number | null>(null)
  const max = niceMax(Math.max(1, ...data.map((d) => d.value)))
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b
  const slot = iw / Math.max(1, data.length), bw = Math.max(2, slot - 2) // 2px surface gap between adjacent bars
  const total = data.reduce((s, d) => s + d.value, 0)
  const y = (v: number) => PAD.t + ih - (v / max) * ih
  const last = data.at(-1)
  const shown = hover !== null ? data[hover] : null

  return (
    <figure className="card space-y-2">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="label">{title}</span>
        <span className="text-xs text-ink-2" aria-live="polite">
          {shown ? <><b className="text-ink">{shown.value.toLocaleString()}</b> {unit} · {shown.label}{errors?.[hover!] ? <> · <span className="text-danger">⚠ {errors[hover!]} server errors</span></> : null}</>
            : <><b className="text-ink">{total.toLocaleString()}</b> {unit} in range{last ? ` · latest ${last.value.toLocaleString()}` : ''}</>}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={id} className="h-auto w-full touch-none"
        onPointerLeave={() => setHover(null)}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const x = ((e.clientX - r.left) / r.width) * W - PAD.l
          setHover(Math.min(data.length - 1, Math.max(0, Math.floor(x / slot))))
        }}>
        <title id={id}>{`${title}: ${total.toLocaleString()} ${unit} over ${data.length} points. Use the table view for exact values.`}</title>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(max * t)} y2={y(max * t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={PAD.l - 6} y={y(max * t) + 3} textAnchor="end" fontSize={10} fill="var(--ink-3)">{Math.round(max * t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = PAD.l + i * slot + 1
          const err = errors?.[i] ?? 0
          const okH = ((d.value - err) / max) * ih, errH = (err / max) * ih
          return (
            <g key={d.label} opacity={hover === null || hover === i ? 1 : 0.45}>
              {err > 0 ? (<>
                <path d={barPath(x, y(d.value - err), bw, okH, 0)} fill="var(--series-1)" />
                <path d={barPath(x, y(d.value), bw, errH - 2, 3)} fill="var(--status-critical)" />
              </>) : <path d={barPath(x, y(d.value), bw, (d.value / max) * ih)} fill="var(--series-1)" />}
              <rect x={PAD.l + i * slot} y={PAD.t} width={slot} height={ih} fill="transparent" />{/* hit target wider than the mark */}
            </g>
          )
        })}
        <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + ih} y2={PAD.t + ih} stroke="var(--ink-3)" strokeWidth={1} />
        {data.length > 0 && <>
          <text x={PAD.l} y={H - 6} fontSize={10} fill="var(--ink-3)">{data[0]!.label}</text>
          <text x={W - PAD.r} y={H - 6} fontSize={10} textAnchor="end" fill="var(--ink-3)">{data.at(-1)!.label}</text>
        </>}
      </svg>
      {errors && (
        <p className="flex flex-wrap gap-4 text-xs text-ink-2">
          <span className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-[var(--series-1)]" />Requests</span>
          <span className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-[var(--status-critical)]" />⚠ Server errors (5xx)</span>
        </p>
      )}
      <details className="text-xs text-ink-2">
        <summary className="cursor-pointer">Table view</summary>
        <div className="mt-2 max-h-48 overflow-auto">
          <table className="w-full text-left"><thead><tr><th className="py-1 pr-4 font-medium">When</th><th className="py-1 font-medium capitalize">{unit}</th>{errors && <th className="py-1 font-medium">Server errors</th>}</tr></thead>
            <tbody>{data.map((d, i) => <tr key={d.label} className="border-t border-line"><td className="py-1 pr-4">{d.label}</td><td className="py-1 tabular-nums">{d.value}</td>{errors && <td className="py-1 tabular-nums">{errors[i]}</td>}</tr>)}</tbody></table>
        </div>
      </details>
    </figure>
  )
}

export function Stat({ label, value, note, tone }: { label: string; value: string | number; note?: string; tone?: 'danger' | 'ok' }) {
  return (
    <div className="card">
      <p className="label">{label}</p>
      <p className={`mt-1 font-display text-3xl font-bold tabular-nums ${tone === 'danger' ? 'text-danger' : ''}`}>{typeof value === 'number' ? value.toLocaleString() : value}</p>
      {note && <p className="mt-0.5 text-xs text-ink-2">{note}</p>}
    </div>
  )
}
