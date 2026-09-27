// API Spend (SpendTracker.html phase S2): live view of what CWP's paid API
// calls cost and whether each API key still works. Reads /api/spend; the
// service decides what this viewer may see (own tenant vs platform-wide),
// so this page just renders whatever scope comes back.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DailyBarChart, type DailyPoint } from '../components/DailyBarChart'
import { getKeyStatus, getSpendSummary, runKeyChecks, type KeyStatus, type SpendMeasures, type SpendSummary } from '../data/spend'
import { ApiError, ApiNotConfiguredError } from '../lib/apiClient'

const REFRESH_MS = 30_000

type RangeKey = 'month' | '7d' | '30d'
const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'month', label: 'This month' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
]

function rangeBounds(key: RangeKey, now = new Date()): { from: Date; to: Date } {
  const to = new Date(now.getTime() + 1000)
  if (key === 'month') return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), to }
  const days = key === '7d' ? 7 : 30
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)))
  return { from, to }
}

export function SpendPage() {
  const [range, setRange] = useState<RangeKey>('month')
  const [metric, setMetric] = useState<'cost' | 'calls'>('cost')
  const [summary, setSummary] = useState<SpendSummary | null>(null)
  const [keys, setKeys] = useState<KeyStatus[] | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [checking, setChecking] = useState(false)
  // Once the service says this viewer isn't a platform admin, stop asking
  // for key health on every refresh.
  const keysForbidden = useRef(false)

  const load = useCallback(async () => {
    const { from, to } = rangeBounds(range)
    try {
      const [s, k] = await Promise.all([
        getSpendSummary(from, to),
        keysForbidden.current ? Promise.resolve(null) : getKeyStatus(),
      ])
      if (k === null) keysForbidden.current = true
      setSummary(s)
      setKeys(k)
      setError(null)
      setUpdatedAt(new Date())
    } catch (err) {
      if (err instanceof ApiNotConfiguredError) setError('The CWP API is not configured (VITE_API_BASE_URL).')
      else if (err instanceof ApiError) setError(err.message)
      else setError(err instanceof Error ? err.message : 'Could not load API spend.')
    }
  }, [range])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => {
      if (!document.hidden) void load()
    }, REFRESH_MS)
    return () => window.clearInterval(id)
  }, [load])

  const onCheckNow = async () => {
    setChecking(true)
    try {
      await runKeyChecks()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Key check failed.')
    } finally {
      setChecking(false)
    }
  }

  const points = useMemo<DailyPoint[]>(() => {
    if (!summary) return []
    const byDay = new Map(summary.daily.map((d) => [d.day, d]))
    const out: DailyPoint[] = []
    const { from, to } = rangeBounds(range)
    for (let d = new Date(from); d < to; d = new Date(d.getTime() + 86_400_000)) {
      const day = d.toISOString().slice(0, 10)
      const row = byDay.get(day)
      out.push({ day, value: row ? (metric === 'cost' ? Number(row.costUsd) : row.calls) : 0 })
    }
    return out
  }, [summary, metric, range])

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-[#003b70]">API Spend</h1>
          <p className="text-xs text-slate-500">
            Estimated cost of the paid API calls CWP makes, from each call&apos;s token counts. Calls through the same
            keys from outside CWP are not included.
          </p>
        </div>
        {summary && (
          <span className="rounded bg-sky-100 px-2 py-0.5 text-[10px] font-bold uppercase text-sky-700">
            {summary.scope === 'platform' ? 'Platform-wide' : 'Your tenant'}
          </span>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setRange(r.key)}
            aria-pressed={range === r.key}
            className={`rounded border px-3 py-1 text-xs ${range === r.key ? 'border-[#0066b2] bg-[#0066b2] text-white' : 'border-sky-300 bg-white text-sky-700 hover:bg-sky-50'}`}
          >
            {r.label}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-slate-400">
          {updatedAt ? `Updated ${updatedAt.toLocaleTimeString()} · refreshes every 30s` : 'Loading...'}
        </span>
      </div>

      {error && <p className="rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>}

      {summary && (
        <>
          <StatTiles total={summary.total} />

          <div>
            <div className="mb-2 flex gap-2">
              {(['cost', 'calls'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMetric(m)}
                  aria-pressed={metric === m}
                  className={`rounded px-2 py-0.5 text-xs ${metric === m ? 'bg-sky-100 font-semibold text-sky-800' : 'text-sky-700 hover:underline'}`}
                >
                  {m === 'cost' ? 'Estimated cost' : 'Calls'}
                </button>
              ))}
            </div>
            <DailyBarChart
              title={metric === 'cost' ? 'Estimated cost per day (USD, priced calls only)' : 'Model calls per day'}
              points={points}
              format={metric === 'cost' ? formatUsd : (v) => String(Math.round(v))}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Breakdown title="By provider" rows={summary.byProvider.map((r) => ({ label: r.provider, m: r }))} />
            <Breakdown title="By model" rows={summary.byModel.map((r) => ({ label: `${r.provider} / ${r.model}`, m: r }))} />
            <Breakdown title="By feature" rows={summary.byFeature.map((r) => ({ label: `${r.service} · ${r.feature}`, m: r }))} />
            {summary.scope === 'platform' && (
              <Breakdown title="By tenant" rows={summary.byTenant.map((r) => ({ label: r.tenantId, m: r }))} />
            )}
          </div>
        </>
      )}

      <KeyHealth keys={keys} checking={checking} onCheckNow={onCheckNow} />
    </div>
  )
}

