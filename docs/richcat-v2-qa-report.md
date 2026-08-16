# RichCat V2 全量 QA 验收报告

> 版本：1.0（最终验收）
> 验收对象：commit `2475704`（HEAD，V2 功能全部装配完成）+ docs/richcat-v2-design.md §3 验收标准
> 验收人：qa（测试与验收工程师）｜日期：2026-08-16
> 范围：① 全量回归 ② 冒烟回归 ③ F1–F10 逐项验收 ④ flag 关闭零影响 ⑤ 联动测试 ⑥ 可回滚演练

---

## 0. 结论摘要

| 项 | 结论 | 说明 |
|---|---|---|
| ① 全量回归 | ✅ 通过 | typecheck（node+web）全绿；lint 124 errors = 基线零新增；build 成功 |
| ② 冒烟回归 | ✅ 通过 | c1（22 项）/ f4（35 项）/ f9-f10（32 项）全部 PASS，exit 0 |
| ③ 功能验收 F1–F10 | ✅ 通过（1 项 N/A） | F3 的 confirmBeforeReply 按设计为后续增量未实现，验收 2c 标 N/A |
| ④ flag 关闭零影响 | ✅ 通过 | 全关零调用/零注入/零定时器/零额外调用；单开单生效；抛错不阻塞（18/18 断言） |
| ⑤ 联动测试 | ✅ 通过 | F5→F2 升级链、F2 多轮接管、F6 含 F2/F7 数据、F1+F4 组合（21/21 断言） |
| ⑥ 可回滚演练 | ✅ 通过（2 项文档修正） | 逆序整体回滚 14 commits 全部干净；单功能 revert 有装配耦合（详见 §6）；F9/F10 合并 commit |
| 缺陷清单 | 2 项低危 + 2 项文档修正 | 见 §7，均不阻塞发布 |

**总体判定：V2 功能全部验收通过，达到可发布状态。** 缺陷均为低危/文档级，不影响主链路与既有 V1 行为。

---

## 1. ① 全量回归

| 检查 | 命令 | 结果 | 证据 |
|---|---|---|---|
| 类型检查 node | `npm run typecheck:node`（tsc --noEmit, tsconfig.node.json） | ✅ PASS | `.qa-typecheck.log`：node 通过，exit 0 |
| 类型检查 web | `npm run typecheck:web` | ✅ PASS | 同上 |
| Lint | `npm run lint`（eslint --cache .） | ✅ PASS（≤基线） | `✖ 10793 problems (124 errors, 10669 warnings)`；与装配文档记录的基线（errors 124 = HEAD 同数）一致，**零新增** |
| 构建 | `npm run build`（typecheck + electron-vite build） | ✅ PASS | main 197.36 kB / preload / renderer 产物完整，exit 0；仅有 vision-utils.ts 动态导入 chunk 提示（非错误） |

注：lint 的 124 errors 为仓库既有基线（主要来自存量代码风格，非 V2 引入），V2 全量提交后数量未增加。

## 2. ② 冒烟回归

运行方式：`npx ts-node --transpile-only scripts/<脚本>.ts`（TS_NODE_COMPILER_OPTIONS 需含 `"target":"esnext"`，原因见 §7-D4）。

| 脚本 | 断言数 | 结果 | 覆盖 |
|---|---|---|---|
| `scripts/c1-prompt-smoke.ts` | 22 PASS | ✅ exit 0 | 14 段拼接顺序、flag 双条件注入、f10 关退化 V1、无重复/空段 |
| `scripts/f4-routing-smoke.ts` | 35 PASS | ✅ exit 0 | RoleRouter 校验、场景判定、二次生成/回退、role_message 不掺和、assembler 槽位 |
| `scripts/f9-f10-smoke.ts` | 32 PASS | ✅ exit 0 | F9 scope/weight/旧数据/关键词/V1 不变；F10 VIP 段条件、情绪价值 8 条、顺序 |

## 3. ③ F1–F10 逐项验收（docs §3）

> 判定符号：✅ 通过 ｜ ⚠️ 通过但有实现偏差/文档修正 ｜ N/A 不适用（按设计未实现）

