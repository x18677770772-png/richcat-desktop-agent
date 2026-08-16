# 财听猫 RichCat V2 工业级升级架构设计

> 版本：1.0（架构设计 T0 产出）
> 目标代码库：`C:\Users\86181\richcat`（Electron + Vite + React + TypeScript 桌面应用）
> 设计原则：**每个功能独立模块 + 独立开关 + 独立 commit 可回滚；关闭时零影响；全量 QA 零冲突零 bug**

---

## 目录

1. [总体架构与数据流](#1-总体架构与数据流)
2. [Feature Flags 功能开关设计](#2-feature-flags-功能开关设计)
3. [F1-F10 模块设计](#3-f1-f10-模块设计)
4. [提示词体系总设计（src/core/prompt/）](#4-提示词体系总设计)
5. [实施顺序建议](#5-实施顺序建议)
6. [附录：改动文件索引](#6-附录改动文件索引)

---

## 1. 总体架构与数据流

### 1.1 现状架构（读代码归纳）

RichCat 是 Electron 桌面应用，核心是一条 **"截图感知 → AI 判断 → RPA 动作"** 的自动客服循环：

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Renderer（React）                                                        │
│  App.tsx 控制面板 / SettingsWindow(基础/智能体/角色) / MemoryWindow        │
│  KnowledgeWindow / CustomerWindow / PersonaPanel                         │
│  通过 window.electron.invoke('engine:start' | 'settings:set' | ...) 通信  │
└───────────────▲──────────────────────────────────────────────────────────┘
                │ IPC（preload/index.ts 透传 invoke/on/send）
┌───────────────┴──────────────────────────────────────────────────────────┐
│  Main 进程（src/main/index.ts）                                           │
│  settingsStore(electron-store) ── settings:getAll/set、features:*         │
│  startEngineCore()：buildDevice() → Provider 装配 → RuntimeHost 启动       │
│  stores 单例：PersonaStore / KnowledgeStore / CustomerStore / ExperienceStore│
│  skill-server.ts（127.0.0.1:12680±）：OpenClaw 远程 start/pause/status     │
│  provider-bundle.ts：远程/内置 ProviderAdapter 安装与加载                   │
└───────────────┬──────────────────────────────────────────────────────────┘
                │ 构造
┌───────────────▼──────────────────────────────────────────────────────────┐
│  RuntimeHost<TState>（src/core/runtime-host.ts）                          │
│  事件队列 drainQueue：顺序消费 SessionEvent；start/stop；                 │
│  runProviderWithMemory()：注入 memoryCards / personaPrompt / knowledgeSection│
└───────────────┬──────────────────────────────────────────────────────────┘
                │ onEvent 派发
┌───────────────▼──────────────────────────────────────────────────────────┐
│  GenericChannelSession（src/core/generic-channel-session.ts）             │
│  事件状态机：bootstrap → observe_chat → provider.{thinking|reply_text|     │
│  skip|error} → check_unread → wait_retry（循环）                          │
└───────┬───────────────────────────────┬──────────────────────────────────┘
        │ DesktopDevice 接口               │ ProviderAdapter 接口
┌───────▼───────────────┐        ┌────────▼─────────────────────────┐
│ RPADevice / BoxSelect │        │ LocalProvider（默认，本地智能客服） │
│ device                │        │  截图→AIClient.getSmartReply      │
│ VLM布局/红点/diff/输入 │        │  →{contact,reply,summary}         │
│ rpa-device.ts+rpa/*   │        │  →回写客户档案/注入知识/人设        │
└───────────────────────┘        │ BundleProviderAdapter（远端 bundle）│
                                 └───────────────────────────────────┘
```

**核心数据结构（V2 扩展的基座）：**

- `ProviderInput`（session-types.ts）已有字段：`screenshot / appType / currentContact / ocrText / memoryCards / personaPrompt / knowledgeSection / customerSection / imageContext`
- `ProviderEvent`：`thinking / reply_text / skip / error`
- `SessionEvent`：`bootstrap / observe_chat / provider.* / check_unread / wait_retry`
- `SmartReplyResult`（ai-client.ts `getSmartReply` 返回）：`{ contact, reply, summary }`
- 数据存储：`settings.json`（electron-store）、`worktrace/memory/{personas,knowledge,cards}.json`、`worktrace/customers/customers.json`、`worktrace/sessions/*`（trace）

### 1.2 V2 目标架构

在现有骨架之上叠加 **三层**，全部向后兼容：

```
┌─ 应用层：Main 进程编排（index.ts 基本不变，新增 features 装配与定时器） ┐
│                                                                        │
│  FeatureFlags（settings.features）── 每个功能独立开关，关闭零影响        │
│                                                                        │
├─ 功能层：src/core/features/<feature>/（F1-F9 各自独立目录）             │
│  只通过以下三个显式接口与核心交互：                                     │
│  ① ProviderInput 扩展字段（可选）        —— 向 Provider 传上下文        │
│  ② SmartReplyResult 扩展字段（可选）     —— 接收 Provider 的分析结果     │
│  ③ FeatureHooks（beforeProvider/afterProvider/onTimer）—— 挂动作        │
│                                                                        │
├─ 提示词层：src/core/prompt/（F10）                                     │
│  PromptAssembler：按固定顺序拼接所有注入段（人设/群聊/VIP/知识/客户/经验/ │
│  情绪价值规范/输出格式），替代散落在 ai-client.ts / persona-store.ts 的   │
│  硬编码 prompt 文本                                                     │
└─────────────────────────────────────────────────────────────────────────┘
```

**V2 数据流（以 F1+F5 为例展示扩展点）：**

```
observe_chat（截图）
  │
  ├─ [F1] GroupChatDetector.detect(screenshot, aiClient) ── 可选，flag 开才调
  │      → ProviderInput.groupChat = { isGroup, lastSender, isMentioned, ... }
  │
  ▼
runProviderWithMemory（RuntimeHost）
  │  PromptAssembler.assemble({ persona, knowledge, customer, memory,
  │                            groupChat(仅 flag 开), features })
  │  → ProviderInput.assembledPrompt（替代散装 systemPrompt 拼接）
  ▼
LocalProvider.run → AIClient.getSmartReply（输出扩展，全部字段可选）
  │  → SmartReplyResult { contact, reply, summary,
  │                      messageKind?, emotion?, handoff?, routeTo?, followUp? }
  │
  ├─ [F5] EmotionRiskHook.afterProvider(emotion 字段) → 打标 + 通知
  ├─ [F2] HandoffHook.afterProvider(handoff 字段) → 停会话 + 桌面通知 + 标记
  ├─ [F7] FollowUpHook.afterProvider(followUp 字段) → 生成待办
  ▼
provider.reply_text → device.sendMessage → check_unread（循环）
  │
  └─ [F6] 每日 23:50 TimerHook → DailyReport.generate → 写 reports/*.md + 通知
```

### 1.3 模块依赖规则（防止隐式耦合）

- **单向依赖**：`features/*` →（只可依赖）`core/prompt`、各 store、`core/ai-client`、`core/session-types`；**禁止** features 之间直接 import。
- **F4 依赖 F1 必须走接口**：F4 只读 `ProviderInput.groupChat`（由 F1 填充），F4 不得 import F1 内部实现。
- **跨功能协作走 FeatureHooks**：F5 检测到高置信负面情绪 → 通过 hook 上下文调用 `hooks.requestHandoff(reason)`（由 F2 注册实现）；F2 不存在/关闭时该调用为 no-op。
- **store 扩展向后兼容**：所有 store 的新增字段可选（`?`），旧 JSON 文件缺字段时给默认值；文件 `version` 不变或升级时做迁移。

---

## 2. Feature Flags 功能开关设计

### 2.1 数据模型

新增 `settings.features: Record<FeatureFlagKey, boolean>`（并入现有 `AppSettings`，electron-store 持久化）：

```ts
// src/core/features/flags.ts
export type FeatureFlagKey =
  | 'f1.group_chat'        // 群聊支持
  | 'f2.human_handoff'     // 人工接管/升级
  | 'f3.vip_service'       // VIP 差异化服务
  | 'f4.role_routing'      // 多角色消息路由
  | 'f5.emotion_risk'      // 情绪/风险识别
  | 'f6.daily_report'      // 服务日报
  | 'f7.follow_up'         // 待跟进提醒
  | 'f8.multi_instance'    // 多实例协同（文档/配置，开关为占位）
  | 'f9.knowledge_v2'      // 知识库深度优化
  | 'f10.prompt_system'    // 提示词体系（默认开，可整体回退旧 prompt）

export const FEATURE_FLAG_DEFAULTS: Record<FeatureFlagKey, boolean> = {
  'f1.group_chat': false,
  'f2.human_handoff': true,
  'f3.vip_service': true,
  'f4.role_routing': false,
  'f5.emotion_risk': true,
  'f6.daily_report': true,
  'f7.follow_up': true,
  'f8.multi_instance': true,   // 占位：仅影响文档/UI 提示
  'f9.knowledge_v2': false,    // 默认关闭：知识注入策略保持现状（全量 30 条）
  'f10.prompt_system': true    // 默认开；关闭时 PromptAssembler 退化输出旧 prompt
}

export class FeatureFlags {
  constructor(private get: () => Partial<Record<FeatureFlagKey, boolean>>) {}
  isEnabled(key: FeatureFlagKey): boolean {
    return this.get()[key] ?? FEATURE_FLAG_DEFAULTS[key]
  }
  getAll(): Record<FeatureFlagKey, boolean> { /* 合并默认值 */ }
  set(key: FeatureFlagKey, value: boolean): void { /* 写 settings.features */ }
}
```

### 2.2 IPC 接口

在 `src/main/index.ts` 新增（保持与现有 `settings:*` 风格一致）：

| 通道 | 参数 | 返回 |
|---|---|---|
| `features:getAll` | 无 | `Record<FeatureFlagKey, boolean>`（含默认值合并） |
| `features:set` | `{ key: FeatureFlagKey, value: boolean }` | `{ success: boolean }` |
| `features:get` | `key` | `boolean` |

主进程持有单例 `featureFlags = new FeatureFlags(() => normalizeSettings(settingsStore.store).features)`；`normalizeSettings` 中把 `raw.features` 做白名单校验（非法 key 丢弃，缺失 key 用默认值）。

### 2.3 "关闭时零影响"硬性规定

对每个功能，flag 关闭时必须满足（QA 逐条验证）：

1. **不注入 prompt**：PromptAssembler 跳过该功能的所有注入段（连空段标记也不出现）。
2. **不改变行为**：会话事件流、发送/跳过判定与 V1 完全一致；新增字段不解析、不消费。
3. **无性能损失**：不发起额外 VLM/LLM 调用（F1 群聊检测、F5 情绪检测等检测调用必须包在 `if (flags.isEnabled(...))` 内）；不挂额外定时器（F6/F7 的 `setInterval` 在 flag 关时不创建）。
4. **不阻塞主链路**：任何 feature 模块抛错都被 try/catch 吞掉并记 log，绝不让 provider/session 崩溃。

### 2.4 设置 UI 位置建议

- **新增侧边栏菜单项「功能开关」（Features）**：在 `SettingsWindow`（App.tsx `SettingsSection` 增加 `'features'`）侧边栏「角色设定」之后加一项；渲染 `FeaturePanel` 组件：每个功能一行 `label + description + Switch`，开关即时调用 `features:set`。
- 显示当前生效状态 + 默认值说明；F8 行显示"多开已通过 --profile 支持，此为说明开关"。
- 开关变更不要求重启；下次 `engine:start` 生效（运行时变更也实时影响 PromptAssembler / 定时器）。

---

## 3. F1-F10 模块设计

> 每个功能统一给出：**模块边界（目录/文件）→ 接口定义 → 注入 prompt 段 → 改动文件清单 → 回滚影响面 → 验收标准**。
> 所有 `SmartReplyResult` 扩展字段**可选**，`parseSmartReply` 解析时字段缺失/解析失败一律 `undefined`，保证旧模型行为不变。

### 3.0 公共扩展：ProviderInput 与 SmartReplyResult（所有功能的地基）

```ts
// src/core/session-types.ts（追加可选字段，不改动现有字段）
export interface ProviderInput {
  // ...现有字段不变
  /** F1：群聊上下文（GroupChatDetector 填充；flag 关闭或非群聊时为 undefined） */
  groupChat?: GroupChatContext
  /** F5：会话轮次元信息（F2 多轮未解决计数用） */
  sessionMeta?: { turnCount: number; unresolvedTurnCount: number }
  /** F10：PromptAssembler 拼接好的完整 system prompt（LocalProvider 优先采用；
   *  未提供时回退旧逻辑拼装） */
  assembledPrompt?: string
}

// src/core/ai-client.ts（getSmartReply 返回值扩展，全部可选）
export interface SmartReplyResult {
  contact: string | null
  reply: string | null
  summary?: string
  // ── V2 扩展（可选；旧模型/旧 provider 不输出则 undefined）──
  /** F1：本条消息的归属判定 */
  messageKind?: 'customer' | 'group_member' | 'role_message' | 'system'
  /** F5：情绪与风险 */
  emotion?: {
    sentiment: 'positive' | 'neutral' | 'negative' | 'angry'
    risk?: 'refund_intent' | 'complaint' | 'urgent' | 'none'
    confidence: number // 0-1
  }
  /** F2：人工接管信号 */
  handoff?: {
    reason:
      | 'explicit_human'       // 客户明确要求转人工
      | 'complaint'            // 投诉
      | 'price_sensitive'      // 价格敏感/砍价纠缠
      | 'multiple_unresolved'  // 多轮未解决（由 sessionMeta 计数，非模型输出）
      | 'risk_escalation'      // 由 F5 高风险升级
    confidence: number
  }
  /** F4：路由目标角色 */
  routeTo?: { personaId: string; reason: string; confidence: number }
  /** F7：待跟进承诺 */
  followUp?: { action: string; dueAt?: string /* ISO 时间，缺省按 now+1d */ }
}
```

`parseSmartReply` 扩展解析（保持容错）：在现有 `{...}` 块内尝试取 `messageKind/emotion/handoff/routeTo/followUp`，每个字段独立 try/catch；解析失败仅该字段为 `undefined`，**绝不让整个 JSON 解析失败**。

```ts
// src/core/features/hooks.ts —— 功能挂载点（显式接口，防止隐式耦合）
export interface ProviderHookContext {
  input: ProviderInput
  result?: SmartReplyResult
  flags: FeatureFlags
  stores: {
    customer: CustomerStore
    knowledge: KnowledgeStore
    persona: PersonaStore
    followUp?: FollowUpStore        // F7 注册后非空
    handoff?: HandoffStore          // F2 注册后非空
  }
  device: DesktopDevice
  notify(payload: { type: string; data?: unknown }): void // 推给所有 renderer 窗口
  requestHandoff(reason: HandoffReason): void              // F2 注册的实现；未注册=no-op
  pauseSession(reason: string): Promise<void>              // 引擎级暂停（F2 用）
  log(type: 'thinking' | 'reply' | 'skip' | 'error', content: string): void
}

export interface FeatureModule {
  flagKey: FeatureFlagKey
  beforeProvider?(ctx: ProviderHookContext): void | Promise<void>
  afterProvider?(ctx: ProviderHookContext): void | Promise<void>
  afterReply?(ctx: ProviderHookContext, replyText: string): void | Promise<void>
  /** 定时触发（F6 日报 / F7 提醒共用）；flag 关时不注册 */
  onTimer?(kind: 'daily_report' | 'follow_up', now: Date): void | Promise<void>
}
```

主进程 `FeatureRegistry`：按 flag 是否开启装配 `FeatureModule[]`，在 RuntimeHost 的 provider 调用前后、发送后、以及定时器里依次调用（每个调用 try/catch）。

---

### F1 群聊支持

**目标**：识别当前会话是群聊；只对"客户本人"的消息或 @ 本机器人的消息回复，忽略其他成员/角色间消息；群公告、红包、系统消息不回复。

**模块边界**（`src/core/features/group-chat/`）：

```
src/core/features/group-chat/
  types.ts        — GroupChatContext 定义
  detect.ts       — GroupChatDetector（VLM 识别群聊状态与最后消息归属）
  section.ts      — buildGroupChatSection(ctx) → prompt 注入段
  index.ts        — FeatureModule 装配（flagKey='f1.group_chat'，无 hook 动作，只提供上下文）
```

```ts
// types.ts
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
```

**接口定义**：

```ts
// detect.ts
export class GroupChatDetector {
  constructor(
    private ai: AIClient,
    private opts: { botNames: string[] /* 机器人昵称，来自 settings.featuresConfig.f1.botNames */ }
  ) {}
  /** 截图 → 群聊上下文；失败返回 { isGroup:false } 且不抛错（不阻塞主链路） */
  async detect(screenshot: string): Promise<GroupChatContext>
}
```

检测方式（两种，配置选择）：
- **VLM 一次调用**：`ai.detectVision(GROUP_CHAT_PROMPT, screenshot)`，输出 JSON `{isGroup, groupName, lastSender, isMentioned, lastMessageKind}`，容错解析。
- **纯 @ 触发（零检测成本）**：仅当 `settings.featuresConfig.f1.mentionOnly=true` 时，跳过 VLM，默认 `isGroup=true, isMentioned=true`（即只靠提示词让模型自己判断是否被 @，回复前必须确认被 @ 或消息来自已知客户）。

**回复策略**（提示词 + 后置过滤双重保障）：
1. 提示词要求：群聊中，仅当 最后消息 @ 了机器人 或 发送者是该群已知客户（出现在客户档案）时回复；否则输出 `reply:null`。
2. 后置过滤（`afterProvider` hook）：`result.messageKind` 为 `group_member`/`role_message`/`system` 且 flag 开 → 强制将 reply 置 null（模型漏判的兜底）。

**注入 prompt 段**（`section.ts`，仅 `isGroup` 时插入，见 §4.5）：

```text
## 群聊规范（当前是群聊）
- 你只服务"客户本人"（群主/提问者/客户档案中存在的联系人）。
- 仅当：① 最后一条消息 @ 了你（机器人昵称），或 ② 发送者是客户档案中的联系人，才回复。
- 其他群成员消息、成员之间对话、群公告、红包、转账、系统消息一律输出 reply:null（不回复）。
- 回复时称呼对方群昵称，语气保持群聊场景的自然口语。
```

**改动文件清单**：
- 新增：`src/core/features/group-chat/{types,detect,section,index}.ts`
- 改：`src/core/session-types.ts`（ProviderInput.groupChat）、`src/core/ai-client.ts`（SmartReplyResult.messageKind + parse 扩展）、`src/core/features/hooks.ts`（ProviderHookContext 加 groupChat 字段）、`src/core/prompt/assembler.ts`（群聊段拼接）、`src/main/index.ts`（装配 GroupChatDetector 到 FeatureRegistry；新增 `settings.featuresConfig.f1`）
- 改 renderer：`App.tsx`（FeaturePanel F1 行 + botNames 输入）

**回滚影响面**（`git revert` 该功能 commit）：
- 涉及：上述新增 4 文件 + session-types/ai-client/hooks/assembler/index.ts 中 **F1 专属行**（ProviderInput.groupChat、messageKind、群聊段）。
- 风险点：`session-types.ts` 与 `ai-client.ts` 被多个功能共用——**F1 的字段必须用独立注释块标注 "F1"**，revert 时只回退标注块，避免误伤 F2/F5 字段；建议 F1 commit 独立于其他字段扩展 commit。
- 数据面：无新持久化文件（botNames 在 settings 内），回滚零数据残留。

**验收标准（QA 可执行）**：
1. flag 关闭：群聊内消息与 V1 行为一致（不注入群聊段、无额外 VLM 调用——用 log 确认无 GROUP_CHAT_PROMPT 调用）。
2. flag 开启 + 群聊：a) 其他成员发消息 → 不回复（日志出现 skip）；b) 客户本人在群内发消息 → 正常回复；c) @ 机器人 → 回复；d) 群公告/红包 → 不回复。
3. 单聊场景：isGroup=false，行为与 V1 一致。
4. 后置过滤：构造模型误输出 `messageKind=group_member` 但 reply 非空的用例 → 实际不发送（mock 或单测）。

---

### F2 人工接管/升级

**目标**：识别"转人工/投诉/价格敏感/多轮未解决"信号 → 停止该会话自动回复 → 桌面通知 + 客户标记"需人工"。

**模块边界**（`src/core/features/human-handoff/`）：

```
src/core/features/human-handoff/
  types.ts        — HandoffRequest / HandoffReason
  store.ts        — HandoffStore（JSON 持久化 worktrace/handoffs/handoffs.json）
  section.ts      — buildHandoffSection() → 提示词（要求模型识别后输出 handoff 字段）
  index.ts        — FeatureModule（afterProvider 消费 result.handoff；onTimer 轮询"多轮未解决"）
```

```ts
// types.ts
export type HandoffReason =
  | 'explicit_human' | 'complaint' | 'price_sensitive'
  | 'multiple_unresolved' | 'risk_escalation'
export interface HandoffRequest {
  handoffId: string
  contact: string | null
  reason: HandoffReason
  confidence: number
  createdAt: number
  status: 'open' | 'resolved'
  resolvedAt?: number
}
```

**Store**：与 CustomerStore 同款同步读写 + 内存缓存模式，文件 `worktrace/handoffs/handoffs.json`，`version:1`。

**触发链路**：
1. **模型信号**（`result.handoff`）：F2 flag 开 → `afterProvider` 中若 `result.handoff && confidence>=0.6` → `store.add(request)` → `ctx.requestHandoff(reason)`。
2. **多轮未解决**：RuntimeHost 在 provider 返回 `skip` 且 `sessionMeta.unresolvedTurnCount>=N`（配置 `f2.maxUnresolvedTurns=3`）时，由 F2 的 `onTimer`/`afterProvider` 侧计数触发（计数放 HandoffStore 内存 Map，按 contact 累计，回复成功/发送后清零）。
3. **F5 升级**：F5 检测到 `risk=refund_intent|complaint` 且 confidence>=0.7 → `ctx.requestHandoff('risk_escalation')`（经 hook 接口，F2 关闭时 no-op）。

**requestHandoff 动作**（F2 在 index.ts 注册实现）：
- `ctx.pauseSession('handoff:' + reason)` —— 停止引擎循环（复用 `stopEngineCore` 的语义，但保留引擎"运行中"UI 状态改为"已接管"？**决策**：V2 采用"会话级暂停"——新增 `SessionEvent {type:'handoff_pause'}`，GenericChannelSession 进入 paused 状态只对该 contact 停止自动回复，其他客户正常服务）。
- 桌面通知：`new Notification({ title: '需人工介入', body: `${contact}：${reasonLabel}` })`（主进程；macOS/Windows 均支持）。
- 推给 UI：`ctx.notify({ type:'handoff:new', data: request })` → 主窗口/客户窗口显示"需人工"角标。
- 客户打标：`stores.customer.addTags(customerId, ['需人工'])`（customerId 由 contact 查得；查不到则跳过）。

**注入 prompt 段**（`section.ts`，F2 flag 开时插入，见 §4.5）：

```text
## 转人工规则
- 当客户出现以下任一情形时，在输出 JSON 中附加 handoff 字段（不要直接回复拒绝话术）：
  a) 明确要求"转人工/找真人/人工客服"
  b) 投诉、威胁差评/曝光
  c) 价格敏感：反复砍价、质疑报价、要求不可能的低价
  d) 情绪激烈升级（结合 emotion 字段）
