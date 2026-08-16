<div align="center">

# 财听猫 RichCat 🐱💰

**AI 微信客服系统 —— 让 AI 像真人客服一样，7×24 小时在微信上接待你的客户**

<p>
  <a href="./README.md"><b>English</b></a>
  &nbsp;·&nbsp;
  <a href="./README.zh-CN.md">简体中文</a>
</p>

<p>
  <img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License: Apache 2.0" />
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-success" alt="Platform: Windows | macOS" />
  <img src="https://img.shields.io/badge/Stack-Electron%20%7C%20React%20%7C%20VLM-5865F2" alt="Stack" />
</p>

</div>

---

## 这是什么

财听猫（RichCat）是我个人开发的 **AI 微信客服系统**。它基于 Electron + 视觉语言模型（VLM），像真人一样"看"微信聊天窗口——识别新消息、理解客户意图、自动回复、记录客户档案，全天候值守你的微信生意，把客服从重复劳动中解放出来。

> 不需要任何微信接口或协议：纯视觉识别，就像真人坐在电脑前操作一样。

---

## ✨ 核心能力

- 🤖 **AI 自动回复** —— 视觉理解聊天内容，智能生成自然回复（含防自问自答保护），支持"无需回复时跳过"
- 👥 **客户自动建档（CRM）** —— 聊过的联系人自动创建档案，支持标签、分类与客户统计；每轮对话自动生成摘要并长期记忆，下次回复自动注入客户历史，跨会话记得每位客户
- 📚 **知识库** —— 维护问答条目（支持批量导入），启用条目自动注入每次回复，让 AI 严格按你的业务事实回答
- 🎭 **角色系统** —— 内置 5 种人设（医疗专家 / 私人管家 / 运动专家 / 心理咨询师 / 销售顾问），支持自定义角色，一键切换
- 🖼 **图片消息识别** —— 客户发来图片时，自动点开大图、读取图片内容（照片 / 截图文字 / 表情包）后再回复
- 🔍 **纯视觉 RPA** —— 未读检测、点击、输入、发送全链路视觉驱动，适配微信 / 企业微信 / 钉钉 / 飞书等桌面应用
- 🧠 **工作记忆** —— 每次执行沉淀经验卡片，系统越用越懂你的业务
- 🔌 **多模型支持** —— 聊天与视觉模型**独立可配**：火山方舟（标准 / Agent Plan）、OpenAI、智谱 GLM、通义 Qwen，或任意 OpenAI 兼容端点
- 🧩 **V2 功能体系**（全部**可独立开关**、关闭零影响、可单独回滚）：
  - 💬 **群聊支持**（F1）—— 只回复客户本人或被 @ 的消息，忽略群成员 / 公告 / 红包
  - 🙋 **人工接管**（F2）—— 识别"转人工 / 投诉 / 价格敏感 / 多轮未解决"，停止自动回复并通知人工
  - 👑 **VIP 差异化服务**（F3）—— 按客户档案提供专属语气与专属知识，让 VIP 更被重视
  - 🔀 **多角色路由**（F4）—— 群内销售 / 售后 / 专家多角色，按问题类型自动路由到对应角色
  - 😤 **情绪 / 风险识别**（F5）—— 识别不满 / 退款意向 / 投诉 / 紧急，自动客户打标与风险提醒
  - 📊 **服务日报**（F6）—— 每日定时（默认 23:50）汇总服务客户 / VIP 动态 / 待跟进 / 接管事件，生成 Markdown 日报
  - ⏰ **待跟进提醒**（F7）—— AI 承诺"明天回复"自动生成待办，到期桌面提醒
  - 🖥 **多实例协同**（F8）—— `--profile` 多开，设置 / 客户 / 知识库 / 日报完全隔离
  - 📚 **知识库分级**（F9）—— 分类 / 权重 / 作用域（VIP、群聊专属），按需注入替代全量 30 条
  - 🎯 **情绪价值提示词体系**（F10）—— 专业感 + 人感 + 情绪价值统一规范，可整体回退旧提示词

---

## 🚀 快速开始

**前置条件**：Node.js (LTS) + npm

```bash
# 1. 安装依赖
npm install

# 2. 开发模式运行
npm run dev

# 3. 打包发布
npm run build:win     # Windows
npm run build:mac     # macOS
```

**首次启动**：选择目标应用（微信 / 企业微信 / 钉钉 / 飞书…）→ 自动视觉测量布局（或手动框选区域）→ 打开设置填入 API Key → 启动引擎，开始自动值守。

## 👥 多开（多账号）

可同时运行多个实例，每个实例拥有独立的设置、角色、知识库与客户数据：

```bash
npm run dev -- --profile=shop     # 实例 A（如：店铺号）
npm run dev -- --profile=service  # 实例 B（如：客服号）
```

- 每个 profile 使用独立数据目录（`%APPDATA%/RichCat/profile-<名字>`），互不干扰
- 窗口标题会显示 profile 名，方便区分实例
- 控制端口按 profile 自动错开
- 启动某实例的引擎前，先把对应的聊天窗口切到前台——实例只会操作**当前激活**的聊天窗口

---

## ⚙️ 配置

| 配置项 | 说明 |
| :-- | :-- |
| **基础配置** | 视觉模型（负责布局检测 / 未读识别 / 图片读取）：API Key、Base URL、模型，支持标准方舟、Agent Plan 与任意 OpenAI 兼容端点 |
| **智能体** | 聊天回复模型：内置 Doubao Seed，或接入火山方舟 / 其他 Provider |
| **角色设定** | 切换内置人设或自定义角色 prompt |
| **知识库 / 客户管理** | 独立窗口管理问答条目与客户档案 |

> 数据全部存储在本地（`%APPDATA%/RichCat`），不上传任何服务器。

---

## 🏗 技术栈

Electron · electron-vite · React · TypeScript · VLM（视觉语言模型）· node-window-manager · robotjs

---

## 📄 License

[Apache License 2.0](LICENSE)

---

## 🙏 致谢

本项目是个人二次开发作品，**技术底座基于开源项目 [SightFlow](https://github.com/sightflow-dev/sightflow-desktop-agent)（SightFlow Desktop Agent）**——一个优秀的 Electron + VLM 桌面 Agent 框架。感谢原作者 sightflow-dev 团队的开源贡献。

<div align="center"><sub>© 2026 RichCat（财听猫）. Released under the Apache License 2.0.</sub></div>
