// src/core/features/human-handoff/install.ts
// ── F2 人工接管：主进程装配层（IPC + 通知接线）──
// main/index.ts 调用 installHumanHandoff({...})；无定时器（接管为事件驱动），
// 因此无需 before-quit 清理（无注册句柄）。
// 设计文档：docs/richcat-v2-design.md §3-F2（改动文件清单中 main/index.ts 的装配部分）。

import { BrowserWindow, ipcMain, Notification } from 'electron'
import { CustomerStore } from '../../customers/customer-store'
import { FeatureFlags } from '../flags'
import { HandoffStore, openHandoff } from './index'
import { HandoffReason, HandoffRequest } from './types'
import { profileTag } from '../multi-instance'

export interface InstallHumanHandoffOptions {
  flags: FeatureFlags
  getStore: () => HandoffStore
  getCustomerStore: () => CustomerStore
  /** 会话级暂停集合（contact → 暂停自动回复；resolve 时移除） */
  pausedContacts: Set<string>
  /** 当前实例 profile 名（通知标题实例标识；空串=默认实例） */
  profile?: string
  /** 多轮未解决上限（featuresConfig.f2.maxUnresolvedTurns 缺省 3） */
  maxUnresolvedTurns?: number
}

export interface HumanHandoffServices {
  /** 打开接管单（F5 升级 / 引擎侧调用；f2 关时 no-op） */
  requestHandoff(
    reason: HandoffReason,
    contact: string | null,
    confidence: number
  ): HandoffRequest | null
  /** 推给所有 renderer 窗口（handoff:new 事件） */
  notify(payload: { type: string; data?: unknown }): void
  /** 桌面通知（标题自动带 profileTag 实例标识） */
  notifyDesktop(title: string, body: string): void
}

/**
 * 装配 F2 人工接管：
 * - handoff:list / handoff:resolve IPC（flag 门控）；
 * - 内部实现 notify（engine:event 推所有窗口）与 notifyDesktop（系统通知 + profileTag）；
 * - 返回 { requestHandoff, notify, notifyDesktop } 供装配方在结果钩子中接线
 *   （F5 升级通道 / captureHandoffResult 的 ctx）。
 */
export function installHumanHandoff(options: InstallHumanHandoffOptions): HumanHandoffServices {
  const tag = profileTag(options.profile ?? '')

  const notify = (payload: { type: string; data?: unknown }): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('engine:event', payload)
    }
  }

  const notifyDesktop = (title: string, body: string): void => {
    try {
      if (Notification.isSupported()) {
        new Notification({ title: `${title}${tag}`, body }).show()
      }
    } catch (error) {
      console.error('[Handoff] 桌面通知失败:', error)
    }
  }

  const requestHandoff = (
    reason: HandoffReason,
    contact: string | null,
    confidence: number
  ): HandoffRequest | null => {
    if (!options.flags.isEnabled('f2.human_handoff')) return null
    return openHandoff(reason, contact, confidence, {
      getStore: options.getStore,
      notify,
      notifyDesktop,
      getCustomerStore: options.getCustomerStore,
      pausedContacts: options.pausedContacts,
      maxUnresolvedTurns: options.maxUnresolvedTurns
    })
  }

  ipcMain.handle('handoff:list', async () => {
    if (!options.flags.isEnabled('f2.human_handoff')) return []
    return options.getStore().list()
  })

  ipcMain.handle('handoff:resolve', async (_event, handoffId: unknown) => {
    if (!options.flags.isEnabled('f2.human_handoff')) {
      return { success: false, error: 'f2_disabled' }
    }
    if (typeof handoffId !== 'string') {
      return { success: false, error: 'invalid_input' }
    }
    const ok = options.getStore().setStatus(handoffId, 'resolved')
    if (ok) {
      // 恢复该客户的自动回复（若被暂停）
      const item = options.getStore().getById(handoffId)
      if (item?.contact) options.pausedContacts.delete(item.contact)
      console.log(`[Handoff] 接管单已处理并恢复自动回复: ${item?.contact ?? '未知客户'}`)
    }
    return ok ? { success: true } : { success: false, error: 'not_found_or_closed' }
  })

  return { requestHandoff, notify, notifyDesktop }
}