- handoff 格式：{"reason": "explicit_human|complaint|price_sensitive", "confidence": 0.0-1.0}
- 触发 handoff 时 reply 可给出安抚过渡语（如"我马上为您转接人工，请稍等"），但不得继续承诺解决方案。
```

**改动文件清单**：
- 新增：`src/core/features/human-handoff/{types,store,section,index}.ts`
- 改：`src/core/session-types.ts`（SessionEvent 增 `handoff_pause`；ProviderInput.sessionMeta）、`src/core/generic-channel-session.ts`（handoff_pause 分支：暂停当前会话循环）、`src/core/ai-client.ts`（SmartReplyResult.handoff）、`src/core/features/hooks.ts`（requestHandoff/pauseSession）、`src/main/index.ts`（Notification 权限+创建；HandoffStore 装配；config `f2.maxUnresolvedTurns`）
- 改 renderer：App.tsx（FeaturePanel F2 行 + 通知横幅渲染 handoff:new 事件）

**回滚影响面**：
- revert 后：handoff 事件、会话暂停分支、桌面通知、客户"需人工"打标全部消失；`handoffs.json` 文件残留但无害（新增文件，revert 不删数据；可手动清理）。
- 风险点：`generic-channel-session.ts` 新增的 `handoff_pause` 分支必须独立成 case 块；`SessionEvent` 联合类型新增成员不影响旧代码（switch 默认分支已存在）。
- 与 F5 的协作通过 hooks 接口（`requestHandoff` 引用），revert F2 后 F5 调用变 no-op，编译不受影响。

**验收标准**：
1. flag 关：客户说"转人工" → 仍走自动回复（与 V1 一致）。
2. flag 开：a) "我要找人工客服" → 停止该会话自动回复 + 桌面通知出现 + 客户档案出现"需人工"标签；b) 投诉话术 → 同上（reason=complaint）；c) 连续 3 轮无有效解决（skip 且无 reply）→ 触发多轮未解决接管；d) 其他客户会话不受影响（仍正常自动回复）。
3. 通知可点击聚焦主窗口（或至少通知已展示）。
4. handoffs.json 记录正确（reason/confidence/status=open）。

---

### F3 VIP 差异化服务

**目标**：按客户档案分类（category='VIP' 或 tags 含 'VIP'）驱动差异化：专属知识库片段、专属语气、可选"回复前人工确认"。

**模块边界**（`src/core/features/vip-service/`）：

```
src/core/features/vip-service/
  vip.ts          — isVip(customer) 判定 + VIP 客户上下文
  section.ts      — buildVipSection(customer) → 语气段 + 专属知识段
  index.ts        — FeatureModule（beforeProvider 注入 vipSection；afterReply 记 VIP 服务日志）
