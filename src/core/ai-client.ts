// src/core/ai-client.ts
// AI 客户端 — 统一封装所有大模型调用
//
// 使用火山引擎 Ark OpenAI 兼容 /chat/completions 端点 + doubao-seed-2-0-lite
// 两种用途：
//   1. 聊天回复：截图 → AI 分析 → 回复文字
//   2. VLM 视觉检测：截图 → AI 分析 → bbox/point 坐标

import { MemoryCardBrief } from './trace/trace-types'

export interface AIClientConfig {
  apiKey: string
  model: string
  baseURL: string
  systemPrompt: string
}

/** 把经验卡片拼成 system prompt 附加段（与内置 provider bundle 的格式保持一致） */
export function buildMemorySection(memoryCards?: MemoryCardBrief[]): string {
  if (!memoryCards || memoryCards.length === 0) return ''
  const lines = memoryCards.map((card, index) => {
    const rationale = card.rationale ? `（原因：${card.rationale}）` : ''
    return `${index + 1}. 【${card.scenario}】${card.guidance}${rationale}`
  })
  return `\n\n## 团队经验（来自工作记忆，优先遵循）\n${lines.join('\n')}`
}

/**
 * 把知识库条目拼成 system prompt 附加段。
 * items 建议由 KnowledgeStore.getInjectionItems() 提供（已截断、限条数）。
 */
export function buildKnowledgeSection(
  items?: Array<{ title: string; content: string }>
): string {
  if (!items || items.length === 0) return ''
  const lines = items.map((item, index) => `${index + 1}. 【${item.title}】${item.content}`)
  return `\n\n## 知识库（公司/业务资料，回答以此为准；知识库未覆盖时如实说明）\n${lines.join('\n')}`
}

const DEFAULT_MODEL = 'doubao-seed-2-0-lite-260215'
const DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'

const REPLY_SYSTEM_PROMPT = `你是一个微信自动回复助手。你会收到一张微信/企业微信的聊天窗口截图。

## 你的任务
分析截图中的聊天内容，生成合适的回复。

## 规则
1. 只输出回复文字，不要解释、不要添加多余内容
2. **防自我循环**：仔细观察截图。聊天窗口中，右侧的气泡是"我"发送的。如果最后一条消息是右侧气泡（即"我"自己发送的），必须输出 [SKIP]
3. 如果最新消息是系统消息、群公告、红包、转账等非对话消息，输出 [SKIP]
4. 如果无法判断是否需要回复，输出 [SKIP]
5. 回复要自然、口语化，像真人对话`

export class AIClient {
  private config: AIClientConfig

  constructor(config: Partial<AIClientConfig> & { apiKey: string }) {
    this.config = {
      apiKey: config.apiKey,
      model: config.model || DEFAULT_MODEL,
      baseURL: config.baseURL || DEFAULT_BASE_URL,
      systemPrompt: config.systemPrompt || REPLY_SYSTEM_PROMPT
    }
  }