function StatTiles({ total }: { total: SpendMeasures }) {
  const failed = total.rateLimitedCalls + total.failedCalls
  const tiles = [
    { label: 'Estimated spend', value: formatUsd(Number(total.costUsd)), note: 'priced calls only' },
    { label: 'Model calls', value: total.calls.toLocaleString(), note: failed ? `${failed} failed or rate-limited` : 'none failed' },
    {
      label: 'Tokens',
      value: (total.inputTokens + total.outputTokens).toLocaleString(),
      note: `${total.inputTokens.toLocaleString()} in · ${total.outputTokens.toLocaleString()} out`,
    },
    {
      label: 'Unpriced calls',
      value: total.unpricedCalls.toLocaleString(),
      note: total.unpricedCalls ? 'no published price; not in the spend total' : 'every call priced',
    },
  ]
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="rounded border border-sky-200 bg-white p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t.label}</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-slate-900">{t.value}</div>
          <div className="text-[11px] text-slate-500">{t.note}</div>
        </div>
      ))}
    </div>
  )
}

function Breakdown({ title, rows }: { title: string; rows: { label: string; m: SpendMeasures }[] }) {
  return (
    <section className="rounded border border-sky-200 bg-white p-4">
      <h2 className="mb-2 text-sm font-bold text-[#003b70]">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-400">No calls in this period.</p>
      ) : (
        <table className="w-full text-left text-xs text-slate-700">
          <thead>
            <tr className="border-b border-sky-100 text-slate-500">
              <th className="py-1 font-semibold" />
              <th className="py-1 text-right font-semibold">Calls</th>
              <th className="py-1 text-right font-semibold">Tokens</th>
              <th className="py-1 text-right font-semibold">Est. cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ label, m }) => (
              <tr key={label} className="border-b border-slate-100">
                <td className="max-w-[16rem] truncate py-1 font-mono" title={label}>{label}</td>
                <td className="py-1 text-right tabular-nums">{m.calls}</td>
                <td className="py-1 text-right tabular-nums">{(m.inputTokens + m.outputTokens).toLocaleString()}</td>
                <td className="py-1 text-right tabular-nums">
                  {m.unpricedCalls === m.okCalls && m.okCalls > 0 ? <span className="text-slate-400">unpriced</span> : formatUsd(Number(m.costUsd))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

type Health = { tone: 'good' | 'warning' | 'critical' | 'neutral'; icon: string; label: string; why: string }

/** A free check can't see a spend cap; a rate-limited last call can. */
function keyHealth(k: KeyStatus): Health {
  if (k.status === 'expired') return { tone: 'critical', icon: '✕', label: 'Expired', why: 'Renew the key with the provider.' }
  if (k.status === 'invalid') return { tone: 'critical', icon: '✕', label: 'Invalid', why: k.detail ?? 'The provider rejected the key.' }
  if (k.status === 'missing') return { tone: 'neutral', icon: '–', label: 'Not configured', why: 'The tracker has no value for this key.' }
  if (k.status === 'error') return { tone: 'warning', icon: '!', label: 'Check failed', why: k.detail ?? 'Could not reach the provider.' }
  if (k.lastCallOutcome === 'rate_limited')
    return { tone: 'warning', icon: '!', label: 'Rate-limited', why: 'The key is valid, but its last real call was refused (rate limit, quota or spend cap).' }
  return { tone: 'good', icon: '✓', label: 'OK', why: 'The key is valid.' }
}

const TONE_COLOR: Record<Health['tone'], string> = {
  good: '#0ca30c',
  warning: '#fab219',
  critical: '#d03b3b',
  neutral: '#898781',
}

function KeyHealth({ keys, checking, onCheckNow }: { keys: KeyStatus[] | null | undefined; checking: boolean; onCheckNow: () => void }) {
  if (keys === undefined) return null
  if (keys === null) {
    return (
      <section className="rounded border border-sky-200 bg-white p-4 text-xs text-slate-500">
        <h2 className="mb-1 text-sm font-bold text-[#003b70]">API key health</h2>
        Visible to platform admins only (<code>SPEND_ADMIN_USER_IDS</code>).
      </section>
    )
  }
  return (
    <section className="rounded border border-sky-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-bold text-[#003b70]">API key health</h2>
        <button
          type="button"
          onClick={onCheckNow}
          disabled={checking}
          className="rounded border border-sky-300 bg-white px-3 py-1 text-xs text-sky-700 hover:bg-sky-50 disabled:opacity-50"
        >
          {checking ? 'Checking...' : 'Check now'}
        </button>
      </div>
      <table className="w-full text-left text-xs text-slate-700">
        <thead>
          <tr className="border-b border-sky-100 text-slate-500">
            <th className="py-1 font-semibold">Key</th>
            <th className="py-1 font-semibold">Provider</th>
            <th className="py-1 font-semibold">Status</th>
            <th className="py-1 font-semibold">Last checked</th>
            <th className="py-1 font-semibold">Last call</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => {
            const h = keyHealth(k)
            return (
              <tr key={k.keyAlias} className="border-b border-slate-100 align-top">
                <td className="py-1.5 font-mono">{k.keyAlias}</td>
                <td className="py-1.5">{k.provider}</td>
                <td className="py-1.5">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800" title={h.why}>
                    <span
                      aria-hidden
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold"
                      // Warning yellow is too light for white ink; use dark ink on it.
                      style={{ backgroundColor: TONE_COLOR[h.tone], color: h.tone === 'warning' ? '#0b0b0b' : '#ffffff' }}
                    >
                      {h.icon}
                    </span>
                    {h.label}
                  </span>
                  <div className="text-[11px] text-slate-500">{h.why}</div>
                </td>
                <td className="py-1.5 text-slate-500">{new Date(k.checkedAt).toLocaleString()}</td>
                <td className="py-1.5 text-slate-500">
                  {k.lastCallAt ? `${k.lastCallOutcome?.replace('_', ' ')} · ${new Date(k.lastCallAt).toLocaleString()}` : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}

function formatUsd(v: number): string {
  if (v === 0) return '$0.00'
  if (Math.abs(v) < 0.01) return `$${v.toFixed(4)}`
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