```

**关键设计**：
- **VIP 判定**：`customer.category === 'VIP' || customer.tags.includes('VIP')`（复用现有 CustomerStore，零新存储）。
- **专属知识库片段**：F9 开启时按知识条目标签匹配（知识条目新增 `scope?: 'vip'`，见 F9）；F9 关闭时 VIP 也使用全量注入，但提示词强调优先参考。→ **F3 不直接依赖 F9 实现**，通过 `stores.knowledge.getVipInjectionItems?.()`（F9 提供可选方法；未实现时回退全量）。
- **专属语气**：注入 VIP 语气段（尊称、不机械道歉、先共情再解决——情绪价值规范见 §4.3）。
- **回复前人工确认**（`f3.confirmBeforeReply=true` 时）：provider 返回 reply 后不直接发送，`afterProvider` 中改为推给 UI 一个 `vip:confirm` 事件（含 contact+reply 预览），等待用户在设置窗口/主窗口点击"确认发送/拒绝"，确认后调用 `device.sendMessage`。实现：V2 先做**最小可用版**——新增 `SessionEvent {type:'vip_confirm_pending', content}`，channel 收到后发送事件到 UI 并进入等待（带 60s 超时自动放弃发送）；UI 确认走新 IPC `engine:confirmVipReply(approve:boolean)`。

**注入 prompt 段**（`section.ts`，仅当当前 contact 是 VIP 且 F3 开时插入，见 §4.5）：

```text
## VIP 专属服务规范（当前客户是 VIP）
- 语气：热情、尊重、多用敬称（您/X总/X老师），体现专属感；不机械道歉，先共情再解决。
- 优先调用 VIP 专属知识（若有）；知识未覆盖时如实说明并承诺跟进，不搪塞。
- 主动服务：在合适时机询问是否需要额外帮助、告知专属权益（以知识库为准，不虚构）。
- 回复前请给出一句话的服务总结（summary），便于人工复核。
```

**改动文件清单**：
- 新增：`src/core/features/vip-service/{vip,section,index}.ts`
- 改：`session-types.ts`（SessionEvent 增 vip_confirm_pending；ProviderInput 增 vipSection？**否**——VIP 段并入 assembledPrompt，由 PromptAssembler 处理）、`generic-channel-session.ts`（vip_confirm_pending 分支）、`ai-client.ts`（无——复用现有 contact 识别）、`main/index.ts`（确认 IPC + config `f3.confirmBeforeReply`）、`features/hooks.ts`（afterProvider 确认拦截）
- 改 renderer：App.tsx（FeaturePanel F3 行 + VIP 确认弹窗）

**回滚影响面**：
- revert 后：VIP 段不注入、确认流程消失、会话恢复即时发送。残留：无新文件（逻辑都在 features 目录）。
- 风险点：`vip_confirm_pending` 是**阻塞性**事件——若实现有 bug 会卡住整个会话队列；因此确认超时必须实现（60s 自动跳过发送），QA 重点回归。

**验收标准**：
1. flag 关：VIP 客户与普通客户行为一致。
2. flag 开：a) VIP 客户（档案 category=VIP）→ 回复语气含敬称/先共情特征（人工抽查 5 条）；b) confirmBeforeReply=false 时 VIP 即时回复；c) confirmBeforeReply=true 时出现确认弹窗，点确认才发送、点拒绝不发送、不操作 60s 后自动放弃（不发送也不报错）；d) 普通客户永不触发确认流程。
3. VIP 服务日志（如有）记录正确。

---

### F4 多角色消息路由

**目标**：同一群/会话内多个服务角色（销售/售后/专家），AI 判断问题类型路由到对应 persona。**依赖 F1 群聊识别结果，但只通过 ProviderInput.groupChat 接口读取**。

**模块边界**（`src/core/features/role-routing/`）：

```
src/core/features/role-routing/
  route.ts        — RoleRouter：SmartReplyResult.routeTo → personaId 选择
  section.ts      — buildRoutingSection(availablePersonas) → 路由提示段
  index.ts        — FeatureModule（beforeProvider 注入路由段；afterProvider 应用 routeTo）
