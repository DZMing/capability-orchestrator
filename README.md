# capability-orchestrator

> Auto-routing plugin for Claude Code and Codex, with experimental OpenClaw and Hermes host adapters. Automatically matches user prompts to
> the right skill, command, or MCP tool using semantic + literal + cross-language
> matching. Zero config, zero dependencies.

[![CI](https://github.com/DZMing/capability-orchestrator/actions/workflows/ci.yml/badge.svg)](https://github.com/DZMing/capability-orchestrator/actions/workflows/ci.yml)

**一句话**：装上之后，Claude Code 或 Codex 每次开新会话自动知道你有哪些 skills / agents / plugins / MCP servers，并且在你输入 prompt 时自动匹配到最合适的工具。

当前版本除了 Claude Code / Codex 的正式宿主支持外，还已经具备：

- OpenClaw 运行态能力快照 + 路由接入
- Hermes 运行态能力快照 + 路由接入
- OpenClaw 实验 hook-pack + adapter 安装路径
- Hermes 实验 plugin 安装路径 + pre-LLM bridge

换句话说，OpenClaw / Hermes 已经不只是“被扫描的生态目录”，而是正在进入一等运行平台形态；但当前仍处于实验宿主路径，不应误读为和 Claude/Codex 同等级的正式支持。

## 30 秒上手

```bash
# 1. 安装（需要 Node.js 18+）
curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash

# 2. 重启 Claude Code 或 Codex，开一个新会话

# 3. 完成。你会看到代理自动感知环境能力，并根据你的 prompt 自动路由到对应 skill。
```

Windows Claude Code 原生环境：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

**装完后效果**：

- 开新会话时，Claude 自动收到一份”能力清单”（你装的 skills、plugins、MCP servers）
- 你说”帮我提交代码”，Claude 自动调用 `/commit` skill（而不是自己瞎写）
- 你说”review 一下代码”，Claude 自动调用 `/review` skill
- 你说”debug this error”，Claude 自动匹配到对应的调试工具

**卸载也简单**：

```bash
bash ~/.claude/plugins/cache/capability-orchestrator/install.sh --uninstall
```

---

## 适用对象

如果你符合下面这些情况，这个插件是合适的：

- 已经在 Claude Code 或 Codex 中使用项目级或用户级 skills
- 机器上还装有 OpenClaw 或 Hermes Agent，希望这些本地 skills 也被一起感知
- 希望代理能看到更多本地可用能力面
- 希望对 skills、legacy commands 和 MCP servers 加更严格的路由层
- 能接受插件通过修改 `~/.claude/settings.json` 或 `~/.codex/hooks.json` 来安装 hooks

## 不适用对象

如果你符合下面这些情况，这个插件并不适合：

- 需要 Windows 原生支持
- 需要 GUI 配置流程
- 不能接受安装器修改本地代理的 hook 设置
- 希望得到托管服务、远程控制面或依赖遥测的产品

## 兼容性

下面的兼容声明刻意保守，只反映当前仓库里已经文档化或验证过的事实。

| 维度              | 状态     | 说明                                                          |
| ----------------- | -------- | ------------------------------------------------------------- |
| Node.js           | 支持     | `>=18`                                                        |
| macOS             | 支持     | CI 和本地验证覆盖                                             |
| Linux             | 支持     | CI 覆盖                                                       |
| WSL               | 支持     | Codex on Windows 的推荐路径                                   |
| Windows 原生      | 部分支持 | Claude Code 原生安装支持；Codex 请使用 WSL2                   |
| Claude Code hooks | 支持     | 依赖 `SessionStart` 和 `UserPromptSubmit` hooks               |
| Codex hooks       | 支持     | Linux / macOS 原生支持；Windows 走 WSL2                       |
| OpenClaw host     | 实验中   | 运行态快照/路由、bootstrap hook 注入、adapter commands 已验证 |
| Hermes host       | 实验中   | 运行态快照/路由、pre-LLM 注入、slash bridge 已验证            |

## 安装会改什么

安装器会拉取仓库内容，并为当前平台注册两个 hooks。

它会做这些事：

- 安装到 `~/.claude/plugins/cache/capability-orchestrator` 或 `~/.codex/plugins/cache/capability-orchestrator`
- Claude Code：在 `~/.claude/settings.json` 中写入或更新 `SessionStart` / `UserPromptSubmit`
- Codex：在 `~/.codex/hooks.json` 中写入或更新对应 hooks
- OpenClaw（实验）：通过宿主 `plugins install` 安装 hook-pack + adapter bridge
- Hermes（实验）：通过宿主 `plugins install` 安装 plugin bridge
- 升级和卸载时保留无关 hook 条目
- 运行时会额外扫描 `~/.openclaw/workspace/skills/` 与 `~/.hermes/skills/`（可通过 `OPENCLAW_USER_DIR` / `HERMES_USER_DIR` 覆盖）

它不会做这些事：

- 不修改你的项目仓库文件
- 不引入后台 daemon 或本地数据库
- 运行时脚本不会主动发起网络请求
- 运行时脚本不会主动执行被扫描插件目录中的代码

## 安装（高级选项）

默认安装命令见上方"30 秒上手"。以下为高级场景：

```bash
# 安装指定版本（会完成 hook 注册）
CAPABILITY_INSTALL_REF=vX.Y.Z \
  curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash

# 安装未发布的 master 分支
curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash -s -- --channel=master

# 显式安装到 Codex
curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash -s -- --platform=codex

# 实验：显式安装到 OpenClaw
curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash -s -- --platform=openclaw

# 实验：显式安装到 Hermes
curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash -s -- --platform=hermes
```

注意：单纯把仓库 `git clone` 到插件目录只会落文件，不会注册 hooks。需要活跃安装时，请通过 `install.sh` 完成。
Windows 原生安装器当前只覆盖 Claude Code。Codex on Windows 请在 WSL2 内使用 `install.sh`。
OpenClaw / Hermes 当前仍标记为实验宿主路径：现在已经有真实安装、bridge 注入、宿主管理面和 route 证据，但还没升格成正式兼容承诺。

## 验证

验证 awareness 快照：

```bash
node ~/.claude/plugins/cache/capability-orchestrator/scripts/scan-environment.cjs --mode=awareness
```

验证路由解释：

```bash
printf '%s' '{"prompt":"输出当前环境的全部可用能力摘要","cwd":"."}' \
  | CLAUDE_USER_DIR="$HOME/.claude" \
    node ~/.claude/plugins/cache/capability-orchestrator/scripts/route-matcher.cjs --explain
```

期望现象：

- awareness 输出中包含环境能力分区
- explain 输出返回稳定 JSON
- Claude skill 命中结果是明确的 `/<skill-name>` 指令，Codex 则是 `$skill-name`
- 结果不会泄漏原始 `!command`

更完整的验证记录见 [VERIFICATION.md](VERIFICATION.md)。

如果要跑仓库内置的 live 验收脚本：

```bash
npm run verify:live:claude
npm run verify:live:codex
npm run verify:host:openclaw
npm run verify:host:hermes
npm run verify:host:lifecycle
npm run verify:release
```

说明：

- `verify:live:claude` 会先用 `install.sh` 注册隔离 hooks，再把当前工作区快照同步到隔离安装目录，并继承真实 `~/.claude/settings.json` 里的运行时 `model + env` 配置，然后用真实 `claude` CLI 抓取 stream-json 与 debug 日志；通过标准是同一条 `UserPromptSubmit` hook 响应里出现目标路由证据
- `verify:live:codex` 会先用 `install.sh` 注册隔离 hooks，再把当前工作区快照同步到隔离安装目录，并使用 ASCII 临时工作区别名执行真实 `codex exec`；通过标准是 fresh `route-log.jsonl` 里出现目标 skill 路由条目
- `verify:release` 会检查 package / plugin manifests / changelog 是否同步，并显式报告 `HEAD` 与最新 tag、工作树 clean/dirty 状态，以及最新 tag 对应的 GitHub Release 是否已真正发布；发布前需要人工检查这些字段，不只看退出码
- `verify:host:openclaw`：在隔离 `OPENCLAW_CONFIG_PATH` 下安装 hook-pack + adapter bridge，并验证宿主 config 写入、`hooks info`、bootstrap awareness 注入、adapter commands 暴露、以及卸载闭环
- `verify:host:hermes`：在隔离 `HERMES_HOME` 下把 Hermes adapter bridge 包装成临时 git repo，通过 `hermes plugins install file://...` 安装，并验证 `plugins list`、slash bridge、`pre_llm_call` 注入、disable/re-enable/remove 闭环
- `verify:host:lifecycle`：用当前工作区创建隔离临时 git 源，再通过 `install.sh` 跑 OpenClaw / Hermes 的 install、reinstall、bridge、管理和 uninstall 生命周期闭环

## 升级

升级到最新 release 的方式是重新执行安装器：

```bash
curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash
```

如果你显式使用的是 `master` 自用渠道，则升级命令也要带上 `--channel=master`：

```bash
curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash -s -- --channel=master
```

如果插件是从你自己维护的本地 checkout 安装的，请先更新那个 checkout，再重跑
你的常规验证命令。

## 回滚

回滚是手工流程，并沿用现有安装路径。

如果已安装副本是 git checkout：

```bash
git -C ~/.claude/plugins/cache/capability-orchestrator fetch --tags
git -C ~/.claude/plugins/cache/capability-orchestrator checkout vX.Y.Z
```

如果已安装副本不是 git checkout：

```bash
rm -rf ~/.claude/plugins/cache/capability-orchestrator
git clone --branch vX.Y.Z --depth=1 https://github.com/DZMing/capability-orchestrator.git \
  ~/.claude/plugins/cache/capability-orchestrator
```

Codex 安装把路径中的 `~/.claude` 替换成 `~/.codex` 即可。

把 `vX.Y.Z` 替换成你要回滚到的实际 tag。回滚后请重新执行上面的验证命令。

## 卸载

```bash
bash ~/.claude/plugins/cache/capability-orchestrator/install.sh --uninstall
```

Codex 安装则执行：

```bash
bash ~/.codex/plugins/cache/capability-orchestrator/install.sh --uninstall
```

它会删除已安装的插件目录，并移除由 `capability-orchestrator` 注册的 hook 条目。

## 使用

安装后可用的 skills：

- `/capability-orchestrator:capabilities`
  输出完整能力摘要，但不做路由判断。
- `/capability-orchestrator:orchestrate`
  扫描当前环境，并为复杂任务建议最合适的 skill 或 agent 路径。
- `/capability-orchestrator:debug-route`
  解释一条示例 prompt 为什么命中某个 skill、command、MCP server，或为什么
  被放行。
- `/capability-orchestrator:refresh`
  重新扫描环境，并对比新增了什么、移除了什么。

legacy command 的当前执行策略：

- 优先输出明确的 `/<command>` 调用指令
- 只有当命令名不适合直接作为 slash command 使用时，才回退到命令定义正文

## FAQ 与 Troubleshooting

### 安装器在完成前就失败了

先检查运行时：

```bash
node --version
```

期望结果：

- Node.js 主版本号是 `18` 或更高

如果安装器提示 `settings.json` 无法解析：

- 先修复损坏的 JSON
- 只有在 `~/.claude/settings.json` 恢复成合法 JSON 后再重跑安装器

安装器在这种情况下会 fail-safe，而不是覆盖原文件。

### 我的 Claude 设置里已经有 hooks 了

这是受支持的场景。

安装器只会更新或插入包含 `capability-orchestrator` 标记的条目，并保留同一文件
中的无关 hooks。

如果你想手工检查已安装条目：

```bash
cat ~/.claude/settings.json
```

你应当能看到一条 `SessionStart` 命令和一条 `UserPromptSubmit` 命令，它们都指向
`~/.claude/plugins/cache/capability-orchestrator`。

### 一条 prompt 没有按预期命中路由

使用 explain 模式：

```bash
printf '%s' '{"prompt":"你的原始 prompt","cwd":"."}' \
  | CLAUDE_USER_DIR="$HOME/.claude" \
    node ~/.claude/plugins/cache/capability-orchestrator/scripts/route-matcher.cjs --explain
```

期望结果：

- JSON 中包含 `action`、`reason`、`targetType`、`targetName`、
  `confidence`

如果 `reason` 是 `escaped`、`too-short` 或 `no-match`，通常说明当前行为
符合设计，而不一定是安装失败。

### 一条 prompt 命中了错误的目标

先确认这次路由来自哪一层：

- 字面量 `/command` 命中
- skill 名称命中
- 语义描述命中
- MCP fallback

对 legacy command 再额外确认它走的是哪条路径：

- `matched-command-literal`：直接命中了 `/<command>`
- `matched-command-semantic`：语义命中 command，但仍优先输出 `/<command>`
- `matched-command-fallback`：命令名不适合直接作为 slash command，回退到命令定义

提交 bug 报告时请附上 `--explain` 输出，并包含 prompt、期望目标、实际目标、
OS、Node.js 版本、Claude Code 版本、安装方式，以及是否自定义了
`CLAUDE_USER_DIR`。

### 插件扫描看起来不完整

对 `~/.claude/plugins/cache/` 的扫描是 best-effort，因为缓存结构没有正式文档。
插件会刻意容忍部分元数据缺失，而不是直接失败。

如果插件发现结果看起来不对，先确认系统其他部分仍然正常：

```bash
node ~/.claude/plugins/cache/capability-orchestrator/scripts/scan-environment.cjs --mode=awareness
```

然后把磁盘上的插件缓存结构和快照输出对照起来，再带着相关目录结构提交 bug。

## 安全、支持与发布策略

- [SECURITY.md](SECURITY.md) - 支持版本、漏洞报告方式和安全边界
- [SUPPORT.md](SUPPORT.md) - bug、使用问题和功能请求分别走哪条路径
- [RELEASE.md](RELEASE.md) - 版本策略、发布清单、tag 规则和手工回滚策略

## 仓库治理评估

- [OPEN_SOURCE_READINESS_AUDIT.md](OPEN_SOURCE_READINESS_AUDIT.md) - 基于本地
  证据与外部对标信号的仓库成熟度审计
- [ROADMAP.md](ROADMAP.md) - 后续改进 backlog 和下一波优先级

## 架构

见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 已知限制

- `~/.claude/plugins/cache/` 的插件缓存目录扫描是 best-effort，因为结构没有
  正式文档化
- `!command` 在 skill 渲染上下文中执行，CWD 是 Claude Code 的启动目录
- awareness 输出上限是 5000 字符，能力过多时会缩短 description
- `route-matcher --explain` 是调试入口，不替代真实 hook 流程
