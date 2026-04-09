# ARCHITECTURE

## 设计哲学

Claude Code 本身就是路由器——它的 agent loop 已经会根据上下文选工具、选 skill、选 subagent。

造一个路由器来告诉路由器怎么路由，是重复工作。

**我们唯一缺的是**：让 Claude 在每次需要时，能快速感知当前环境里到底有哪些可用能力。

所以这个插件的定位是 **能力感知层**，不是能力接管层。

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
- 跨平台（纯 Node.js 标准库，macOS / Linux / WSL 通用）

## 扫描来源及稳定性

| 来源                   | 路径                       | 稳定性                               |
| ---------------------- | -------------------------- | ------------------------------------ |
| 项目级 skills          | `.claude/skills/`          | ✅ 官方正式目录                      |
| 项目级 agents          | `.claude/agents/`          | ✅ 官方正式目录                      |
| 项目级 legacy commands | `.claude/commands/`        | ✅ 官方正式目录                      |
| 用户级 skills          | `~/.claude/skills/`        | ✅ 官方正式目录                      |
| 用户级 agents          | `~/.claude/agents/`        | ✅ 官方正式目录                      |
| 用户级 legacy commands | `~/.claude/commands/`      | ✅ 官方正式目录                      |
| 项目级 MCP 配置        | `.mcp.json`                | ✅ 官方正式格式                      |
| 用户级 MCP 配置        | `~/.claude/.mcp.json`      | ✅ 官方正式格式                      |
| 已安装插件             | `~/.claude/plugins/cache/` | ⚠️ best-effort，目录结构未正式文档化 |

## Token 预算

输出上限 3000 字符的原因：

- skill description 总预算约为上下文窗口的 1%（约 2000 字符/200k 窗口）
- orchestrate skill 的快照是主要内容，不应占用过多 token
- 3000 字符约等于 750 tokens（GPT-4 分词估算），对大多数项目足够
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

## Future Enhancements（仅文档记录，不实现）

以下是可扩展方向，当前版本不实现，不引入任何复杂性：

1. **SessionStart hook 自动刷新**：在 `hooks/hooks.json` 中配置 `SessionStart` hook，每次会话启动时自动执行扫描并将结果注入 CLAUDE.md
2. **bundled MCP server 结构化查询**：将扫描结果暴露为 MCP tool，支持按类型过滤、模糊搜索
3. **能力摘要缓存**：将扫描结果缓存到 `${CLAUDE_PLUGIN_DATA}/capability-cache.json`，减少重复扫描开销（当前实时扫描足够快，无需此优化）