```

**关键设计**：
- **Persona 扩展**（`persona-store.ts` 追加可选字段，向后兼容）：
  ```ts
  export interface Persona {
    // ...现有字段
    /** F4：该角色负责的问题域关键词（用于提示词说明） */
    routingDomains?: string[]
    /** F4：是否参与路由（默认 true）；false 的角色不会被路由选中 */
    routable?: boolean
  }
  ```
- **路由执行**：模型在输出中给 `routeTo.personaId` → `afterProvider` 将本次回复的 system prompt 替换为目标 persona 的 prompt **重新调用一次 provider**（V2 采用"先路由后回答"两段式：第一段只输出 routeTo（不生成 reply 文本），第二段用目标 persona 正式生成回复）。为控制成本，**第一段路由判断**只发送**文字版消息摘要**（截图 OCR/或降采样文本；无 OCR 时直接复用同一次截图但要求只输出 routeTo）。**决策（V2.1 简化）**：第一段不做额外调用——把"你是哪个角色"交给最终生成，即模型在同一输出里给 routeTo + reply，若 routeTo 存在则**丢弃 reply 并按 routeTo 的 persona 重新生成**；否则直接采用。此方案只有 routeTo 时才多花一次调用。
- 角色消息互不回复：`messageKind='role_message'`（F1 输出）时，无论路由结果都 `reply:null`（群内角色间对话不掺和）。

**注入 prompt 段**（`section.ts`，F4 开且 F1 判定为群聊/多角色场景时插入）：

```text
## 多角色路由规则
本群由多个服务角色共同服务，当前可用角色：
- 销售顾问（personaId=...）：产品咨询、报价、下单
- 售后客服（personaId=...）：退换货、物流、售后问题
- 专家（personaId=...）：专业咨询类问题
规则：
1. 先判断本条消息属于哪个角色的问题域，在输出 JSON 中附加 routeTo：{"personaId":"...","reason":"...","confidence":0-1}
2. 只有 confidence>=0.6 才给 routeTo；模糊问题归当前默认角色（不输出 routeTo）
3. 角色间对话（member→member）输出 messageKind="role_message" 且 reply:null
4. routeTo 与 reply 可同时输出：reply 先按"通用客服"口吻写，路由成功后按目标角色重写
```

**改动文件清单**：
- 新增：`src/core/features/role-routing/{route,section,index}.ts`
- 改：`persona-store.ts`（routingDomains/routable 可选字段 + 默认值）、`ai-client.ts`（SmartReplyResult.routeTo）、`main/index.ts`（装配 + config `f4`）、`prompt/assembler.ts`（路由段）
- 改 renderer：App.tsx（FeaturePanel F4 行 + persona routable 开关）

**回滚影响面**：
- revert 后：routeTo 字段不消费、路由段不注入、persona 新字段残留但无害（可选字段）。
- 风险点：二次生成调用有额外 API 成本与延迟——QA 需确认 routeTo 场景出现时 UI 不超时、失败时回退第一段 reply（重试/降级必须实现：二次调用失败 → 采用第一次的 reply）。

**验收标准**：
1. flag 关：多角色群内消息走 F1 群聊逻辑（只回客户本人），无路由行为。
2. flag 开：a) 客户问"怎么退货" → routeTo=售后 persona，回复风格为售后；b) 客户问"多少钱" → routeTo=销售；c) 成员间对话 → 不回复；d) 二次调用失败 → 回退第一次 reply 且不报错。
3. persona 新字段缺省时（旧数据）行为与 V1 一致。

---

### F5 情绪/风险识别

**目标**：检测不满/退款意向/危机情绪 → 客户打标 + UI 通知（+ 可选升级 F2 人工接管）。

**模块边界**（`src/core/features/emotion-risk/`）：

```
src/core/features/emotion-risk/
  emotion.ts      — 情绪标签映射：sentiment/risk → tags/通知文案
  section.ts      — buildEmotionSection() → 提示词（要求输出 emotion 字段）
  index.ts        — FeatureModule（afterProvider 消费 emotion → 打标+通知+可选 handoff）
