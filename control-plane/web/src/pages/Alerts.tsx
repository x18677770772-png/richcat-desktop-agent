// 告警中心
import { useCallback, useEffect, useState } from 'react'
import { apiAckAlert, apiGetAlerts } from '../api/client'
import { ApiClientError } from '../api/client'
import type { Alert } from '../api/types'
import { severityName, categoryName, formatDateTime } from '../lib/format'

type TabKey = 'firing' | 'resolved'

export default function AlertsPage() {
  const [tab, setTab] = useState<TabKey>('firing')
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>('')
  const [ackLoading, setAckLoading] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiGetAlerts(tab)
      setAlerts(res.data ?? [])
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => {
    void load()
  }, [load])

  const handleAck = async (id: string) => {
    setAckLoading(id)
    try {
      await apiAckAlert(id)
      setAlerts(prev => prev.filter(a => a.alert_id !== id))
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '确认失败')
    } finally {
      setAckLoading(null)
    }
  }

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>告警中心</h2>
      <div style={{ color: 'var(--text-tertiary)', fontSize: 13, marginBottom: 20 }}>
        离线、降级、资源与安全告警统一管理
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button
          className="btn btn-sm"
          onClick={() => setTab('firing')}
          style={{
            background: tab === 'firing' ? 'linear-gradient(135deg,#d64550,#a8323c)' : 'rgba(255,255,255,0.05)',
            border: tab === 'firing' ? 'transparent' : 'var(--border-weak)',
            color: tab === 'firing' ? '#fff' : 'var(--text-secondary)',
          }}
        >
          进行中
        </button>
        <button
          className="btn btn-sm"
          onClick={() => setTab('resolved')}
          style={{
            background: tab === 'resolved' ? 'linear-gradient(135deg,#2e9e5b,#1e7a44)' : 'rgba(255,255,255,0.05)',
            border: tab === 'resolved' ? 'transparent' : 'var(--border-weak)',
            color: tab === 'resolved' ? '#fff' : 'var(--text-secondary)',
          }}
        >
          已恢复
        </button>
      </div>

      {error && <div className="error-message">{error}</div>}
      {loading && <div className="loading">加载中…</div>}

      {!loading && !error && (
        alerts.length === 0 ? (
          <div className="empty-state">{tab === 'firing' ? '暂无进行中的告警' : '暂无已恢复的告警'}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {alerts.map(a => (
              <div key={a.alert_id} className="card" style={{ padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span className={`badge badge-${a.severity}`}>{severityName(a.severity)}</span>
                  <span className={`badge badge-${a.state}`}>{a.state === 'firing' ? '进行中' : '已恢复'}</span>
                  {a.ack_status !== 'closed' && (
                    <span className={`badge badge-${a.ack_status}`}>
                      {a.ack_status === 'unacked' ? '未确认' : '已确认'}
                    </span>
                  )}
                  <span style={{
                    fontSize: 11, color: 'var(--text-tertiary)', background: 'var(--bg-glass)',
                    padding: '1px 8px', borderRadius: 'var(--radius-full)',
                  }}>
                    {categoryName(a.category)}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {a.agent_id}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
                    {formatDateTime(a.created_at)}
                  </span>
                </div>

                <div style={{ marginTop: 8, fontSize: 14, fontWeight: 600 }}>{a.title_safe}</div>
                {a.detail_safe && (
                  <div style={{ marginTop: 4, fontSize: 13, color: 'var(--text-secondary)' }}>
                    {a.detail_safe}
                  </div>
                )}

                {a.state === 'firing' && a.ack_status === 'unacked' && (
                  <div style={{ marginTop: 10 }}>
                    <button
                      className="btn btn-sm"
                      disabled={ackLoading === a.alert_id}
                      onClick={() => handleAck(a.alert_id)}
                    >
                      {ackLoading === a.alert_id ? '确认中…' : '确认告警'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}