  /**
   * 智能回复 — 一次视觉调用同时完成「识别当前联系人 + 判断是否回复 + 生成回复」。
   *
   * 输出 JSON：{"contact": "...", "reply": "..."}
   * - contact: 截图里当前对话的联系人名称（昵称/备注名），无法识别时为 null
   * - reply:   回复内容；null 表示本轮无需回复（等价 [SKIP]）
   *
   * 上下文注入（全部可选）：
   * - systemPrompt: 角色 prompt（完整 system prompt，替代默认客服提示词）
   * - knowledgeSection / customerSection / memoryCards: 知识库 / 客户记忆 / 团队经验段
   *
   * 容错：模型输出非法 JSON 时降级按旧格式（纯文本 / [SKIP]）解析，保证老模型可用。
   */
  async getSmartReply(
    screenshotBase64: string,
    ctx?: {
      systemPrompt?: string
      knowledgeSection?: string
      customerSection?: string
      memoryCards?: MemoryCardBrief[]
      /** 对方发来的图片内容（设备已点开大图读取的描述） */
      imageContext?: string
    }
  ): Promise<{ contact: string | null; reply: string | null; summary?: string }> {
    const startTime = Date.now()
    const basePrompt = ctx?.systemPrompt?.trim() || this.config.systemPrompt || REPLY_SYSTEM_PROMPT

    const sections = [
      ctx?.knowledgeSection || '',
      ctx?.customerSection || '',
      ctx?.imageContext
        ? `\n\n## 对方刚发来的图片内容（AI 已点开大图读取，请结合图片内容理解并回复）\n${ctx.imageContext}`
        : '',
      buildMemorySection(ctx?.memoryCards)
    ]
      .filter((section) => section.trim().length > 0)
      .join('\n')

    const smartPrompt = `${basePrompt}\n${sections}

## 输出格式（必须严格遵守）
以 JSON 格式输出，不要输出任何其他内容：
{"contact": "当前对话的联系人名称", "reply": "你的回复内容", "summary": "本轮对话一句话摘要"}
- contact：从截图顶部（对话窗口标题栏 / 联系人名称区域，通常在消息区上方）识别当前对话的联系人名称（昵称或备注名）；无法识别时填 null
- reply：你的回复；如果按规则不需要回复，填 null（等价于 [SKIP]）
- summary：本轮对话的一句话摘要（客户说了什么、你如何处理），用于客户长期记忆；reply 为 null 时也尽量填写，实在无法判断可填 null`

    try {
      console.log('[AIClient] getSmartReply 开始...')
      const raw = await this.callVision(
        smartPrompt,
        '请根据截图中微信聊天窗口的最新消息，按输出格式要求返回 JSON。',
        screenshotBase64
      )
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      console.log(`[AIClient] getSmartReply 完成 (${elapsed}s):`, raw.slice(0, 160))

      const parsed = parseSmartReply(raw)
      if (parsed) return parsed

      // 降级：模型没按 JSON 输出（旧模型）→ 按旧格式解析
      if (!raw || raw.trim() === '[SKIP]') {
        return { contact: null, reply: null }
      }
      return { contact: null, reply: raw.trim() }
    } catch (error: any) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      console.error(`[AIClient] 智能回复失败 (${elapsed}s):`, error?.message || error)
      throw error
    }
  }

  /**
   * 发送截图给 AI，获取聊天回复
   * memoryCards: 运行时注入的经验卡片（工作记忆），拼入 system prompt
   */
  async getReply(screenshotBase64: string, memoryCards?: MemoryCardBrief[]): Promise<string | null> {
    const startTime = Date.now()
    try {
      console.log('[AIClient] getReply 开始...')
      const replyText = await this.callVision(
        this.config.systemPrompt + buildMemorySection(memoryCards),
        '请根据截图中微信聊天窗口的最新消息进行回复。',
        screenshotBase64
      )

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      console.log(`[AIClient] getReply 完成 (${elapsed}s):`, replyText?.slice(0, 100))

      if (!replyText || replyText.trim() === '[SKIP]') {
        return null
      }

      return replyText.trim()
    } catch (error: any) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      console.error(`[AIClient] 聊天回复失败 (${elapsed}s):`, error?.message || error)
      throw error
    }
  }

  /**
   * VLM 视觉检测 — 发送截图 + prompt，获取 bbox/point 文本
   * 供 vision-utils.ts 调用
   */
  async detectVision(prompt: string, screenshotBase64: string): Promise<string> {
    return await this.callVision(
      '你是一个视觉分析专家。请严格按照用户要求的格式输出检测结果。',
      prompt,
      screenshotBase64
    )
  }

  /**
   * 纯文本调用（不带图片）— 用于 testConnection 等
   */
  async callText(userMessage: string): Promise<string> {
    const data = await this.callAPI([
      { role: 'user', content: userMessage }
    ])
    return this.extractText(data)
  }

  /**
   * 测试 API 连接
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.callText('你好，请回复"连接成功"。')
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) }
    }
  }

  updateConfig(config: Partial<AIClientConfig>): void {
    Object.assign(this.config, config)
  }

  getApiKey(): string {
    return this.config.apiKey
  }

  // ── 内部方法 ──

  /**
   * 视觉调用：system prompt + 用户文本 + 图片
   */
  private async callVision(
    systemPrompt: string,
    userText: string,
    imageBase64: string
  ): Promise<string> {
    const rawBase64 = this.stripBase64Prefix(imageBase64)
    const imageUrl = rawBase64.startsWith('http')
      ? rawBase64
      : `data:image/png;base64,${rawBase64}`

    const data = await this.callAPI([
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageUrl } },
          { type: 'text', text: userText }
        ]
      }
    ])

    return this.extractText(data)
  }

  /**
   * 底层 HTTP 调用 — OpenAI 兼容 /chat/completions 端点
   * thinking 字段是火山方舟对标 OpenAI Responses API 的扩展参数，
   * 在非火山供应商上会被忽略，放在这里不影响兼容性
   */
  private async callAPI(messages: any[]): Promise<any> {
    const url = `${this.config.baseURL}/chat/completions`
    const TIMEOUT_MS = 30_000 // 30 秒超时
    const callStart = Date.now()

    // 计算 payload 大小（粗略，不重复序列化）
    const bodyStr = JSON.stringify({
      model: this.config.model,
      messages,
      thinking: { type: 'disabled' },
      stream: false
    })
    const bodySizeKB = (bodyStr.length / 1024).toFixed(0)
    console.log(
      `[AIClient] callAPI 开始 | model=${this.config.model} | payload=${bodySizeKB}KB | timeout=${TIMEOUT_MS / 1000}s`
    )

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: bodyStr,
        signal: controller.signal
      })

      const fetchElapsed = ((Date.now() - callStart) / 1000).toFixed(1)
      console.log(`[AIClient] 收到响应 status=${response.status} (${fetchElapsed}s)`)

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`[AIClient] API 错误: ${response.status}`, errorText)
        throw new Error(buildApiErrorMessage(response.status, errorText, this.config.baseURL))
      }

      const json = await response.json()
      const totalElapsed = ((Date.now() - callStart) / 1000).toFixed(1)
      console.log(`[AIClient] 解析完成 (${totalElapsed}s)`)
      return json
    } catch (error: any) {
      const elapsed = ((Date.now() - callStart) / 1000).toFixed(1)
      if (error?.name === 'AbortError') {
        console.error(`[AIClient] ⏱ 超时！已等待 ${elapsed}s，上限 ${TIMEOUT_MS / 1000}s`)
        throw new Error(`AI API 请求超时 (${TIMEOUT_MS / 1000}s)`)
      }
      console.error(`[AIClient] 请求异常 (${elapsed}s):`, error?.message)
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * 从 OpenAI 兼容 /chat/completions 返回值中提取文本
   * 格式: { choices: [{ message: { role, content: string } }] }
   */
  private extractText(responseData: any): string {
    const content = responseData?.choices?.[0]?.message?.content
    if (typeof content === 'string' && content.length > 0) {
      return content
    }
    console.warn('[AIClient] 无法解析回复格式:', JSON.stringify(responseData).slice(0, 500))
    return ''
  }

  private stripBase64Prefix(base64: string): string {
    const idx = base64.indexOf('base64,')
    return idx !== -1 ? base64.slice(idx + 'base64,'.length) : base64
  }
}