### F1 群聊支持（97f6032）✅
| 验收标准 | 结果 | 证据 |
|---|---|---|
| 1. flag 关：不注入群聊段、无 GROUP_CHAT_PROMPT 调用 | ✅ | 代码审查：`getGroupChatContextForSession` 首行判 flag 返回 undefined（main/index.ts:272-277）；assembler 双条件；qa-flag-impact 全关零调用 |
| 2a. 其他成员发消息 → 不回复 | ✅ | `applyGroupChatReplyFilter`：messageKind=group_member → reply=null（qa-integration C 组 PASS） |
| 2b. 客户本人消息 → 回复 | ✅ | 客户本人消息原样回复（qa-integration C 组 PASS） |
| 2c. @ 机器人 → 回复 | ✅ | 提示词层（buildGroupChatSection）+ 检测层 isMentioned 字段；无过滤拦截 |
| 2d. 群公告/红包 → 不回复 | ✅ | `applyNonConversationFilter` 确定性兜底 announcement/red_packet/system → reply=null（qa-integration PASS） |
| 3. 单聊与 V1 一致 | ✅ | groupChat undefined → filterResult 原样返回（qa-integration PASS） |
| 4. 后置过滤兜底（模型误判） | ✅ | 构造 messageKind=group_member + reply 非空 → 强制 null（qa-integration PASS） |

### F2 人工接管/升级（87a4786）✅（实现偏差已文档化）
| 验收标准 | 结果 | 证据 |
|---|---|---|
| 1. flag 关：仍走自动回复 | ✅ | `captureHandoffResult` 首行判 flag 返回；qa-integration B 组 PASS |
| 2a. 转人工 → 停会话+通知+打标 | ✅ | `openHandoff`：store.add + pausedContacts + handoff:new + 桌面通知 + 客户打标「需人工」（qa-integration A 组 PASS） |
| 2b. 投诉话术 → reason=complaint | ✅ | 同链路 reason=complaint 入 store |
| 2c. 连续 3 轮无解决 → 多轮接管 | ✅ | 第 3 轮空 reply 触发 multiple_unresolved；有 reply 清零后重新计数（qa-integration B 组 PASS） |
| 2d. 其他客户会话不受影响 | ✅ | 暂停按 contact 粒度（pausedContacts Set + LocalProvider.shouldSkipContact 仅命中该 contact） |
| 3. 通知可展示 | ✅ | installHumanHandoff 走 Notification API（flag 开时） |
| 4. handoffs.json 记录正确 | ✅ | HandoffStore.add 落盘 reason/confidence/status=open（qa-integration 断言 PASS） |
| 实现偏差 | ⚠️ | 设计为 SessionEvent `handoff_pause`，实现采用 `shouldSkipContact` 会话级跳过（human-handoff/index.ts:12-13 已注释说明），可观察行为等价、侵入面更小——**已文档化，验收通过** |

### F3 VIP 差异化服务（559eaed）✅（1 项 N/A）
| 验收标准 | 结果 | 证据 |
|---|---|---|
| 1. flag 关：与普通客户一致 | ✅ | registry 按 flag 装配；f3 关不注入段不判定 |
| 2a. VIP 客户语气含敬称/先共情 | ✅ | vipSection（prompt/sections/vip.ts 尊称体系）仅 f3 开 && isVip 注入（f9-f10-smoke PASS） |
| 2b. confirmBeforeReply=false 即时回复 | ✅ | 默认路径即时发送（确认流程未启用） |
| 2c. confirmBeforeReply=true 确认弹窗 | **N/A** | 设计文档 §3-F3 明确"V2 先做最小可用版"；实现预留配置位 `f3Confirm()` 恒 false（main/index.ts:458-460 注释），确认流程为后续增量，**未实现不验收** |
| 2d. 普通客户不触发确认 | ✅ | 确认流程整体未启用，无触发路径 |
| 3. VIP 服务日志 | ✅ | handleVipAfterReply 仅 isVip 时记录（index.ts:101-110） |

