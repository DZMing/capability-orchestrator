# ARCHITECTURE

## 设计哲学

Claude Code 本身就是路由器——它的 agent loop 已经会根据上下文选工具、选 skill、选 subagent。

但路由器再聪明，**看不到菜单就点不了菜**。

这个插件做两件事：

1. **能力感知**：实时扫描环境中所有可用能力（skills / agents / plugins / MCP servers）
2. **路由策略注入**：在每次会话开始时告诉 Claude "遇到什么类型的任务该用什么"

定位是 **能力感知 + 路由引导层**——不接管 Claude 的决策，但确保它在决策时有完整信息和明确策略。

## 技术方案

### 当前模块分层

扫描能力仍由 `scripts/scan-environment.cjs` 这个稳定入口对外暴露，但内部已经拆成 3 层：

- `scripts/lib/scan-core.cjs`：扫描与归一化
- `scripts/lib/scan-render.cjs`：`route` / `list` / `awareness` 渲染
- `scripts/lib/user-dir.cjs`：共享用户目录解析

这样做的目的不是改变外部契约，而是让 `scan-environment` 和 `route-matcher` 共享同一套用户目录解析与能力发现逻辑。

### 核心机制：`!command` 动态注入

Claude Code skills 支持 `` !`command` `` 语法：在 SKILL.md 渲染时执行 shell 命令，stdout 直接注入到 Claude 的上下文。

```
!`node "${CLAUDE_SKILL_DIR}/../../scripts/scan-environment.cjs"`
```

每次 skill 被调用时：

1. Shell 命令立即执行（Claude 看不到命令本身，只看到输出）
2. 扫描脚本读取文件系统，输出当前环境的能力快照
3. 快照注入 Claude 上下文，Claude 据此做决策

**结果**：

- 零常驻进程（没有 daemon / hub / server）
- 零数据库（没有 SQLite 或任何持久化存储）
- 零索引文件（没有预生成缓存，每次实时扫描）
- 跨平台（纯 Node.js 标准库）

## 平台兼容矩阵

| 平台           | 支持状态 | 用户目录                         | 已知限制                                                 |
| -------------- | -------- | -------------------------------- | -------------------------------------------------------- |
| macOS          | ✅ 完整  | `~/.claude/`                     | 无                                                       |
| Linux          | ✅ 完整  | `~/.claude/`                     | 无                                                       |
| WSL (Windows)  | ✅ 推荐  | Linux `~/.claude/` / `~/.codex`  | Codex on Windows 推荐通过 WSL2 使用                      |
| Windows (原生) | ⚠️ 部分  | `%USERPROFILE%\.claude`          | 当前仓库仅对 Claude Code 提供原生安装器；Codex 请走 WSL2 |
| CI / Docker    | ✅ 部分  | 通过 `--user-dir` 或环境变量指定 | 插件缓存目录通常为空，MCP 配置需手动挂载                 |

## 扫描来源及稳定性

| 来源                   | 路径                            | 稳定性                                |
| ---------------------- | ------------------------------- | ------------------------------------- |
| 项目级 skills          | `.claude/skills/`               | ✅ 官方正式目录                       |
| 项目级 agents          | `.claude/agents/`               | ✅ 官方正式目录                       |
| 项目级 legacy commands | `.claude/commands/`             | ✅ 官方正式目录                       |
| 用户级 skills          | `~/.claude/skills/`             | ✅ 官方正式目录                       |
| 用户级 agents          | `~/.claude/agents/`             | ✅ 官方正式目录                       |
| 用户级 legacy commands | `~/.claude/commands/`           | ✅ 官方正式目录                       |
| 项目级 MCP 配置        | `.mcp.json`                     | ✅ 官方正式格式                       |
| 用户级 MCP 配置        | `~/.claude/mcp.json`            | ✅ 官方正式格式（兼容旧 `.mcp.json`） |
| 已安装插件             | `~/.claude/plugins/cache/`      | ⚠️ best-effort，目录结构未正式文档化  |
| OpenClaw skills        | `~/.openclaw/workspace/skills/` | ⚠️ 兼容扫描面（只读，不执行）         |
| Hermes skills          | `~/.hermes/skills/`             | ⚠️ 兼容扫描面（只读，不执行）         |

## Token 预算

输出上限 5000 字符的原因：

- skill description 总预算约为上下文窗口的 1%（约 2000 字符/200k 窗口）
- orchestrate skill 的快照是主要内容，不应占用过多 token
- 5000 字符约等于 1250 tokens（通用 BPE 分词估算），对大多数项目足够
- 超限时自动缩短 description（100→50 字符），优先保留能力名称

## 安全边界

- 只读扫描：脚本只使用 `fs.readFileSync`、`fs.readdirSync`、`fs.openSync`+`fs.readSync`（tryReadHead）、`fs.existsSync`、`fs.statSync`、`fs.lstatSync`，不写入任何文件
- 不执行插件代码：只读取 plugin.json manifest，不 `require()` 插件
- 不联网：零网络调用
- 不修改权限：不改变任何文件的权限或所有者
- route-matcher.cjs 遵循相同安全原则：只读扫描 + 零网络 + 故障开放（异常时放行）

## $CLAUDE_SKILL_DIR 路径说明

文档定义：`${CLAUDE_SKILL_DIR}` = skill 的 SKILL.md 所在目录。

对于 plugin 内的 skill（如 `skills/orchestrate/SKILL.md`）：

```
${CLAUDE_SKILL_DIR} = <plugin-root>/skills/orchestrate/
${CLAUDE_SKILL_DIR}/../../scripts/ = <plugin-root>/scripts/
```

