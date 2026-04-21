# OpenClaw / Hermes Host Platform Plan

更新时间：2026-04-20

## 目标

把 `capability-orchestrator` 从“Claude Code / Codex 的能力编排插件，顺带扫描
OpenClaw / Hermes skills”提升为：

- Claude Code
- Codex
- OpenClaw
- Hermes Agent

四个**一等宿主平台**共享的一套能力感知 + 路由编排层。

这里的“一等宿主平台”指：

- 有自己的安装入口
- 有自己的宿主配置写入点
- 有自己的 hook / 事件注入路径
- 有自己的插件缓存 / 数据目录
- 能独立做 install / upgrade / uninstall / verify
- 不依赖 Claude / Codex 去“借用”它们的能力

## 当前状态

当前仓库已经实现：

- Claude Code：原生宿主支持
- Codex：原生宿主支持
- OpenClaw：只读扫描 `skills`
- Hermes：只读扫描 `skills`

当前**没有**实现：

- OpenClaw 作为宿主平台安装 capability-orchestrator
- Hermes 作为宿主平台安装 capability-orchestrator
- OpenClaw / Hermes 宿主配置写入
- OpenClaw / Hermes 宿主 hook / 事件注册
- OpenClaw / Hermes 宿主 slash commands 扫描并纳入路由池
- OpenClaw / Hermes 插件目录扫描并纳入路由池
- OpenClaw / Hermes 宿主 live verify

## 已确认缺口

当前平台抽象仍是二元模型：

- `claude`
- `codex`

直接影响面：

- `scripts/lib/platform.cjs`
- `scripts/lib/user-dir.cjs`
- `scripts/install-hooks.cjs`
- `install.sh`
- `install.ps1`
- `scripts/live-verify.cjs`
- README / ARCHITECTURE / VERIFICATION

## 外部研究结论

### 已确认

1. 现在的实现边界只覆盖 Claude/Codex 作为宿主。
2. OpenClaw / Hermes 目前只作为“兼容扫描面”进入快照和路由池。
3. 继续往前做，核心不是补文案，而是做“宿主适配层”。

### 公开资料给出的方向性信号

公开资料表明，OpenClaw 与 Hermes 都不是“只有 skills 的目录”；它们各自也有
宿主级配置、slash commands、以及插件/扩展概念。

目前已拿到的宿主级锚点包括：

- OpenClaw：
  - config 默认在 `~/.openclaw/openclaw.json`
  - workspace 默认在 `~/.openclaw/workspace`
  - host hooks / plugins / commands 都有宿主级 CLI
- Hermes：
  - config 默认在 `~/.hermes/config.yaml`
  - env 文件在 `~/.hermes/.env`
  - `skills.external_dirs`、`plugins.enabled`、gateway hooks、plugin hooks 都是正式概念
  - Windows 原生不应承诺，官方边界是 Linux / macOS / WSL2

但在当前仓库里，还没有把这些宿主契约 pin 成稳定实现依赖。因此真正开工前，
必须先把两件事做成明确契约：

- OpenClaw 的宿主配置文件、hook / 事件入口、插件发现约定
- Hermes 的宿主配置文件、hook / 事件入口、插件发现约定

在这些契约没有被固定之前，不应直接写死安装器行为。

### 这轮深度研究后新增确认的漏项

下面这些点如果不提前纳入设计，后面就会出现“看起来支持了宿主，实际上只支持了一半”：

1. **命令面不是一个概念**

- OpenClaw 有：
  - skill 变成 slash command
  - plugin 自己注册的 slash commands
  - `commands.nativeSkills`
  - `/plugins`
  - `/mcp`
  - `/config`
- Hermes 有：
  - 每个已安装 skill 自动变成 slash command
  - plugin 注册的 slash commands
  - plugin 注册的 CLI subcommands

所以后续不能只抽象一个 `commandsDir`，而要区分：

- 用户写在磁盘上的 slash command roots
- 由 plugin 动态注册出来的命令
- 宿主内建命令面
- 非交互 CLI subcommands（尤其是 Hermes）

建议的统一 capability entity 模型：

- `skill`
- `slash_command`
- `builtin_command`
- `plugin_command`
- `cli_subcommand`

每条 capability 至少应有：

- `host`
- `surfaceType`
- `source`
- `state`（`discovered` / `enabled` / `loaded`）
- `invocation`
- `restartRequirement`
- `scope`（`project` / `workspace` / `user` / `bundled` / `plugin`）

2. **Hook 语义明显不同**

- OpenClaw：
  - hook 是宿主一级概念
  - 配置保存在 `~/.openclaw/openclaw.json`
  - workspace hooks 默认不启用，需要显式 enable
  - plugin-managed hooks 不能像普通 hooks 那样单独 enable/disable，要通过 plugin 控制
  - 某些变更要求 gateway restart
