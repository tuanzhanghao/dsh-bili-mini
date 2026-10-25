<div align="center">

<img src="./icon.svg" width="96" height="96" alt="BiliMini icon" />

# BiliMini

**为 DeepSeek Harness 打造的极客风 B 站侧边栏**

推荐流 · 点击即播 · 实时弹幕 · DASH 1080P · PGC 剧集 · 选集连播 · 扫码登录 · 历史同步 · 状态持久化 · 0 Token

[![npm](https://img.shields.io/npm/v/dsh-bili-mini?style=flat-square)](https://www.npmjs.com/package/dsh-bili-mini)
[![DSH Plugin](https://img.shields.io/badge/DSH-Plugin-6C5CE7?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-00AEEC?style=flat-square)](#平台支持)
[![License](https://img.shields.io/badge/license-MIT-2ea44f?style=flat-square)](LICENSE)
[![LLM Token](https://img.shields.io/badge/LLM%20Token-0-111111?style=flat-square)](#为什么是-0-token)

不离开工作台，也能刷 B 站。

</div>

---

## 一眼看懂

```text
┌─ BiliMini ──────────────────────────────────────────┐
│  推荐  |  历史              [1080P ▾] [同步] [×]     │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │  封面     │  │  封面     │  │  封面     │           │
│  │  标题     │  │  标题     │  │  标题     │           │
│  └──────────┘  └──────────┘  └──────────┘           │
│                                                      │
│  点击卡片 → ArtPlayer + DASH + 实时弹幕               │
└──────────────────────────────────────────────────────┘
```

BiliMini 把 B 站推荐流、播放器、弹幕、账号登录、历史记录、PGC 选集和画质切换塞进 DSH 的侧边栏。没有额外窗口，没有浏览器标签页，也没有大模型调用。

## 简介

BiliMini 是一个面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的第三方侧边栏插件。它注册在 DSH 的 `sidebar.panellist`，打开即可浏览推荐视频；点击卡片后在同一面板内播放，支持 UGC 视频与 PGC 番剧/电视剧、弹幕、DASH 720P/1080P、选集面板、自动连播、扫码登录、个性化推荐、历史记录与可选的观看进度同步。

整个插件运行在本地 DSH Host 中：账号 Cookie 只保存在本机，媒体流通过本地代理转发，前端只拿播放所需的短期令牌。插件不调用任何 LLM API，因此浏览和播放不会消耗 DSH Token。

> 非 B 站官方项目，与哔哩哔哩、DeepSeek、DSH 官方均无关联。

## 核心特性

| | 特性 | 说明 |
|---|---|---|
| 🧩 | 侧边栏推荐 | 直接在 DSH 内刷 B 站推荐流，支持刷新与换一批 |
| 🎬 | 点击即播 | ArtPlayer + 本地流代理，支持 Range 拖动进度 |
| 💬 | 实时弹幕 | B 站 XML 弹幕，支持开关、速度、透明度、字号、模式等设置 |
| 🎚️ | DASH 720P/1080P | 登录态使用 DASH 独立音视频轨；播放器右上角切换画质，保留当前进度 |
| 🎞️ | PGC 剧集 | 支持番剧/电视剧 DASH 播放；PGC 历史条目可直接点开，进度走剧集心跳上报 |
| 🗂️ | 选集与连播 | 播放器右上角打开集数网格，当前集高亮；点击切集，可开关自动连播 |
| 🔐 | 本地安全登录 | B 站扫码登录；`SESSDATA` / `bili_jct` 只存在 Host 本地，前端不可见 |
| ✨ | 个性化推荐 | 登录后自动带 Cookie 请求；退出后回退匿名推荐 |
| 🕘 | 历史记录 | 最近 30 条观看记录，普通视频与 PGC 剧集混排，支持继续播放 |
| 🔄 | 历史同步 | 按网页播放器的方式节流上报进度；UGC 与 PGC 分别走对应接口，可选关闭，失败静默 |
| 🧠 | 状态持久化 | 记住 Tab、列表缓存和当前播放进度；切换对话/插件再回来不重置 |
| 🪶 | 0 Token | 不调用大模型，不产生 LLM Token 费用 |
| 📦 | 零构建 | 无 npm 运行时依赖、无构建步骤，播放器/弹幕/DASH/二维码均已内置 |
| 🖥️ | 多端兼容 | macOS 为开发与主要验证平台；Windows 已做路径、权限、回环地址适配 |

## 安装

### 从 npm 安装（推荐）

```bash
dsh plugin add dsh-bili-mini
```

如果你的 DSH 版本要求显式 npm spec：

```bash
dsh plugin add npm:dsh-bili-mini
```

如果你的 DSH 使用显式 profile：

```bash
# 桌面版通常使用 desktop
dsh plugin --profile desktop add dsh-bili-mini

# Web 版
dsh plugin --profile web add dsh-bili-mini
```

也可以先检查 npm 包内容：

```bash
npm view dsh-bili-mini
```

安装后**完整退出并重新打开 DSH**，然后在侧边栏打开 **BiliMini**。

### 从 GitHub 安装（源码）

```bash
dsh plugin add https://github.com/tuanzhanghao/dsh-bili-mini
```

部分 DSH 版本也接受 GitHub 简写：

```bash
dsh plugin add github:tuanzhanghao/dsh-bili-mini
```

> Host 代码更新后需要完整重启，而不是只刷新网页。从源码安装时，如果 pnpm 询问 `allowBuilds`：本项目没有构建脚本、原生依赖或 `postinstall`，只在你信任本仓库时授权。

### 本地开发安装

```bash
dsh plugin add /path/to/dsh-bili-mini
```

把 `/path/to/dsh-bili-mini` 替换成你的本地仓库目录。

### 环境要求

- DSH 桌面版或 Web 版；
- Node.js 20+（DSH 通常已内置）；
- 无需安装 npm 依赖，无需构建；
- 支持 MSE 的 Chromium/Electron 内核（DASH 播放需要）。

## 使用

1. 在 DSH 侧边栏打开 **BiliMini**；
2. 浏览推荐流，点击任意卡片开始播放；
3. 播放器支持进度拖动、音量、全屏、画中画；
4. 播放器右上角可选择 **720P / 1080P**（登录后按视频实际可用轨显示）；
5. 弹幕按钮位于播放器控制条，可在设置中调整样式；
6. 点击右上角 **登录**，用 B 站手机客户端扫码；
7. 登录后推荐流变为个性化，顶部显示头像与昵称；
8. 点击 **历史** 查看最近观看记录，普通视频与剧集混排，点击卡片继续播放；
9. PGC 剧集播放时，右上角 **选集** 打开集数网格；当前集高亮，点击即切集；
10. 选集面板内的 **自动连播** 默认开启，播完自动切下一集，最后一集停止；
11. 播放器右上角的 **同步历史** 开关控制是否把进度写回 B 站，默认开启；
12. 切换到其他对话/插件再回来，Tab、列表和播放进度会恢复。

## DASH 与画质

| 状态 | 播放模式 | 可用画质 |
|---|---|---|
| UGC 未登录 | 渐进式 MP4 | 最高 720P |
| UGC 已登录 | DASH（独立视频/音频轨） | 720P / 1080P，取决于视频与账号权益 |
| PGC 未登录 | DASH | 通常 480P，取决于剧集 |
| PGC 已登录 | DASH | 480P / 720P / 1080P，取决于剧集与账号权益 |
| 1080P+ / 4K | 未在 UI 开放 | 需要对应会员与视频权限 |

实现要点：

- 登录态请求 `fnval=16`，后端解析 `dash.video` / `dash.audio`，生成静态 MPD；
- 视频与音频分别通过本地 `/bili-mini/stream/<token>` 代理，支持 HTTP Range；
- MPD 通过 `/bili-mini/dash/<token>` 提供，`BaseURL` 使用当前 Host 的绝对地址；
- 前端懒加载内置的 **dash.js**，通过 ArtPlayer `customType` 接入 MSE；
- 切换画质时重新请求目标画质，记录当前 `currentTime`，新播放器 `ready` 后 seek 回原位置；
- 切换/关闭时先 `dash.destroy()` 再 `art.destroy()`，避免双音频与实例泄漏。

说明：

- PGC 第一版优先走 DASH 协议，兼顾画质与性能；剧集没有 DASH 时会直接报错，暂不做渐进式 MP4 回退；
- PGC 匿名通常只有 480P；登录后按剧集与账号权益显示 720P/1080P；
- UGC 720P 匿名可用；1080P 需要登录，并且依赖视频本身提供 1080P 轨、账号具备相应权益；
- 1080P+（qn=112）和 4K 当前不在 UI 中暴露；
- 本项目不做 DRM 绕过，只播放账号本来有权访问的流；
- 画质切换是“保留进度的短重载”，不是帧级无缝切换。

## 状态持久化

状态保存在 client 模块内部的内存对象 `panelMemory` 中：不挂 `window`、不写 localStorage/sessionStorage、不写 Cookie。面板组件卸载再挂载时状态仍在；整页刷新会清空。

> 弹幕偏好与“同步历史”开关仍使用 localStorage，这是纯 UI 设置，不包含 Cookie、UID、昵称或播放令牌。

| 内容 | 行为 |
|---|---|
| 当前 Tab | 推荐/历史；切换对话或插件后保持 |
| 推荐列表 | 5 分钟内直接复用缓存，不显示骨架屏、不重复请求 |
| 历史列表 | 5 分钟内直接复用缓存；手动刷新强制请求 |
| 当前播放 | 记住选中卡片、播放数据与进度；3 小时内切回来自动恢复并 seek |
| 登录/退出 | 清空推荐与历史缓存，避免串号或显示旧账号内容 |
| 整页刷新 | 内存清空，回到默认推荐 Tab |

播放恢复依赖播放响应里的 stream/manifest 临时令牌（有效期约 3 小时），因此缓存时间与令牌 TTL 对齐；过期后不会拿旧令牌强行播放。

## 安全与隐私

BiliMini 涉及 B 站账号 Cookie，边界如下：

| 项目 | 实现 |
|---|---|
| Cookie 位置 | 仅本地 Host 的 `data/cookie.json`；不写前端 localStorage/sessionStorage |
| POSIX 权限 | 数据目录 `0700`，Cookie 文件 `0600` |
| Windows 权限 | 不调用 `chmod`，交由用户目录 ACL |
| 前端可见性 | 前端只拿 `loggedIn`、昵称、头像；永远拿不到 `SESSDATA` / `bili_jct` |
| 网络范围 | 带 Cookie 的请求只发往 `*.bilibili.com` |
| 重定向 | `redirect: "error"`，避免 Cookie 被带到第三方 |
| 二维码 | 后端本地生成，不使用第三方二维码服务 |
| 日志 | 后端错误统一 `redact()`；第一方代码不打印 Cookie、SESSDATA 或接口原始响应 |
| 媒体令牌 | 随机、短期、仅本地使用；不写入磁盘 |
| 退出登录 | 删除 `data/cookie.json` 及临时文件 |
| 版本管理 | `.gitignore` 已忽略 `data/`、`cookie.json`、`*.log`、`.env*`、`.dsh-ops/` |

BiliMini 没有遥测、埋点、远程配置或第三方中转服务器。推荐、播放、弹幕、登录和历史同步都只在本机 DSH Host 与 B 站之间发生。

> 发布、打包或分享代码前，请确认 `data/cookie.json` 不存在。`.gitignore` 只能阻止 Git 提交，不能阻止手动压缩、网盘同步或上传。
>
> 如果使用中的已安装插件仍处于登录状态，请在插件内点“退出登录”，或删除该安装目录下的 `data/cookie.json`；本仓库源码目录不包含任何 Cookie。

## 平台支持

| 平台 | 状态 | 说明 |
|---|---|---|
| macOS | ✅ 完美支持 | 开发与主要验证平台；DASH、弹幕、登录、历史同步、PGC 播放与选集均已实机验证 |
| Windows | ✅ 已做适配 | 路径、权限、文件替换、回环地址均已处理；未覆盖所有 Windows 版本 |
| Linux | ⚠️ 理论可用 | 未做专项验证，欢迎反馈 |
| DSH Web | ✅ 支持 | 需要浏览器支持 MSE；Firefox/Safari 的 DASH 行为可能不同 |
| DSH Desktop | ✅ 支持 | Electron/Chromium 内核，推荐使用 |

Windows 细节：

- 所有路径使用 `path.join` / `fileURLToPath`，不依赖 `/tmp` 或 macOS 固定路径；
- Windows 下不调用 `fs.chmod`，Cookie 文件权限交由用户目录 ACL；
- `rename` 失败时使用 `copyFileSync` 兜底，避免杀毒/索引器短暂占用；
- 媒体地址中的 `localhost` / `::1` 归一化为 `127.0.0.1`，避免系统代理或双栈解析拦截。

## 已知限制

- **1080P 依赖登录与 DASH**：UGC 匿名只有 720P；1080P 还取决于视频轨与账号权益；
- **1080P+ / 4K 未开放**：qn=112 及更高画质当前不在 UI 中暴露；
- **PGC 匿名通常只有 480P**：登录后按剧集与账号权益显示 720P/1080P；PGC 第一版优先走 DASH；
- **PGC 选集以正片为主**：OP/ED/SP 暂不纳入选集列表；
- **历史混排会过滤未知类型**：直播、专栏等条目会被忽略，可见条数可能少于 30 条；
- **不提供 DRM 绕过、去广告或付费内容破解**；
- B 站接口、风控、区域限制和 Cookie 有效期都可能影响推荐、播放与历史同步；
- 历史同步是 best-effort，失败会静默，不保证 100% 写入；
- 画质切换是短重载，会有一瞬间的播放器初始化；
- 状态持久化是进程内内存，整页刷新或重启 DSH 后会重置；
- 侧边栏宽度有限，复杂播放器设置可能需要横向滚动；
- 本插件不提供视频下载功能。

## 为什么是 0 Token

BiliMini 只使用 B 站公开接口与本地播放器：

- 不调用大模型；
- 不消耗 LLM Token；
- 不需要 API Key；
- 不把观看内容发送给模型服务。

它消耗的只有正常的网络流量和本地 CPU/GPU 解码资源。

## 架构

```text
DSH Client (React)
   │  /bili-mini/api/feed · /play · /history · /login · /history/report
   │  /bili-mini/dash/<token> · /bili-mini/stream/<token>
   ▼
DSH Host (Node.js)
   │  Cookie 本地保存 · 请求头补齐 · DASH MPD · Range 流代理 · 日志脱敏
   ▼
Bilibili API / CDN
```

主要模块：

- `index.js`：Host 路由、推荐/UGC/PGC 播放/历史/登录 API、DASH MPD、流代理、CORS、缓存；
- `bili.js`：B 站接口封装、DASH 轨道归一化、UGC/PGC 历史与进度上报；
- `auth.js`：扫码登录、Cookie 原子写入、权限、脱敏；
- `danmaku.js`：弹幕 XML 解析与格式转换；
- `client.js`：React 侧边栏 UI、ArtPlayer、dash.js、弹幕插件、PGC 选集/连播、面板状态缓存；
- `vendor/`：ArtPlayer、artplayer-plugin-danmuku、dash.js、qrcode-generator 的内置版本。

内置依赖：

- ArtPlayer 5.x（MIT）；
- artplayer-plugin-danmuku 5.x（MIT）；
- dash.js 4.7.4（BSD-3-Clause）；
- qrcode-generator 1.4.4（MIT）。

## 项目结构

```text
dsh-bili-mini/
├── .gitignore
├── LICENSE
├── README.md
├── package.json
├── cordis.patch.yml
├── icon.svg
├── index.js
├── bili.js
├── auth.js
├── danmaku.js
├── client.js
├── locale/
│   ├── en.json
│   └── zh.json
└── vendor/
    ├── README.md
    ├── LICENSE.artplayer
    ├── LICENSE.artplayer-plugin-danmuku
    ├── LICENSE.dashjs
    ├── LICENSE.qrcode-generator
    ├── artplayer.js
    ├── artplayer-plugin-danmuku.js
    ├── dash.all.min.js
    ├── dash.all.min.js.LICENSE.txt
    └── qrcode-generator.cjs
```

`data/` 是运行时目录（登录后创建），已被 `.gitignore` 忽略，不随仓库发布。

## 开发

本项目没有构建步骤，源码直接运行：

```bash
node --check index.js
node --check bili.js
node --check auth.js
node --check danmaku.js
node --check client.js

# 检查 npm 发布内容，确认不包含 data/、Cookie、日志或本地文件
npm pack --dry-run
```

约定：

- 保持零运行时 npm 依赖；
- 第三方浏览器资源继续使用 `vendor/`，不引入 CDN；
- Host 代码中的错误信息统一走 `redact()`；
- 不提交 Cookie、真实 UID、昵称、头像、本地绝对路径或接口原始响应；
- 修改 Windows 相关代码时同时检查路径、权限与回环地址。

## 常见问题

**登录后仍然只有 720P？**

先确认当前账号已登录、视频本身提供 1080P DASH 轨，并且账号具备对应权益。部分视频、地区或账号只返回 720P；1080P+ 不在 UI 中开放。

**切换 1080P 会闪一下？**

这是设计行为：切换画质会重新生成 MPD 并创建 dash.js 实例，随后 seek 回切换前的时间点，不是帧级无缝切换。

**切换到其他对话/插件再回来，Tab 或播放进度重置？**

正常应保持。若整页刷新或重启 DSH，内存缓存会清空。若面板模块被 DSH 重新加载，也会重置；可在 Issue 中附上 DSH 版本与复现步骤。

**历史同步没有记录？**

确认已登录且播放器右上角“同步历史”为开启状态。B 站写接口可能触发风控或限流，插件会静默失败，不影响播放。

**二维码不显示 / 登录 404？**

确认安装后已完整重启 DSH，而不是只刷新页面。Host 代码更新后尤其需要重启。

**Cookie 存在哪里？如何退出？**

```text
<插件目录>/data/cookie.json
```

macOS 为 `0600`；Windows 使用用户目录 ACL。退出登录会自动删除该文件及临时文件。也可以直接删除 `data/cookie.json`。

**Windows 上无法播放或拖动？**

确认媒体地址使用 `127.0.0.1` 而不是 `localhost`；本项目已自动归一化。若仍有问题，请附上 DSH 日志中的脱敏错误。

## 免责声明

本项目仅用于学习与技术交流，与哔哩哔哩、DeepSeek、DSH 官方均无关联。

- B 站接口可能随时调整或触发风控，推荐、播放、历史同步等功能不保证长期可用；
- 请遵守 B 站用户协议与相关法律法规，不要用于批量抓取、账号滥用或其他违规用途；
- 本项目不提供破解、去广告或绕过付费内容的能力；
- 使用本项目产生的任何后果由使用者自行承担，作者不对账号风险、数据丢失或服务中断负责。

## 参与贡献

欢迎提交 Issue 和 Pull Request。

- 提交前请确保不包含 `data/cookie.json`、Cookie、真实 UID、昵称、头像或本地绝对路径；
- 不要提交接口原始响应、调试日志或带个人信息的截图；
- 代码保持零运行时依赖，优先使用 Node 原生 `fetch` / `fs` / `path`；
- 播放器、弹幕、DASH、二维码资源继续使用 vendored 版本；
- Windows 相关改动请同时验证路径、权限与回环地址。

## License

[MIT](LICENSE) © 2026 [tuanzhanghao](https://github.com/tuanzhanghao)

## 致谢

- [ArtPlayer](https://github.com/zhw2590582/ArtPlayer) — MIT
- [artplayer-plugin-danmuku](https://github.com/zhw2590582/artplayer-plugin-danmuku) — MIT
- [dash.js](https://github.com/Dash-Industry-Forum/dash.js) — BSD-3-Clause
- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) — MIT
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)

---

<div align="center">

如果 BiliMini 让你的摸鱼更快乐，点个 Star ⭐

</div>