### F4 多角色消息路由（ac61a04）✅
| 验收标准 | 结果 | 证据 |
|---|---|---|
| 1. flag 关：只走 F1 群聊逻辑 | ✅ | applyRoleRouting 首行判 flag 原样返回（f4-routing-smoke PASS）；assembler 不注入路由段 |
| 2a. "怎么退货" → 售后 persona | ✅ | routeTo→RoleRouter.resolve 校验 → 目标 persona 二次生成（f4-routing-smoke 路由链路 PASS） |
| 2b. "多少钱" → 销售 | ✅ | 同上（routingDomains 驱动提示词） |
| 2c. 成员间对话不回复 | ✅ | role_message 不二次生成 + F1 后置 reply=null 双保险（f4-routing-smoke + qa-integration PASS） |
| 2d. 二次调用失败 → 回退第一段不报错 | ✅ | regenerate 返回 null / 抛错均回退第一段 reply（f4-routing-smoke PASS） |
| 3. persona 旧数据缺省行为 | ✅ | routable 缺省=可路由（f4-routing-smoke PASS）；routingDomains 缺省不影响 |

### F5 情绪/风险识别（114404f）✅
| 验收标准 | 结果 | 证据 |
|---|---|---|
| 1. flag 关：无标签/通知 | ✅ | registry 按 flag 装配；qa-integration B 组（f2 关零消费）同理；全关零调用 |
| 2a. 退款意向 → 标签+通知 | ✅ | decideEmotionActions risk=refund_intent → 「退款意向」（emotion.ts 纯函数 + f9-f10-smoke 同族断言） |
| 2b. 投诉 → 「投诉」标签 | ✅ | qa-integration A 组：risk=complaint → tags 含「投诉」PASS |
| 2c. 愤怒 → 「情绪负面」+F2 接管 | ✅ | qa-integration A 组：angry+0.8 → requestHandoff('risk_escalation') + 打标 PASS |
| 2d. 正常聊天不打标 | ✅ | neutral/positive/risk=none → tags=[] 不打标不通知（emotion.ts 逻辑） |
| 3. 标签写库 UI 可见 | ✅ | addTags 落库（qa-integration 断言客户 tags 含「情绪负面」「投诉」PASS）；CustomerWindow 已有标签展示 |

### F6 服务日报（b459f8d + dfd7a07）✅
| 验收标准 | 结果 | 证据 |
|---|---|---|
| 1. flag 关：无定时器、report:* 不可用 | ✅ | DailyReportScheduler.start() 判 flag 不挂定时器（qa-flag-impact 断言 setInterval 0 次 PASS）；IPC 返回 f6_disabled |
| 2a. 手动生成含全部节 | ✅ | qa-flag-impact §7：Markdown 含服务客户/VIP/待跟进/接管/轮次，exit 0 |
| 2b. 内容与当日数据一致 | ✅ | 服务客户=2、VIP=王总、待跟进=张先生、接管=李女士、轮次=1（qa-flag-impact 断言 PASS） |
| 2c. 定时触发自动生成+通知 | ✅ | scheduleNext 每日校准 + 触发时再校验 flag；定时器单句柄防重复（qa-flag-impact 断言二次 start 不叠加 PASS） |
| 2d. 无数据当日正常生成 | ✅ | 各数据源缺省 → 空数组 → 节显示 0/无（report.ts 全部 try/catch 降级） |
| 3. 重启定时器不重复、日期正确 | ✅ | before-quit 清理 + start 前 stop + unref；日期按本地时区 formatDayKey |

### F7 待跟进提醒（96c2f1d）✅
| 验收标准 | 结果 | 证据 |
|---|---|---|
| 1. flag 关：无待办生成 | ✅ | 装配层 f7 关不调 handleFollowUpResult、定时器不注册（install.ts:53-57） |
| 2a. 承诺 → followups.json open 待办 | ✅ | handleFollowUpResult → store.add（qa-flag-impact §7 待跟进节 PASS） |
| 2b. 同承诺不重复建 | ✅ | store.add 同 contact+action+open 去重返回 null（store.ts:63-69） |
| 2c. 到期 → 桌面通知+followup:due | ✅ | FollowUpScheduler.scanDue：dueAt<=now && open → notify + notifyDesktop（不自动关闭） |
| 2d. 标记 done 后不再提醒 | ✅ | setStatus open→done 后 listOpen 不含（store.ts:89-96） |
| 3. 日报（F6）含待跟进节 | ✅ | 联动⑤：F6 经 listFollowUps 注入显示（qa-flag-impact PASS） |

