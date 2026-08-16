// src/renderer/src/FeaturePanel.tsx
// V2 功能开关面板（阶段 0 / C0）—— 嵌入设置窗口「功能开关」页。
// 每个功能一行：label + description + Switch；开关即时调用 features:set，无需重启。
// 开关类型与默认值以主进程 src/core/features/flags.ts 为唯一事实来源，此处仅为 UI 元数据。
// 注意：保持本文件不依赖 src/core（renderer 与 main 分层隔离），key 字符串需与 flags.ts 同步。

import { useCallback, useEffect, useState } from 'react'
import { showToast } from './App'
import './features.css'

/** 与 src/core/features/flags.ts 的 FeatureFlagKey 保持一致（唯一事实来源在 core） */
type FeatureFlagKey =
  | 'f1.group_chat'
  | 'f2.human_handoff'
  | 'f3.vip_service'
  | 'f4.role_routing'
  | 'f5.emotion_risk'
  | 'f6.daily_report'
  | 'f7.follow_up'
  | 'f8.multi_instance'
  | 'f9.knowledge_v2'
  | 'f10.prompt_system'

/** F7 待跟进的 UI 子集（与 src/core/features/follow-up/types.ts 对齐） */
interface FollowUpItem {
  followUpId: string
  contact: string | null
  action: string
  dueAt: number
  status: 'open' | 'done' | 'cancelled'
  createdAt: number
  source?: 'ai' | 'manual'
}

/** F2 接管单的 UI 子集（与 src/core/features/human-handoff/types.ts 对齐） */
interface HandoffRequest {
  handoffId: string
  contact: string | null
  reason: string
  confidence: number
  createdAt: number
  status: 'open' | 'resolved'
}

/** F2 接管原因中文标签（与 core 模块 HANDOFF_REASON_LABELS 一致） */
const HANDOFF_REASON_LABELS: Record<string, string> = {
  explicit_human: '客户要求转人工',
  complaint: '投诉',
  price_sensitive: '价格敏感/砍价',
  multiple_unresolved: '多轮未解决',
  risk_escalation: '高风险情绪升级'
}

/** 默认值与 src/core/features/flags.ts 的 FEATURE_FLAG_DEFAULTS 保持一致 */
const FEATURE_FLAG_DEFAULTS: Record<FeatureFlagKey, boolean> = {
  'f1.group_chat': false,
  'f2.human_handoff': true,
  'f3.vip_service': true,
  'f4.role_routing': false,
  'f5.emotion_risk': true,
  'f6.daily_report': true,
  'f7.follow_up': true,
  'f8.multi_instance': true,
  'f9.knowledge_v2': false,
  'f10.prompt_system': true
}

interface FeatureMeta {
  key: FeatureFlagKey
  label: string
  description: string
  note?: string
}

const FEATURE_META: FeatureMeta[] = [
  {
    key: 'f1.group_chat',
    label: '群聊支持',
    description: '识别群聊会话，只回复客户本人或被 @ 的消息，忽略群成员/公告/红包等。'
  },
  {
    key: 'f2.human_handoff',
    label: '人工接管 / 升级',
    description: '识别"转人工/投诉/价格敏感/多轮未解决"信号，停止自动回复并通知人工介入。'
  },
  {
    key: 'f3.vip_service',
    label: 'VIP 差异化服务',
    description: '按客户档案分类与标签提供专属语气、专属知识片段（可选回复前人工确认）。'
  },
  {
    key: 'f4.role_routing',
    label: '多角色消息路由',
    description: '同一群内多个服务角色（销售/售后/专家），按问题类型路由到对应角色回答。'
  },
  {
    key: 'f5.emotion_risk',
    label: '情绪 / 风险识别',
    description: '识别不满、退款意向、投诉、紧急等情绪信号，客户打标并触发风险通知。'
  },
  {
    key: 'f6.daily_report',
    label: '服务日报',
    description:
      '每日定时（默认 23:50）汇总服务客户 / VIP 动态 / 待跟进 / 接管事件，生成 Markdown 日报。'
  },
  {
    key: 'f7.follow_up',
    label: '待跟进提醒',
    description: 'AI 承诺"明天回复"等后续动作时生成待办，到期桌面通知提醒。'
  },
  {
    key: 'f8.multi_instance',
    label: '多实例协同',
    description: '通过 --profile 多开，数据隔离、窗口标识与端口错开均已支持。',
    note: '多开已通过 --profile 支持，此为说明开关。'
  },
  {
    key: 'f9.knowledge_v2',
    label: '知识库深度优化',
    description: '知识分类 / 权重 / 作用域（scope），按上下文按需注入，替代全量 30 条注入。'
  },
  {
    key: 'f10.prompt_system',
    label: '提示词体系',
    description: '集中管理的客服提示词（专业感 + 人感 + 情绪价值）；关闭时回退旧 prompt 拼装。'
  }
]

