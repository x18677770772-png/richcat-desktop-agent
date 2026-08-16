// src/core/rpa-device.ts
// RPADevice — DesktopDevice 的真实 RPA 实现
//
// 串联 screenshot-utils、input-utils、has-unread、vision-utils
// 所有感知和动作能力在这里汇聚

import { DesktopDevice } from './device'
import { AIClient } from './ai-client'
import { AppType } from './rpa/types'
import { BBox } from './rpa/vision-utils'
import { captureChatContextArea, captureChatMainArea } from './rpa/screenshot-utils'
import { sendReplyAction, activeUnreadByClickAction, clickUnreadContactAction } from './rpa/input-utils'
import {
  hasUnreadMessage as hasUnreadMessageDetect,
  isChatContactUnread as isChatContactUnreadDetect
} from './rpa/has-unread'
import {
  setChatBaseline as setChatBaselineFn,
  checkChatAreaDiff,
  clearChatBaseline as clearChatBaselineFn
} from './rpa/image-compare'
import {
  clearLayoutCache,
  detectUnreadArea as detectUnreadAreaFn,
  detectWechatLayout,
  getInputAreaFromCache,
  getLayoutCache,
  setLayoutCache
} from './rpa/vision-utils'
import { getWechatWindowInfo } from './rpa/window-utils'
import {
  bboxToScreenCoords,
  captureFullScreenImage,
  detectIncomingImage,
  pressEscape,
  readImageContent,
  waitForImageViewer
} from './rpa/image-reading'
import { captureWechatWindow } from './rpa/screenshot-utils'

export class RPADevice implements DesktopDevice {
  private appType: AppType = 'wechat'
  private aiClient: AIClient | null = null

  setAppType(appType: AppType): void {
    this.appType = appType
  }

  setApiKey(apiKey: string): void {
    this.setVisionConfig({ apiKey })
  }

  /** 设置视觉模型配置（布局检测 / 红点检测 / 图片读取共用） */
  setVisionConfig(config: { apiKey: string; baseURL?: string; model?: string }): void {
    if (!config.apiKey) return
    this.aiClient = new AIClient({
      apiKey: config.apiKey,
      baseURL: config.baseURL || undefined,
      model: config.model || undefined
    })
  }

  // ── 生命周期 ──
  // 旧实现里 clearLayoutCache 由 WeChatChannelSession.onStop 调用。改用 GenericChannelSession 之后，
  // 把这个微信特定的清理动作下沉到设备的 onSessionStop hook 里，让 channel session 不必感知 appType。
  onSessionStop(): void {
    clearLayoutCache(this.appType)
  }

  // ── 感知层 ──