```

**关键设计**：
- **零额外调用**：emotion 字段由 getSmartReply **同一次调用**输出（模型看到截图即可判断情绪），F5 不新增 VLM 调用。
- **打标规则**（`emotion.ts`，映射表，纯函数可单测）：
  - `sentiment=negative|angry` → `addTags(['情绪负面'])`
  - `risk=refund_intent` → `addTags(['退款意向'])`
  - `risk=complaint` → `addTags(['投诉'])`
  - `risk=urgent` → `addTags(['紧急'])` + `ctx.notify(risk-alert)`（高优先级）
  - `sentiment=angry && confidence>=0.7` → `ctx.requestHandoff('risk_escalation')`（F2 开才生效）
- **通知**：`ctx.notify({type:'risk:alert', data:{contact, emotion}})` → 主窗口右上角红点/横幅。

**注入 prompt 段**（`section.ts`，F5 开时插入）：

```text
## 情绪识别规则
- 分析最后一条客户消息的情绪，在输出 JSON 中附加 emotion 字段：
  {"sentiment": "positive|neutral|negative|angry", "risk": "refund_intent|complaint|urgent|none", "confidence": 0-1}
- 没有明显情绪倾向时输出 {"sentiment":"neutral","risk":"none","confidence":0.5}
- 情绪识别不影响 reply 生成，两者独立判断。
```

**改动文件清单**：
- 新增：`src/core/features/emotion-risk/{emotion,section,index}.ts`
- 改：`ai-client.ts`（SmartReplyResult.emotion）、`main/index.ts`（装配）、`features/hooks.ts`
- 改 renderer：App.tsx（FeaturePanel F5 行 + risk:alert 横幅）

**回滚影响面**：
- revert 后：emotion 不解析、不打标、不通知、不升级 handoff。残留：客户档案中已打的标签（数据层面非破坏；QA 验收时可用测试客户验证）。
- 风险点：打标为写操作，`afterProvider` 必须 try/catch，打标失败不影响回复发送。

**验收标准**：
1. flag 关：负面消息不产生任何标签/通知。
2. flag 开：a) "你们太坑了我要退款" → 客户出现"退款意向"标签 + 通知；b) "再不解决我就投诉" → "投诉"标签；c) "我很生气" → "情绪负面"标签 + 触发 F2 接管（若 F2 开）；d) 正常聊天 → 无标签（neutral 不打标）。
3. 标签写库成功且 UI 客户列表可见。

---

### F6 服务日报

**目标**：汇总当日服务客户 / VIP 动态 / 待跟进 / 接管事件，生成 Markdown 日报，定时（默认 23:50）或手动生成。

**模块边界**（`src/core/features/daily-report/`）：

```
src/core/features/daily-report/
  report.ts       — DailyReportGenerator.generate(day) → markdown
  section.ts      — 日报模板（中文 Markdown）
  index.ts        — FeatureModule（onTimer('daily_report') 注册定时器；IPC report:generate 手动触发）
```

**数据来源**（只读，全部现有 store + F2/F7 新增 store）：
- `CustomerStore.listCustomers()` 过滤 `lastSeenAt ∈ [dayStart, dayEnd]` → 服务客户数/名单
- `customer.tags` 含 VIP / category=VIP → VIP 动态（今日新增/今日互动）
- F7 `FollowUpStore.list({status:'open', createdAt∈day})` → 今日新增待跟进
- F2 `HandoffStore.list({status:'open'})` → 待处理接管
- trace 会话数（`listTraceSessions(worktraceBaseDir())` 今日）→ 服务轮次

**输出**：`<userData>/worktrace/reports/YYYY-MM-DD.md`；生成后 `ctx.notify({type:'report:ready', data:{path, date}})` + 桌面通知；UI 提供"查看日报"（新 IPC `report:read {date}` 返回 markdown，主窗口弹预览或打开文件）。

**注入 prompt 段**：无（日报不注入对话 prompt；模板内置于 section.ts）。

**改动文件清单**：
- 新增：`src/core/features/daily-report/{report,section,index}.ts`
- 改：`main/index.ts`（定时器注册：仅 F6 flag 开时 `setInterval` 每日校准；IPC `report:generate` / `report:read`）
- 改 renderer：App.tsx（FeaturePanel F6 行 + "生成日报"按钮 + 日报预览）

**回滚影响面**：
- revert 后：定时器移除、IPC 消失；reports/*.md 残留（新增目录，无害）。
- 风险点：定时器生命周期——必须在 `stopEngineCore`/`before-quit` 清理，防止重复注册；QA 验证重启后定时器不叠加。

**验收标准**：
1. flag 关：无定时器（`setInterval` 未创建——可加 log 验证）、`report:*` IPC 返回不可用。
2. flag 开：a) 手动点"生成日报" → 产出当日 Markdown，含：服务客户数+名单、VIP 动态、待跟进、待处理接管、轮次数；b) 内容与当日实际数据一致（抽查 3 项）；c) 定时触发（可临时把时间改为 1 分钟后验证）自动生成 + 通知；d) 无数据当日也生成（各节显示 0/无）。
3. 重启应用定时器不重复、日报日期正确。

---

### F7 待跟进提醒

**目标**：AI 承诺"明天回复/稍后处理" → 生成待办（FollowUpItem）→ 到期提醒（通知 + 日报挂载）。

**模块边界**（`src/core/features/follow-up/`）：

```
src/core/features/follow-up/
  types.ts        — FollowUpItem
  store.ts        — FollowUpStore（worktrace/followups/followups.json）
  section.ts      — buildFollowUpSection() → 提示词（要求输出 followUp 字段）
  index.ts        — FeatureModule（afterProvider 消费 result.followUp；onTimer('follow_up') 到期扫描）
