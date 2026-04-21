# Host Contract Draft: Hermes Agent

状态：draft
更新时间：2026-04-20

## 目的

冻结 Hermes Agent 作为一等宿主平台时，`capability-orchestrator` 需要依赖的最小宿主契约。

## 已确认

- 用户目录基线：`~/.hermes/`
- 现有仓库已扫描的 skills root：`~/.hermes/skills/`
- 主配置文件：`~/.hermes/config.yaml`
- 环境文件：`~/.hermes/.env`
- 配置优先级：CLI args > `config.yaml` > `.env` > built-in defaults
- Hermes 有 plugin runtime
- Hermes 也有 slash commands / plugin commands，不只是 skills
- `skills.external_dirs` 已存在，且本地 `~/.hermes/skills/` 会覆盖 external dirs 中同名技能
- plugin discovery sources 至少包括 bundled、用户插件、项目插件、pip entry points
- discovery 不等于 activation；只有进入 `plugins.enabled` 的插件才应视为 enabled
- 原生 Windows 不支持；官方边界是 Linux / macOS / WSL2
- 本机实测：`hermes skills list` 与 `hermes plugins list` 都可稳定作为 runtime
  snapshot 证据源
- 本机实测：当前环境里 `hermes plugins list` 可见一个 `local` 源插件 `cache`

## 必须钉死的契约

### 配置

- 主配置文件精确路径
- 配置格式
- `plugins.enabled` / `plugins.disabled`
- `skills.external_dirs`
- project plugins 是否默认启用
- `HERMES_ENABLE_PROJECT_PLUGINS` 的作用范围
- `config migrate` 是否需要纳入安装器或 verify 路径

### Hooks / Runtime

- `~/.hermes/hooks/` 是否只在 gateway 生效
- plugin hooks 是否通过 `register_hook()` 注入
- CLI 路径是否读取 gateway hooks
- gateway hooks 与 plugin hooks 的职责边界
- 哪些变更需要 restart
- 哪些变更只需 `/reload`
- 哪些变更只需 `/reload-mcp`

### Commands

- skill 自动变 slash command 的规则
- plugin 注册 slash commands 的规则
- plugin 注册 CLI subcommands 的规则
- 哪些命令是静态磁盘来源，哪些是运行时注入
- CLI 顶层命令与 plugin-added CLI subcommands 的区分

### Plugins

- global plugin roots
- project plugin roots
- entry-point / packaged plugin sources
- discovery 与 enablement 的区别
- enabled plugin 的最终判定方式
- `HERMES_ENABLE_PROJECT_PLUGINS=1` 缺失时的保守处理

### Verification

- `hermes config show`
- `hermes config path`
- `hermes config check`
- `hermes config migrate`
- `hermes plugins list`
- `hermes skills list`
- `hermes status`
- `hermes doctor`
- `hermes gateway status`
- `hermes gateway run`
- `hermes chat -s ...` 或等价非交互入口
- 列举 skills / commands / plugin 状态的 CLI

## 保守处理规则

在这些点没有固定前，不应：

- 声称 Hermes 已被正式支持为一等宿主
- 把 Hermes gateway hooks 误当成 CLI hooks
- 在安装器里写死 Hermes plugin/hook 行为
- 在 release 文档里把 Hermes host support 写成已完成
- 把 Linux/macOS/WSL2 之外的 OS 面写成正式支持
- 假设 plugin / hook 变更统一支持热更新
