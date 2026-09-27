// Single-series daily column chart (API Spend page). One series, so no
// legend: the title names it. Hand-built SVG to avoid a chart dependency.
// Mark spec (dataviz): columns <= 24px wide, 4px rounded top, square at the
// baseline, recessive grid, hover tooltip on a hit target wider than the
// mark, and a table view so values are never color/position-only.
// Series color #0066b2 validated against the white surface (all checks pass).
import { useEffect, useMemo, useRef, useState } from 'react'

export interface DailyPoint {
  day: string // YYYY-MM-DD
  value: number
}

const HEIGHT = 180
const PAD = { top: 12, right: 12, bottom: 28, left: 56 }
const MAX_BAR = 24

export function DailyBarChart({
  title,
  points,
  format,
}: {
  title: string
  points: DailyPoint[]
  format: (v: number) => string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const [showTable, setShowTable] = useState(false)
  // Render at the container's real pixel width so text and marks stay at
  // their specified sizes instead of scaling with a viewBox.
  const boxRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(720)
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(120, Math.floor(entry.contentRect.width))))
    observer.observe(el)
    return () => observer.disconnect()
  }, [showTable, points.length])

  const { max, ticks } = useMemo(() => {
    const top = Math.max(...points.map((p) => p.value), 0)
    const niceMax = niceCeil(top)
    return { max: niceMax, ticks: [0, niceMax / 2, niceMax] }
  }, [points])

  const plotW = width - PAD.left - PAD.right
  const plotH = HEIGHT - PAD.top - PAD.bottom
  const band = points.length ? plotW / points.length : plotW
  const barW = Math.min(MAX_BAR, band * 0.6)
  const y = (v: number) => PAD.top + plotH - (max ? (v / max) * plotH : 0)
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(plotW / 70))))
  // Dim the other bars only when the hovered day actually has a bar.
  const focus = hover !== null && points[hover]?.value > 0 ? hover : null

  return (
    <figure className="rounded border border-sky-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <figcaption className="text-sm font-bold text-[#003b70]">{title}</figcaption>
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          className="text-xs text-sky-700 hover:underline"
        >
          {showTable ? 'Show chart' : 'Show table'}
        </button>
      </div>

      {points.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">No calls in this period.</p>
      ) : showTable ? (
        <table className="w-full text-left text-xs text-slate-700">
          <thead>
            <tr className="border-b border-sky-100 text-slate-500">
              <th className="py-1 font-semibold">Day (UTC)</th>
              <th className="py-1 text-right font-semibold">{title}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.day} className="border-b border-slate-100">
                <td className="py-1">{p.day}</td>
                <td className="py-1 text-right tabular-nums">{format(p.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative" ref={boxRef}>
          <svg width={width} height={HEIGHT} className="block" role="img" aria-label={title}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? '#c3c2b7' : '#e1e0d9'} strokeWidth={1} />
                <text x={PAD.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="#898781">
                  {format(t)}
                </text>
              </g>
            ))}
            {points.map((p, i) => {
              const cx = PAD.left + band * i + band / 2
              const top = y(p.value)
              const h = PAD.top + plotH - top
              return (
                <g key={p.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  {/* hit target: the whole band, taller than the mark */}
                  <rect x={PAD.left + band * i} y={PAD.top} width={band} height={plotH} fill="transparent" />
                  {h > 0 && <path d={columnPath(cx - barW / 2, top, barW, h)} fill="#0066b2" opacity={focus === null || focus === i ? 1 : 0.55} />}
                  {i % labelEvery === 0 && (
                    <text x={cx} y={HEIGHT - 8} textAnchor="middle" fontSize={11} fill="#898781">
                      {p.day.slice(5)}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>
          {hover !== null && (
            <div
              className="pointer-events-none absolute -translate-x-1/2 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 shadow"
              style={{
                left: `${((PAD.left + band * hover + band / 2) / width) * 100}%`,
                top: 0,
              }}
            >
              <div className="text-slate-500">{points[hover].day}</div>
              <div className="font-semibold tabular-nums">{format(points[hover].value)}</div>
            </div>
          )}
        </div>
      )}
    </figure>
  )
}

/** Column with a 4px rounded top and a square base. */
function columnPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h)
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`
}

function niceCeil(v: number): number {
  if (v <= 0) return 1
  const exp = Math.pow(10, Math.floor(Math.log10(v)))
  const f = v / exp
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10
  return nice * exp
}
