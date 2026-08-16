// src/core/features/follow-up/index.ts
// ── F7 待跟进提醒：FeatureModule（消费 followUp）+ 到期扫描调度器 ──
// 设计文档：docs/richcat-v2-design.md §3-F7。
//
// 关键设计：
// - 生成：handleFollowUpResult 消费 SmartReplyResult.followUp → store.add（AI 承诺）；
//   去重（同 contact+action+open）与容错全部在 store 内；
// - 到期提醒：FollowUpScheduler 每分钟扫描（flag 开才挂定时器，防重复、before-quit 清理）；
//   dueAt<=now && open → 桌面通知 + followup:due 事件；不自动关闭（等 UI 标记 done）；
// - flag 关闭零影响：定时器不注册、followUp 字段不消费（装配方按 f7 开关决定是否调用）；
// - 回滚：本目录为 F7 独立 commit；revert 后待办不生成、定时提醒消失，followups.json 残留无害。

import { SmartReplyResult } from '../../ai-client'
import { FeatureFlagKey } from '../flags'
import { FollowUpStore } from './store'
import { FollowUpItem } from './types'

export * from './types'
export { FollowUpStore, DEFAULT_FOLLOW_UP_DELAY_MS } from './store'
export { buildFollowUpSection } from './section'

export const FOLLOW_UP_FLAG_KEY: FeatureFlagKey = 'f7.follow_up'

/** 到期扫描间隔：每分钟（docs §3-F7） */
export const FOLLOW_UP_SCAN_INTERVAL_MS = 60 * 1000

/**
 * 消费 SmartReplyResult.followUp（模型承诺）→ 生成待办。
 * - followUp 缺失/action 无效 → 零动作；
 * - dueAt 解析失败 → now+24h（store 内兜底）；
 * - store.add 内部去重；任何异常吞掉（不影响回复发送）。
 * 返回新建的待办（去重命中返回 null）。
 */
export function handleFollowUpResult(
  result: SmartReplyResult,
  store: FollowUpStore
): FollowUpItem | null {
  const followUp = result?.followUp
  if (!followUp || typeof followUp.action !== 'string' || !followUp.action.trim()) return null
  try {
    let dueAt: number | undefined
    if (typeof followUp.dueAt === 'string' && followUp.dueAt.trim()) {
      const parsed = Date.parse(followUp.dueAt)
      if (Number.isFinite(parsed)) dueAt = parsed
    }
    const item = store.add({
      contact: result.contact,
      action: followUp.action,
      dueAt,
      source: 'ai'
    })
    if (item) {
      const due = new Date(item.dueAt).toLocaleString('zh-CN', { hour12: false })
      console.log(
        `[FollowUp] 已生成待办: ${item.contact ?? '未知客户'} - ${item.action}（到期 ${due}）`
      )
    }
    return item
  } catch (error) {
    console.error('[FollowUp] 生成待办失败（不影响回复发送）:', error)
    return null
  }
}

/** F7 特征模块（形状与 f1/f5/f6 对齐） */
export interface FollowUpFeatureModule {
  flagKey: FeatureFlagKey
  /** 消费模型承诺（afterProvider 语义）；f7 关时装配方不调用 */
  captureFollowUp(result: SmartReplyResult, store: FollowUpStore): FollowUpItem | null
  /** 到期扫描（onTimer 语义）；f7 关时调度器不注册 */
  onTimer(kind: 'follow_up', now: Date): void
}

export function createFollowUpFeature(store: FollowUpStore): FollowUpFeatureModule {
  const scheduler = new FollowUpScheduler({ store })
  return {
    flagKey: 'f7.follow_up',
    captureFollowUp: (result, s) => handleFollowUpResult(result, s ?? store),
    onTimer: (kind, now) => {
      if (kind === 'follow_up') scheduler.scanDue(now)
    }
  }
}

export interface FollowUpSchedulerOptions {
  store: FollowUpStore
  /** 到期时推给所有 renderer 窗口（followup:due 事件）；缺省 no-op（纯逻辑场景） */
  notify?(payload: { type: string; data?: unknown }): void
  /** 桌面通知（主进程实现；缺省则只发 renderer 事件） */
  notifyDesktop?(title: string, body: string): void
  /** 扫描间隔（默认 60s；测试可缩短） */
  intervalMs?: number
}

/**
 * 到期扫描调度器：仅 start() 且 flag 开时挂 setInterval；stop() 清理（before-quit 调用）。
 * 到期（dueAt<=now 且 open）→ 桌面通知 + followup:due 事件；不自动关闭。
 */
export class FollowUpScheduler {
  private timer: NodeJS.Timeout | null = null
  private readonly intervalMs: number
  private readonly notify: (payload: { type: string; data?: unknown }) => void
  private readonly notifyDesktop?: (title: string, body: string) => void

  constructor(private readonly options: FollowUpSchedulerOptions) {
    this.intervalMs = options.intervalMs ?? FOLLOW_UP_SCAN_INTERVAL_MS
    this.notify = options.notify ?? (() => undefined)
    this.notifyDesktop = options.notifyDesktop
  }

  /** 挂每分钟扫描（防重复：先 stop）；flag 开否由装配方决定是否调用 */
  start(): void {
    this.stop()
    console.log(`[FollowUp] 到期扫描定时器已注册（每 ${Math.round(this.intervalMs / 1000)}s）`)
    this.timer = setInterval(() => {
      try {
        this.scanDue(new Date())
      } catch (error) {
        console.error('[FollowUp] 到期扫描异常（忽略）:', error)
      }
    }, this.intervalMs)
    if (typeof this.timer.unref === 'function') this.timer.unref()
  }

  /** 清理定时器（before-quit / 引擎停止，防重复注册） */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** 扫描一次：所有到期 open 待办 → 通知（不自动关闭） */
  scanDue(now: Date): void {
    const dueItems = this.options.store.listOpen().filter((item) => item.dueAt <= now.getTime())
    if (dueItems.length === 0) return
    for (const item of dueItems) {
      console.log(`[FollowUp] 待跟进到期: ${item.contact ?? '未知客户'} - ${item.action}`)
      try {
        this.notify({ type: 'followup:due', data: { followUp: item } })
      } catch (error) {
        console.error('[FollowUp] followup:due 事件推送失败:', error)
      }
      try {
        this.notifyDesktop?.(`待跟进：${item.contact ?? '未知客户'}`, item.action)
      } catch (error) {
        console.error('[FollowUp] 桌面通知失败:', error)
      }
    }
  }
}
