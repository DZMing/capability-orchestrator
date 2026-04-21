# Host Contract Draft: OpenClaw

状态：draft
更新时间：2026-04-20

## 目的

冻结 OpenClaw 作为一等宿主平台时，`capability-orchestrator` 需要依赖的最小宿主契约。

## 已确认

- 用户目录基线：`~/.openclaw/`
- 现有仓库已扫描的 skills root：`~/.openclaw/workspace/skills/`
- 主配置文件：`$OPENCLAW_CONFIG_PATH`，默认 `~/.openclaw/openclaw.json`
- 默认 workspace：`~/.openclaw/workspace`
- OpenClaw 有宿主级 hooks，且 `openclaw hooks list|info|check|enable|disable` 可用
- OpenClaw 有 plugin / command 面，不只是 skills
- Gateway 会 watch config，但 `gateway` / `discovery` / `canvasHost` / `plugins`
  等关键配置改动仍属于 restart-sensitive 类别
- 插件 discovery precedence 明确存在：配置路径 → workspace extensions →
  global extensions → bundled plugins
- 插件 enablement 与 discovery 分离，需要建模 `enabled/disabled/not-enabled`
- skills precedence 明确存在：workspace > project agent skills > personal skills >
  `~/.openclaw/skills` > bundled > `skills.load.extraDirs`
- 本机实测：`openclaw skills list --json`、`openclaw plugins list --json`、
  `openclaw hooks list --json` 都可用，可直接作为 runtime snapshot 证据源
- 本机实测：`openclaw plugins inspect <id>` 会暴露 plugin 的
  `Commands / CLI commands / Typed hooks / Tools / Capability mode / Shape`
  等运行态能力信息
- 本机实测：把当前仓库根目录当兼容 bundle 安装会被危险代码扫描拦截
- 本机实测：即使做瘦 bundle，只要 bundle 内仍包含 `child_process` 模式，仍会被拦截
- 本机源码证据：hook pack 安装要求 `package.json` 内存在 `openclaw.hooks`
- 本机源码证据：每个 hook 目录至少需要 `HOOK.md`，handler 候选是
  `handler.ts` / `handler.js` / `index.ts` / `index.js`
- 本机实测：最小 hook-pack skeleton 已能通过
  `openclaw plugins install <path> --link`
  在隔离 config 下真实写入：
  - `hooks.internal.load.extraDirs`
  - `hooks.internal.entries.<hook>.enabled`
  - `hooks.internal.installs.<pack-id>`
- 本机实测：同一隔离 config 下，安装后立刻执行
  `openclaw hooks info capability-orchestrator-bootstrap`
  仍未命中，说明“写入 install record”与“runtime 已发现 hook”之间还存在
  restart / loader 语义需要进一步钉死

## 必须钉死的契约

### 配置

- 主配置文件精确路径
- 配置格式
- 需要写入 capability-orchestrator 的字段
- 是否支持 schema 验证

### Hooks / Events

- hooks 的真实存储位置
- hooks 的启用/禁用模型
- workspace hooks 与 plugin-managed hooks 的区别
- 哪些变更需要 restart
- CLI 是否能读取同一套 hooks
- plugin-managed hooks 不能通过普通 hook enable/disable 直接切换，而要通过所属
  plugin 控制

### Commands

- skill 自动映射 slash command 的规则
- plugin 注册 slash command 的规则
- `commands.nativeSkills`
- `/plugins`
- `/mcp`
- `/config`
- 哪些命令是宿主内建、哪些是插件动态注册
- 哪些命令在不同 channel/provider 下行为不同
- `openclaw plugins inspect <id>` 是否应作为 command/cli command 的权威来源

### Plugins

- plugin discovery roots
- plugin enablement config
- plugin precedence
- plugin-shipped skills 是否进入宿主技能池
- `plugins list` 或等价 CLI 是否能作为验证入口
- 兼容 bundle 安装是否允许当前 capability-orchestrator 以“瘦 bundle”形态通过安全扫描

### Verification

- 非交互 CLI 入口
- 列出 hooks 的 CLI
- 列出 plugins 的 CLI
- 列出 skills / commands 的 CLI
- `openclaw status`
- `openclaw hooks list`
- `openclaw hooks check`
- `openclaw gateway status`
- `openclaw doctor`
- `openclaw plugins list`
- `openclaw plugins inspect`
- `openclaw config show|get|set|unset`
- `openclaw config file`
- `openclaw config schema`
- `openclaw config validate`
- `openclaw skills list --json`
- `openclaw plugins list --json`
- `openclaw hooks list --json`
- `openclaw hooks info <hook>`
- `openclaw hooks check`

## 保守处理规则

在这些点没有固定前，不应：

- 声称 OpenClaw 已被正式支持为一等宿主
- 在安装器里写死 OpenClaw hook 持久化逻辑
- 在 CI 里把 OpenClaw host smoke 当成 release blocker
- 假设 config 写入后所有能力面都会立即生效
- 假设当前整个 repo 可以直接作为 OpenClaw 兼容 bundle 安装
- 把“hook-pack install 成功”直接等同于“hook 已被 runtime 发现并可执行”