  /**
   * 启动时一次性 VLM 布局测量（并行执行）
   *
   * 并行调两个 VLM 检测任务:
   * 1. detectUnreadArea — chatEntranceArea + firstContact（红点检测用）
   * 2. detectWechatLayout — searchInputBox + headerArea + chatMainArea（diff/搜索用）
   *
   * 检测完成后，从 chatMainArea 反推 inputArea（纯计算，无外部调用）
   */
  async measureLayout(): Promise<{ success: boolean; error?: string }> {
    if (!this.aiClient) {
      console.error('[RPADevice] aiClient 未初始化，无法测量布局')
      return { success: false, error: 'AI Client 未初始化' }
    }

    try {
      // 提前校验应用窗口，避免大模型成本和迷惑性报错
      const windowInfo = await getWechatWindowInfo(this.appType)
      if (!windowInfo) {
        const appName = this.appType === 'wechat' ? '微信' : (this.appType === 'wework' ? '企业微信' : 'WhatsApp')
        return { success: false, error: `未找到${appName}窗口，请确保已打开且未被完全遮挡/最小化` }
      }

      console.log('[RPADevice] 开始布局测量（并行）...')

      const [unreadResult, layoutResult] = await Promise.allSettled([
        detectUnreadAreaFn(this.aiClient, this.appType),
        detectWechatLayout(this.aiClient, this.appType)
      ])

      // 检查结果
      const unreadOk = unreadResult.status === 'fulfilled' && unreadResult.value.success
      const layoutOk = layoutResult.status === 'fulfilled' && layoutResult.value.success

      console.log('[RPADevice] VLM 检测结果:', {
        detectUnreadArea: unreadOk ? '✓' : '✗',
        detectWechatLayout: layoutOk ? '✓' : '✗'
      })

      if (unreadResult.status === 'fulfilled' && unreadResult.value.success) {
        console.log('[RPADevice] 未读区域:', {
          chatEntrance: unreadResult.value.chatEntranceArea?.coordinates,
          firstContact: unreadResult.value.firstContact?.coordinates
        })
      } else {
        const error = unreadResult.status === 'rejected'
          ? unreadResult.reason
          : (unreadResult.value as any)?.error
        console.error('[RPADevice] 未读区域检测失败:', error)
      }

      if (layoutResult.status === 'fulfilled' && layoutResult.value.success) {
        console.log('[RPADevice] 主布局:', {
          searchInputBox: layoutResult.value.searchInputBox?.coordinates,
          headerArea: layoutResult.value.headerArea?.coordinates,
          chatMainArea: layoutResult.value.chatMainArea?.coordinates
        })

        // 从 chatMainArea 反推 inputArea（纯计算）
        const inputArea = getInputAreaFromCache(this.appType)
        if (inputArea) {
          console.log('[RPADevice] 输入框（反推）:', inputArea.coordinates)
        } else {
          console.warn('[RPADevice] 输入框反推失败')
        }
      } else {
        const error = layoutResult.status === 'rejected'
          ? layoutResult.reason
          : (layoutResult.value as any)?.error
        console.warn('[RPADevice] 主布局检测失败（非致命）:', error)
      }

      // 核心判定：后续截图 / diff / 发送都依赖主布局和输入框位置。
      // 未读区域可以缺失，缺失时 session 会退回当前会话 diff 轮询。
      if (!layoutOk) {
        const errorMsg =
          layoutResult.status === 'fulfilled' && !layoutResult.value.success
            ? layoutResult.value.error || '主布局检测失败'
            : '主布局检测失败'
        return { success: false, error: `布局测量失败: ${errorMsg}` }
      }

      const inputArea = getInputAreaFromCache(this.appType)
      if (!layoutResult.value.chatMainArea || !inputArea) {
        return { success: false, error: '布局测量失败: 缺少聊天区或输入框位置' }
      }

      console.log('[RPADevice] 布局测量完成 ✓')
      return { success: true }
    } catch (error: any) {
      console.error('[RPADevice] 布局测量异常:', error)
      return { success: false, error: String(error) }
    }
  }

  async screenshot(): Promise<string> {
    // 优先截「聊天区 + 顶部 header」：模型需要看到联系人名称才能识别客户
    const image = (await captureChatContextArea(this.appType)) ?? (await captureChatMainArea(this.appType))
    if (!image) {
      throw new Error('聊天区截图失败')
    }
    return image.toDataURL()
  }

  async hasUnreadMessage(): Promise<{
    hasUnread: boolean
    chatEntranceArea?: { bbox: BBox; coordinates: [number, number] }
  }> {
    if (!this.aiClient) {
      console.warn('[RPADevice] aiClient 未初始化，无法进行视觉检测')
      return { hasUnread: false }
    }

    const result = await hasUnreadMessageDetect(this.aiClient, this.appType)

    if (!result.success) {
      console.error('[RPADevice] hasUnreadMessage 失败:', result.error)
      return { hasUnread: false }
    }

    return {
      hasUnread: result.hasUnread || false,
      chatEntranceArea: result.chatEntranceArea
    }
  }

  async isChatContactUnread(): Promise<{
    isUnread: boolean
    firstContactCoords?: [number, number]
  }> {
    if (!this.aiClient) {
      console.warn('[RPADevice] aiClient 未初始化')
      return { isUnread: false }
    }

    const result = await isChatContactUnreadDetect(this.aiClient, this.appType)

    if (!result.success) {
      console.error('[RPADevice] isChatContactUnread 失败:', result.error)
      return { isUnread: false }
    }

    return {
      isUnread: result.isUnread || false,
      firstContactCoords: result.firstContact?.coordinates
    }
  }

