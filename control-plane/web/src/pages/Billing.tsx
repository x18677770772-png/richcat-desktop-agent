// 计费页：订阅 + 账单
import { useEffect, useState } from 'react'
import { apiGetBills, apiGetSubscription } from '../api/client'
import { ApiClientError } from '../api/client'
import type { Bill, Subscription } from '../api/types'
import { planName, billStatusName, formatMoney, formatDate, subscriptionStatusName } from '../lib/format'

function subStatusColor(status: string): string {
  const map: Record<string, string> = {
    active: 'var(--success)',
    expired: 'var(--danger)',
    suspended: 'var(--warning)',
  }
  return map[status] ?? 'var(--text-tertiary)'
}

export default function BillingPage() {
  const [sub, setSub] = useState<Subscription | null>(null)
  const [bills, setBills] = useState<Bill[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>('')

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const [s, b] = await Promise.all([apiGetSubscription(), apiGetBills()])
        setSub(s)
        setBills(b.data ?? [])
      } catch (err) {
        setError(err instanceof ApiClientError ? err.message : '加载失败')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  if (loading) return <div className="loading">加载中…</div>
  if (error) return <div className="error-message">{error}</div>

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>计费</h2>
      <div style={{ color: 'var(--text-tertiary)', fontSize: 13, marginBottom: 20 }}>
        订阅套餐与账单记录
      </div>

      {/* 订阅卡片 */}
      {sub && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header">
            <div className="card-title">当前订阅</div>
            <span style={{ fontSize: 13, fontWeight: 600, color: subStatusColor(sub.status) }}>
              {subscriptionStatusName(sub.status)}
            </span>
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 12,
          }}>
            <div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>套餐</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-amber)' }}>
                {planName(sub.plan)}
              </div>
            </div>
            <div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>坐席数</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{sub.seats}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>订阅起始</div>
              <div style={{ fontSize: 14 }}>{formatDate(sub.subscription_start)}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>到期时间</div>
              <div style={{ fontSize: 14, color: sub.subscription_end && new Date(sub.subscription_end) < new Date() ? 'var(--danger)' : 'var(--text-primary)' }}>
                {formatDate(sub.subscription_end)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 账单表格 */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">账单记录</div>
        </div>
        {bills.length === 0 ? (
          <div className="empty-state">暂无账单</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>账单号</th>
                  <th>账期</th>
                  <th>金额</th>
                  <th>状态</th>
                  <th>创建时间</th>
                  <th>支付时间</th>
                </tr>
              </thead>
              <tbody>
                {bills.map(b => (
                  <tr key={b.bill_id}>
                    <td className="mono">{b.bill_id}</td>
                    <td>{b.period}</td>
                    <td style={{ fontWeight: 600 }}>¥{formatMoney(b.amount_cents)}</td>
                    <td><span className={`badge badge-${b.status}`}>{billStatusName(b.status)}</span></td>
                    <td>{formatDate(b.created_at)}</td>
                    <td>{formatDate(b.paid_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="hint" style={{ marginTop: 14 }}>
          续费请联系客服付款，确认后由平台开通。
        </div>
      </div>
    </div>
  )
}