// 超管管理页：企业列表 + 建企业 + 建账单 + 标记已付
import React, { useCallback, useEffect, useState } from 'react'
import {
  apiCreateBill,
  apiCreateTenant,
  apiListTenants,
  apiMarkBillPaid,
} from '../api/client'
import { ApiClientError } from '../api/client'
import type { Bill, Plan, Tenant } from '../api/types'
import { planName, tenantStatusName, formatDate, formatMoney, billStatusName } from '../lib/format'

const planOptions: { value: Plan | ''; label: string }[] = [
  { value: '', label: '选择套餐' },
  { value: 'community', label: '社区版' },
  { value: 'standard', label: '标准版' },
  { value: 'pro', label: '专业版' },
  { value: 'strategic', label: '战略伙伴版' },
  { value: 'flagship', label: '旗舰版' },
]

function tenantStatusColor(status: string): string {
  const map: Record<string, string> = {
    active: 'var(--success)',
    expired: 'var(--danger)',
    suspended: 'var(--warning)',
  }
  return map[status] ?? 'var(--text-tertiary)'
}

function genSiteToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += chars[bytes[i] % chars.length]
  return out
}

interface TenantWithBills extends Tenant {
  bills: Bill[]
}

export default function PlatformPage() {
  const [tenants, setTenants] = useState<TenantWithBills[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>('')
  const [notice, setNotice] = useState<string>('')

  // 建企业表单
  const [tenantName, setTenantName] = useState('')
  const [tenantPlan, setTenantPlan] = useState<Plan | ''>('')
  const [tenantSeats, setTenantSeats] = useState(5)
  const [siteToken, setSiteToken] = useState('')
  const [creatingTenant, setCreatingTenant] = useState(false)

  // 建账单表单
  const [billTenantId, setBillTenantId] = useState('')
  const [billPeriod, setBillPeriod] = useState('')
  const [billAmount, setBillAmount] = useState('')
  const [creatingBill, setCreatingBill] = useState(false)

  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiListTenants()
      setTenants((res.data ?? []).map(t => ({ ...t, bills: [] })))
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const showNotice = (msg: string) => {
    setNotice(msg)
    setTimeout(() => setNotice(''), 6000)
  }

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!tenantName.trim()) {
      setError('请输入企业名称')
      return
    }
    setCreatingTenant(true)
    try {
      const res = await apiCreateTenant({
        name: tenantName.trim(),
        plan: (tenantPlan as Plan) || 'standard',
        seats: tenantSeats || 5,
        site_token: siteToken.trim() || undefined,
      })
      showNotice(`企业创建成功。站点 Token：${res.site_token}（请妥善保存）`)
      setTenantName('')
      setTenantPlan('')
      setTenantSeats(5)
      setSiteToken('')
      await load()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '创建失败')
    } finally {
      setCreatingTenant(false)
    }
  }

  const handleCreateBill = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!billTenantId || !billPeriod.trim() || !billAmount) {
      setError('请完整填写企业、账期与金额')
      return
    }
    const amountCents = Math.round(parseFloat(billAmount) * 100)
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      setError('金额格式不正确')
      return
    }
    setCreatingBill(true)
    try {
      await apiCreateBill({
        tenant_id: billTenantId,
        period: billPeriod.trim(),
        amount_cents: amountCents,
      })
      showNotice('账单创建成功')
      setBillPeriod('')
      setBillAmount('')
      await load()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '创建失败')
    } finally {
      setCreatingBill(false)
    }
  }

  const handleMarkPaid = async (id: string) => {
    setError('')
    try {
      await apiMarkBillPaid(id)
      showNotice('账单已标记为已付')
      await load()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '操作失败')
    }
  }

  const toggleExpand = (id: string) => {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>企业管理</h2>
      <div style={{ color: 'var(--text-tertiary)', fontSize: 13, marginBottom: 20 }}>
        平台超管：创建企业、管理套餐与账单
      </div>

      {notice && (
        <div style={{
          color: 'var(--success)', background: 'var(--success-bg)',
          borderRadius: 'var(--radius-md)', padding: '10px 14px', marginBottom: 16, fontSize: 13,
        }}>
          {notice}
        </div>
      )}
      {error && <div className="error-message">{error}</div>}

      <div className="grid-2" style={{ marginBottom: 20 }}>
        {/* 建企业 */}
        <form onSubmit={handleCreateTenant} className="card">
          <div className="card-header">
            <div className="card-title">创建企业</div>
          </div>
          <div className="form-group">
            <label className="form-label">企业名称 *</label>
            <input
              className="input"
              value={tenantName}
              onChange={e => setTenantName(e.target.value)}
              placeholder="例如：某某科技有限公司"
            />
          </div>
          <div className="form-row" style={{ marginBottom: 14 }}>
            <div className="form-group">
              <label className="form-label">套餐</label>
              <select
                className="select"
                value={tenantPlan}
                onChange={e => setTenantPlan(e.target.value as Plan | '')}
              >
                {planOptions.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">坐席数</label>
              <input
                className="input"
                type="number"
                min={1}
                value={tenantSeats}
                onChange={e => setTenantSeats(parseInt(e.target.value) || 0)}
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">站点 Token（留空自动生成）</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input"
                value={siteToken}
                onChange={e => setSiteToken(e.target.value)}
                placeholder="st_xxxxxxxx"
                style={{ fontFamily: 'var(--font-mono)' }}
              />
              <button type="button" className="btn" onClick={() => setSiteToken(genSiteToken())}>
                生成
              </button>
            </div>
          </div>
          <button className="btn btn-primary" disabled={creatingTenant}>
            {creatingTenant ? '创建中…' : '创建企业'}
          </button>
        </form>

        {/* 建账单 */}
        <form onSubmit={handleCreateBill} className="card">
          <div className="card-header">
            <div className="card-title">创建账单</div>
          </div>
          <div className="form-group">
            <label className="form-label">企业</label>
            <select
              className="select"
              value={billTenantId}
              onChange={e => setBillTenantId(e.target.value)}
            >
              <option value="">选择企业</option>
              {tenants.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div className="form-row" style={{ marginBottom: 14 }}>
            <div className="form-group">
              <label className="form-label">账期（YYYY-MM）</label>
              <input
                className="input"
                value={billPeriod}
                onChange={e => setBillPeriod(e.target.value)}
                placeholder="2026-08"
              />
            </div>
            <div className="form-group">
              <label className="form-label">金额（元）</label>
              <input
                className="input"
                type="number"
                step="0.01"
                min="0"
                value={billAmount}
                onChange={e => setBillAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
          </div>
          <button className="btn btn-primary" disabled={creatingBill}>
            {creatingBill ? '创建中…' : '创建账单'}
          </button>
          <div className="hint">账单创建后状态为「待付」，确认收款后标记已付。</div>
        </form>
      </div>

      {/* 企业列表 */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">企业列表</div>
          <span style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>共 {tenants.length} 家</span>
        </div>

        {loading ? (
          <div className="loading">加载中…</div>
        ) : tenants.length === 0 ? (
          <div className="empty-state">暂无企业，请先创建。</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>企业名称</th>
                  <th>套餐</th>
                  <th>坐席</th>
                  <th>状态</th>
                  <th>到期时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map(t => (
                  <React.Fragment key={t.id}>
                    <tr>
                      <td>
                        <button
                          onClick={() => toggleExpand(t.id)}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: 'var(--text-primary)', fontSize: 13, fontWeight: 600,
                          }}
                        >
                          {expanded[t.id] ? '▾ ' : '▸ '}
                          {t.name}
                        </button>
                        <div className="mono" style={{ color: 'var(--text-muted)', marginLeft: 16 }}>
                          {t.id}
                        </div>
                      </td>
                      <td>{planName(t.plan)}</td>
                      <td>{t.seats}</td>
                      <td>
                        <span style={{ color: tenantStatusColor(t.status), fontWeight: 600 }}>
                          {tenantStatusName(t.status)}
                        </span>
                      </td>
                      <td>{formatDate(t.subscription_end)}</td>
                      <td>
                        <button
                          className="btn btn-sm"
                          onClick={() => {
                            setBillTenantId(t.id)
                            window.scrollTo({ top: 0, behavior: 'smooth' })
                          }}
                        >
                          建账单
                        </button>
                      </td>
                    </tr>
                    {expanded[t.id] && (
                      <tr>
                        <td colSpan={6} style={{ background: 'rgba(255,255,255,0.02)' }}>
                          <div style={{ padding: '8px 4px' }}>
                            <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>账单记录</div>
                            {t.bills.length === 0 ? (
                              <div className="hint">暂无账单</div>
                            ) : (
                              <table>
                                <thead>
                                  <tr>
                                    <th>账单号</th>
                                    <th>账期</th>
                                    <th>金额</th>
                                    <th>状态</th>
                                    <th>创建时间</th>
                                    <th>操作</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {t.bills.map(b => (
                                    <tr key={b.bill_id}>
                                      <td className="mono">{b.bill_id}</td>
                                      <td>{b.period}</td>
                                      <td>¥{formatMoney(b.amount_cents)}</td>
                                      <td>
                                        <span className={`badge badge-${b.status}`}>
                                          {billStatusName(b.status)}
                                        </span>
                                      </td>
                                      <td>{formatDate(b.created_at)}</td>
                                      <td>
                                        {b.status !== 'paid' && (
                                          <button
                                            className="btn btn-sm"
                                            onClick={() => handleMarkPaid(b.bill_id)}
                                          >
                                            标记已付
                                          </button>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}