### F8 多实例协同（02303f8）✅（环境限制：未真机双实例）
| 验收标准 | 结果 | 证据 |
|---|---|---|
| 1. --profile=a/b 数据隔离 | ✅ 代码级 | PROFILE 解析（main/index.ts:99-107）→ userData 子目录 `profile-<name>`；settings/customers/knowledge/personas/cards/sessions/reports 全部基于 userData（worktraceBaseDir），天然隔离 |
| 2. 端口错开 | ✅ | skill-server.ts:17-23 `hash%100` 偏移，与文档一致（12680+offset） |
| 3. 文档可照跑 | ✅ | docs/multi-instance.md（112 行）：快速开始/数据隔离表/端口规则/注意事项齐全；parseProfileArg 与主进程规则一致（白名单字符替换 `_`） |
| 限制 | ⚠️ | 本环境无法真实拉起 2 个 Electron GUI 实例做端到端验证；已通过代码路径 + 文档 + 纯函数（parseProfileArg/profileTag）验证 |

### F9 知识库深度优化（ebaee4d 与 F10 合并 commit）✅
| 验收标准 | 结果 | 证据 |
|---|---|---|
| 1. flag 关：与 V1 完全一致（30 条时间序无 scope 过滤） | ✅ | getInjectionItems() 保持原实现；f9-f10-smoke V1 路径断言 PASS（时间序、含全部启用条目） |
| 2a. weight=100/scope=vip 普通客户不注入、VIP 注入且排最前 | ✅ | getInjectionItemsV2 scope/weight 排序（f9-f10-smoke PASS：VIP 会话「退货流程」首位） |
| 2b. scope=group 仅群聊注入 | ✅ | 同上（群聊会话含「运费政策」不含 vip 条目） |
| 2c. 旧数据默认值不报错 | ✅ | weight=50/scope=all 默认；非法 scope 忽略（f9-f10-smoke PASS） |
| 3. UI 可编辑分类/权重/作用域并持久化 | ✅ | KnowledgeStore addItem/updateItem 支持 category/weight/scope（clamp 0-100、白名单 scope）；KnowledgeWindow 编辑入口（代码审查） |

### F10 提示词体系（e73f900 + ebaee4d 深化）✅
| 验收标准 | 结果 | 证据 |
|---|---|---|
| 1. flag 开：情绪价值规范生效；5 内置角色规则仍生效 | ✅ | base/emotion-value 段注入（c1-smoke PASS）；角色段作为第 2 段原样插入（assembler personaPrompt 槽位），内置角色数据未改动（设计决策） |
| 2. flag 关：与 V1 完全一致 | ✅ | f10 关 → LEGACY_SYSTEM_PROMPT + OUTPUT_FORMAT_SECTION（V1 文本），无任何注入段（c1-smoke 5 项断言 PASS） |
| 3. 14 段顺序正确无重复 | ✅ | c1-smoke 全开 14 段顺序断言 + 无重复 PASS |
| 4. 各段仅对应 flag+场景出现 | ✅ | c1/f9-f10-smoke + qa-flag-impact 双条件断言 PASS |

## 4. ④ flag 关闭零影响（docs §2.3 四条硬性规定）

QA 独立脚本 `scripts/qa-flag-impact.ts`（18/18 断言 PASS，exit 0）：

| 硬性规定 | 断言证据 |
|---|---|
| 1. 不注入 prompt | 全关 assembler：无任何功能段标题、无 V2 可选字段（messageKind/emotion/handoff/routeTo/followUp 均不出现） |
| 2. 不改变行为 | registry 全关 enabled()=0，before/after/afterReply/onTimer 五类钩子**零调用** |
| 3. 无性能损失（无额外调用/无定时器） | 全关零调用（F1 检测在装配层判 flag 短路，无 VLM）；F6/F7 调度器 flag 关 start() 挂 0 个定时器（setTimeout/setInterval 计数断言） |
| 4. 不阻塞主链路 | 抛错模块被 try/catch 吞掉，后续模块继续执行（f5 抛错 → f7 仍执行断言 PASS）；buildAssembledPromptFor 失败返回 undefined 走旧拼装；transformResult 失败吞掉返回原 result |

