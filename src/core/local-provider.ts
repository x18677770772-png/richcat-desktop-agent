// src/core/local-provider.ts
// 本地聊天 Provider — 默认回复链路（智能客服）
//
// 相比远程 bundle provider，LocalProvider 直接运行在主进程内，因此能访问
// 角色库 / 知识库 / 客户档案等本地数据，构成完整「AI 微信客服工作台」链路：
//
//   截图 → getSmartReply（一次调用：识别联系人 + 判断 + 回复 + 本轮摘要）
//        → 注入当前角色 prompt / 知识库 / 客户长期记忆
//        → 回写客户档案（对话摘要、计数、时间）
//
// 客户记忆的「先回复后注入」问题处理：
// 联系人只有拿到截图后才能识别，因此本 provider 缓存上一个联系人及其
// 记忆段——同一会话连续多轮时记忆持续生效；会话切换后的第一轮无该客户
// 记忆注入（可接受），识别完成后缓存即更新，下一轮恢复记忆注入。

import { AIClient, AIClientConfig, SmartReplyResult } from './ai-client'
import { ProviderAdapter, ProviderEvent, ProviderInput } from './session-types'
import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** LocalProvider 运行时上下文（由主进程注入，全部可选） */
export interface LocalProviderContext {
  /** 当前角色的完整 system prompt；null 表示默认客服人设 */
  getPersonaPrompt?: () => string | null
  /** 知识库注入段（已格式化 markdown） */
  getKnowledgeSection?: () => string
  /** 指定联系人的长期记忆注入段（已格式化 markdown） */
  getCustomerSection?: (contact: string) => string
  /** 回写客户长期记忆（contact 为 null 时不回写） */
  recordCustomerMemory?: (contact: string, summary: string, reply: string | null) => void
  /**
   * 每轮 getSmartReply 结果的后处理钩子（F1 后置过滤 / F2/F5/F7 消费入口）。
   * 返回的 result 用于本轮发送判定与记忆回写；抛错被吞掉（记日志，不影响主链路）。
   * flag 关闭时装配方传入的实现应立即原样返回 result（零影响）。
   */
  transformResult?: (result: SmartReplyResult, input: ProviderInput) => SmartReplyResult
  /**
   * F2：会话级暂停判定——上一轮识别到的联系人（lastContact）是否已被人工接管。
   * 返回 true → 本轮直接 skip（不发 AI 调用，零成本）；flag 关时装配方返回 false（零影响）。
   */
  shouldSkipContact?: (contact: string) => boolean
}

export interface LocalProviderConfig {
  ai: Partial<AIClientConfig> & { apiKey: string }
  context?: LocalProviderContext
}

export class LocalProvider implements ProviderAdapter {
  private aiClient: AIClient
  private readonly context: LocalProviderContext
  /** 上一个识别到的联系人（用于连续会话的记忆注入） */
  private lastContact: string | null = null
  private lastContactSection: string = ''

  constructor(config: LocalProviderConfig) {
    this.aiClient = new AIClient(config.ai)
    this.context = config.context ?? {}
  }