/**
 * 构造 API 错误消息；401/403 时根据端点类型附加可操作的诊断提示。
 */
export function buildApiErrorMessage(
  status: number,
  errorText: string,
  baseURL: string
): string {
  let message = `API request failed: ${status} - ${errorText.slice(0, 200)}`
  if (status === 401 || status === 403) {
    const base = (baseURL || '').trim()
    if (base.includes('/api/plan/')) {
      message +=
        '。提示：这是 Agent Plan 专属端点，需要使用其专属 API Key（方舟控制台 → 开通管理 → Agent Plan → API Key 管理 创建），普通 ark-xxx 密钥无法通过鉴权。'
    } else if (base.includes('/api/coding/')) {
      message +=
        '。提示：这是 Coding Plan 专属端点，需要使用 Coding Plan 专属 API Key；如无订阅请改用标准 /api/v3 端点。'
    } else {
      message += '。提示：请检查 API Key 是否正确、是否与所选服务商匹配。'
    }
  }
  return message
}

/**
 * 解析 getSmartReply 的 JSON 输出。
 * 容错处理：去掉 markdown 代码围栏、提取第一个 {...} 块。
 */export function parseSmartReply(
  raw: string
): { contact: string | null; reply: string | null; summary?: string } | null {
  if (!raw || typeof raw !== 'string') return null
  const text = raw.trim()
  if (text === '[SKIP]') return { contact: null, reply: null }

  const withoutFence = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const match = withoutFence.match(/\{[\s\S]*\}/)
  if (!match) return null

  try {
    const obj = JSON.parse(match[0])
    if (!obj || typeof obj !== 'object') return null

    const contact =
      typeof obj.contact === 'string' && obj.contact.trim() ? obj.contact.trim() : null
    const reply = typeof obj.reply === 'string' && obj.reply.trim() ? obj.reply.trim() : null
    const summary =
      typeof obj.summary === 'string' && obj.summary.trim() ? obj.summary.trim() : undefined
    return { contact, reply, summary }
  } catch {
    return null
  }
}