```

```ts
// types.ts
export interface FollowUpItem {
  followUpId: string
  contact: string | null
  action: string        // "明天上午回复退款进度"
  dueAt: number         // epoch ms
  status: 'open' | 'done' | 'cancelled'
  createdAt: number
  doneAt?: number
  source: 'ai' | 'manual'   // manual 支持 UI 手动添加
}
```

**关键设计**：
- **生成**：`result.followUp`（模型承诺）→ `store.add({ action, dueAt: followUp.dueAt ?? now+24h, contact: result.contact })`；去重：同 contact 同 action 且 status=open 不重复建。
- **到期提醒**：`onTimer('follow_up')` 每分钟扫描（flag 开才注册）：`dueAt<=now && status=open` → 桌面通知"待跟进：contact — action" + `ctx.notify({type:'followup:due'})`；不自动关闭（等人工处理，UI 可标记 done）。
- **IPC**：`followup:list / followup:add / followup:setStatus`（供日报窗口与主窗口管理）。
- 日报 F6 通过 `FollowUpStore.list()` 只读接口取数（F6 不依赖 F7 内部实现）。

**注入 prompt 段**（`section.ts`，F7 开时插入）：

```text
## 待跟进承诺规则
- 当你承诺了后续动作（如"明天给您答复""稍后确认后回复"），在输出 JSON 中附加 followUp 字段：
  {"action": "具体承诺内容（含时间点）", "dueAt": "ISO 时间，缺省表示 24 小时内"}
- 仅当确实需要后续动作时才输出；一般咨询不需要。
- 输出 followUp 后，reply 中要明确告知客户会在何时回复（让客户安心）。
```

**改动文件清单**：
- 新增：`src/core/features/follow-up/{types,store,section,index}.ts`
- 改：`ai-client.ts`（SmartReplyResult.followUp）、`main/index.ts`（装配 + 定时器 + IPC）、`features/hooks.ts`
- 改 renderer：App.tsx（FeaturePanel F7 行 + 待跟进列表（并入日报窗口或客户窗口 tab））

**回滚影响面**：
- revert 后：followUp 不解析、待办不生成、定时提醒消失；followups.json 残留无害。
- 风险点：定时器重复注册（同上，需在 before-quit 清理）。

**验收标准**：
1. flag 关：模型承诺"明天回复" → 无待办生成。
2. flag 开：a) 对话中承诺 → followups.json 出现 open 待办（action/dueAt/contact 正确）；b) 同一承诺不重复建；c) 到期（把 dueAt 改为过去时间测试）→ 桌面通知 + followup:due 事件；d) UI 标记 done 后不再提醒。
3. 日报（F6 开）当日待跟进节显示该待办。

---

### F8 多实例协同

**目标**：多开（--profile）已实现（数据隔离/窗口标识/端口错开），补齐配置与文档。

**模块边界**（`src/core/features/multi-instance/`）：以文档 + 配置说明为主，**几乎无运行时代码**。

```
src/core/features/multi-instance/
  README.md       — 多开使用说明（放入 docs/ 更合适：docs/multi-instance.md）
  index.ts        — 占位 FeatureModule（flagKey='f8.multi_instance'，无 hook；提供 isProfileMode() 帮助函数）
```

**补齐内容**：
1. `docs/multi-instance.md`：--profile=<name> 用法、数据隔离说明、端口错开规则（12680+hash%100）、注意（每实例独立微信实例）。
2. UI：主窗口标题已显示 profile（已有）；设置页基础配置显示当前 profile 名 + 提示"不同 profile 数据互不干扰"。
3. skill-server 已按 profile 偏移端口（已有）——仅补文档说明。
4. 提示词/日报等文件路径均基于 `app.getPath('userData')`，天然隔离（已验证代码），文档说明即可。

**改动文件清单**：
- 新增：`docs/multi-instance.md`、`src/core/features/multi-instance/index.ts`
- 改：App.tsx（基础配置页显示 profile 名 + 提示）
- 数据迁移逻辑（index.ts 顶部）已兼容多开（`!PROFILE` 时才迁移），无需改动。

**回滚影响面**：纯增量文件 + 一行 UI 提示；revert 无任何行为影响。

**验收标准**：
1. `richcat --profile=a` 与 `--profile=b` 同时运行：设置/客户/知识/日报互不影响（改 a 的设置 b 不变）。
2. 两个实例 skill 端口不同（文档描述与实际 log 一致）。
3. 文档步骤可照着跑通（QA 按文档起 2 个实例验证）。

---

### F9 知识库深度优化

**目标**：知识管理专业化——分类/权重/作用域（scope）/搜索注入策略（从"全量 30 条"升级为"按需注入"）。

**模块边界**（`src/core/features/knowledge-v2/`）：

```
src/core/features/knowledge-v2/
  types.ts        — KnowledgeItem V2 扩展字段
  injection.ts    — InjectionStrategy：按上下文挑选注入条目（替代全量注入）
  section.ts      — buildKnowledgeV2Section(items) → 注入段（更紧凑的格式）
  index.ts        — FeatureModule（beforeProvider 调用 injection 生成 knowledgeV2Section）
```

**KnowledgeItem 扩展**（`knowledge-store.ts` 追加可选字段，旧数据兼容）：

```ts
export interface KnowledgeItem {
  // ...现有字段
  /** F9：分类，如 "售前/售后/物流/产品" */
  category?: string
  /** F9：权重 0-100，影响注入排序（默认 50） */
  weight?: number
  /** F9：作用域：'all'（默认）| 'vip'（仅 VIP 注入）| 'group'（仅群聊注入） */
  scope?: 'all' | 'vip' | 'group'
}
```

**注入策略**（`injection.ts`，flag 开时替换 `getInjectionItems()` 的调用点）：
1. **上下文过滤**：按 scope 过滤（vip → 仅当前客户是 VIP 时注入；group → 仅群聊时注入）。
2. **优先级排序**：`weight` 降序；同权重新近优先。
3. **条数上限**：默认仍 30 条（`KNOWLEDGE_INJECTION_LIMIT` 不变），但按 weight 挑选而非纯时间。
4. **标题白名单检索**（可选增强，配置 `f9.useKeywordMatch`）：当前截图链路无消息原文，暂不启用关键词检索（保留接口，OCR 接入后启用）。
5. 向后兼容：所有方法保持旧签名可用；`getInjectionItems()` 行为不变（V2 新增 `getInjectionItemsV2(ctx)`），`index.ts` 在 flag 开时选用 V2。

**注入 prompt 段**（`section.ts`）：

```text
## 知识库（按优先级排列，回答以此为准；知识库未覆盖时如实说明）
[1.8 优先级]【分类：售后】退货流程：7 天内无理由退货……
[1.5 优先级]【分类：物流】运费政策：满 99 元包邮……
（条目带优先级系数与分类，模型按权重参考）
```

**改动文件清单**：
- 新增：`src/core/features/knowledge-v2/{types,injection,section,index}.ts`
- 改：`knowledge-store.ts`（可选字段 + getInjectionItemsV2 + UI 排序）、`main/index.ts`（装配，flag 开时替换注入源）、`prompt/assembler.ts`（知识段由 V2 提供）
- 改 renderer：KnowledgeWindow.tsx（分类/权重/作用域编辑 UI）、App.tsx（FeaturePanel F9 行）

**回滚影响面**：
- revert 后：注入回到全量 30 条（时间序）；知识条目新字段残留无害（可选字段不参与逻辑）。
- 风险点：`getInjectionItemsV2` 与旧方法并存，装配点用 flag 分支——revert 只需删分支与新增文件。

**验收标准**：
1. flag 关：注入与 V1 完全一致（30 条、时间序、无 scope 过滤）。
2. flag 开：a) 设置某条目 weight=100、scope=vip，普通客户会话该条不注入，VIP 会话注入且排最前；b) scope=group 条目仅群聊注入；c) 旧数据（无新字段）行为等于默认值（weight=50/scope=all），不报错。
3. UI 可编辑分类/权重/作用域并持久化。

---

### F10 提示词体系

**目标**：集中管理客服提示词——专业感+人感+情绪价值规范、群聊/VIP 规范、各功能注入段；统一拼接顺序。**详见 §4**，此处给模块边界与验收。

**模块边界**（`src/core/prompt/`）：

```
src/core/prompt/
  index.ts        — 统一导出 + PromptAssembler
  assembler.ts    — assembleSystemPrompt(opts) → string（拼接顺序见 §4.5）
  base.ts         — BASE_SYSTEM_PROMPT（专业+人感+情绪价值基础模板，替代 REPLY_SYSTEM_PROMPT）
  emotion-value.ts— 情绪价值规范（原文草案见 §4.3）
  sections/
    group-chat.ts     — 群聊规范段（F1）
    handoff.ts        — 转人工规则段（F2）
    vip.ts            — VIP 服务规范段（F3）
    routing.ts        — 多角色路由段（F4）
    emotion.ts        — 情绪识别段（F5）
    knowledge.ts      — 知识库段（知识/知识V2 共用格式）
    customer.ts       — 客户记忆段（复用 CustomerStore.buildMemorySection 的格式规范）
    memory.ts         — 经验卡片段（复用 buildMemorySection）
    image.ts          — 图片上下文段
    output-format.ts  — JSON 输出格式要求（contact/reply/summary + V2 可选字段）
