// 舰队视图（第一屏）
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiGetAlerts, apiGetFleet } from '../api/client'
import { ApiClientError } from '../api/client'
import type { Agent, Alert } from '../api/types'
import { statusName, timeAgo, formatDateTime } from '../lib/format'

export default function FleetPage() {
  const nav = useNavigate()
  const [agents, setAgents] = useState<Agent[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const [fleet, alertRes] = await Promise.all([
        apiGetFleet(),
        apiGetAlerts('firing'),
      ])
      setAgents(fleet.data ?? [])
      setAlerts(alertRes.data ?? [])
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const stats = useMemo(() => {
    const total = agents.length
    const online = agents.filter(a => a.status === 'online').length
    const degraded = agents.filter(a => a.status === 'degraded').length
    const offline = agents.filter(a => a.status === 'offline').length
    return { total, online, degraded, offline, todayAlerts: alerts.length }
  }, [agents, alerts])

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>舰队视图</h2>
      <div style={{ color: 'var(--text-tertiary)', fontSize: 13, marginBottom: 20 }}>
        本企业所有财听猫值守终端的实时状态
      </div>

      {/* KPI */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-value" style={{ color: 'var(--text-primary)' }}>{stats.total}</div>
          <div className="kpi-label">总实例</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-value" style={{ color: 'var(--color-online)' }}>{stats.online}</div>
          <div className="kpi-label">在线</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-value" style={{ color: 'var(--color-degraded)' }}>{stats.degraded}</div>
          <div className="kpi-label">降级</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-value" style={{ color: 'var(--color-offline)' }}>{stats.offline}</div>
          <div className="kpi-label">离线</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-value" style={{ color: 'var(--color-amber)' }}>{stats.todayAlerts}</div>
          <div className="kpi-label">今日告警</div>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}
      {loading && <div className="loading">加载中…</div>}

      {/* 终端卡片 */}
      {!loading && !error && (
        agents.length === 0 ? (
          <div className="empty-state">暂无已接入的终端。请确保 Agent 已配置站点 Token 并开始心跳上报。</div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 14,
          }}>
            {agents.map(a => {
              const cpu = Math.round(a.cpu_pct ?? 0)
              const mem = Math.round(a.mem_pct ?? 0)
              return (
                <div
                  key={a.agent_id}
                  className="card"
                  onClick={() => nav(`/agents/${a.agent_id}`)}
                  style={{
                    cursor: 'pointer',
                    transition: 'all var(--transition-normal)',
                    padding: '16px 18px',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.transform = 'translateY(-2px)'
                    e.currentTarget.style.borderColor = 'var(--border-teal)'
                    e.currentTarget.style.boxShadow = 'var(--shadow-glow-teal)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.transform = ''
                    e.currentTarget.style.borderColor = 'var(--border-weak)'
                    e.currentTarget.style.boxShadow = 'var(--shadow-card)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <span className={`status-dot ${a.status}`} />
                    <span style={{ fontWeight: 600, fontSize: 14, fontFamily: 'var(--font-mono)' }}>
                      {a.agent_id.slice(-8)}
                    </span>
                    <span className={`badge badge-${a.status}`}>{statusName(a.status)}</span>
                  </div>

                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 12,
                    color: 'var(--text-secondary)',
                    marginBottom: 4,
                  }}>
                    <span>版本</span>
                    <span className="mono">{a.agent_version || '—'}</span>
                  </div>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 12,
                    color: 'var(--text-secondary)',
                    marginBottom: 4,
                  }}>
                    <span>最近心跳</span>
                    <span title={formatDateTime(a.last_seen)}>{timeAgo(a.last_seen)}</span>
                  </div>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 12,
                    color: 'var(--text-secondary)',
                  }}>
                    <span>CPU / 内存</span>
                    <span>
                      <span style={{ color: cpu > 80 ? 'var(--danger)' : 'var(--text-primary)' }}>{cpu}%</span>
                      {' / '}
                      <span style={{ color: mem > 80 ? 'var(--danger)' : 'var(--text-primary)' }}>{mem}%</span>
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )
      )}
    </div>
  )
}