  async *run(input: ProviderInput): AsyncIterable<ProviderEvent> {
    if (!input.screenshot) {
      yield { type: 'skip' }
      return
    }

    await this.persistDebugInput(input)
    yield { type: 'thinking', content: this.buildThinkingMessage(input) }

    // F2：上一轮联系人已被人工接管 → 本轮零调用直接跳过（该会话暂停自动回复）
    if (this.lastContact && this.context.shouldSkipContact?.(this.lastContact)) {
      console.log(`[LocalProvider] 客户「${this.lastContact}」已转人工，跳过本轮自动回复`)
      yield { type: 'skip' }
      return
    }

    try {
      // ── F10（C1）：优先使用 PromptAssembler 拼好的完整 system prompt ──
      // assembledPrompt 已含全部注入段与输出格式段（docs §4.5 共 14 段），因此
      // 置 appendOutputFormat=false 防止 getSmartReply 重复追加输出格式段；
      // 未提供时走旧拼装路径（getPersonaPrompt + 知识/客户/记忆/图片段），向后兼容。
      const assembled = input.assembledPrompt?.trim()
      const result = await this.aiClient.getSmartReply(
        input.screenshot,
        assembled
          ? { systemPrompt: assembled, appendOutputFormat: false }
          : {
              systemPrompt: this.context.getPersonaPrompt?.() ?? undefined,
              knowledgeSection: this.context.getKnowledgeSection?.(),
              customerSection: this.resolveCustomerSection(),
              memoryCards: input.memoryCards,
              imageContext: input.imageContext
            }
      )
      if (assembled) {
        console.log(`[LocalProvider] 使用 PromptAssembler 完整 prompt（${assembled.length} 字符）`)
      }

      // ── 结果后处理钩子（F1 后置过滤等；失败仅记日志，绝不影响发送判定）──
      const finalResult = this.applyTransformResult(result, input)

      // 识别到联系人 → 更新缓存 + 回写客户档案
      if (finalResult.contact) {
        const contact = finalResult.contact
        if (contact !== this.lastContact) {
          this.lastContact = contact
          this.lastContactSection = this.context.getCustomerSection?.(contact) ?? ''
        }
        const summary =
          finalResult.summary?.trim() ||
          (finalResult.reply
            ? `与${contact}的对话，回复：${finalResult.reply.slice(0, 120)}`
            : `与${contact}的对话，本轮无需回复`)
        this.context.recordCustomerMemory?.(contact, summary, finalResult.reply)
      }

      if (!finalResult.reply) {
        yield { type: 'skip' }
        return
      }

      yield { type: 'reply_text', content: finalResult.reply }
    } catch (error: unknown) {
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : String(error) || 'Provider 调用失败'
      }
    }
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    return this.aiClient.testConnection()
  }

  updateConfig(config: Partial<AIClientConfig>): void {
    this.aiClient.updateConfig(config)
  }

  /** 会话切换检测：外部可在检测到聊天会话切换时调用，避免跨客户串记忆 */
  resetContactCache(): void {
    this.lastContact = null
    this.lastContactSection = ''
  }

  getLastContact(): string | null {
    return this.lastContact
  }

  private resolveCustomerSection(): string {
    return this.lastContact ? this.lastContactSection : ''
  }

  /** 调用装配方注入的 transformResult；任何异常吞掉并记日志，返回原 result（不阻塞主链路） */
  private applyTransformResult(result: SmartReplyResult, input: ProviderInput): SmartReplyResult {
    if (!this.context.transformResult) return result
    try {
      return this.context.transformResult(result, input)
    } catch (error) {
      console.error('[LocalProvider] transformResult 钩子执行失败（忽略，使用原始结果）:', error)
      return result
    }
  }

  private buildThinkingMessage(input: ProviderInput): string {
    const parts: string[] = []
    if (input.memoryCards?.length) parts.push(`${input.memoryCards.length} 条团队经验`)
    if (this.lastContact) parts.push(`客户「${this.lastContact}」历史记忆`)
    if (this.context.getPersonaPrompt?.()) parts.push('角色设定')
    const loaded = parts.length ? `（已加载 ${parts.join('、')}）` : ''
    return `正在分析聊天内容${loaded}...`
  }

  private async persistDebugInput(input: ProviderInput): Promise<void> {
    try {
      const parsed = this.parseScreenshotData(input.screenshot)
      if (!parsed) {
        console.warn('[LocalProvider] 未能解析 provider 输入截图，跳过落盘')
        return
      }

      const debugDir = path.join(os.tmpdir(), 'richcat-desktop-agent', 'provider-inputs')
      await mkdir(debugDir, { recursive: true })

      const stamp = this.createTimestamp()
      const baseName = `${stamp}-${input.appType}`
      const imagePath = path.join(debugDir, `${baseName}.${parsed.extension}`)
      const metaPath = path.join(debugDir, `${baseName}.json`)
      const latestImagePath = path.join(debugDir, `latest-${input.appType}.${parsed.extension}`)
      const latestMetaPath = path.join(debugDir, `latest-${input.appType}.json`)

      const metadata = {
        savedAt: new Date().toISOString(),
        appType: input.appType,
        currentContact: input.currentContact ?? null,
        ocrText: input.ocrText ?? null,
        mimeType: parsed.mimeType,
        imageBytes: parsed.buffer.length,
        imagePath
      }

      await writeFile(imagePath, parsed.buffer)
      await writeFile(metaPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
      await writeFile(latestImagePath, parsed.buffer)
      await writeFile(latestMetaPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')

      console.log(
        `[LocalProvider] 模型输入截图已保存: ${imagePath} (${parsed.buffer.length} bytes, mime=${parsed.mimeType})`
      )
      console.log(`[LocalProvider] 模型输入元数据已保存: ${metaPath}`)
      console.log(`[LocalProvider] 当前最新截图快捷路径: ${latestImagePath}`)
    } catch (error) {
      console.error('[LocalProvider] 保存模型输入截图失败:', error)
    }
  }

  private parseScreenshotData(
    screenshot: string
  ): { buffer: Buffer; mimeType: string; extension: string } | null {
    const dataUrlMatch = screenshot.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
    if (dataUrlMatch) {
      const mimeType = dataUrlMatch[1]
      const base64 = dataUrlMatch[2]
      const extension = this.mimeTypeToExtension(mimeType)
      return {
        buffer: Buffer.from(base64, 'base64'),
        mimeType,
        extension
      }
    }

    if (!screenshot.trim()) {
      return null
    }

    return {
      buffer: Buffer.from(screenshot, 'base64'),
      mimeType: 'image/png',
      extension: 'png'
    }
  }

  private mimeTypeToExtension(mimeType: string): string {
    switch (mimeType) {
      case 'image/jpeg':
        return 'jpg'
      case 'image/webp':
        return 'webp'
      default:
        return 'png'
    }
  }

  private createTimestamp(): string {
    return new Date().toISOString().replace(/[:.]/g, '-')
  }
}
