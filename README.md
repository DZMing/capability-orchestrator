# capability-orchestrator

> Auto-routing plugin for Claude Code. Matches user prompts to skills, commands, and MCP tools via semantic + literal + cross-language routing. Zero config, zero dependencies, 256 tests.

[![CI](https://github.com/DZMing/capability-orchestrator/actions/workflows/ci.yml/badge.svg)](https://github.com/DZMing/capability-orchestrator/actions/workflows/ci.yml)

让 Claude Code 实时感知当前环境的全部可用能力（skills / subagents / plugins / MCP servers / commands），并通过路由策略引导 Claude 自动选择最优执行路径。

## 安装

**一键安装（推荐）：**

```bash
curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash
```

需要 Node.js 18+，有 git 或 curl 即可。

**手动安装：**

```bash
# 克隆到插件缓存目录
git clone --depth=1 https://github.com/DZMing/capability-orchestrator.git \
  ~/.claude/plugins/cache/capability-orchestrator

# 或开发测试（不安装，直接加载）
claude --plugin-dir ./capability-orchestrator
```

## 使用

### 会话开始自动注入（推荐）

安装脚本会在 `~/.claude/settings.json` 里注册两个 hook：

**SessionStart hook** — 每次新会话开始时注入能力清单 + 强制路由规则：

- **MCP server 描述**（平台只暴露 tool 名，不注入 server 级说明）
- **Subagent 描述**（帮助 Claude 判断何时委派 vs 自己做）
- **Skill 名称 + 描述**（供路由匹配使用）
- **强制路由规则**（匹配到 skill 时必须调用，不得跳过）

**UserPromptSubmit hook** — 每条用户消息实时匹配 skill：

- 自动扫描所有 skill 的 description，与用户消息做关键词匹配
- 匹配到 → 注入强制调用指令，Claude 会自动通过 Skill tool 调用
- 未匹配 → 静默放行，不影响正常使用
- 逃逸机制：说"直接做"或"skip"可跳过路由

**无需手动触发，无需 CLAUDE.md 路由规则。**

如需手动添加 hook，建议同时注册 `SessionStart` 和 `UserPromptSubmit`：

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
    ],
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

### 手动查看完整能力摘要

```
/capability-orchestrator:capabilities
```

输出当前环境全部可用能力，含描述，不做路由判断。

### 路由复杂任务

```
/capability-orchestrator:orchestrate
```

扫描当前环境后给出"用哪个 skill/agent 最合适"的建议。

### 安装新插件后刷新

```
/capability-orchestrator:refresh
```

重新扫描环境，对比前后变化，告知 Claude 新增了什么、移除了什么。

## 验证安装

```bash
# 测试扫描脚本是否正常输出
node ~/.claude/plugins/cache/capability-orchestrator/scripts/scan-environment.cjs --mode=awareness
```

## 卸载

```bash
bash ~/.claude/plugins/cache/capability-orchestrator/install.sh --uninstall
```

会自动移除插件目录，以及 `settings.json` 中由 capability-orchestrator 注册的 `SessionStart` 和 `UserPromptSubmit` hooks。

## 架构

见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 已知限制

- 插件缓存目录 `~/.claude/plugins/cache/` 的结构未正式文档化，扫描插件信息为 best-effort
- `!command` 在 skill 渲染时执行，CWD 为 Claude Code 启动目录（即项目根目录）
- 输出硬限制 3000 字符；能力过多时自动缩短 description