  /**
   * 清除未读区域的 VLM 坐标缓存（chatEntranceArea + firstContact）
   * 连续检测失败时调用：强制下次 isChatContactUnread / hasUnreadMessage 重新 VLM 定位
   */
  clearUnreadCache(): void {
    const cache = getLayoutCache(this.appType)
    if (cache) {
      cache.chatEntranceArea = null
      cache.firstContact = null
      setLayoutCache(this.appType, cache)
      console.log('[RPADevice] 已清除未读区域缓存')
    }
  }

  // ── chatMainArea Diff 检测 ──

  async setChatBaseline(): Promise<boolean> {
    return setChatBaselineFn(this.appType)
  }

  async hasChatAreaChanged(): Promise<{ hasDiff: boolean; hasBaseline: boolean }> {
    return checkChatAreaDiff(this.appType)
  }

  clearChatBaseline(): void {
    clearChatBaselineFn()
  }

  // ── 动作层 ──

  async sendMessage(text: string): Promise<void> {
    const success = await sendReplyAction(this.appType, text)
    if (!success) {
      throw new Error('发送消息失败')
    }
  }

  /**
   * 点击红点区域激活未读消息（视觉路线）
   * 微信场景双击，企业微信场景单击
   */
  async activeUnreadByClick(coordinates: [number, number]): Promise<void> {
    await activeUnreadByClickAction(coordinates, this.appType)
  }

  /**
   * 点击联系人列表中的第一个联系人
   */
  async clickUnreadContact(coordinates: [number, number]): Promise<void> {
    await clickUnreadContactAction(coordinates)
  }

  async clickAt(x: number, y: number): Promise<void> {
    await clickUnreadContactAction([x, y])
  }

  /**
   * 检测并读取对方最新发来的图片消息。
   * 流程：全窗截图 → VLM 定位图片气泡 → 点击缩略图 → 等查看器打开
   *       → 全屏截图 → VLM 读图 → Esc 关闭。
   * 任何一步失败都安全返回 null（不阻断正常回复流程）。
   */
  async analyzeIncomingImage(): Promise<string | null> {
    if (!this.aiClient) return null

    try {
      // 1. 全窗口截图（VLM 检测需要看到整个对话区）
      const shot = await captureWechatWindow(this.appType)
      if (!shot.success || !shot.screenshotBase64 || !shot.bounds) {
        console.warn('[RPADevice] 图片检测：窗口截图失败')
        return null
      }

      // 2. 检测对方最新图片消息气泡
      const bbox: BBox | null = await detectIncomingImage(this.aiClient, shot.screenshotBase64)
      if (!bbox) return null
      console.log('[RPADevice] 检测到对方发来的图片:', bbox)

      // 3. 归一化 bbox → 屏幕物理像素坐标，点击缩略图
      const scaleFactor = shot.display?.scaleFactor ?? 1
      const [clickX, clickY] = bboxToScreenCoords(bbox, shot.bounds, scaleFactor)
      console.log(
        `[RPADevice] 点击图片缩略图 (${clickX}, ${clickY}) scaleFactor=${scaleFactor}`
      )
      await this.clickAt(clickX, clickY)
      await waitForImageViewer()

      // 4. 全屏截图（微信图片查看器大图）
      const fullScreen = await captureFullScreenImage()
      if (!fullScreen) {
        await pressEscape()
        return null
      }

      // 5. VLM 读取大图内容
      const content = await readImageContent(this.aiClient, fullScreen)

      // 6. 关闭查看器，恢复聊天窗口
      await pressEscape()
      await new Promise((resolve) => setTimeout(resolve, 400))

      const trimmed = content?.trim()
      if (!trimmed) {
        console.warn('[RPADevice] 图片内容读取为空')
        return null
      }
      console.log('[RPADevice] 图片内容已读取:', trimmed.slice(0, 120))
      return trimmed
    } catch (error: unknown) {
      console.error(
        '[RPADevice] 图片读取异常（不阻断回复）:',
        error instanceof Error ? error.message : String(error)
      )
      await pressEscape().catch(() => {})
      return null
    }
  }
}