三个 skill 都用相同的相对路径访问同一个脚本：

```
skills/orchestrate/  →  ../../scripts/scan-environment.cjs
skills/capabilities/ →  ../../scripts/scan-environment.cjs
skills/refresh/      →  ../../scripts/scan-environment.cjs
```

## SessionStart Hook 机制

POSIX 安装脚本在 `~/.claude/settings.json` 中注册一个 `SessionStart` hook：

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "CLAUDE_USER_DIR=\"$HOME/.claude\" node \"$HOME/.claude/plugins/cache/capability-orchestrator/scripts/scan-environment.cjs\" --mode=awareness",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

每次 Claude Code 开启新会话时，hook 自动执行扫描脚本，将能力摘要 + 强制路由规则注入到会话上下文。

Windows 原生 Claude 安装器会把 hook 命令写成 `cmd.exe /d /s /c ""...\scripts\scan-environment.cmd" ..."` 和 `route-matcher.cmd`，由 `.cmd` wrapper 负责反推 `%USERPROFILE%\.claude` 与插件 `data` 目录，再调用现有 `.cjs` 脚本。

选择 `--mode=awareness` 是因为它提供了最高的性价比：

- MCP servers 展示完整描述（平台不会自动注入）
- Subagents 展示 top-15 描述（帮助 Claude 判断何时委派）
- Skills 展示名称 + 描述（供路由匹配使用）
- 末尾附加 `<MANDATORY>` 路由规则，强制 Claude 匹配到 skill 时必须调用

## UserPromptSubmit Hook 实时路由

安装脚本同时注册一个 `UserPromptSubmit` hook：

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "CLAUDE_USER_DIR=\"$HOME/.claude\" node \"$HOME/.claude/plugins/cache/capability-orchestrator/scripts/route-matcher.cjs\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

每条用户消息经过 `route-matcher.cjs`：

1. 从 stdin 读取 JSON（含 prompt 字段）
2. 扫描环境中所有 skill / legacy command 的 name + description
3. 关键词匹配 → 找到最佳匹配目标
4. 匹配到 skill → 注入明确的 `/<skill-name>` 调用指令
5. 匹配到 legacy command → 优先注入明确的 `/<command>` 调用；仅在命令名不适合 slash 调用时回退到命令定义
6. 未匹配 → 静默放行

扫描范围（v1.4.0+）：项目级 skill + 用户级 skill + 已安装插件 skill，去重优先级：项目 > 用户 > 插件。

匹配算法：Unicode 分词 + CJK bigrams + 关键词交集。返回置信度评分 confidence (0-1)。

CWD 解析：从 stdin JSON 的 `cwd` 字段读取项目目录，fallback 到环境变量和 process.cwd()。
用户目录解析：优先 `CAPABILITY_USER_DIR`，其次 `CLAUDE_USER_DIR`，最后 fallback 到默认 `~/.claude` / WSL 探测。

安全设计：

- 故障开放：任何异常 → 放行，不阻断用户操作
- stdin 读取 3s 超时 + unref，防止挂起
- 逃逸机制：用户说"直接做"/"skip" 时跳过路由
- skill description 经 sanitize 清洗，防注入
- 只在 UserPromptSubmit 做路由，不在 PostToolUse → 避免循环
- 匹配到 skill 时注入明确的 `/<skill-name>` 调用指令，不注入未渲染的 `SKILL.md` 原文
- 匹配到 legacy command 时优先注入明确的 `/<command>` 调用，只在 slash 调用不安全时回退到命令定义

## explain 调试入口

`route-matcher.cjs` 新增 `--explain` 只读模式。输入与 hook 相同的 stdin JSON，输出机器可读 JSON：

- `action`: `route` / `pass`
- `reason`: `matched-skill` / `matched-command-literal` / `matched-command-semantic` / `matched-command-fallback` / `matched-mcp` / `escaped` / `too-short` / `no-match`
- `targetType`: `skill` / `command` / `mcp` / `null`
- `targetName`
- `confidence`
- `matchedKeywords`
- `cwd`
- `userDirSource`

默认 hook 模式不输出 explain 信息，避免影响既有 Claude Code 行为。`/debug-route` skill 只是这个 explain 能力的人类可读包装。

## 渲染模式

| 模式      | 参数                   | 用途                    | 输出内容                  |
| --------- | ---------------------- | ----------------------- | ------------------------- |
| route     | `--mode=route`（默认） | orchestrate skill 调用  | 完整描述，供路由决策      |
| list      | `--mode=list`          | capabilities skill 调用 | 名称列表，纯展示          |
| awareness | `--mode=awareness`     | SessionStart hook       | 差异化价值 + 强制路由规则 |

`awareness` 模式的设计原则是**只注入平台不会自动提供的信息**：

- MCP server 描述（平台只暴露 tool 名，不注入 server 级描述）
- Agent 描述（帮助判断何时委派 vs 自己做）
- Skill 名称 + 描述（供路由匹配使用）
- 兼容生态本地 skills（OpenClaw / Hermes）
- 强制路由规则（`<MANDATORY>` 包裹，要求 Claude 匹配到 skill 时必须调用）

## Future Enhancements（仅文档记录，不实现）

以下是可扩展方向，当前版本不实现，不引入任何复杂性：

1. **bundled MCP server 结构化查询**：将扫描结果暴露为 MCP tool，支持按类型过滤、模糊搜索
2. **能力摘要缓存**：将扫描结果缓存到 `${CLAUDE_PLUGIN_DATA}/capability-cache.json`，减少重复扫描开销（当前实时扫描足够快，无需此优化）
