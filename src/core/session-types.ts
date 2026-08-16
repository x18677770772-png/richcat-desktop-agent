import { AppType } from './rpa/types'
import { MemoryCardBrief, TraceStepInput } from './trace/trace-types'

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
