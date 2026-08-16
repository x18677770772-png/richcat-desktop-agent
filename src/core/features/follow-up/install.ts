// src/core/features/follow-up/install.ts
// ── F7 待跟进提醒：主进程装配层（IPC + 定时器 + 通知）──
// main/index.ts 只需调用 installFollowUp({...})；before-quit 清理在内部注册。
// 设计文档：docs/richcat-v2-design.md §3-F7（改动文件清单中 main/index.ts 的装配部分）。
//
// 回滚：本文件与 follow-up 模块同属 F7；revert 后 followup:* IPC 与定时提醒消失，
// followups.json 残留无害。独立成文件使 main/index.ts 改动面最小。

import { app, BrowserWindow, ipcMain, Notification } from 'electron'
import { FeatureFlags } from '../flags'
import { FollowUpScheduler, FollowUpStore } from './index'
import { FollowUpItem } from './types'
import { profileTag } from '../multi-instance'

export interface InstallFollowUpOptions {
  flags: FeatureFlags
  getStore: () => FollowUpStore
  /** 当前实例 profile 名（桌面通知标题加实例标识；空串=默认实例） */
  profile?: string
}

/**
 * 装配 F7 待跟进提醒：
 * - followup:list / followup:add / followup:setStatus IPC（全部 flag 门控）；
 * - 到期扫描定时器（仅 f7 flag 开时注册；before-quit 清理，防重复）；
 * - 到期 → 桌面通知（标题带 profileTag）+ followup:due renderer 事件。
 * 返回 { stop } 供 main 显式清理（可选；before-quit 已自动注册）。
 */
export function installFollowUp(options: InstallFollowUpOptions): { stop(): void } {
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
      console.error('[FollowUp] 桌面通知失败:', error)
    }
  }

  const scheduler = new FollowUpScheduler({
    store: options.getStore(),
    notify,
    notifyDesktop
  })
  // 定时器仅 f7 flag 开时注册（关闭零影响：无 setInterval 挂载）
  if (options.flags.isEnabled('f7.follow_up')) {
    scheduler.start()
  } else {
    console.log('[FollowUp] f7.follow_up 关闭，不注册到期扫描定时器（关闭零影响）')
  }

  ipcMain.handle('followup:list', async () => {
    if (!options.flags.isEnabled('f7.follow_up')) return []
    return options.getStore().list()
  })

  ipcMain.handle(
    'followup:add',
    async (
      _event,
      input: { contact?: unknown; action?: unknown; dueAt?: unknown }
    ): Promise<{ success: boolean; item?: FollowUpItem; error?: string }> => {
      if (!options.flags.isEnabled('f7.follow_up')) {
        return { success: false, error: 'f7_disabled' }
      }
      if (!input || typeof input.action !== 'string' || !input.action.trim()) {
        return { success: false, error: 'invalid_input' }
      }
      const item = options.getStore().add({
        contact: typeof input.contact === 'string' ? input.contact : null,
        action: input.action,
        dueAt:
          typeof input.dueAt === 'number' && Number.isFinite(input.dueAt) ? input.dueAt : undefined,
        source: 'manual'
      })
      return item ? { success: true, item } : { success: false, error: 'duplicate' }
    }
  )

  ipcMain.handle(
    'followup:setStatus',
    async (
      _event,
      followUpId: unknown,
      status: unknown
    ): Promise<{ success: boolean; error?: string }> => {
      if (!options.flags.isEnabled('f7.follow_up')) {
        return { success: false, error: 'f7_disabled' }
      }
      if (typeof followUpId !== 'string' || (status !== 'done' && status !== 'cancelled')) {
        return { success: false, error: 'invalid_input' }
      }
      const ok = options.getStore().setStatus(followUpId, status)
      return ok ? { success: true } : { success: false, error: 'not_found_or_closed' }
    }
  )

  const stop = (): void => scheduler.stop()
  app.on('before-quit', stop)
  return { stop }
}
