# 版本管理 · 发布 / 回滚工作流

本文档说明财听猫 RichCat 的版本如何发布、如何隔离、如何回滚。
**目标：每次更新都能追溯到确切代码与安装包，出问题可以快速回到上一个可用版本。**

---

## 1. 版本号规则（SemVer）

`主版本.次版本.修订版本`（如 `1.1.0`）：

| 段 | 何时 +1 | 示例 |
|----|---------|------|
| 主版本 | 不兼容架构/数据迁移变化 | 2.0.0 |
| 次版本 | 新功能、界面改版（向后兼容） | 1.1.0 |
| 修订版本 | 缺陷修复（向后兼容） | 1.1.1 |

- 版本号唯一来源：`package.json` 的 `version` 字段
- **应用内显示的版本号必须与 `package.json` 一致**（`src/renderer/src/i18n.ts` 的 `app.version`）
- 每发布一个版本，`CHANGELOG.md` 必须有对应条目

---

## 2. 版本隔离（为什么用 git tag）

**每个发布版本用一个 git tag（`vX.Y.Z`）钉在对应提交上**，实现三层隔离：

1. **代码层**：`git checkout v1.0.0` 即可拿到该版本精确的源码
2. **构建层**：从该 tag checkout 后构建，产物与该版本发布时一致
3. **产物层**：`dist/` 保留每个版本的安装包（`richcat-desktop-agent-X.Y.Z-setup.exe`），
   **旧安装包不删除**，需要旧版时直接用旧安装包重装

```
v1.0.0 ──→ 1.0.0 安装包 + latest.yml
   │
v1.1.0 ──→ 1.1.0 安装包 + latest.yml   ← 当前
   │
v1.1.1 ──→ 1.1.1 安装包 + latest.yml   ← 未来
```

---

## 3. 发布一个新版本（每次更新走这套流程）

```powershell
cd E:\DSH\richcat-desktop-agent

# ① 确认改动就绪：typecheck + build 通过
npm.cmd run typecheck

# ② 更新 package.json 的 version（例如 1.1.0）
#    同步更新 src/renderer/src/i18n.ts 的 app.version

# ③ 在 CHANGELOG.md 追加本版本条目（把 [Unreleased] 内容移入新版本号）
#    给重要改动写 docs/releases/vX.Y.Z.md 详细说明

# ④ 提交改动
git add -A
git commit -m "chore(release): v1.1.0"

# ⑤ 打 tag（版本隔离锚点）+ 推送
git tag -a v1.1.0 -m "v1.1.0 - 翡翠鎏金视觉改版 + RichCat 品牌统一"
git push origin main --tags

# ⑥ 构建安装包（产物进 dist/，旧包保留）
npm.cmd run build:win
```

> **提醒**：打 tag 前确认该提交就是你要发布的版本；tag 一旦推送，
> 若要修改需删除并重打（`git tag -d v1.1.0` + `git push origin :refs/tags/v1.1.0`），
> 所以务必先在本地验证 build 产物再推送 tag。

---

## 4. 回滚（Rollback）— 出问题怎么办

### 情况 A：只是代码回退（还没重装/没升级到生产）

```powershell
# 回到上一个稳定版本代码
git checkout v1.0.0

# 需要时基于它开修复分支
git checkout -b hotfix/v1.0.1 v1.0.0
```

### 情况 B：已经装了新版，要退回旧版

直接用旧安装包重装即可（版本隔离的产物层）：
1. 卸载当前版本（或直接运行旧安装包，覆盖降级）
2. 运行 `dist/richcat-desktop-agent-1.0.0-setup.exe`
3. 数据在 `%APPDATA%/RichCat`，降级一般不丢数据（数据格式向后兼容的前提）

### 情况 C：数据也被新版改坏了

1. 先备份 `%APPDATA%/RichCat`
2. 用旧版安装包重装
3. 如需彻底重置，删除 `%APPDATA%/RichCat` 后重装

---

## 5. 版本文件清单

| 文件 | 作用 |
|------|------|
| `CHANGELOG.md` | 版本说明总表（每版本一条） |
| `docs/releases/vX.Y.Z.md` | 每版本详细发布说明 |
| `docs/versioning.md` | 本文档（发布/回滚流程） |
| `package.json` version | 版本号唯一来源 |
| `dist/richcat-desktop-agent-X.Y.Z-setup.exe` | 该版本安装包（保留所有历史版本） |

---

## 6. 当前版本状态

| 版本 | 日期 | tag | 安装包 | 状态 |
|------|------|-----|--------|------|
| v1.0.0 | 2026-08-17 | `v1.0.0` | dist/...1.0.0-setup.exe | 已发布（基线） |
| v1.1.0 | 2026-08-19 | `v1.1.0` | 待构建 | 当前版本 |
