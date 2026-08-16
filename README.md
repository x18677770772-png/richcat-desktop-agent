<div align="center">

# 财听猫 RichCat 🐱💰

**AI WeChat Customer-Service System — Let AI serve your customers on WeChat, 24/7, just like a human agent**

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

## What is this?

**RichCat (财听猫)** is my personal AI WeChat customer-service system. Built on Electron + Vision-Language Model (VLM), it "sees" the WeChat chat window like a human — detecting new messages, understanding customer intent, replying automatically, and keeping customer records. It watches over your WeChat business around the clock and frees you from repetitive customer-service work.

> No WeChat API or protocol required: it is pure vision-based automation, exactly like a real person operating the computer.

---

## ✨ Core Features

- 🤖 **AI Auto-Reply** — understands chat content visually and generates natural replies (with anti-self-loop protection), and skips when no reply is needed
- 👥 **Customer Auto-Profiling (CRM)** — contacts are automatically archived after chatting; supports tags, categories and stats; every conversation is summarized and remembered long-term, then injected into the next reply — it remembers every customer across sessions
- 📚 **Knowledge Base** — maintain Q&A entries (with batch import); enabled entries are auto-injected into every reply so answers follow your business facts
- 🎭 **Persona System** — 5 built-in personas (medical expert / butler / sports coach / psychologist / sales consultant) plus custom personas, switchable in one click
- 🖼 **Image Message Reading** — when a customer sends an image, it automatically opens the full-size image, reads its content (photo / screenshot text / sticker), then replies
- 🔍 **Pure-Vision RPA** — unread detection, clicking, typing and sending are all vision-driven; works with WeChat, WeCom, DingTalk, Feishu and other desktop apps
- 🧠 **Working Memory** — every run accumulates experience cards; the system gets better at your business over time
- 🔌 **Multi-Model Support** — chat and vision models are **independently configurable**: Volcengine Ark (Standard / Agent Plan), OpenAI, Zhipu GLM, Qwen, or any OpenAI-compatible endpoint

---

## 🚀 Getting Started

**Prerequisites:** Node.js (LTS) + npm

```bash
# 1. Install dependencies
npm install

# 2. Run in development
npm run dev

# 3. Build a release
npm run build:win     # Windows
npm run build:mac     # macOS
```

**On first launch:** pick your target app (WeChat / WeCom / DingTalk / Feishu …) → let VLM measure the layout automatically (or select regions manually) → enter your API key in Settings → start the engine and let it work.

## 👥 Multi-Instance (Multi-Account)

Run several instances side by side — each with its own settings, personas, knowledge base and customer data:

```bash
npm run dev -- --profile=shop     # instance A (e.g. shop account)
npm run dev -- --profile=service  # instance B (e.g. service account)
```

- Each profile uses an isolated data directory (`%APPDATA%/RichCat/profile-<name>`)
- Window titles show the profile name so you can tell instances apart
- Skill-server ports are offset per profile automatically
- Before starting the engine in an instance, bring its target chat window to the foreground — an instance only operates the currently active chat window

---

## ⚙️ Configuration

| Section | Description |
| :-- | :-- |
| **Base Configuration** | Vision model (layout detection / unread detection / image reading): API Key, Base URL, model — supports Standard Ark, Agent Plan and any OpenAI-compatible endpoint |
| **Agent** | Chat reply model: built-in Doubao Seed, or any other provider |
| **Personas** | Switch built-in personas or define custom role prompts |
| **Knowledge Base / Customers** | Standalone windows to manage Q&A entries and customer profiles |

> All data is stored locally (`%APPDATA%/RichCat`) — never uploaded to any server.

---

## 🏗 Tech Stack

Electron · electron-vite · React · TypeScript · VLM (Vision-Language Model) · node-window-manager · robotjs

---

## 📄 License

[Apache License 2.0](LICENSE)

---

## 🙏 Acknowledgements

This is a personal derivative project. **The technical foundation is based on the open-source project [SightFlow](https://github.com/sightflow-dev/sightflow-desktop-agent) (SightFlow Desktop Agent)** — an excellent Electron + VLM desktop agent framework. Thanks to the original author, the sightflow-dev team, for their open-source contribution.

<div align="center"><sub>© 2026 RichCat (财听猫). Released under the Apache License 2.0.</sub></div>
