# Changelog

财听猫 RichCat — 所有值得记录的变更都按版本归档于此。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 约定，版本号遵循
[语义化版本 SemVer](https://semver.org/lang/zh-CN/)。

- **主版本**：不兼容的架构/数据迁移变化
- **次版本**：向后兼容的新功能、界面改版
- **修订版本**：向后兼容的缺陷修复

每个版本都会：
1. 在本文件追加版本条目（本文件的条目就是「版本说明」）
2. 用 git tag（`vX.Y.Z`）把该版本固定在提交上（版本隔离）
3. 在 `docs/releases/vX.Y.Z.md` 写详细发布说明
4. 在 `dist/` 保留该版本的安装包与 `latest.yml`（旧版本不删除）

> **回滚指引**：见 `docs/versioning.md`。git tag 是最可靠的版本隔离与回滚锚点。

---

## [Unreleased]

- 待规划（新功能/修复先在这里占位，发布时移入具体版本号）。

---

## [2.0.0-alpha.2] - 2026-08-20

### Added（新增）
- **总后台 Agent 遥测 SDK（C1）**：`src/core/enterprise/telemetry.ts` —— 心跳(60s)/用量(10min)/错误 三类事件上报到中央控制面；HMAC 脱敏设备标识；离线缓冲+重放(replayed 标记)；`setEnabled` 开关
- **主进程遥测接线**：`telemetry:*` IPC（getConfig/setConfig/getStatus/flushQueue）；引擎启动/停止自动启停遥测；仅上报用量统计/心跳/错误码，不含聊天与客户内容（合规铁律）
- **EnterprisePanel「总后台接入」UI**：后台地址（默认 `https://129.226.204.240:8443`）/ 站点 Token / 启用开关 / 保存与立即补发按钮 / 连接状态徽标
- **中央管理后台（控制面）代码库**：`control-plane/` —— Go+Gin+PostgreSQL16+Redis 多租户后端（认证/遥测/舰队/告警/计费/超管）+ React 管理后台 Web（登录/舰队/用量/告警/计费/平台页）+ docker compose 部署 + nginx HTTPS 反代配置
- 应用内版本号同步至 `v2.0.0-alpha.2`（`i18n.ts` app.version）

### Changed（变更）
- 版本升级至 `2.0.0-alpha.2`

### Fixed（修复）
- `i18n.ts` 应用内版本号从遗留的 `v1.1.0` 修正为 `v2.0.0-alpha.2`

---

## [2.0.0-alpha.1] - 2026-08-20

### Added（新增）
- **企业版 v2.0 预览切片**（E2-E8）：License 授权核心（状态机：trial/active/grace/expired/invalid，14 天试用，激活码伪校验，到期降级门禁），审计日志（append-only JSONL，全操作留痕，可查询可导出），用量计量（日桶配额+硬封顶熔断，会话/消息/接管/API 调用计数），密钥加密（AES-256-GCM，API Key 密文存储，旧明文自动迁移），企业版 IPC（`enterprise:*` 通道），引擎钩子（License 门禁/用量计费/配额熔断 gate），EnterprisePanel UI（设置窗口「企业版」tab：授权卡/用量仪表盘/审计流）
- 版本升级至 `2.0.0-alpha.1`（基于现行 master 的独立版本，不干扰社区版主线）

### Fixed（修复）
- **代码审查修复（CRITICAL/HIGH）**：① API Key 密文在远程启动/F4 二次路由/updateConfig 4 处被当明文使用 → 统一走 `resolveChatApiKey`/`resolveVisionConfig` 解密；② License 运行期熔断（shouldSkipContact 增 `canRun` 检查）；③ settings:set 密钥变化判定改为"解密后比较"，消除每次保存的虚假重加密与审计；④ 解密失败回退改为空值（不再把去前缀密文垃圾当密钥）；⑤ grace 宽限期 UI 文案与行为对齐；⑥ 密钥加密失败 fail-closed（保留旧值）；⑦ masterKey 非法时自动重新生成；⑧ settings:get 对 chatProvider 一并解密；⑨ engine.start 审计移到启动成功后；⑩ 熔断与 lastContact 解耦（空联系人也检查）；⑪ 删除 auditActionFor 死代码
- `skill-server.ts` 补充 `license_expired` 状态码（402）

---

## [1.1.0] - 2026-08-19

### Added（新增）
- **翡翠鎏金高端视觉设计系统 v2**（Jade & Gold）：墨夜底 `#080a12` + 翡翠 `#10b981` + 鎏金 `#d4af37` + AI 紫 `#a78bfa`
  - `:root` 全套 design token（颜色/渐变/圆角/阴影/字体/间距/动效）
  - 玻璃拟态卡片、渐变描边、氛围光晕、流光按钮、呼吸状态点、fade-in-up 等动效
  - 完整设计规范见 `docs/ui-redesign-design.md`
- **品牌统一为 RichCat**（替换原 SightFlow 字标）
  - 全窗口统一「猫图标 + RichCat 渐变字标」：主界面 / 设置 / 客户 / 记忆 / 知识库
  - 新增纯猫图标资源 `src/renderer/src/assets/richcat-icon.png`
- **版本说明与版本隔离体系**（本版本开始建立）
  - `CHANGELOG.md`、`docs/versioning.md`、`docs/releases/v1.1.0.md`
  - git tag `v1.0.0`（改版前基线）+ `v1.1.0`（本版本）

### Changed（变更）
- `index.css` 全面重写（GBK→UTF-8 转换，清理乱码注释，约 2530+ 行）
- `features.css` 对齐 v2 token：开关渐变发光、徽章/行 hover、圆角统一
- 状态点/卡片/表单/按钮/日志面板视觉升级（纯 CSS，零业务逻辑改动）
- 应用内版本号同步至 `v1.1.0`（修正原先遗留的 `v0.1.0`）

### Fixed（修复）
- 原 `logo.png` 图标区包含多余「R」字母导致的显示偏差 → 重新裁剪为纯猫图标

### 已知问题
- 无重大已知问题；视觉细节可在后续迭代微调

---

## [1.0.0] - 2026-08-17

首个正式发布版本（初始包为 `richcat-desktop-agent-1.0.0-setup.exe`）。

### Added（新增）
- Electron + VLM 的 AI 微信客服桌面端完整功能
- **品牌封装为财听猫 RichCat**（改名 / README / electron-builder / i18n / logo / 数据迁移 `%APPDATA%/sightflow-desktop-agent` → `%APPDATA%/RichCat`）
- **V2 工业级升级（F1–F10 功能模块，FeatureRegistry 按 flag 装配）**
  - F1 群聊支持 / F2 人工接管升级 / F3 VIP 差异化服务 / F4 多角色路由
  - F5 情绪/风险识别 / F6 服务日报 / F7 待跟进提醒 / F8 多实例协同 / F9 知识库深度优化
- AI 微信客服工作台：persona 人设 / knowledge 知识库 / customers 客户长期记忆 / 图片读取
- 工作记忆（Learn）v0：执行轨迹时间轴 / 逐步回放 / 经验卡片
- 提供方 Hub（provider hub）配置支持

### Changed（变更）
- Electron 升级至 ^39.8.10
- README 重写为产品化双语介绍

### Fixed（修复）
- V2 QA 验收报告（`docs/richcat-v2-qa-report.md`）中记录的 D1/D2 问题修复

---

## 更早的未版本化阶段

初始提交 `5511457`（2026-04-15）起为「sightflow-desktop-agent」内部开发阶段，
正式版本化自 v1.0.0 开始，此前的提交保留在 git 历史中（不另行标记版本）。

<!-- 链接锚点（tag 推送后与 GitHub Release 对齐） -->
[Unreleased]: https://github.com/x18677770772-png/richcat-desktop-agent/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/x18677770772-png/richcat-desktop-agent/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/x18677770772-png/richcat-desktop-agent/releases/tag/v1.0.0
