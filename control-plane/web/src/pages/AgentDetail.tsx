// 单机详情
import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import ReactECharts from 'echarts-for-react'
import { apiGetAgent } from '../api/client'
import { ApiClientError } from '../api/client'
import type { Agent, UsageDaily } from '../api/types'
import { statusName, formatDateTime, timeAgo } from '../lib/format'

interface AgentDetail extends Agent {
  usage_last_7d?: UsageDaily[]
}

export default function AgentDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const nav = useNavigate()
  const [detail, setDetail] = useState<AgentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await apiGetAgent(id)
      setDetail({ ...data.agent, usage_last_7d: data.usage_last_7d ?? [] })
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [id])

  const chartOption = useMemo(() => {
    const usage = detail?.usage_last_7d ?? []
    const days = usage.map(u => u.day)
    const messages = usage.map(u => u.messages)
    const replies = usage.map(u => u.replies)
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis' },
      legend: { data: ['消息量', '回复量'], textStyle: { color: '#aeb6c4' }, bottom: 0 },
      grid: { left: 40, right: 20, top: 20, bottom: 40 },
      xAxis: {
        type: 'category',
        data: days,
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } },
        axisLabel: { color: '#8a94a3' },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
        axisLabel: { color: '#8a94a3' },
      },
      series: [
        {
          name: '消息量',
          type: 'line',
          smooth: true,
          data: messages,
          itemStyle: { color: '#1ba69e' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(27,166,158,0.35)' },
                { offset: 1, color: 'rgba(27,166,158,0)' },
              ],
            },
          },
        },
        {
          name: '回复量',
          type: 'line',
          smooth: true,
          data: replies,
          itemStyle: { color: '#e8a33d' },
        },
      ],
    }
  }, [detail])

  if (loading) return <div className="loading">加载中…</div>
  if (error) return <div className="error-message">{error}</div>
  if (!detail) return <div className="empty-state">未找到该终端</div>

  const cpu = Math.round(detail.cpu_pct ?? 0)
  const mem = Math.round(detail.mem_pct ?? 0)

  return (
    <div>
      <button
        className="btn btn-sm"
        onClick={() => nav('/')}
        style={{ marginBottom: 16, background: 'transparent' }}
      >
        ← 返回舰队
      </button>

      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>
        <span className="mono" style={{ fontSize: 18 }}>{detail.agent_id}</span>
      </h2>
      <div style={{ color: 'var(--text-tertiary)', fontSize: 13, marginBottom: 20 }}>
        终端详情与近 7 天用量
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-header">
            <div className="card-title">基本信息</div>
            <span className={`badge badge-${detail.status}`}>
              <span className="status-dot" style={{ marginRight: 4 }} /> {statusName(detail.status)}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 14px', fontSize: 13 }}>
            <div><div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>Agent ID</div><div className="mono">{detail.agent_id}</div></div>
            <div><div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>版本</div><div>{detail.agent_version || '—'}</div></div>
            <div><div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>租户</div><div className="mono">{detail.tenant_id}</div></div>
            <div><div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>站点</div><div className="mono">{detail.site_id}</div></div>
            <div><div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>首次接入</div><div>{formatDateTime(detail.first_seen)}</div></div>
            <div><div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>最近心跳</div><div>{timeAgo(detail.last_seen)}</div></div>
            <div><div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>微信状态</div><div>{detail.wechat_state || '未知'}</div></div>
            <div><div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>磁盘剩余</div><div>{detail.disk_free_gb != null ? `${detail.disk_free_gb} GB` : '—'}</div></div>
          </div>
        </div>

        <div className="card">
          <div className="card-title" style={{ marginBottom: 12 }}>资源占用</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div style={{
                display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 4,
              }}>
                <span>CPU</span><span style={{ color: cpu > 80 ? 'var(--danger)' : 'var(--text-primary)' }}>{cpu}%</span>
              </div>
              <div style={{ height: 8, background: 'rgba(255,255,255,0.07)', borderRadius: 999, overflow: 'hidden' }}>
                <div style={{
                  width: `${Math.min(cpu, 100)}%`, height: '100%',
                  background: cpu > 80 ? 'var(--danger)' : 'linear-gradient(90deg,#1ba69e,#10b981)',
                  borderRadius: 999,
                }} />
              </div>
            </div>
            <div>
              <div style={{
                display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 4,
              }}>
                <span>内存</span><span style={{ color: mem > 80 ? 'var(--danger)' : 'var(--text-primary)' }}>{mem}%</span>
              </div>
              <div style={{ height: 8, background: 'rgba(255,255,255,0.07)', borderRadius: 999, overflow: 'hidden' }}>
                <div style={{
                  width: `${Math.min(mem, 100)}%`, height: '100%',
                  background: mem > 80 ? 'var(--danger)' : 'linear-gradient(90deg,#1ba69e,#10b981)',
                  borderRadius: 999,
                }} />
              </div>
            </div>
          </div>
          <div className="hint">
            总消息 / 回复 / 接管 / API 调用：可切换至「用量看板」查看全企业汇总。
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title">近 7 天用量</div>
        </div>
        <ReactECharts
          option={chartOption}
          style={{ height: 280 }}
          notMerge
        />
      </div>
    </div>
  )
}