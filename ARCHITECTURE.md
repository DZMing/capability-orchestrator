# ARCHITECTURE

## 设计哲学

Claude Code 本身就是路由器——它的 agent loop 已经会根据上下文选工具、选 skill、选 subagent。

但路由器再聪明，**看不到菜单就点不了菜**。

这个插件做两件事：

1. **能力感知**：实时扫描环境中所有可用能力（skills / agents / plugins / MCP servers）
2. **路由策略注入**：在每次会话开始时告诉 Claude "遇到什么类型的任务该用什么"

定位是 **能力感知 + 路由引导层**——不接管 Claude 的决策，但确保它在决策时有完整信息和明确策略。

## 技术方案

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

| 平台           | 支持状态  | 用户目录                                                              | 已知限制                                            |
| -------------- | --------- | --------------------------------------------------------------------- | --------------------------------------------------- |
| macOS          | ✅ 完整   | `~/.claude/`                                                          | 无                                                  |
| Linux          | ✅ 完整   | `~/.claude/`                                                          | 无                                                  |
| WSL (Windows)  | ✅ 实验   | Linux `~/.claude/` 优先；不存在时尝试 Windows `%USERPROFILE%\.claude` | 需要 `wslpath` + `cmd.exe` 可访问；超时 2s fallback |
| Windows (原生) | ❌ 不支持 | —                                                                     | Claude Code 目前不支持 Windows 原生运行             |
| CI / Docker    | ✅ 部分   | 通过 `--user-dir` 或环境变量指定                                      | 插件缓存目录通常为空，MCP 配置需手动挂载            |

## 扫描来源及稳定性

| 来源                   | 路径                       | 稳定性                                |
| ---------------------- | -------------------------- | ------------------------------------- |
| 项目级 skills          | `.claude/skills/`          | ✅ 官方正式目录                       |
| 项目级 agents          | `.claude/agents/`          | ✅ 官方正式目录                       |
| 项目级 legacy commands | `.claude/commands/`        | ✅ 官方正式目录                       |
| 用户级 skills          | `~/.claude/skills/`        | ✅ 官方正式目录                       |
| 用户级 agents          | `~/.claude/agents/`        | ✅ 官方正式目录                       |
| 用户级 legacy commands | `~/.claude/commands/`      | ✅ 官方正式目录                       |
| 项目级 MCP 配置        | `.mcp.json`                | ✅ 官方正式格式                       |
| 用户级 MCP 配置        | `~/.claude/mcp.json`       | ✅ 官方正式格式（兼容旧 `.mcp.json`） |
| 已安装插件             | `~/.claude/plugins/cache/` | ⚠️ best-effort，目录结构未正式文档化  |

## Token 预算

输出上限 3000 字符的原因：

- skill description 总预算约为上下文窗口的 1%（约 2000 字符/200k 窗口）
- orchestrate skill 的快照是主要内容，不应占用过多 token
- 3000 字符约等于 750 tokens（通用 BPE 分词估算），对大多数项目足够
- 超限时自动缩短 description（100→50 字符），优先保留能力名称

## 安全边界

- 只读扫描：脚本只使用 `fs.readFileSync` 和 `fs.readdirSync`，不写入任何文件
- 不执行插件代码：只读取 plugin.json manifest，不 `require()` 插件
- 不联网：零网络调用
- 不修改权限：不改变任何文件的权限或所有者

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

安装脚本在 `~/.claude/settings.json` 中注册一个 `SessionStart` hook：

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$HOME/.claude/plugins/cache/capability-orchestrator/scripts/scan-environment.cjs\" --mode=awareness",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

每次 Claude Code 开启新会话时，hook 自动执行扫描脚本，将能力摘要 + 路由策略注入到会话上下文。

选择 `--mode=awareness` 是因为它提供了最高的性价比：

- MCP servers 展示完整描述（平台不会自动注入）
- Subagents 展示 top-15 描述（帮助 Claude 判断何时委派）
- Skills / Plugins 只展示名称或数量（平台已提供详情）
- 末尾附加路由策略，引导 Claude 自动选择正确执行路径

## 渲染模式

| 模式      | 参数                   | 用途                    | 输出内容              |
| --------- | ---------------------- | ----------------------- | --------------------- |
| route     | `--mode=route`（默认） | orchestrate skill 调用  | 完整描述，供路由决策  |
| list      | `--mode=list`          | capabilities skill 调用 | 名称列表，纯展示      |
| awareness | `--mode=awareness`     | SessionStart hook       | 差异化价值 + 路由策略 |

`awareness` 模式的设计原则是**只注入平台不会自动提供的信息**：

- MCP server 描述（平台只暴露 tool 名，不注入 server 级描述）
- Agent 描述（帮助判断何时委派 vs 自己做）
- 路由策略（告诉 Claude 遇到什么类型任务该走哪条路）

## Future Enhancements（仅文档记录，不实现）

以下是可扩展方向，当前版本不实现，不引入任何复杂性：

1. **bundled MCP server 结构化查询**：将扫描结果暴露为 MCP tool，支持按类型过滤、模糊搜索
2. **能力摘要缓存**：将扫描结果缓存到 `${CLAUDE_PLUGIN_DATA}/capability-cache.json`，减少重复扫描开销（当前实时扫描足够快，无需此优化）