/** 待办到期时间显示（MM-DD HH:mm；已过期加前缀） */
function formatDue(ts: number): string {
  const d = new Date(ts)
  const time = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return `${ts < Date.now() ? '已到期 ' : ''}${time}`
}

export default function FeaturePanel(): React.JSX.Element {
  const [flags, setFlags] = useState<Record<FeatureFlagKey, boolean> | null>(null)
  const [saving, setSaving] = useState<FeatureFlagKey | null>(null)
  // F1 群聊参数（featuresConfig.f1；逗号分隔昵称 + 纯 @ 触发开关）
  const [f1BotNames, setF1BotNames] = useState('')
  const [f1MentionOnly, setF1MentionOnly] = useState(false)
  const [f1Saving, setF1Saving] = useState(false)
  // F7 待跟进列表（followup:list；open 项 + 标记完成 + 手动添加）
  const [followUps, setFollowUps] = useState<FollowUpItem[] | null>(null)
  const [newFollowUpAction, setNewFollowUpAction] = useState('')
  const [followUpBusy, setFollowUpBusy] = useState(false)
  // F2 待接管列表（handoff:list；open 项 + 标记已处理）
  const [handoffs, setHandoffs] = useState<HandoffRequest[] | null>(null)
  const [handoffBusy, setHandoffBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.electron
      ?.invoke('features:getAll')
      .then((result) => {
        if (!cancelled && result) setFlags(result as Record<FeatureFlagKey, boolean>)
      })
      .catch((error: unknown) => {
        console.error('[FeaturePanel] features:getAll 失败:', error)
      })
    window.electron
      ?.invoke('settings:getAll')
      .then((settings) => {
        if (!cancelled && settings?.featuresConfig?.f1) {
          const f1 = settings.featuresConfig.f1 as { botNames?: string[]; mentionOnly?: boolean }
          setF1BotNames((f1.botNames ?? []).join('、'))
          setF1MentionOnly(Boolean(f1.mentionOnly))
        }
      })
      .catch((error: unknown) => {
        console.error('[FeaturePanel] settings:getAll 失败:', error)
      })
    window.electron
      ?.invoke('followup:list')
      .then((result) => {
        if (!cancelled && Array.isArray(result)) setFollowUps(result as FollowUpItem[])
      })
      .catch((error: unknown) => {
        console.error('[FeaturePanel] followup:list 失败:', error)
      })
    window.electron
      ?.invoke('handoff:list')
      .then((result) => {
        if (!cancelled && Array.isArray(result)) setHandoffs(result as HandoffRequest[])
      })
      .catch((error: unknown) => {
        console.error('[FeaturePanel] handoff:list 失败:', error)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleToggle = useCallback(
    async (key: FeatureFlagKey) => {
      if (!flags || flags[key] === undefined) return
      const next = !flags[key]
      setSaving(key)
      try {
        const result = (await window.electron?.invoke('features:set', {
          key,
          value: next
        })) as { success?: boolean; error?: string } | undefined
        if (result?.success) {
          setFlags((prev) => (prev ? { ...prev, [key]: next } : prev))
        } else {
          showToast(`开关更新失败：${result?.error || '未知错误'}`, 'error')
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        showToast(`开关更新失败：${message}`, 'error')
      } finally {
        setSaving(null)
      }
    },
    [flags]
  )

  const handleResetDefaults = useCallback(async () => {
    const current = flags
    if (!current) return
    let ok = true
    for (const [key, value] of Object.entries(FEATURE_FLAG_DEFAULTS)) {
      if (current[key as FeatureFlagKey] !== value) {
        const result = (await window.electron?.invoke('features:set', {
          key,
          value
        })) as { success?: boolean } | undefined
        if (!result?.success) ok = false
      }
    }
    if (ok) {
      showToast('已恢复全部默认开关', 'success')
      const fresh = (await window.electron?.invoke('features:getAll')) as
        Record<FeatureFlagKey, boolean> | undefined
      if (fresh) setFlags(fresh)
    } else {
      showToast('部分开关恢复失败', 'error')
    }
  }, [flags])

  /** 保存 F1 群聊参数（botNames 逗号分隔 + mentionOnly）；失败提示不阻塞 */
  const saveF1Config = useCallback(async (botNames: string, mentionOnly: boolean) => {
    setF1Saving(true)
    try {
      const parsed = botNames
        .split(/[,，、\s]+/)
        .map((name) => name.trim())
        .filter((name) => name.length > 0)
      const result = (await window.electron?.invoke('settings:set', {
        featuresConfig: { f1: { botNames: parsed, mentionOnly } }
      })) as { success?: boolean } | undefined
      if (result?.success) {
        showToast('群聊参数已保存', 'success')
      } else {
        showToast('群聊参数保存失败', 'error')
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      showToast(`群聊参数保存失败：${message}`, 'error')
    } finally {
      setF1Saving(false)
    }
  }, [])

  /** 刷新待跟进列表（followup:list） */
  const reloadFollowUps = useCallback(async () => {
    try {
      const result = (await window.electron?.invoke('followup:list')) as FollowUpItem[] | undefined
      if (Array.isArray(result)) setFollowUps(result)
    } catch (error: unknown) {
      console.error('[FeaturePanel] followup:list 失败:', error)
    }
  }, [])

  /** 标记待办完成（followup:setStatus done） */
  const handleFollowUpDone = useCallback(
    async (followUpId: string) => {
      setFollowUpBusy(true)
      try {
        const result = (await window.electron?.invoke('followup:setStatus', followUpId, 'done')) as
          { success?: boolean; error?: string } | undefined
        if (result?.success) {
          await reloadFollowUps()
        } else {
          showToast(`标记失败：${result?.error || '未知错误'}`, 'error')
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        showToast(`标记失败：${message}`, 'error')
      } finally {
        setFollowUpBusy(false)
      }
    },
    [reloadFollowUps]
  )

  /** 手动添加待办（followup:add，source=manual） */
  const handleFollowUpAdd = useCallback(async () => {
    const action = newFollowUpAction.trim()
    if (!action) return
    setFollowUpBusy(true)
    try {
      const result = (await window.electron?.invoke('followup:add', {
        action,
        contact: null
      })) as { success?: boolean; error?: string } | undefined
      if (result?.success) {
        setNewFollowUpAction('')
        await reloadFollowUps()
      } else {
        showToast(
          `添加失败：${result?.error === 'duplicate' ? '已存在相同待办' : result?.error || '未知错误'}`,
          'error'
        )
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      showToast(`添加失败：${message}`, 'error')
    } finally {
      setFollowUpBusy(false)
    }
  }, [newFollowUpAction, reloadFollowUps])

  /** 刷新待接管列表（handoff:list） */
  const reloadHandoffs = useCallback(async () => {
    try {
      const result = (await window.electron?.invoke('handoff:list')) as HandoffRequest[] | undefined
      if (Array.isArray(result)) setHandoffs(result)
    } catch (error: unknown) {
      console.error('[FeaturePanel] handoff:list 失败:', error)
    }
  }, [])

  /** 标记接管单已处理（handoff:resolve；同时恢复该客户自动回复） */
  const handleHandoffResolve = useCallback(
    async (handoffId: string) => {
      setHandoffBusy(true)
      try {
        const result = (await window.electron?.invoke('handoff:resolve', handoffId)) as
          { success?: boolean; error?: string } | undefined
        if (result?.success) {
          await reloadHandoffs()
        } else {
          showToast(`处理失败：${result?.error || '未知错误'}`, 'error')
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        showToast(`处理失败：${message}`, 'error')
      } finally {
        setHandoffBusy(false)
      }
    },
    [reloadHandoffs]
  )

  return (
    <div className="settings-page slide-up">
      <div className="settings-page-header">
        <div>
          <h1>功能开关</h1>
          <p>每个功能独立开关，关闭时零影响（不注入提示词、不改变行为、无额外调用）。</p>
        </div>
      </div>

      <div className="card feature-panel-card">
        <div className="feature-panel-toolbar">
          <span className="form-hint">
            开关变更即时生效；引擎运行中的行为变更在下一次交互时应用。
          </span>
          <button className="btn btn-secondary" onClick={handleResetDefaults}>
            恢复默认
          </button>
        </div>

        {!flags ? (
          <div className="feature-panel-loading">加载中…</div>
        ) : (
          <div className="feature-list">
            {FEATURE_META.map((meta) => {
              const enabled = flags[meta.key] ?? FEATURE_FLAG_DEFAULTS[meta.key]
              const isDefault = enabled === FEATURE_FLAG_DEFAULTS[meta.key]
              return (
                <div key={meta.key} className="feature-row">
                  <div className="feature-row-info">
                    <div className="feature-row-title">
                      <span className="feature-row-label">{meta.label}</span>
                      <span className={`feature-badge ${enabled ? 'on' : 'off'}`}>
                        {enabled ? '开' : '关'}
                      </span>
                      {!isDefault && <span className="feature-badge changed">已改</span>}
                    </div>
                    <div className="feature-row-desc">{meta.description}</div>
                    {meta.note && <div className="feature-row-note">{meta.note}</div>}
                    {meta.key === 'f1.group_chat' && (
                      <div className="feature-row-config">
                        <div className="feature-row-config-line">
                          <label className="feature-row-config-label" htmlFor="f1-botnames">
                            机器人昵称（逗号分隔，用于 @ 识别）
                          </label>
                          <input
                            id="f1-botnames"
                            className="form-input feature-row-config-input"
                            type="text"
                            value={f1BotNames}
                            disabled={f1Saving}
                            onChange={(e) => setF1BotNames(e.target.value)}
                            onBlur={() => void saveF1Config(f1BotNames, f1MentionOnly)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void saveF1Config(f1BotNames, f1MentionOnly)
                            }}
                            placeholder="如：财听猫、小财"
                          />
                        </div>
                        <label className="feature-row-config-check">
                          <input
                            type="checkbox"
                            checked={f1MentionOnly}
                            disabled={f1Saving}
                            onChange={(e) => {
                              const next = e.target.checked
                              setF1MentionOnly(next)
                              void saveF1Config(f1BotNames, next)
                            }}
                          />
                          纯 @ 触发模式（跳过 VLM 群聊检测，零检测成本）
                        </label>
                      </div>
                    )}
                    {meta.key === 'f2.human_handoff' && (
                      <div className="feature-row-config">
                        <div className="feature-row-config-label" style={{ marginBottom: 6 }}>
                          待接管列表（触发后该客户自动回复暂停；处理完成即恢复）
                        </div>
                        <div className="followup-list">
                          {handoffs === null ? (
                            <div className="feature-panel-loading">加载中…</div>
                          ) : handoffs.filter((item) => item.status === 'open').length === 0 ? (
                            <div className="followup-empty">暂无待接管</div>
                          ) : (
                            handoffs
                              .filter((item) => item.status === 'open')
                              .map((item) => (
                                <div key={item.handoffId} className="followup-item">
                                  <div className="followup-item-info">
                                    <div className="followup-item-action">
                                      {item.contact ? `【${item.contact}】` : '未知客户'}
                                      {' · '}
                                      {HANDOFF_REASON_LABELS[item.reason] ?? item.reason}
                                    </div>
                                    <div className="followup-item-meta">
                                      {formatDue(item.createdAt)} 触发 · 置信度{' '}
                                      {Math.round(item.confidence * 100)}%
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    className="btn btn-secondary followup-done-btn"
                                    disabled={handoffBusy}
                                    onClick={() => void handleHandoffResolve(item.handoffId)}
                                  >
                                    已处理
                                  </button>
                                </div>
                              ))
                          )}
                        </div>
                      </div>
                    )}
                    {meta.key === 'f7.follow_up' && (
                      <div className="feature-row-config">
                        <div className="feature-row-config-label" style={{ marginBottom: 6 }}>
                          待跟进列表（到期自动桌面提醒；标记完成即停止提醒）
                        </div>
                        <div className="followup-list">
                          {followUps === null ? (
                            <div className="feature-panel-loading">加载中…</div>
                          ) : followUps.filter((item) => item.status === 'open').length === 0 ? (
                            <div className="followup-empty">暂无待跟进</div>
                          ) : (
                            followUps
                              .filter((item) => item.status === 'open')
                              .map((item) => (
                                <div key={item.followUpId} className="followup-item">
                                  <div className="followup-item-info">
                                    <div className="followup-item-action">
                                      {item.contact ? `【${item.contact}】` : ''}
                                      {item.action}
                                    </div>
                                    <div className="followup-item-meta">
                                      到期 {formatDue(item.dueAt)} ·{' '}
                                      {item.source === 'manual' ? '手动' : 'AI 承诺'}
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    className="btn btn-secondary followup-done-btn"
                                    disabled={followUpBusy}
                                    onClick={() => void handleFollowUpDone(item.followUpId)}
                                  >
                                    完成
                                  </button>
                                </div>
                              ))
                          )}
                        </div>
                        <div className="followup-add-line">
                          <input
                            className="form-input feature-row-config-input"
                            type="text"
                            value={newFollowUpAction}
                            disabled={followUpBusy}
                            onChange={(e) => setNewFollowUpAction(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void handleFollowUpAdd()
                            }}
                            placeholder="手动添加待办，如：明天上午回复退款进度"
                          />
                          <button
                            type="button"
                            className="btn btn-secondary"
                            disabled={followUpBusy || !newFollowUpAction.trim()}
                            onClick={() => void handleFollowUpAdd()}
                          >
                            添加
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="feature-row-meta">
                      默认：{FEATURE_FLAG_DEFAULTS[meta.key] ? '开' : '关'} · {meta.key}
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    aria-label={meta.label}
                    className={`feature-switch ${enabled ? 'on' : ''}`}
                    disabled={saving === meta.key}
                    onClick={() => void handleToggle(meta.key)}
                  >
                    <span className="feature-switch-thumb" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
