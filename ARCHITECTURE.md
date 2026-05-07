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

### Intent Router 执行契约层

除了技能 / 命令 / MCP 路由，仓库还提供一层独立的 Intent Router，
用于把短操作口令扩展成完整的执行契约。它不是替代 route-matcher，
而是给“继续”“执行吧”“还有什么没做完”“做到可以商用”这类短 prompt
提供统一的 What / Guardrails / Success / Budget / Verify 输出。

数据流如下：

1. `intent-classifier.cjs` 先按短 prompt 和关键词把输入映射到 intent
   （`continue_work` / `execute_plan` / `work_status` /
   `commercial_readiness` / `prompt_composition` / `capability_lookup`）
2. `safety-gate.cjs` 先做 prompt-level 高风险预检；普通未知 prompt 不会读取
   工作上下文、偏好文件或 route log
3. 只有命中短 prompt intent，或预检发现高风险动作时，`work-context.cjs`
   才读取受限工作上下文：项目规则、git status、最近的 route 记录
4. 同样只有上述路径需要时，`preference-profile.cjs` 才读取可选偏好文件
   `~/.config/capability-orchestrator/preferences.json`，并对 secret-like
   内容做 redaction
5. `safety-gate.cjs` 结合 prompt 和上下文做完整风险判断
6. `prompt-composer.cjs` 生成五段式执行契约，并在高风险时输出
   `[CONFIRMATION REQUIRED]`
7. `intent-router.cjs` 负责把这些输入串起来；当 intent 不明确且预检无高风险时
   不足时返回 `null`，让现有的 skill / command / MCP matcher 继续处理

安全规则：

- `preferences.json` 里的条目是建议，不会降低风险等级
- project preferences 优先于 global preferences
- disabled 或低置信度偏好会被忽略
- route log、AGENTS 规则和 git 状态都只读读取，不写入任何文件
- 高风险动作按“动作 + 目标 + 作用域”组合判断；`HTML tag`、`brand color`
  和局部 UX 调整这类普通技术词不会单独触发确认
- 发布、推送、部署、删除、付费、凭证、生产变更、真实产品 / UX 决策，以及
  `git tag` / release tag 这类发布边界动作，都会被闸门拦下并要求确认

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

| 来源                          | 路径                                   | 稳定性                                                  |
| ----------------------------- | -------------------------------------- | ------------------------------------------------------- |
| 项目级 skills                 | `.claude/skills/`                      | ✅ 官方正式目录                                         |
| 项目级 agents                 | `.claude/agents/`                      | ✅ 官方正式目录                                         |
| 项目级 legacy commands        | `.claude/commands/`                    | ✅ 官方正式目录                                         |
| 用户级 skills                 | `~/.claude/skills/`                    | ✅ 官方正式目录                                         |
| 用户级 agents                 | `~/.claude/agents/`                    | ✅ 官方正式目录                                         |
| 用户级 legacy commands        | `~/.claude/commands/`                  | ✅ 官方正式目录                                         |
| 项目级 MCP 配置               | `.mcp.json`                            | ✅ 官方正式格式                                         |
| 用户级 MCP 配置               | `~/.claude/mcp.json`                   | ✅ 官方正式格式（兼容旧 `.mcp.json`）                   |
| 已安装插件                    | `~/.claude/plugins/cache/`             | ⚠️ best-effort，目录结构未正式文档化                    |
| OpenClaw skills fallback      | `~/.openclaw/workspace/skills/`        | ⚠️ 冻结的兼容扫描面（只读，不执行；不承诺 host bridge） |
| Hermes runtime skills/plugins | 宿主 CLI (`hermes skills/plugins ...`) | ⚠️ 实验宿主路径：运行态快照与 route 已接入              |
| Hermes skills fallback        | `~/.hermes/skills/`                    | ⚠️ 兼容扫描面（只读，不执行）                           |

## Token 预算

输出上限 5000 字符的原因：

- skill description 总预算约为上下文窗口的 1%（约 2000 字符/200k 窗口）
- orchestrate skill 的快照是主要内容，不应占用过多 token
- 5000 字符约等于 1250 tokens（通用 BPE 分词估算），对大多数项目足够
- 超限时自动缩短 description（100→50 字符），优先保留能力名称