- Hermes：
  - `~/.hermes/hooks/` 里的 gateway hooks 只在 gateway 生效
  - CLI 不加载 gateway hooks
  - 想要 CLI + gateway 都生效，要走 plugin hooks（`ctx.register_hook()`）

所以 capability-orchestrator 不能假设“一个 hook 写入点 = 所有宿主都一样”。

3. **插件发现 != 插件启用**

- OpenClaw：
  - discovery 和 enablement 分离
  - 插件有 precedence
  - workspace/global/bundled/config-path 有不同来源
- Hermes：
  - discovery 找到后默认也可能不加载
  - `plugins.enabled` 才决定真正启用
  - project plugin 还受 `HERMES_ENABLE_PROJECT_PLUGINS=true` 约束

所以后续扫描层至少要区分：

- discovered plugin
- enabled plugin
- loaded plugin

否则快照和真实运行态会错位。

4. **skills roots 也不是固定单目录**

- OpenClaw skill root 不只是 `~/.openclaw/workspace/skills/`
  还和 active workspace、plugin-shipped skills、extra dirs、ClawHub 安装路径相关
- Hermes 不只是 `~/.hermes/skills/`
  还支持 `skills.external_dirs`，plugin 也能 `register_skill()`

所以如果想做成一等宿主，不能把当前“单目录扫描”直接升级为宿主支持。

5. **setup / config repair surfaces 也是宿主能力面**

- OpenClaw 有 `setup-entry.ts` 这类 setup-only surface
- OpenClaw config schema 可直接作为机器契约读取
- Hermes `config migrate` / `config show` 会参与 skill/plugin 配置落地

这意味着安装器不只是“写 hooks”，还要考虑：

- 未配置但可引导的宿主状态
- setup-only 模式
- 配置修复/迁移行为

6. **restart / hot reload 行为不同**

- OpenClaw config 文件会被 gateway watch，但 hooks / plugins 某些变更仍要求 restart
- Hermes gateway hooks 在 gateway startup 扫描；plugin hooks 则依赖 plugin 加载

所以后续安装/升级/卸载输出必须是 host-aware 的，明确告诉用户：

- 已立即生效
- 需要 restart
- 需要重新打开会话

7. **宿主级扩展运行时本身不同**

- OpenClaw 的插件开发契约是 TypeScript / ESM + `openclaw.plugin.json`
- Hermes 的插件开发契约是 Python + `plugin.yaml` + `__init__.py`

同时，这轮研究还发现了一个重要分叉：

- OpenClaw 原生支持 **兼容 bundle**，包括 Claude/Codex 风格的插件/skills 目录
- 这意味着 OpenClaw 可能可以先通过“兼容 bundle 安装 + 宿主 config/hook 对接”落地
- Hermes 目前看仍更像需要原生 Python adapter

但这里已经出现了一个实际 blocker：

- 直接把当前仓库根目录作为 OpenClaw 兼容 bundle 安装时，会被 OpenClaw 的危险代码扫描拦截
- 原因是仓库包含 `child_process` 等模式，OpenClaw 会把它视为 bundle-level dangerous code
- 因此 OpenClaw 不能直接复用“当前整个 repo 作为可安装 bundle”的方式

这意味着 OpenClaw 路线必须在下面两种里二选一：

1. 做一个 **瘦身的兼容 bundle**，只打包允许进入 OpenClaw 的最小运行面
2. 做一个 **原生 OpenClaw adapter**，把高风险 Node 逻辑隔离在 bundle 外

本机进一步取证后，已经知道 OpenClaw hook pack 的最小契约包括：

- `package.json` 里的 `openclaw.hooks`
- 每个 hook entry 指向包内 hook 目录
- hook 目录里至少有 `HOOK.md`
- handler 候选文件：
  `handler.ts` / `handler.js` / `index.ts` / `index.js`
- 最小 hook-pack skeleton 已经能在隔离 config 下真实安装，并写入
  `hooks.internal.load.extraDirs`
  `hooks.internal.entries.*`
  `hooks.internal.installs.*`
- 但安装后立刻 `openclaw hooks info <hook>` 仍未命中，说明 hook-pack 的
  runtime 发现还有 restart / loader 语义需要继续确认

本机进一步取证后，还确认了：

- `openclaw plugins inspect <id>` 能直接给出某个 plugin 的
  `Commands / CLI commands / Typed hooks / Tools / Shape / Capability mode`
- 因此 OpenClaw 的命令面不必只靠磁盘目录猜，可以用 inspect 作为运行态权威来源
- Hermes 当前也已有稳定的运行态列表面：
  `hermes skills list`
  `hermes plugins list`

