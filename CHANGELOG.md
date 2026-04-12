# Changelog

## [1.4.0] - 2026-04-12

### Added

- 插件 skill 路由：route-matcher 现在扫描 `~/.claude/plugins/cache/` 中安装的插件 skill
- 匹配置信度评分：findBestMatch 返回 confidence (0-1) 字段
- stdin CWD 解析：SessionStart 和 UserPromptSubmit hook 均从 stdin JSON 读取项目目录
- route-matcher 测试纳入 CI 流水线
- 15 项新测试：中文分词、插件路由、置信度、CWD 解析、符号链接安装

### Fixed

- 中文分词：CJK 文本拆为单字 + bigrams，修复中文匹配完全失效
- createOutput 注入防护：skill description 经 sanitize 清洗
- readStdin 进程挂起：超时后 unref stdin 确保进程退出
- 停词 "做"/"什么"/"要" 过度激进导致中文 false negative
- install.sh `&&`/`||` 条件链优先级 bug 改为 if/elif/fi

### Changed

- 测试总数从 149 项增至 164 项

## [1.3.0] - 2026-04-12

### Added

- UserPromptSubmit hook 实时路由：每条用户消息自动匹配 skill 并注入强制调用指令
- route-matcher.cjs 核心匹配器（关键词提取、逃逸检测、故障开放）
- awareness 模式 skill 展示升级：名字 + 描述（供路由匹配使用）
- 35 项新测试：route-matcher 单元测试 + 端到端子进程测试

### Changed

- 路由策略升级为强制路由规则（`<MANDATORY>` 包裹，匹配到 skill 必须调用）
- install.sh 新增 UserPromptSubmit hook 注册 + 卸载清理
- 安装测试新增 4 项断言（route-matcher 存在/可执行、hook 注册/卸载）

## [1.2.0] - 2026-04-09

### Added

- renderSection 导出供测试使用
- 魔法数字提取为顶层常量（TOP*N / MAX_PLUGIN_DEPTH / AWARENESS*\*\_DESC）
- 安全审计注释（UNSAFE_UNICODE ReDoS 分析、WSL execSync 注入防护、ENOENT 静默策略）
- 18 项新测试：renderSection level 0-4、scanAgents/scanCommands 边界、isPluginRoot 全路径、awareness 空快照/错误 footer、EACCES 权限、collectSnapshot undefined projectDir

### Changed

- 测试总数从 111 项增至 129 项（109 unit + 14 install + 6 idempotent）

## [1.1.0] - 2026-04-09

### Added

- awareness 渲染模式：SessionStart hook 差异化注入（MCP 描述 + agent 描述 + 路由策略）
- 三级插件结构扫描（vendor/name/version/），覆盖真实 Claude Code 插件缓存
- MCP server description 字段读取，disabled server 自动过滤
- 插件内 skill description 提取（之前只取目录名）
- 降级策略 top-15 折叠（替代无信息量的纯计数）
- 插件多版本去重（按版本号保留最新）
- install.sh: --version / --uninstall 支持、符号链接保护
- CLI --mode 白名单校验（无效模式 exit 1）
- 15 项回归 + 8 项边界测试
- LICENSE / CONTRIBUTING.md / CHANGELOG.md

### Fixed

- awareness 路由策略截断保护（预留空间保证不被截断）
- JSON 注释剥离正确处理连续转义反斜杠（`\\"`）
- block scalar 含空行不再截断解析
- semver 比较支持 v 前缀和 4 段版本号
- tryReadHead UTF-8 多字节截断产生的 U+FFFD
- extractServers 对非 object 值（null / array / string）不崩溃
- getDescription 全局 frontmatter 正则与 extractFrontmatter 对齐
- MCP 跨级别去重（项目级优先，用户级同名跳过）
- sanitize: HTML entities 解码防护、heading 正则精确化、C# 不误伤
- isSymlink fail-safe 返回 true（异常时宁可跳过）
- WSL 路径获取拆两步（避免嵌套 shell 替换）
- MCP description 未经 sanitize 的注入漏洞

### Changed

- 降级策略导致 skills 信息归零（"118 个"无路由价值）→ top-15 折叠
- ARCHITECTURE.md / README.md 更新设计定位从纯感知到"感知 + 路由引导层"
- install.sh 条件语法统一为 `[[ ]]`

## [1.0.0] - 2026-04-09

### Added

- 核心扫描引擎：skills / agents / plugins / MCP servers / commands
- 三个 skill：capabilities / orchestrate / refresh
- 一键安装脚本（git clone / curl 双模式）
- SessionStart hook 自动注入
- 多级降级渲染（route / list 模式）
- sanitize 防 prompt injection
- 56 项测试（单元 + 安装冒烟 + 幂等性）
- GitHub Actions CI（Node 18/20/22, ubuntu/macOS）
