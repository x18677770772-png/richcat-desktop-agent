# 多实例协同（Multi-Instance / --profile）

> 财听猫 RichCat 支持**同时运行多个实例**（多开），每个实例使用独立的微信账号与独立的数据目录，
> 互不干扰。多开能力由 `--profile=<name>` 启动参数驱动，属于 V2 功能 **F8**（开关 `f8.multi_instance`，
> 默认开，占位开关仅影响 UI 提示）。

---

## 1. 快速开始

```bash
# 默认实例（无 profile）
richcat

# 多开实例：为每个微信账号起一个独立 profile
richcat --profile=a
richcat --profile=b
# 或
richcat --profile=zhangsan
richcat --profile=lisi
```

- profile 名称支持 `a-zA-Z0-9_-`，其他字符会被替换为 `_`（防路径注入）。
- 每个实例需要**独立的微信桌面端实例**：请先登录微信 A，再启动 `--profile=a`；
  登录微信 B，再启动 `--profile=b`。**同一微信实例不能被两个 RichCat 同时操作。**

---

## 2. 数据隔离

每个 profile 使用独立的 userData 子目录：`%APPDATA%/RichCat/profile-<name>`（macOS：
`~/Library/Application Support/RichCat/profile-<name>`，Linux：`~/.config/RichCat/profile-<name>`）。

在 profile 目录内**全部数据天然隔离**：

| 数据 | 路径（相对 userData） | 说明 |
|---|---|---|
| 应用设置 | `settings.json` | 视觉密钥 / 聊天服务 / 功能开关 / 功能配置 |
| 客户档案 | `worktrace/customers/customers.json` | 各实例独立客户库 |
| 知识库 | `worktrace/memory/knowledge.json` | 各实例独立知识 |
| 角色人设 | `worktrace/memory/personas.json` | 各实例独立角色 |
| 经验卡片 | `worktrace/memory/cards.json` | 各实例独立工作记忆 |
| 服务轨迹 | `worktrace/sessions/*` | 轨迹/回放隔离 |
| 服务日报 | `worktrace/reports/*.md` | 日报隔离 |

> 验证：修改实例 A 的设置 / 客户 / 知识库，实例 B 完全不受影响。

### 旧数据迁移

首次启动时（仅**默认实例、无 profile**）会把旧版数据目录（`sightflow-desktop-agent`）
自动迁移到 `RichCat`。**profile 实例不做迁移**，各自全新开始——避免把默认数据复制到每个
多开实例里。

---

## 3. 端口错开（Skill HTTP Server）

每个实例的本地 Skill 服务端口按 profile 名错开，避免冲突：

```
端口 = 12680 + hash(profile) % 100
```

- 默认实例：`12680`
- 实例 `a`：`12680 + hash('a') % 100`
- 若端口被占用，自动顺延 +1（fallback）

启动日志会打印实际端口（`[skill-server] ...`）。两个实例的端口**必然不同**
（相同 profile 才能得到相同端口，而相同 profile 共享数据目录、不应同时启动）。

---

## 4. 窗口与日志标识

- **窗口标题**：多开实例的所有窗口标题带 `· <profile>` 后缀
  （主窗口「财听猫 RichCat · a」、设置 / 工作记忆 / 知识库 / 客户管理窗口同理），一眼区分实例。
- **启动日志**：`[RichCat] 多开模式：profile=a，数据目录=...`。
- **通知/日报**：建议在桌面通知标题追加 `profileTag(profile)`（` · <name>`）以区分实例；
  由各功能模块（F2 接管 / F6 日报）在装配时按 `src/core/features/multi-instance/index.ts`
  的 `profileTag()` 帮助函数统一处理。

---

## 5. 注意事项 / FAQ

**Q：两个实例可以共用同一个 profile 吗？**
不建议。相同 profile = 相同数据目录 + 相同端口，同时启动会互相覆盖数据。

**Q：多开会消耗多少资源？**
每个实例独立运行一套引擎（截图检测 + AI 调用 + Skill 服务），内存/API 消耗线性增加。
请按需开启。

**Q：功能开关（Feature Flags）是全局共享的吗？**
不。每个实例的 `settings.json` 独立，功能开关与功能配置（如 F1 机器人昵称）各自独立设置。

**Q：如何退出多开模式？**
不带 `--profile` 启动即为默认实例。删除某 profile 只需删除对应数据目录（谨慎操作，先备份）。

**Q：V2 功能 F8 开关有什么用？**
`f8.multi_instance` 是**说明性开关**（默认开）：多开能力始终可用，开关仅控制设置页的提示与
文档展示，不影响运行时行为。

---

## 6. 验收对照（QA）

1. `richcat --profile=a` 与 `richcat --profile=b` 同时运行：
   a) 改 A 的设置 / 客户 / 知识库 → B 不受影响；
   b) 两实例窗口标题分别显示 `· a` / `· b`；
   c) 两实例 Skill 端口不同（见启动日志）。
2. 无 profile 启动 → 标题无后缀、端口 12680、走旧数据迁移逻辑（首次）。
3. 本文档步骤可照着跑通。