**单开单生效**：仅开 f5 → 仅 f5 模块被调用（断言 PASS）。

## 5. ⑤ 联动测试

QA 独立脚本 `scripts/qa-integration.ts`（21/21 断言 PASS，exit 0）：

| 联动链 | 结果 | 证据 |
|---|---|---|
| F5→F2 升级链 | ✅ | angry+0.8 → requestHandoff('risk_escalation') → 接管单入 store + 客户暂停 + 「情绪负面」「投诉」「需人工」打标 + risk:alert/handoff:new 事件 |
| F2 多轮未解决 | ✅ | 第 3 轮空 reply 触发 multiple_unresolved；reply 清零后重新计数 |
| F6 日报含 F2/F7 数据 | ✅ | 服务客户/VIP/待跟进（F7 待办）/待处理接管（F2 接管单）/轮次 全部进日报 |
| F1+F4 组合 | ✅ | 群聊段(4) < 路由段(6) 顺序；role_message 双保险不回复；单聊不注入路由段 |
| F1 后置过滤矩阵 | ✅ | group_member/role_message/公告/红包 → null；客户本人 → 回复；单聊 → 原样 |

## 6. ⑥ 可回滚演练

### 6.1 每功能独立 commit 核对（git log）

| 功能 | commit | 独立新文件 | 共享文件 |
|---|---|---|---|
| C0 flags | 52bff00 | features/flags.ts | main/index.ts, App.tsx, FeaturePanel.tsx, features.css |
| C1 prompt 骨架 | e73f900 | prompt/{assembler,base,emotion-value,index}, sections/output-format | ai-client.ts, local-provider.ts |
| C2 类型+解析 | 5942c9f | — | ai-client.ts, session-types.ts |
| F5 | 114404f | emotion-risk/* | 无（独立） |
| F3 | 559eaed | vip/* | 无（独立） |
| F6 模块 | b459f8d | daily-report/{index,report,section} | 无 |
| F9+F10 | ebaee4d | knowledge-v2/*, prompt/sections/{knowledge,vip} | knowledge-store.ts, prompt/assembler.ts, base.ts, emotion-value.ts, index.ts |
| F6 装配 | dfd7a07 | daily-report/install.ts | 无 |
| F1 | 97f6032 | group-chat/* | local-provider.ts, runtime-host.ts, main/index.ts, FeaturePanel.tsx, features.css |
| F4 | ac61a04 | role-routing/* | persona-store.ts |
| F8 | 02303f8 | multi-instance/index.ts, docs/multi-instance.md | main/index.ts, App.tsx, features.css |
| F7 | 96c2f1d | follow-up/* | main/index.ts, FeaturePanel.tsx, features.css |
| F2 | 87a4786 | human-handoff/* | local-provider.ts, main/index.ts, FeaturePanel.tsx |
| 装配集成 | 2475704 | features/hooks.ts, docs/feature-assembly.md | local-provider.ts, runtime-host.ts, main/index.ts, daily-report/install.ts |

### 6.2 revert 实测（逐 commit `git revert --no-commit` + abort 恢复）

| 场景 | 结果 | 证据 |
|---|---|---|
| **逆序整体回滚**（2475704→5942c9f 共 14 commits） | ✅ 全部干净 | 逐 commit 无任何 UU/UD 冲突；回滚后树 = V1 基线（发布过的版本），编译必然通过 |
| 单 revert F3/F4/F5/F9+F10（无共享文件依赖） | ✅ git 干净 | 仅删除各自功能文件 |
| 单 revert F1/F2/F7/F8 | ⚠️ 共享文件冲突 | main/index.ts / FeaturePanel.tsx / features.css / local-provider.ts / runtime-host.ts 出现 UU（后续 commit 改过同行）；功能代码目录仍干净删除，冲突集中在装配/UI 接线行，可手工解决 |
| 单 revert F6 装配（dfd7a07） | ⚠️ 冲突 | daily-report/install.ts 被装配 commit 后续修改 → UD；先 revert 2475704 则干净 |
| 单 revert 功能 commit 后编译 | ⚠️ 编译失败 | 例：revert F5 后 `npm run typecheck` 报 2 个 TS2307（main/index.ts 装配层仍 import emotion-risk）——**装配 commit 引用耦合，符合预期** |
| 单 revert C2（5942c9f） | ⚠️ 编译失败 | F1/F5/F7 等引用 SmartReplyResult 扩展字段/GroupChatContext → TS2305/TS2339 多处——与 docs §5"revert C2 编译通过"**实测相反** |

### 6.3 回滚影响面文档核对

- docs/richcat-v2-design.md §3 每功能均含「回滚影响面」小节（数据残留、风险点、协作接口）✅
- docs/feature-assembly.md §4「关闭零影响保证」✅
- **最简回滚 = 关 flag**：全部功能 flag 可运行时关闭（§4 已验证零影响），无需代码变更即达成"功能下线"语义 ✅

## 7. 缺陷清单

| # | 严重度 | 类型 | 描述 | 位置 | 建议 |
|---|---|---|---|---|---|
| D1 | 低 | 脚本类型错误 | `scripts/f4-routing-smoke.ts` 裸 `npx ts-node` 编译报 TS2741×6（routeTo 缺必填 `reason`）；scripts/ 不在 tsconfig include 内故 typecheck 不覆盖；`--transpile-only` 可正常运行 | scripts/f4-routing-smoke.ts:151,154,157,172,181,187 | 补 `reason` 字段，或按解析器容错语义将 `routeTo.reason` 声明为可选并同步文档 |
| D2 | 低 | 文档不准确 | docs §5 称"revert C2 编译通过（字段可选自动退化）"，实测 C2 单独 revert 后 F1/F5/F7 引用扩展字段导致 typecheck 失败 | docs/richcat-v2-design.md §5 提交纪律 | 更正为"回滚顺序：先功能、后地基（C2 最后）；C2 单独 revert 需功能已回滚" |
| D3 | 低 | 提交纪律偏差 | F9 与 F10 合并在 commit ebaee4d，违反"每功能一个 commit"；二者只能一起 commit 级回滚（运行时 flag 仍可独立关闭） | ebaee4d | 未来拆分；或文档注明合并回滚面 |
| D4 | 提示 | 测试工具链 | ts-node 未显式 target 时（根 tsconfig 无 compilerOptions → 默认 ES5）Set/Map 展开静默退化为 []（如 `[...new Set(...)]`）；本次 QA 在补 `"target":"esnext"` 后全部正常。现有 3 个冒烟脚本不依赖该语义故不受影响 | 各 scripts/ 头注释 | 建议在 scripts 头注释的 TS_NODE_COMPILER_OPTIONS 模板中加 `"target":"esnext"` |

> D1–D3 不影响运行期行为与主链路，不阻塞发布；D4 为工具链健壮性建议。

## 8. 环境限制与说明

- F8 多开未做真机双实例端到端（需 2 个 Electron GUI + 2 个微信实例），以代码路径 + 纯函数 + 文档验证代替。
- F6 定时自动生成未等待真实 23:50 触发，以调度器单测（flag 判定、防重复、日期计算）替代。
- 未调用真实 LLM API（无密钥/成本考量），提示词质量类验收（F10-1 语气抽查、F1 回复策略）基于注入段结构与纯函数断言，未做真实对话抽样。
- 复验脚本：`scripts/qa-flag-impact.ts`（④⑤-flag）、`scripts/qa-integration.ts`（⑤-联动），当前为未纳入版本控制的附加文件，可选用或删除。

## 9. 验收结论

**V2 全部功能（F1–F10 + C0/C1/C2 + 装配）验收通过，可发布。** 所有运行期行为类验收标准均满足；缺陷（D1–D3）为低危文档/脚本级，建议随下次迭代修复；D4 建议顺手补齐。回滚保障成立：逆序整体回滚 14 commits 零冲突，运行时按 flag 零成本下线任意功能。
