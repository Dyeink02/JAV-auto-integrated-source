# JAV自动化爬虫工具 v0.26

> **源码来源说明**：本项目基于开源项目 [raawaa/jav-scrapy](https://github.com/raawaa/jav-scrapy) 进行二次开发，在原有命令行爬虫核心的基础上，增加了 Windows 桌面 GUI 界面、视频整理模块、智能广告过滤、女优排行榜等大量功能，形成了一套完整的 JAV 自动化管理桌面工具。

---

## 目录

- [软件简介](#软件简介)
- [核心功能](#核心功能)
- [软件架构](#软件架构)
- [目录结构说明](#目录结构说明)
- [技术栈与依赖](#技术栈与依赖)
- [使用方法](#使用方法)
- [配置说明](#配置说明)
- [版本历史](#版本历史)

---

## 软件简介

JAV自动化爬虫工具是一款运行于 Windows 平台的桌面应用程序，由AI编程并以 Electron 封装，提供图形化界面。软件以 [javbus.com](https://www.javbus.com) 作为主要数据源，支持多镜像域名容灾切换，能够自动化完成影片信息抓取、磁力链接获取、本地视频文件整理、广告过滤、女优排行榜查询等全流程任务。

---

## 核心功能

### 1. 视频自动爬取
- 按女优主页 URL 批量抓取影片列表
- 多镜像域名自动容灾（支持 10+ 个 javbus 镜像站）
- 断点续爬：任务中断后可从上次进度继续
- 磁力链接自动获取，优先返回体积最大的完整资源
- 智能限量模式：设置目标条数后自动停止

### 2. 智能广告过滤
- **快速候选**：优先选取体积最大的磁力链接
- **内容校验**：通过 DHT 网络验证磁力内容，过滤广告包/杂文件包
- **AI 模型检测**：内嵌 MobileNetV3 / SqueezeNet / YOLOv8n 三款模型，对视频帧进行广告帧识别
- **自学习系统**：用户标记后自动更新本地哈希数据库，持续提升过滤准确率
- 广告处理方式可视化切换（删除/隔离/跳过）

### 3. 视频文件整理
- 自动扫描本地目录，按番号匹配视频文件
- 支持批量重命名（标准格式 / 自定义格式）
- 智能补漏：与爬虫抓取记录对照，找出未下载的番号
- 清理空目录、孤立文件
- 整理报告生成（成功/失败/跳过统计）

### 4. 女优排行榜
- FANZA 官方排行榜实时同步
- Avfan 第三方排行榜接入
- 本地历史排名记录，支持趋势对比
- 一键将排行榜女优 URL 填入爬虫配置

### 5. 桌面 GUI 界面
- 实时运行状态面板（进度、速度、统计）
- 彩色日志查看器，支持筛选/导出
- 配置中心（代理、限量、输出路径等）
- 版本更新历史展示

---

## 软件架构

```
┌─────────────────────────────────────────────────────┐
│                  Electron 主进程                     │
│  main.js → ipcHandlers.js → runnerService.js        │
│              ↓ organizerService.js                  │
│              ↓ settingsStore.js                     │
│              ↓ windowService.js                     │
└───────────────────┬─────────────────────────────────┘
                    │ IPC (contextBridge)
┌───────────────────▼─────────────────────────────────┐
│                渲染进程 (Renderer)                   │
│  renderer.js → formController.js                   │
│             → organizerController.js               │
│             → rankingController.js                 │
│             → logController.js                     │
│             → stateController.js                   │
└─────────────────────────────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────────┐
│              爬虫核心 (src/core)                     │
│  scraperRunner.ts（任务主流程）                      │
│    → requestHandler.ts（HTTP请求/代理/镜像）        │
│    → queueManager.ts（并发队列管理）                │
│    → parser.ts（HTML解析）                          │
│    → magnetContentValidation.ts（磁力内容校验）     │
│    → fileHandler.ts（文件写入）                     │
└─────────────────────────────────────────────────────┘
```

### 关键设计原则

| 设计点 | 说明 |
|--------|------|
| 沙盒隔离 | Electron 渲染进程运行于 `sandbox: true`，通过 `contextBridge` 安全暴露 API |
| IPC 常量化 | 所有 IPC 通道名在 `ipcChannels.js` 中统一管理 |
| 并发队列 | 索引页/详情页/磁力/文件各自独立队列，互不阻塞 |
| 镜像容灾 | 多域名健康评分机制，自动切换到最优镜像 |
| 404 早停 | 索引页连续 404 时自动停止，避免无效重试死循环 |
| 断点续爬 | 任务状态持久化到 JSON，重启后自动恢复进度 |

---

## 目录结构说明

```
JAV-auto-source-v0.26/
├── desktop/                    # Electron 桌面端代码
│   ├── main.js                 # Electron 主进程入口
│   ├── preload.js              # 沙盒预加载脚本（contextBridge）
│   ├── common/                 # 主进程/渲染进程共享模块
│   │   ├── text/               # 文案、版本历史、应用信息
│   │   │   ├── appInfo.js      # 应用名称、版本、默认配置
│   │   │   ├── versionHistory.js  # 版本更新历史
│   │   │   └── uiText.js       # UI 文字常量
│   │   ├── ipcChannels.js      # IPC 通道名称常量（主进程侧使用）
│   │   ├── actressRankingService.js    # 女优排行榜业务逻辑
│   │   ├── actressRankingAvfanSource.js  # Avfan 排行榜数据源
│   │   ├── actressRankingOfficialSource.js  # FANZA 官方排行榜数据源
│   │   ├── actressRankingLocalHistory.js    # 本地历史记录管理
│   │   ├── javBusActressLookupService.js    # JavBus 女优信息查询
│   │   ├── actressRankingShared.js          # 排行榜共享工具函数
│   │   └── progressSchema.js               # 进度状态数据结构定义
│   ├── mainServices/           # 主进程服务层
│   │   ├── ipcHandlers.js      # IPC 消息处理器（主进程）
│   │   ├── runnerService.js    # 爬虫任务启停管理
│   │   ├── organizerService.js # 视频整理任务管理
│   │   ├── settingsStore.js    # 设置持久化存储
│   │   ├── windowService.js    # 窗口创建与管理
│   │   ├── runtimeState.js     # 运行时全局状态
│   │   ├── proxyValidationService.js  # 代理可用性验证
│   │   ├── logBridge.js        # 日志主进程转发桥
│   │   └── organizerModules/   # 视频整理子模块
│   │       ├── organizerScanModule.js      # 扫描阶段
│   │       ├── organizerMatchModule.js     # 番号匹配
│   │       ├── organizerRenameModule.js    # 重命名处理
│   │       ├── organizerCleanModule.js     # 清理空目录
│   │       └── organizerReportModule.js   # 报告生成
│   ├── renderer/               # 渲染进程（界面）
│   │   ├── index.html          # 主界面 HTML
│   │   ├── renderer.js         # 渲染进程入口，初始化所有控制器
│   │   ├── formController.js   # 爬虫配置表单主控制器
│   │   ├── organizerController.js  # 视频整理主控制器
│   │   ├── rankingController.js    # 排行榜控制器
│   │   ├── logController.js        # 日志面板控制器
│   │   ├── stateController.js      # 运行状态面板控制器
│   │   ├── uiText.js               # UI 文字注入（从 __desktopTextModules 读取）
│   │   ├── styles/                 # CSS 样式文件（按模块拆分）
│   │   └── assets/                 # 图标、背景等静态资源
│   └── resources/              # 打包资源（ffmpeg 等）
│
├── src/                        # 爬虫核心 TypeScript 源码
│   ├── core/
│   │   ├── scraperRunner.ts    # 爬虫任务主流程（索引页/详情页/磁力全生命周期）
│   │   ├── requestHandler.ts   # HTTP 请求处理（代理、镜像、重试、Cloudflare）
│   │   ├── queueManager.ts     # 并发队列管理（索引/详情/磁力/文件队列）
│   │   ├── parser.ts           # HTML 页面解析（影片列表、详情、磁力）
│   │   ├── magnetContentValidation.ts  # 磁力内容校验（DHT 探测，广告过滤）
│   │   ├── fileHandler.ts      # 抓取结果写盘（JSON、磁力文本、日志）
│   │   ├── config.ts           # 任务配置解析与验证
│   │   ├── constants.ts        # 全局常量定义
│   │   ├── crawlerConstants.ts # 爬虫专用常量（域名评分、冷却参数）
│   │   ├── requestHandlerBaseOriginUtils.ts  # 域名健康评分与冷却管理
│   │   ├── requestHandlerProxyManager.ts     # 代理轮换与失败检测
│   │   ├── requestHandlerCookieManager.ts    # Cookie 自动管理
│   │   ├── scraperRunnerRecoveryPipelineUtils.ts  # 断点恢复与重试评估
│   │   ├── taskStateManager.ts    # 任务状态持久化
│   │   ├── logFormatUtils.ts      # 统一日志格式化工具
│   │   ├── resultValidator.ts     # 抓取结果校验
│   │   └── ...（其他辅助模块）
│   ├── utils/                  # 通用工具函数
│   └── types/                  # TypeScript 类型定义
│
├── test/                       # 单元测试
│   ├── scraperRunner.test.js
│   ├── requestHandler.test.js
│   ├── magnetContentValidation.test.js
│   └── ...（共 18 个测试文件）
│
├── scripts/                    # 构建与辅助脚本
├── docs/                       # 历史开发文档
├── package.json                # 项目配置与依赖声明
└── tsconfig.json               # TypeScript 编译配置
```

---

## 技术栈与依赖

### 运行时环境
| 技术 | 版本 | 用途 |
|------|------|------|
| Electron | ^37 | Windows 桌面应用框架 |
| Node.js | ≥18 | JavaScript 运行时 |
| TypeScript | ^5.9 | 爬虫核心语言 |

### 核心依赖
| 依赖 | 用途 |
|------|------|
| axios | HTTP 请求（支持代理、超时、重试） |
| axios-retry | 请求自动重试策略 |
| cheerio | HTML 解析（jQuery 风格） |
| puppeteer-core | Cloudflare 验证页 JS 渲染 |
| magnet2torrent-js | DHT 磁力内容探测（广告过滤） |
| winston | 结构化日志记录 |
| commander | CLI 参数解析 |
| winreg | 读取 Windows 注册表（代理配置） |
| electron-builder | Electron 应用打包 |

### 构建输出
- **便携版（Portable）**：单 EXE 文件，无需安装，双击即用
- **安装版（NSIS Installer）**：带安装向导，支持桌面快捷方式、开始菜单、卸载

---

## 使用方法

### 直接运行（推荐）
1. 从 Releases 页面下载 `JAV自动化爬虫工具 0.26.0.exe`（便携版）
2. 双击运行，无需安装
3. 首次运行会在同目录创建 `JAV自动化爬虫工具输出/` 文件夹

### 爬虫使用流程
1. 打开软件，切换到「爬虫配置」标签页
2. 在「目标 URL」输入框粘贴女优主页地址（格式：`https://www.javbus.com/star/xxx`）
3. 按需设置：抓取数量上限、输出目录、代理服务器
4. 点击「开始运行」
5. 在「运行日志」标签页查看实时进度
6. 抓取完成后，在输出目录查看 `magnet-links.txt`（磁力链接）和 `latest-log.txt`（运行日志）

### 视频整理使用流程
1. 切换到「视频整理」标签页
2. 设置「视频目录」（本地已下载视频所在目录）
3. 选择整理方式（重命名/移动/清理）
4. 点击「开始整理」
5. 查看整理报告

### 代理配置
- 软件会自动读取 Windows 系统代理（注册表）
- 也可在配置面板手动输入：`http://127.0.0.1:7890`（格式）

---

## 配置说明

### 任务参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| 目标 URL | 女优主页地址 | — |
| 抓取数量上限 | 最多抓取的影片条数（0=不限制） | 0 |
| 并发详情页 | 同时抓取的详情页数量 | 5 |
| 输出目录 | 结果文件保存位置 | 桌面 |
| 代理服务器 | HTTP/SOCKS 代理地址 | 系统代理 |
| 断点续爬 | 是否从上次中断位置继续 | 开启 |

### 磁力过滤参数

| 参数 | 说明 |
|------|------|
| 内容校验 | 通过 DHT 探测验证磁力内容是否为广告 |
| AI 广告检测 | 使用 AI 模型检测视频帧广告内容 |
| 广告处理方式 | 删除 / 移到隔离目录 / 仅标记 |

---

## 版本历史

| 版本 | 更新内容 |
|------|---------|
| v0.26 | 代码架构模块化解耦、IPC通道常量化、统一错误分类体系、索引页404早停优化 |
| v0.25 | 抓取进度面板视觉升级，运行状态配色复刻整理结果风格，两模块 UI 统一 |
| v0.24 | 模块联动增强，整理版本更新与爬虫同步，配置面板精简与日志保留策略改进 |
| v0.23 | 内嵌 AI 广告检测模型上线（MobileNetV3/SqueezeNet/YOLOv8n） |
| v0.22 | 爬虫与视频整理一体化增强，广告处理可视化切换，补抓对账优化 |
| v0.21 | 新增磁力内容校验，自动跳过广告包并切换候选磁力 |

---

## 致谢

本项目爬虫核心基于 [raawaa/jav-scrapy](https://github.com/raawaa/jav-scrapy) 开发，感谢原作者的开源贡献。

---

*本软件仅供学习研究使用。*
