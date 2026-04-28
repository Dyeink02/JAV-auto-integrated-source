# 贡献指南

感谢你对本项目感兴趣！我们欢迎任何形式的贡献。

## 📋 贡献方式

### 1. 提交 Bug 报告
- 在 [Issues](https://github.com/raawaa/jav-scrapy/issues) 中搜索是否已有类似问题
- 如果没有，创建新的 Issue，包含：
  - 详细描述问题现象
  - 复现步骤
  - 预期行为
  - 实际行为
  - 日志文件（`%APPDATA%/jav-auto-crawler-tool/logs/`）
  - 系统信息（Windows 版本、Chrome 版本）

### 2. 提出功能建议
- 在 Issues 中标记为 `enhancement`
- 说明功能的使用场景和预期效果
- 如果有 UI 设计想法，可以附上截图或草图

### 3. 提交代码
- Fork 本仓库
- 创建功能分支：`git checkout -b feature/your-feature-name`
- 进行代码修改
- 运行测试确保不破坏现有功能：`npm test`
- 提交 Pull Request

### 4. 改进文档
- 修正文档中的错误或拼写
- 补充使用说明
- 添加使用教程或视频

## 🔧 开发环境搭建

### 前置要求
| 组件 | 版本要求 |
|------|---------|
| Node.js | 24.x 或更高 |
| npm | 11.x 或更高 |
| Git | 2.x 或更高 |
| Chrome/Chromium | 最新版（用于 Cloudflare 绕过） |

### 安装步骤
```bash
# 1. Fork 并克隆仓库
git clone https://github.com/YOUR_USERNAME/jav-scrapy.git
cd jav-scrapy

# 2. 安装依赖
npm install

# 3. 开发模式运行
npm run desktop:dev

# 4. 编译 TypeScript
npm run build

# 5. 运行测试
npm test
```

## 📝 代码规范

### 提交信息格式
本项目使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

```
<type>(<scope>): <subject>
```

**Type 类型**：
- `feat`：新功能
- `fix`：Bug 修复
- `docs`：文档更新
- `style`：代码格式调整（不影响逻辑）
- `refactor`：重构（既不是新功能也不是修复）
- `perf`：性能优化
- `test`：测试相关
- `build`：构建系统或外部依赖
- `ci`：CI 配置更改
- `chore`：其他修改

**示例**：
```bash
git commit -m "feat(organizer): 添加目录级快速删除功能"
git commit -m "fix(crawler): 修复分页补抓逻辑"
git commit -m "docs(readme): 更新安装说明"
```

### TypeScript 规范
- 启用严格模式（`strict: true`）
- 所有公开 API 必须有类型注解
- 避免使用 `any` 类型

### JavaScript 规范
- 使用 ES2020 语法
- 优先使用 `const` / `let`，避免 `var`
- 使用箭头函数处理 `this` 作用域
- 异步操作使用 `async/await`

### 文件命名
- TypeScript：`camelCase.ts`
- JavaScript：`camelCase.js`
- CSS：`kebab-case.css`
- 测试文件：`module.test.js`

## 🧪 测试要求

### 运行测试
```bash
# 运行所有测试
npm test

# 运行单个测试文件
npx mocha test/config.test.js
```

### 编写测试
- 新功能必须包含测试用例
- 测试文件放在 `test/` 目录下
- 测试文件命名：`模块名.test.js`

### 测试覆盖率
我们使用 Mocha 作为测试框架，目标是核心模块覆盖率达到 80% 以上。

## 🔀 分支策略

| 分支 | 用途 | 说明 |
|------|------|------|
| `main` | 主分支 | 稳定版本，可直接使用 |
| `develop` | 开发分支 | 正在开发的下一个版本 |
| `feature/*` | 功能分支 | 新功能开发 |
| `fix/*` | 修复分支 | Bug 修复 |
| `release/*` | 发布分支 | 准备发布的版本 |

### 工作流程
1. 从 `develop` 创建功能分支
2. 在功能分支上开发和测试
3. 提交 Pull Request 到 `develop`
4. 维护者审查后合并
5. 定期从 `develop` 创建 `release` 分支
6. 测试通过后合并到 `main` 并打标签

## 📦 发布流程

### 版本管理
使用语义化版本号（SemVer）：`MAJOR.MINOR.PATCH`

- **MAJOR**：不兼容的 API 变更
- **MINOR**：向后兼容的功能新增
- **PATCH**：向后兼容的 Bug 修复

### 发布步骤
```bash
# 1. 更新版本号（选择适当的类型）
npm run release:patch   # 0.26.0 → 0.26.1
npm run release:minor   # 0.26.0 → 0.27.0
npm run release:major   # 0.26.0 → 1.0.0

# 2. 自动生成 CHANGELOG
npm run changelog

# 3. 推送到远程仓库
git push --follow-tags

# 4. GitHub Actions 自动打包发布
```

## 🤝 行为准则

### 我们期望
- 使用友好和包容性的语言
- 尊重不同的观点和经历
- 优雅地接受建设性批评
- 关注对社区最有利的事情

### 不可接受的行为
- 使用性语言或图像
- 人身攻击
- 恶意或政治性评论
- 公开或私下骚扰

## 📚 学习资源

### 项目文档
- `README.md`：项目概述和快速开始
- `docs/软件说明书-*.md`：用户使用说明
- `docs/开发说明书-*.md`：开发者指南
- `docs/架构说明.md`：系统架构详解
- `docs/版本更新记录-*.md`：版本变更历史

### 外部资源
- [Electron 官方文档](https://www.electronjs.org/docs)
- [TypeScript 官方文档](https://www.typescriptlang.org/docs)
- [Cheerio 文档](https://cheerio.js.org/)
- [Puppeteer 文档](https://pptr.dev/)
- [ONNX Runtime 文档](https://onnxruntime.ai/docs/)

## ❓ 常见问题

### Q: 如何调试 Electron 主进程？
A: 使用 VSCode 的 Debug 配置，或添加 `console.log` 输出到日志文件。

### Q: 如何添加新的爬虫站点？
A: 在 `src/core/parser.ts` 中添加新的解析策略，确保 `Parser.parse()` 方法支持新站点的 HTML 结构。

### Q: 如何测试 AI 广告检测模型？
A: 在 `test/` 目录下创建测试用例，使用已知广告样本和正常样本验证模型输出。

### Q: 提交 PR 后多久会被审查？
A: 通常在 1-3 个工作日内。如果超过一周没有响应，可以在 Issue 中 @maintainer。

## 🙏 致谢

感谢所有为本项目做出贡献的开发者！

- [@qiusli](https://github.com/qiusli)
- [@Eddie104](https://github.com/Eddie104)
- [@leongfeng](https://github.com/leongfeng)
- 以及所有提交 Issue 和 PR 的用户

---

**再次感谢你的贡献！** 🎉
