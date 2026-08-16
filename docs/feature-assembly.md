# RichCat V2 功能装配说明（install-features）

> 装配集成 commit 的接线清单：所有 V2 功能如何注册、按 flag 驱动、注入 prompt。
> 设计依据：docs/richcat-v2-design.md §1.2 / §3.0 / §4.6 / §5。

## 1. 统一注册骨架

- **`src/core/features/hooks.ts`**（装配集成新增）：
  - `FeatureModule`：统一模块形状 `{ flagKey, beforeProvider?, afterProvider?, afterReply?, onTimer? }`（与文档 §3.0 对齐）。
  - `FeatureHookContext`：统一钩子上下文（input / result / flags / stores / 输出槽 vipSection·routingSection·isVip·multiRole·vipItems / 注入能力 notify·requestHandoff·regenerate）。
  - `FeatureRegistry`：按 flag 过滤 `enabled()`，`runBeforeProvider / runAfterProvider / runAfterReply / runOnTimer` 逐模块调用、各自 try/catch（§2.3-4 不阻塞主链路）。

## 2. 装配入口（src/main/index.ts）

- `installFeatures()`：在 `app.whenReady` 内、`installDailyReport / installFollowUp / installHumanHandoff` 之后调用（依赖各 install* 提供的 stores/服务句柄）。
- `featureRegistry` 单例（`getFeatureRegistry()` 懒建，注入全局 `featureFlags`）。
- 运行时两条驱动链：
  - **beforeProvider**：`RuntimeHost` 每轮调 `buildAssembledPromptFor(enriched)` → 先 `registry.runBeforeProvider(ctx)`（F3/F4/F9 填充段与场景判定），再 `assembleSystemPrompt({...})` 拼 14 段 → 注入 `input.assembledPrompt`（f10 关 → 返回 undefined，LocalProvider 走旧拼装）。
  - **afterProvider/afterReply**：`LocalProvider.transformResult`（已支持 async）调 `transformProviderResult(result, input)` → `registry.runAfterProvider(ctx)`（F5/F2/F7 消费 + F4 二次生成写回 `ctx.result`）→ 链尾 `filterF1GroupChatResult`（F1 后置过滤，需返回新 result，故保留在链尾）。

## 3. 每个 feature 的接线位置

| Feature | flagKey | 钩子 | 接线位置（main/index.ts installFeatures） | prompt 段槽位（assembleSystemPrompt） |
|---|---|---|---|---|
| F1 群聊 | f1.group_chat | 检测（runtime-host getGroupChatContext）+ 后置过滤（transformResult 链尾） | `getGroupChatContextForSession`（engine 装配）+ `filterF1GroupChatResult` | groupChatSection（仅群聊） |
| F2 人工接管 | f2.human_handoff | afterProvider | 适配器调 `captureHandoffResult(ctx.result, buildHandoffContext(), flags)` | handoffSection |
| F3 VIP | f3.vip_service | beforeProvider + afterReply | 适配器经 `VipHookContext` 调 `handleVipBeforeProvider`（输出槽回写 ctx.isVip/vipSection/vipItems）；`handleVipAfterReply` 独立重判 VIP | vipSection + isVip |
| F4 角色路由 | f4.role_routing | beforeProvider + afterProvider(async) | before：经 `RoleRoutingHookContext` 调 `createRoleRoutingFeature().beforeProvider`（回写 multiRole/routingSection）；after：`applyRoleRouting(ctx.result, { stores, input, regenerate, flags })` 写回 ctx.result | routingSection + multiRole |
| F5 情绪/风险 | f5.emotion_risk | afterProvider | 适配器调 `handleEmotionResult({ result, stores.customer, notify, requestHandoff })` | emotionSection |
| F6 服务日报 | f6.daily_report | onTimer（统一入口）+ 独立定时器 | `installDailyReport`（whenReady）返回句柄存 `dailyReportHandle`；registry onTimer 委托 `dailyReportHandle.generateNow`；IPC `report:generate/report:read`（flag 门控）；F7/F2 数据源注入 `listFollowUps/listHandoffs` | 无（日报不注入对话 prompt） |
| F7 待跟进 | f7.follow_up | afterProvider + 独立定时器 | 适配器调 `handleFollowUpResult(ctx.result, getFollowUpStore())`；`installFollowUp` 管 IPC 与到期扫描 | followUpSection |
| F8 多实例 | f8.multi_instance | 无（占位） | 不注册钩子；`profileTag` 供 F6/F7 通知标题 | 无 |
| F9 知识 V2 | f9.knowledge_v2 | beforeProvider | 适配器调 `createKnowledgeV2Feature().beforeProvider({ input, stores.knowledge, flags, injection })`（改写 input.knowledgeSection） | knowledgeSection（数据驱动） |
| F10 提示词 | f10.prompt_system | —（assembler 整体开关） | `buildAssembledPromptFor` 首行判 f10 关 → undefined（旧拼装） | 全部 14 段 |

## 4. 关闭零影响保证

- **不注册不调用**：registry 按 flag 过滤；flag 关的模块不进入任何 run*（抽查脚本验证：全关 → 零调用）。
- **不注入段**：assembler 段 4-9 由 flag+场景双条件控制（C1 实现，c1-prompt-smoke 验证）。
- **无额外调用**：F1 检测在 `getGroupChatContextForSession` 判 flag；F4 二次生成仅 routeTo 且 confidence≥0.6 时；F5/F2/F7 消费同一次 getSmartReply 结果，零新增调用。
- **不阻塞主链路**：registry 每个钩子独立 try/catch；`buildAssembledPromptFor` 失败返回 undefined（旧拼装兜底）；`transformProviderResult` 失败由 LocalProvider.applyTransformResult 吞掉。
- **定时器防重复**：F6/F7 各自单句柄、start 前 stop、before-quit 清理（install* 内部实现）。

## 5. 验证记录

- `npm run typecheck`（node+web）全绿。
- `npm run lint`：errors 124 = 基线（HEAD 同数），零新增。
- `npm run build`：通过（main/preload/renderer 产物完整）。
- 冒烟：`scripts/c1-prompt-smoke.ts`、`scripts/f4-routing-smoke.ts`、`scripts/f9-f10-smoke.ts` 全部通过。
- flag 关闭零影响抽查（FeatureRegistry 行为）：全关零调用 / 只开 f5 只调 f5 / 抛错吞掉继续 / 输出槽回写，全部通过。
