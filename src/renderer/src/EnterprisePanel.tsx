// src/renderer/src/EnterprisePanel.tsx
// 企业版面板 —— 嵌入设置窗口「企业版」页。
// 三块：License 授权卡（状态/试用/激活）、用量仪表盘（今日计数 + 配额进度）、审计流（最近事件 + 导出）。
// 数据经 window.electron.invoke('enterprise:*') 与主进程通信；渲染层不依赖 src/core。

import { useCallback, useEffect, useState } from 'react'
import { showToast } from './App'
import './features.css'

/** License 状态（与 src/core/enterprise/license.ts 对齐） */
interface LicenseState {
  status: 'trial' | 'active' | 'expired' | 'grace' | 'invalid'
  plan: 'community' | 'strategic' | 'standard' | 'pro' | 'flagship'
  seats: number
  activatedAt: number | null
  expiresAt: number | null
  trialEndsAt: number | null
  deviceId: string
  licenseKey: string | null
  error?: string
}

/** 用量快照（与 src/core/enterprise/usage.ts 对齐） */
interface UsageSnapshot {
  date: string
  sessions: number
  messages: number
  replies: number
  handoffs: number
  apiCalls: number
  quotaLimit: number
}

/** 审计事件（与 src/core/enterprise/audit.ts 对齐） */
interface AuditEvent {
  id: string
  ts: number
  action: string
  actor: 'system' | 'user'
  detail?: string
  meta?: Record<string, unknown>
}

const STATUS_LABELS: Record<LicenseState['status'], { label: string; className: string }> = {
  trial: { label: '试用中', className: 'ent-status-trial' },
  active: { label: '已激活', className: 'ent-status-active' },
  grace: { label: '宽限期', className: 'ent-status-grace' },
  expired: { label: '已过期', className: 'ent-status-expired' },
  invalid: { label: '未激活', className: 'ent-status-invalid' }
}

const PLAN_LABELS: Record<LicenseState['plan'], string> = {
  community: '社区版',
  strategic: '战略伙伴版',
  standard: '标准版',
  pro: '专业版',
  flagship: '旗舰版'
}

