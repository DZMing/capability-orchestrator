# capability-orchestrator

[![CI](https://github.com/DZMing/capability-orchestrator/actions/workflows/ci.yml/badge.svg)](https://github.com/DZMing/capability-orchestrator/actions/workflows/ci.yml)

让 Claude Code 实时感知当前环境里有哪些可用能力（skills / subagents / plugins / MCP servers / commands）。

## 安装

**一键安装（推荐）：**

```bash
curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash
```

需要 Node.js 18+，有 git 或 curl 即可。

**手动安装：**

```bash
# 克隆到插件缓存目录
git clone https://github.com/DZMing/capability-orchestrator.git \
  ~/.claude/plugins/cache/capability-orchestrator

# 或开发测试（不安装，直接加载）
claude --plugin-dir ./capability-orchestrator
```

## 使用

### 会话开始自动注入（推荐）

安装脚本会在 `~/.claude/settings.json` 里注册一个 SessionStart hook，每次新会话开始时自动做一次轻量扫描并将能力摘要注入 Claude 上下文。**无需手动触发，无需 CLAUDE.md 路由规则。**

如需手动添加 hook，在 `~/.claude/settings.json` 的 `hooks.SessionStart` 数组里加：

```json
{
  "hooks": [
    {
      "type": "command",
      "command": "node \"$HOME/.claude/plugins/cache/capability-orchestrator/scripts/scan-environment.cjs\" --mode=list",
      "timeout": 10
    }
  ]
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
node ~/.claude/plugins/cache/capability-orchestrator/scripts/scan-environment.cjs --mode=list
```

## 卸载

```bash
bash ~/.claude/plugins/cache/capability-orchestrator/install.sh --uninstall
```

会自动移除插件目录和 `settings.json` 中的 SessionStart hook。

## 架构

见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 已知限制

- 插件缓存目录 `~/.claude/plugins/cache/` 的结构未正式文档化，扫描插件信息为 best-effort
- `!command` 在 skill 渲染时执行，CWD 为 Claude Code 启动目录（即项目根目录）
- 输出硬限制 3000 字符；能力过多时自动缩短 description