```

**关键设计**：
- `assembleSystemPrompt(opts)` 接收 `{ persona?, knowledgeSection?, customerSection?, memorySection?, imageContext?, groupChat?, flags, isVip }`，内部按 §4.5 顺序拼接，**每个注入段由对应 flag 控制是否包含**；flag 全关时输出仅基础模板 + 输出格式（等价旧 prompt）。
- LocalProvider 改为：优先使用 `input.assembledPrompt`（RuntimeHost 已注入）；未提供时走旧拼装（`getPersonaPrompt` + `buildKnowledgeSection` + `buildMemorySection`）——**向后兼容**。
- 删除/保留旧常量：`REPLY_SYSTEM_PROMPT`、`BASE_REPLY_RULES` 保留为"legacy"别名（不再被新链路引用），`persona-store.ts` 内置角色 prompt 里的 `${BASE_REPLY_RULES}` 替换为 `assembleSystemPrompt` 的基础段引用（注意内置角色文本是数据不是代码——**设计决策**：内置角色 systemPrompt 文本不动，V2 在组装时把角色文本作为"角色段"插入基础模板之上，避免改内置角色数据）。

**改动文件清单**：
- 新增：`src/core/prompt/*`（上述 12 文件）
- 改：`local-provider.ts`（优先 assembledPrompt）、`runtime-host.ts`（调用 PromptAssembler 生成 assembledPrompt）、`ai-client.ts`（引用 prompt 段常量改从 prompt/index 导入）、`main/index.ts`（装配）
- 改 renderer：无（提示词不进 UI 编辑，仍走角色自定义）

**回滚影响面**：
- revert 后：LocalProvider 回到 `getPersonaPrompt()+buildKnowledgeSection()` 旧拼装；prompt 目录文件残留但不再被引用。
- 风险点：基础模板变化会**全局影响所有回复风格**——QA 需对默认人设+5 内置角色各回归一轮对话，确认无 [SKIP] 误判、无自循环、回复质量不劣化。

**验收标准**：
1. flag 开：默认人设回复体现情绪价值规范（先共情/口语化/不机械道歉——人工抽查 10 条对话）；5 个内置角色各自的附加规则仍生效。
2. flag 关：输出与 V1 完全一致（可用 V1 版本对比 5 条相同输入）。
3. 所有注入段顺序正确（见 §4.5），无重复/冲突段。
4. 群聊/VIP/路由等段仅在对应 flag+场景下出现（配合各功能验收）。

---

## 4. 提示词体系总设计

### 4.1 设计目标

三层标准：**专业感**（答得准、不编造、有边界）+ **人感**（自然口语、有记忆、不机械）+ **情绪价值**（先共情再解决、让客户感到被重视）。所有注入段统一由 `src/core/prompt/` 管理，禁止在业务代码里散写 prompt 文本。

### 4.2 基础模板（`base.ts`，替代 `REPLY_SYSTEM_PROMPT`）

```text
你是「财听猫」智能客服，正在微信/企业微信中为客户服务。

## 你的任务
分析聊天截图，识别最新客户消息并给出合适的回复。

## 回复原则（专业感 + 人感 + 情绪价值）
1. 专业：回答准确、有依据，以知识库为准；不确定时如实说明，不编造。
2. 人感：像真人一样自然口语化，不机械、不堆术语；有上下文记忆时自然衔接，不重复客户说过的话。
3. 情绪价值：先共情、再解决——先回应客户的情绪和处境，再给方案；让客户感到被认真对待。
4. 简洁：一次回复说清楚一件事，不啰嗦、不刷屏。
5. 安全边界：涉及诊断/处方/法律/投资等专业决策时明确提示以专业人士意见为准；危机信号（自伤等）立即建议求助热线或就医。

## 防自我循环
- 观察截图：右侧气泡是自己发送的。若最后一条消息是自己发送的 → reply 为 null。
- 最新消息是系统消息/群公告/红包/转账等非对话消息 → reply 为 null。
- 无法判断是否需要回复 → reply 为 null。
```

### 4.3 情绪价值规范（`emotion-value.ts`，原文草案）

```text
## 情绪价值规范（重要）
面对任何客户消息，按以下规范组织回复：

1. **先共情，再解决**：回复的第一句先回应客户的感受或处境（"理解您的心情""确实让您久等了"），
   然后再进入解决方案。情绪激烈时，先安抚情绪，再谈事情。
2. **不机械道歉**：道歉要具体（"很抱歉让您多跑了一趟"），不要空洞的"给您带来不便敬请谅解"；
   不是自己的过错时不揽责，但保持诚恳。
3. **让人感到被重视**：称呼客户（姓名/尊称），提及他刚才说过的细节（"您刚才提到的地址问题"），
   体现"我在认真听"。
4. **给确定性与安全感**：能承诺时间就说具体时间（"今天 18 点前给您答复"），做不到就说明原因并给替代方案。
5. **不敷衍、不甩锅**：不复制粘贴式回复；问题暂时无解时，说明正在做什么、何时有进展。
6. **克制热情**：情绪价值不等于浮夸——用真诚、得体的表达，不用感叹号堆砌、不过度承诺。
7. **VIP 客户**（客户档案为 VIP）：在上述基础上更主动——主动询问是否需要额外帮助、体现专属服务感。
```

### 4.4 各注入段清单与用途

| 段 id | 来源模块 | 触发条件 | 用途 |
|---|---|---|---|
| `base` | prompt/base.ts | 总是 | 角色/回复原则/防自循环 |
| `persona` | persona-store（角色文本） | activePersona 存在 | 角色附加规则（医学/管家/销售…） |
| `emotion-value` | prompt/emotion-value.ts | f10 开 | 情绪价值规范（专业+人感核心） |
| `group-chat` | features/group-chat | f1 开 && 群聊 | 群聊回复边界（见 §3-F1） |
| `vip` | features/vip-service | f3 开 && 客户是 VIP | VIP 语气与专属服务（见 §3-F3） |
| `routing` | features/role-routing | f4 开 && 多角色场景 | 角色路由规则（见 §3-F4） |
| `handoff` | features/human-handoff | f2 开 | 转人工识别规则（见 §3-F2） |
| `emotion` | features/emotion-risk | f5 开 | 情绪字段输出规则（见 §3-F5） |
| `follow-up` | features/follow-up | f7 开 | 待跟进字段输出规则（见 §3-F7） |
| `knowledge` | knowledge(-v2) | 有知识条目 | 知识注入段 |
| `customer` | customer-store | 客户有记忆 | 客户历史记忆段 |
| `memory` | experience-store | 有经验卡片 | 团队经验段 |
| `image` | local-provider | 有图片上下文 | 对方发来图片的内容描述 |
| `output-format` | prompt/sections/output-format.ts | 总是 | JSON 输出格式（含 V2 可选字段） |

### 4.5 拼接顺序（PromptAssembler 固定顺序）

```
1  base（基础模板）
2  persona（角色附加规则，若有）
3  emotion-value（情绪价值规范）
4  group-chat（F1，仅群聊）
5  vip（F3，仅 VIP）
6  routing（F4，仅多角色）
7  handoff（F2）
8  emotion（F5）
9  follow-up（F7）
10 knowledge（知识库段）
11 customer（客户记忆段）
12 memory（经验卡片段）
13 image（图片上下文段）
14 output-format（输出格式要求）
```

**顺序原则**：身份与边界（1-6）在前，功能识别规则（7-9）居中，事实材料（10-13）在后，格式要求（14）收尾——让模型先确立身份与边界，再读功能指令，最后参考材料输出。

### 4.6 PromptAssembler 接口

```ts
// src/core/prompt/assembler.ts
export interface AssembleOptions {
  personaPrompt?: string | null          // 角色文本（若有）
  knowledgeSection?: string              // 知识段（F9 开时由 V2 提供）
  customerSection?: string               // 客户记忆段
  memorySection?: string                 // 经验卡片段
  imageContext?: string                  // 图片上下文
  groupChat?: GroupChatContext           // F1 输出
  isVip?: boolean                        // F3 判定结果
  multiRole?: boolean                    // F4 场景判定（群聊且有 routable 角色）
  flags: FeatureFlags
}
export function assembleSystemPrompt(opts: AssembleOptions): string
```

RuntimeHost 在 `runProviderWithMemory` 中调用它生成 `assembledPrompt` 注入 `ProviderInput`；LocalProvider 优先采用（向后兼容回退见 §3-F10）。

---

## 5. 实施顺序建议

### 阶段划分（依赖驱动）

```
阶段 0（地基，所有功能前置）            ← 可并行：T0 已完成
  ├─ C0  Feature Flags 框架（flags.ts + IPC + FeaturePanel UI 骨架 + normalizeSettings 扩展）
  ├─ C1  Prompt 体系骨架（prompt/ 目录 + assembler + base/emotion-value/output-format + LocalProvider 接入）
  └─ C2  SmartReplyResult/ProviderInput 扩展字段类型 + parseSmartReply 容错扩展（只加类型与解析，不消费）
      （C0/C1/C2 相互独立，可三个工程师并行）

阶段 1（无依赖的功能）                  ← 可并行
  ├─ F1  群聊支持（依赖 C2 的 messageKind）
  ├─ F5  情绪/风险识别（依赖 C2 的 emotion）
  ├─ F8  多实例文档（独立）
  └─ F9  知识库 V2（独立，改 knowledge-store + injection）

阶段 2（中等依赖）                      ← 依赖阶段 1
  ├─ F3  VIP 差异化（依赖 C1 的 vip 段槽位；逻辑独立）
  ├─ F7  待跟进（依赖 C2 的 followUp 字段）
  └─ F4  多角色路由（依赖 F1 的 groupChat 接口）

阶段 3（收敛功能，依赖阶段 2）          ← 依赖前面全部
  ├─ F2  人工接管（依赖 F5 升级通道 + sessionMeta 轮次计数）
  ├─ F6  服务日报（依赖 F2 的 HandoffStore + F7 的 FollowUpStore）
  └─ 收尾：F10 全量提示词联调（各功能注入段就位后统一 QA 提示词质量）

阶段 4（QA 与发布）
  └─ 全量 QA：按 §3 每功能验收标准逐条执行；feature flags 组合矩阵
     （单功能开关 × 关键两两组合：F1+F4、F5+F2、F3+F9、F6+F7）回归；
     冲突排查重点：generic-channel-session.ts 新增事件分支、assembler 拼接顺序。
```

### 提交纪律（可回滚保障）

- **每个功能一个 commit**：`feat(f1): 群聊支持`、`feat(f5): 情绪识别`…`git revert <commit>` 即完整移除该功能。
- **公共扩展独立 commit**：C2（类型与解析扩展）单独 commit，**不要**混入任何功能消费逻辑——这样 revert 单个功能不会把公共字段一起删掉；若 revert C2 本身，各功能因字段可选而自动退化为 V1 行为（编译通过）。
- **改动文件冲突预防**：
  - `session-types.ts` / `ai-client.ts`：每个功能字段用 `// ── Fx ──` 注释块隔开，避免 revert 时误删他功能字段。
  - `generic-channel-session.ts`：新增事件分支独立 case，不修改现有分支。
  - `main/index.ts`：装配代码集中在 `registerFeatures()` 函数内（新函数），不散落各处。
- **每个 commit 过 typecheck**：`npm run typecheck` 绿后再提交。

### 风险清单（QA 与工程师注意）

| 风险 | 缓解 |
|---|---|
| prompt 拼接顺序错误导致模型困惑 | assembler 单测：断言各段出现/顺序/flag 控制 |
| 阻塞事件（vip_confirm_pending/handoff_pause）卡死会话队列 | 必须带超时/降级；QA 专项回归 |
| 定时器重复注册（F6/F7） | 统一 TimerRegistry，before-quit 清理；QA 重启验证 |
| 二次生成成本（F4 routeTo） | 失败回退第一次 reply；默认 routeTo 后才多一次调用 |
| 多功能同时改 session-types/ai-client | 注释块隔离 + 每功能独立 commit + typecheck 门槛 |
| 新字段解析破坏旧模型输出 | parseSmartReply 字段级容错（独立 try/catch），单测覆盖旧格式 |

---

## 6. 附录：改动文件索引

### 新增文件

```
src/core/features/flags.ts                    — FeatureFlags（阶段 0）
src/core/features/hooks.ts                    — FeatureModule/ProviderHookContext/FeatureRegistry（阶段 0）
src/core/features/group-chat/{types,detect,section,index}.ts      — F1
src/core/features/human-handoff/{types,store,section,index}.ts    — F2
src/core/features/vip-service/{vip,section,index}.ts              — F3
src/core/features/role-routing/{route,section,index}.ts           — F4
src/core/features/emotion-risk/{emotion,section,index}.ts         — F5
src/core/features/daily-report/{report,section,index}.ts          — F6
src/core/features/follow-up/{types,store,section,index}.ts        — F7
src/core/features/multi-instance/index.ts                         — F8
src/core/features/knowledge-v2/{types,injection,section,index}.ts — F9
src/core/prompt/{index,assembler,base,emotion-value}.ts           — F10
src/core/prompt/sections/{group-chat,handoff,vip,routing,emotion,
  knowledge,customer,memory,image,output-format}.ts               — F10
docs/multi-instance.md                                            — F8
docs/richcat-v2-design.md                                         — 本文档
```

### 修改文件（按功能标注行）

| 文件 | 改动 |
|---|---|
| `src/main/index.ts` | settings.features 归一化；features:* IPC；registerFeatures()；Notification；F6/F7 定时器；F2 接管 IPC；F3 确认 IPC |
| `src/core/session-types.ts` | ProviderInput.groupChat/sessionMeta/assembledPrompt（可选）；SessionEvent 增 handoff_pause/vip_confirm_pending |
| `src/core/ai-client.ts` | SmartReplyResult 扩展字段；parseSmartReply 字段级容错；prompt 常量改引 prompt/ |
| `src/core/local-provider.ts` | 优先使用 input.assembledPrompt |
| `src/core/runtime-host.ts` | runProviderWithMemory 调 PromptAssembler；sessionMeta 计数；feature hooks 调用 |
| `src/core/generic-channel-session.ts` | handoff_pause / vip_confirm_pending 新 case（独立分支） |
| `src/core/persona/persona-store.ts` | routingDomains/routable 可选字段（F4） |
| `src/core/knowledge/knowledge-store.ts` | category/weight/scope 可选字段 + getInjectionItemsV2（F9） |
| `src/core/customers/customer-store.ts` | 无结构改动（F3 复用 tags/category）；可选 addTags 便捷方法 |
| `src/renderer/src/App.tsx` | SettingsSection 增 'features' + FeaturePanel；F2/F5 通知横幅；F3 确认弹窗；F6 日报入口 |
| `src/renderer/src/KnowledgeWindow.tsx` | 分类/权重/作用域编辑（F9） |

---

*文档结束。工程师按 §5 阶段顺序实施；每个功能完成即按 §3 验收标准自测，再由 QA 复核；全量回归前先过 `npm run typecheck` 与 `npm run lint`。*