所以后续 OpenClaw 安装实现不能只写 config，还必须决定：

- 走 plugin bundle
- 走 hook pack
- 或两者组合

这意味着“让它们成为一等运行平台”很可能不是只靠当前 Node CLI 安装器就能完成，
而是需要：

- OpenClaw 原生适配层
- Hermes 原生适配层
- 再由这两层桥接到共享的 capability-orchestrator 核心

如果不承认这一点，后面会把“宿主支持”误做成一堆脆弱的 shell/config hack。

## 总体策略

采用“**先抽宿主层，再逐个平台接入**”的路线，而不是继续在现有
`claude` / `codex` 分支上堆特例。

默认架构假设：

- 共享核心仍保留在当前 Node.js 代码里
- OpenClaw 优先尝试“瘦身兼容 bundle”路线；如果危险代码扫描仍无法接受，再补原生 TS/ESM host adapter
- Hermes 通过原生 Python host adapter 接入
- 适配层负责宿主 hook / command / plugin runtime
- 共享核心负责 capability normalization / matching / rendering

### 核心设计目标

1. 宿主适配层统一
2. 安装器支持按宿主分发
3. 扫描层支持宿主特有目录
4. 路由层支持宿主特有调用前缀/契约
5. 验证层支持宿主特有 smoke/live verify
6. skills / plugins / slash commands 三种能力面都按宿主分别建模

## 分阶段计划

### Phase 0: 宿主契约冻结

目的：
在真正改代码之前，先把 OpenClaw / Hermes 的宿主契约固定下来。

必须确认的内容：

- 用户目录默认位置
- 配置文件路径和格式
- hook / 事件注入机制
- 插件缓存或插件安装目录
- skills / agents / commands / plugins / MCP 等能力面分别在哪里
- 宿主 CLI 的非交互入口
- 最小可验证的“新会话注入能力摘要”路径
- 最小可验证的“单条 prompt 路由”路径

输出物：

- `docs/host-contract-openclaw.md`
- `docs/host-contract-hermes.md`

停止条件：

- 如果任一宿主没有稳定公开契约，进入“实验支持”方案，不直接承诺正式支持。

### Phase 1: 宿主抽象重构

目的：
把当前 `claude/codex` 二元平台模型提升为可扩展的宿主描述模型。

改动目标：

- `scripts/lib/platform.cjs`
- `scripts/lib/user-dir.cjs`
- `scripts/install-hooks.cjs`
- `scripts/lib/scan-core.cjs`
- `scripts/route-matcher.cjs`

需要落的抽象：

- `hostId`
- `configDir`
- `configFile`
- `hookStorageKind`
- `hookRuntimeKind`
- `projectSkillsDir`
- `projectAgentsDir`
- `projectCommandsDir`
- `userCommandsDir`
- `workspaceResolver`
- `externalSkillDirsResolver`
- `pluginMarker`
- `pluginCacheDir`
- `pluginDiscoveryRoots`
- `pluginEnablementModel`
- `pluginDataEnv`
- `userDirEnv`
- `invocationStyle`
- `restartRequirement`
- `capabilityEntityModel`

验收标准：

- 不改变现有 Claude/Codex 行为
- 所有现有测试继续通过
- 可以在单元测试里声明性添加 `openclaw` / `hermes` host fixtures

### Phase 2: OpenClaw 宿主支持

目的：
让 OpenClaw 成为 capability-orchestrator 的原生宿主。

范围：

- OpenClaw 平台识别
- OpenClaw 用户目录解析
- OpenClaw 安装目录和卸载路径
- OpenClaw hook / 事件写入
- OpenClaw plugin 扫描
- OpenClaw slash commands 扫描
- OpenClaw enabled/disabled plugin 状态识别
- OpenClaw workspace roots / plugin-shipped skills / nativeSkills 行为识别
- OpenClaw host verify

建议优先级：

- 先做 macOS/Linux
- Windows 只有在 OpenClaw 官方宿主契约明确后再承诺

验收标准：

- `install.sh --platform=openclaw` 可完成真实安装
- OpenClaw 配置文件被正确写入且可回滚
- `scan-environment` 能在 OpenClaw 宿主上产生能力摘要
- `route-matcher` 能在 OpenClaw 宿主上给出稳定路由结果
- OpenClaw 宿主 slash commands 能进入匹配池并产出正确调用前缀
- OpenClaw 快照至少能区分 discovered plugins 与 enabled plugins
- 安装/卸载输出能明确提示哪些改动需要 gateway restart
- uninstall 只移除本插件注入条目

### Phase 3: Hermes 宿主支持

