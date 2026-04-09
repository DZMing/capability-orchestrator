# Changelog

## [1.1.0] - 2026-04-09

### Added

- 三级插件结构扫描（vendor/name/version/），覆盖真实 Claude Code 插件缓存
- MCP server description 字段读取，disabled server 自动过滤
- 插件内 skill description 提取（之前只取目录名）
- 降级策略 top-15 折叠（替代无信息量的纯计数）
- 插件多版本去重（按版本号保留最新）
- LICENSE 文件
- CONTRIBUTING.md 贡献指南
- CHANGELOG.md

### Fixed

- 降级策略导致 skills 信息归零（"118 个"无路由价值）

## [1.0.0] - 2026-04-09

### Added

- 核心扫描引擎：skills / agents / plugins / MCP servers / commands
- 三个 skill：capabilities / orchestrate / refresh
- 一键安装脚本（git clone / curl 双模式）
- SessionStart hook 自动注入
- 多级降级渲染（route / list 模式）
- sanitize 防 prompt injection
- 61 项测试（单元 + 安装冒烟 + 幂等性）
- GitHub Actions CI（Node 18/22, ubuntu/macOS）