## 安全边界

- 只读扫描：脚本只使用 `fs.readFileSync`、`fs.readdirSync`、`fs.openSync`+`fs.readSync`（tryReadHead）、`fs.existsSync`、`fs.statSync`、`fs.lstatSync`，不写入任何文件
- 不执行插件代码：只读取 plugin.json manifest，不 `require()` 插件
- 不执行 MCP / plugin 描述文本：MCP server、legacy command 和 plugin skill 的
  manifest / markdown / command body 都只作为匹配线索，不作为执行指令
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
2. Intent Router 先做 prompt-level 分类和高风险预检
3. 只有短 prompt 或高风险动作才读取工作上下文 / 偏好 / 最近 route log，并生成 Harness Contract 或 confirmation gate
4. 未命中 intent 时，扫描环境中所有 skill / legacy command 的 name + description
5. 匹配到 skill → 注入明确的 `/<skill-name>` 调用指令
6. 匹配到 legacy command → 输出明确的 `/<command>` 能力入口建议，不执行扫描到的命令正文或 markdown 定义
7. 未匹配 → 静默放行

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
- 匹配到 legacy command 时只输出明确的 `/<command>` 能力入口建议，不注入、不执行扫描到的命令正文或 markdown 定义
- MCP 匹配只作为能力建议；涉及外部、凭证、生产、付费或真实用户数据时必须先确认
- route log 只写入匿名化、白名单字段，不记录原始 prompt、凭证或长文本

## explain 调试入口

`route-matcher.cjs` 新增 `--explain` 只读模式。输入与 hook 相同的 stdin JSON，输出机器可读 JSON：

- `action`: `route` / `pass`
- `reason`: `intent-router` / `confirmation-required` / `matched-skill` / `matched-command-literal` / `matched-command-semantic` / `matched-command-fallback` / `matched-mcp` / `escaped` / `too-short` / `no-match`
- `targetType`: `intent` / `skill` / `command` / `mcp` / `null`
- `targetName`
- `confidence`
- `matchedKeywords`
- `cwd`
- `userDirSource`
- `promptType`
- `host` / `source` / `scope` / `surfaceType` / `invocation`
- MCP 或插件信任信号：`transport` / `authRequired` / `mayWrite` /
  `externalAccess`

默认 hook 模式不输出 explain 信息，避免影响既有 Claude Code 行为。`/debug-route` skill 只是这个 explain 能力的人类可读包装。

## 实验宿主路径

当前仓库除了正式支持的 Claude / Codex 之外，保留 Hermes 实验宿主路径。
OpenClaw host bridge 已冻结，不再作为安装、route bridge、adapter command 或
lifecycle 验证承诺；仅保留 `~/.openclaw/workspace/skills/` 的只读兼容扫描。

- Hermes：
  - active host runtime snapshot 已成立
  - route 已能命中 Hermes runtime skills
  - plugin bridge 已可通过 `hermes plugins install file://...` 安装
  - `pre_llm_call` hook 和 slash command 已接入共享 bridge

Hermes 路径已经有真实安装和宿主管理面证据，但仍然标记为实验状态，原因是：

- Hermes 仍处于实验支持面，主要保守点是正式支持矩阵和更广泛宿主生命周期承诺尚未冻结
- OpenClaw bridge 在本版本冻结，避免文档、测试和 release gate 继续声明不可验证的宿主支持

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
- 兼容生态本地 skills（OpenClaw scan-only / Hermes）
- 强制路由规则（`<MANDATORY>` 包裹，要求 Claude 匹配到 skill 时必须调用）

## Future Enhancements（仅文档记录，不实现）

以下是可扩展方向，当前版本不实现，不引入任何复杂性：

1. **bundled MCP server 结构化查询**：将扫描结果暴露为 MCP tool，支持按类型过滤、模糊搜索
2. **能力摘要缓存**：将扫描结果缓存到 `${CLAUDE_PLUGIN_DATA}/capability-cache.json`，减少重复扫描开销（当前实时扫描足够快，无需此优化）
