import { AppType } from './rpa/types'
import { MemoryCardBrief, TraceStepInput } from './trace/trace-types'

// ── V2 扩展：ProviderInput 公共扩展字段（C2：只加类型与解析，不消费）──
// 回滚说明：本块属于 C2 独立 commit；后续功能（F1/F2/F10）只读这些字段，
// revert 单个功能时不得改动本块；revert C2 本身后各功能因字段可选自动退化为 V1。

/** F1：群聊上下文（由 GroupChatDetector 填充；flag 关闭或非群聊时为 undefined） */
export interface GroupChatContext {
  isGroup: boolean
  groupName?: string
  /** 最后一条消息的发送者（群昵称/备注），无法识别为 null */
  lastSender: string | null
  /** 最后一条消息是否 @ 了本机器人（按配置的机器人昵称列表匹配） */
  isMentioned: boolean
  /** 最后一条消息类型：文本/图片/系统/红包/公告 */
  lastMessageKind: 'text' | 'image' | 'system' | 'red_packet' | 'announcement' | 'unknown'
}

export interface ProviderInput {
  screenshot: string
  appType: AppType
  currentContact?: string
  ocrText?: string
  /** 运行时注入的经验卡片（工作记忆）。Provider 可拼入 system prompt。 */
  memoryCards?: MemoryCardBrief[]
  /** 当前角色的完整 system prompt（人设系统）。Provider 优先采用。 */
  personaPrompt?: string
  /** 知识库注入段（已格式化 markdown）。Provider 可拼入 system prompt。 */
  knowledgeSection?: string
  /** 客户长期记忆注入段（已格式化 markdown）。Provider 可拼入 system prompt。 */
  customerSection?: string
  /** 对方发来的图片内容（已由设备点开大图读取的描述文本）。Provider 可拼入 system prompt。 */
  imageContext?: string
  // ── V2 扩展字段（可选；缺失时 Provider 行为与 V1 一致）──
  /** F1：群聊上下文（GroupChatDetector 填充；flag 关闭或非群聊时为 undefined） */
  groupChat?: GroupChatContext
  /** F2：会话轮次元信息（多轮未解决计数用） */
  sessionMeta?: { turnCount: number; unresolvedTurnCount: number }
  /** F10：PromptAssembler 拼接好的完整 system prompt（LocalProvider 优先采用；
   *  未提供时回退旧逻辑拼装） */
  assembledPrompt?: string
}

export type ProviderEvent =
  | { type: 'thinking'; content: string }
  | { type: 'reply_text'; content: string }
  | { type: 'skip' }
  | { type: 'error'; error: string }

export type SessionEvent =
  | { type: 'bootstrap' }
  | { type: 'observe_chat' }
  | { type: 'provider.thinking'; content: string }
  | { type: 'provider.reply_text'; content: string }
  | { type: 'provider.skip' }
  | { type: 'provider.error'; error: string }
  | { type: 'check_unread' }
  | { type: 'wait_retry'; reason?: string; delayMs?: number }

export interface ProviderAdapter {
  run(input: ProviderInput): AsyncIterable<ProviderEvent>
}

export interface RuntimeHostControls {
  enqueue(event: SessionEvent): void
  schedule(event: SessionEvent, delayMs: number): void
  runProvider(input: ProviderInput): AsyncIterable<ProviderEvent>
  log(type: 'thinking' | 'reply' | 'skip' | 'error', content: string): void
  /** 记录一条结构化工作轨迹（work-trace）。无 recorder 时为 no-op。 */
  trace(step: TraceStepInput): void
  isRunning(): boolean
  stopSession(reason?: string): Promise<void>
}

export interface ChannelContext<TState> {
  appType: AppType
  state: TState
  host: RuntimeHostControls
}

export interface ChannelSession<TState> {
  onStart(ctx: ChannelContext<TState>): Promise<void>
  onStop(ctx: ChannelContext<TState>): Promise<void>
  onEvent(event: SessionEvent, ctx: ChannelContext<TState>): Promise<void>
}