function fmtTime(ts: number | null): string {
  if (!ts) return '—'
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`
}

function fmtClock(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function EnterprisePanel(): React.JSX.Element {
  const [license, setLicense] = useState<LicenseState | null>(null)
  const [usage, setUsage] = useState<UsageSnapshot | null>(null)
  const [audits, setAudits] = useState<AuditEvent[]>([])
  const [keyInput, setKeyInput] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = (): void => {
      window.electron
        ?.invoke('enterprise:license:getState')
        .then((lic) => {
          if (!cancelled && lic) setLicense(lic as LicenseState)
        })
        .catch((error: unknown) => console.error('[Enterprise] license 读取失败:', error))
      window.electron
        ?.invoke('enterprise:usage:getToday')
        .then((usg) => {
          if (!cancelled && usg) setUsage(usg as UsageSnapshot)
        })
        .catch((error: unknown) => console.error('[Enterprise] usage 读取失败:', error))
      window.electron
        ?.invoke('enterprise:audit:list', { limit: 30 })
        .then((aud) => {
          if (!cancelled && Array.isArray(aud)) setAudits(aud as AuditEvent[])
        })
        .catch((error: unknown) => console.error('[Enterprise] audit 读取失败:', error))
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const startTrial = useCallback(async () => {
    setBusy(true)
    try {
      const state = (await window.electron.invoke('enterprise:license:startTrial')) as LicenseState
      setLicense(state)
      showToast('已开始 14 天试用', 'success')
    } catch (error) {
      showToast('启动试用失败，请重试', 'error')
      console.error(error)
    } finally {
      setBusy(false)
    }
  }, [])

  const activate = useCallback(async () => {
    if (!keyInput.trim()) {
      showToast('请输入授权码', 'error')
      return
    }
    setBusy(true)
    try {
      const result = (await window.electron.invoke(
        'enterprise:license:activate',
        keyInput.trim()
      )) as { ok: boolean; state?: LicenseState; error?: string }
      if (result.ok && result.state) {
        setLicense(result.state)
        setKeyInput('')
        showToast('激活成功', 'success')
      } else {
        showToast(result.error || '激活失败', 'error')
      }
    } catch (error) {
      showToast('激活失败，请重试', 'error')
      console.error(error)
    } finally {
      setBusy(false)
    }
  }, [keyInput])

  const exportAudit = useCallback(async () => {
    try {
      const text = (await window.electron.invoke('enterprise:audit:export')) as string
      // 在 Electron 渲染层用 Blob 下载
      const blob = new Blob([text], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `richcat-audit-${usage?.date || Date.now()}.json`
      a.click()
      // 延迟 revoke，避免部分 Chromium 取消刚触发的下载
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      showToast('审计日志已导出', 'success')
    } catch (error) {
      showToast('导出失败', 'error')
      console.error(error)
    }
  }, [usage])

  const status = license?.status ?? 'invalid'
  const statusMeta = STATUS_LABELS[status]
  // 软额度=quotaLimit（达到显示提醒），硬熔断=hardCap（达到停自动回复），按 hardCap 显示进度更贴近实际
  const hardCap = usage ? Math.ceil(usage.quotaLimit * 1.2) : 0
  const usagePct =
    usage && hardCap > 0 ? Math.min(100, Math.round((usage.messages / hardCap) * 100)) : 0
  const needActivate = status === 'invalid' || status === 'expired'

  return (
    <div className="ent-panel">
      <h2 className="ent-title">企业版</h2>
      <p className="ent-subtitle">License 授权 · 用量计量 · 审计留痕 · 密钥加密</p>
      <p className="ent-preview-note">预览版说明：授权码为本地占位校验，正式版将接入服务端在线授权；密钥为本地静态加密。</p>

      {/* ① License 卡片 */}
      <section className="ent-card">
        <div className="ent-card-head">
          <span className="ent-card-title">授权状态</span>
          <span className={`ent-status-badge ${statusMeta.className}`}>{statusMeta.label}</span>
        </div>
        {license && (
          <div className="ent-grid">
            <div className="ent-field">
              <span className="ent-field-label">套餐</span>
              <span className="ent-field-value">{PLAN_LABELS[license.plan]}</span>
            </div>
            <div className="ent-field">
              <span className="ent-field-label">坐席</span>
              <span className="ent-field-value">{license.seats} 席</span>
            </div>
            <div className="ent-field">
              <span className="ent-field-label">设备指纹</span>
              <span className="ent-field-value ent-mono">{license.deviceId.slice(0, 12)}…</span>
            </div>
            <div className="ent-field">
              <span className="ent-field-label">到期时间</span>
              <span className="ent-field-value">
                {status === 'trial' ? fmtTime(license.trialEndsAt) : fmtTime(license.expiresAt)}
              </span>
            </div>
            {license.licenseKey && (
              <div className="ent-field ent-span2">
                <span className="ent-field-label">授权码</span>
                <span className="ent-field-value ent-mono">{license.licenseKey}</span>
              </div>
            )}
            {status === 'grace' && (
              <div className="ent-warn ent-span2">授权已到期，宽限期内自动回复继续运行，请尽快续费，否则宽限期后将暂停自动回复。</div>
            )}
            {status === 'expired' && (
              <div className="ent-error ent-span2">授权已过期，自动回复已暂停。请激活新授权码或联系续费。</div>
            )}
          </div>
        )}

        {needActivate ? (
          <div className="ent-license-actions">
            {status === 'invalid' && (
              <button className="ent-btn ent-btn-primary" onClick={startTrial} disabled={busy}>
                开始 14 天试用
              </button>
            )}
            <div className="ent-activate-row">
              <input
                className="ent-input ent-mono"
                placeholder="RC-XXXX-XXXX-XXXX-XXXX"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                disabled={busy}
              />
              <button className="ent-btn" onClick={activate} disabled={busy}>
                激活
              </button>
            </div>
          </div>
        ) : (
          <div className="ent-active-tip">✓ 授权有效，AI 自动回复正常运行</div>
        )}
      </section>

      {/* ② 用量仪表盘 */}
      <section className="ent-card">
        <div className="ent-card-head">
          <span className="ent-card-title">今日用量（{usage?.date || '—'}）</span>
          {usage && usage.messages >= hardCap && (
            <span className="ent-status-badge ent-status-expired">已达熔断上限</span>
          )}
          {usage && usage.messages >= usage.quotaLimit && usage.messages < hardCap && (
            <span className="ent-status-badge ent-status-grace">接近上限</span>
          )}
        </div>
        {usage && (
          <>
            <div className="ent-usage-stats">
              <div className="ent-usage-stat">
                <span className="ent-usage-num">{usage.messages}</span>
                <span className="ent-usage-label">处理消息</span>
              </div>
              <div className="ent-usage-stat">
                <span className="ent-usage-num">{usage.replies}</span>
                <span className="ent-usage-label">自动回复</span>
              </div>
              <div className="ent-usage-stat">
                <span className="ent-usage-num">{usage.handoffs}</span>
                <span className="ent-usage-label">人工接管</span>
              </div>
              <div className="ent-usage-stat">
                <span className="ent-usage-num">{usage.apiCalls}</span>
                <span className="ent-usage-label">AI 调用</span>
              </div>
            </div>
            <div className="ent-quota">
              <div className="ent-quota-bar">
                <div className="ent-quota-fill" style={{ width: `${usagePct}%` }} />
              </div>
              <div className="ent-quota-label">
                {usage.messages} / {hardCap} 条（今日熔断上限，软额度 {usage.quotaLimit}）
              </div>
            </div>
          </>
        )}
        <p className="ent-hint">
          基础额度 10,000 会话/坐席/年，按日折算；超出后将暂停自动回复转为人工接管。用量包与提额请联系我们。
        </p>
      </section>

      {/* ③ 审计流 */}
      <section className="ent-card">
        <div className="ent-card-head">
          <span className="ent-card-title">审计日志</span>
          <button className="ent-btn ent-btn-small" onClick={exportAudit}>
            导出
          </button>
        </div>
        <div className="ent-audit-list">
          {audits.length === 0 && <div className="ent-audit-empty">暂无审计记录</div>}
          {audits.map((a) => (
            <div className="ent-audit-item" key={a.id}>
              <span className="ent-audit-time">{fmtClock(a.ts)}</span>
              <span className={`ent-audit-actor ent-audit-${a.actor}`}>
                {a.actor === 'user' ? '用户' : '系统'}
              </span>
              <span className="ent-audit-action">{a.action}</span>
              {a.detail && <span className="ent-audit-detail">{a.detail}</span>}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