目的：
让 Hermes Agent 成为 capability-orchestrator 的原生宿主。

范围：

- Hermes 平台识别
- Hermes 用户目录解析
- Hermes 配置写入
- Hermes hook / 事件写入
- Hermes plugin 扫描
- Hermes slash commands 扫描
- Hermes gateway hooks 与 plugin hooks 的适用范围区分
- Hermes `skills.external_dirs` 与 project plugins 行为识别
- Hermes host verify

验收标准：

- `install.sh --platform=hermes` 可完成真实安装
- Hermes 配置文件被正确写入且可回滚
- Hermes skills + plugins 都进入 snapshot / route 池
- Hermes slash commands 进入 snapshot / route 池
- Hermes 快照能区分 discovered plugin 与 enabled plugin
- Hermes CLI / gateway 哪条路径真正触发 capability-orchestrator，要在文档和验证里说清
- uninstall 和 upgrade 行为稳定

### Phase 4: 多宿主验证矩阵

目的：
把“支持”变成可重复验证的证据，而不是文案。

最少需要的验证层：

1. 单元测试

- 平台识别
- 用户目录解析
- hook 写入/清理
- scan roots
- route pool 组合
- slash command 发现与调用前缀
- discovered vs enabled plugin 状态
- workspace / external_dirs / plugin-shipped skills precedence

2. 安装 smoke

- Claude
- Codex
- OpenClaw
- Hermes

3. 幂等 / 卸载

- 重复安装不漂移
- uninstall 只移除 owned hooks

4. live verify

- 宿主 CLI 或宿主日志上能证明 SessionStart / prompt route 真正生效

5. CI

- macOS
- ubuntu-latest
- windows-latest（仅在宿主官方支持明确时开启）

## 风险分级

### 高风险

- OpenClaw / Hermes hook 机制如果不是文件型配置，而是内部数据库或私有 IPC
- 插件目录结构如果未文档化且跨版本变化大
- 宿主 prompt hook 如果没有稳定的非交互入口
- 宿主“命令面”如果大部分来自动态注册而不是磁盘目录，route snapshot 可能只能拿到运行态而不是静态配置态

### 中风险

- 平台调用前缀不同，导致现有路由输出约定不适配
- 宿主对 `skills` / `plugins` / `agents` 的命名规范和 Claude/Codex 不同

### 低风险

- 路径扩展
- 只读扫描扩展
- 文档矩阵扩展

## 非目标

这一轮不做：

- 强行统一四个宿主的内部行为细节
- 没有公开契约时就承诺 Windows 原生支持
- 在没有真实宿主验证之前宣称“已支持”

## 推荐执行顺序

1. 先做 Phase 0，把 OpenClaw/Hermes 宿主契约固定
2. 再做 Phase 1，把平台抽象升维
3. 然后先接 OpenClaw 宿主
4. 再接 Hermes 宿主
5. 最后扩 live verify / CI / 文档 / release

## Phase 0 现在必须补充的契约清单

### OpenClaw

- `~/.openclaw/openclaw.json` 的最小写入字段
- JSON5 兼容边界
- `openclaw config schema` 是否可作为自动化验证契约
- workspace hooks 与 plugin hooks 的 enable / disable / restart 规则
- `commands.nativeSkills` / `commands.plugins` / `commands.mcp` / `commands.config` 哪些默认关闭
- `plugins.entries.<id>` 的 enabled/config 语义
- plugin-shipped skills 如何进入最终 skill pool
- `openclaw plugins list --json`
- `openclaw hooks list --json`
- `openclaw skills list`
- `openclaw status`
- `openclaw config file`
- `openclaw config schema`
- `openclaw config validate`

### Hermes

- `~/.hermes/config.yaml` 最小写入字段
- `~/.hermes/.env` 与 `config.yaml` 的优先级边界
- `plugins.enabled` / `plugins.disabled`
- `~/.hermes/plugins/`、`.hermes/plugins/`、pip entry points 的优先级
- `HERMES_ENABLE_PROJECT_PLUGINS`
- `~/.hermes/hooks/` gateway hooks 与 plugin hooks 的实际职责边界
- `skills.external_dirs`
- `hermes plugins list`
- `hermes config show`
- `hermes gateway status`
- `hermes gateway run`
- `hermes chat -s ...` / CLI 验证入口

## 本轮完成定义

当前这份计划完成的定义是：

- 已明确当前边界不是文案问题，而是宿主支持缺失
- 已把后续工作拆成宿主契约、平台抽象、逐宿主接入、验证矩阵四个阶段
- 已给出每阶段的目标、改动面、风险和验收标准

下一步不是继续空谈，而是直接进入 **Phase 0 宿主契约冻结**。
