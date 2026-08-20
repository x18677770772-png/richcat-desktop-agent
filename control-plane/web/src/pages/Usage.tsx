// 用量看板
import { useEffect, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { apiGetUsage } from '../api/client'
import { ApiClientError } from '../api/client'
import type { UsageResponse } from '../api/types'
import { daysAgo, today, formatDate } from '../lib/format'

type RangeKey = '7d' | '30d'

const rangeMap: Record<RangeKey, { label: string; days: number }> = {
  '7d': { label: '近 7 天', days: 7 },
  '30d': { label: '近 30 天', days: 30 },
}

export default function UsagePage() {
  const [range, setRange] = useState<RangeKey>('7d')
  const [data, setData] = useState<UsageResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const from = daysAgo(rangeMap[range].days)
      const to = today()
      const res = await apiGetUsage(from, to)
      setData(res)
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [range])

  const chartOption = useMemo(() => {
    const s = data?.summary
    if (!s) return {}
    const items = [
      { name: '消息量', value: s.total_messages, color: '#1ba69e' },
      { name: '回复量', value: s.total_replies, color: '#e8a33d' },
      { name: '接管次数', value: s.total_handoffs, color: '#4a9eff' },
      { name: 'API 调用', value: s.total_api_calls, color: '#b48eff' },
      { name: '会话数', value: s.total_sessions, color: '#2e9e5b' },
    ]
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis' },
      grid: { left: 50, right: 20, top: 20, bottom: 30 },
      xAxis: {
        type: 'category',
        data: items.map(i => i.name),
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } },
        axisLabel: { color: '#aeb6c4' },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
        axisLabel: { color: '#8a94a3' },
      },
      series: [
        {
          type: 'bar',
          data: items.map(i => ({
            value: i.value,
            itemStyle: { color: i.color, borderRadius: [4, 4, 0, 0] },
          })),
          barWidth: 40,
        },
      ],
    }
  }, [data])

  const summary = data?.summary
  const cards = [
    { label: '消息量', value: summary?.total_messages ?? 0 },
    { label: '回复量', value: summary?.total_replies ?? 0 },
    { label: '接管次数', value: summary?.total_handoffs ?? 0 },
    { label: 'API 调用', value: summary?.total_api_calls ?? 0 },
    { label: '会话数', value: summary?.total_sessions ?? 0 },
  ]

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>用量看板</h2>
      <div style={{ color: 'var(--text-tertiary)', fontSize: 13, marginBottom: 20 }}>
        本企业范围内的用量汇总
      </div>

      {/* 时间范围 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {(Object.keys(rangeMap) as RangeKey[]).map(key => (
          <button
            key={key}
            className="btn btn-sm"
            onClick={() => setRange(key)}
            style={{
              background: range === key ? 'linear-gradient(135deg,#1ba69e,#10b981)' : 'rgba(255,255,255,0.05)',
              border: range === key ? 'transparent' : 'var(--border-weak)',
              color: range === key ? '#fff' : 'var(--text-secondary)',
            }}
          >
            {rangeMap[key].label}
          </button>
        ))}
      </div>

      {error && <div className="error-message">{error}</div>}
      {loading && <div className="loading">加载中…</div>}

      {!loading && !error && data && (
        <>
          <div style={{
            color: 'var(--text-tertiary)', fontSize: 12, marginBottom: 12,
          }}>
            统计区间：{formatDate(data.from)} ~ {formatDate(data.to)}
          </div>
          <div className="kpi-grid" style={{ marginBottom: 20 }}>
            {cards.map(c => (
              <div key={c.label} className="kpi-card">
                <div className="kpi-value" style={{ color: 'var(--color-teal)' }}>{c.value.toLocaleString()}</div>
                <div className="kpi-label">{c.label}</div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">指标对比</div>
            </div>
            <ReactECharts option={chartOption} style={{ height: 300 }} notMerge />
          </div>
        </>
      )}
    </div>
  )
}