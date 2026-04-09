# capability-orchestrator

让 Claude Code 实时感知当前环境里有哪些可用能力（skills / subagents / plugins / MCP servers / commands）。

## 安装

```bash
# 开发测试（不安装，直接加载）
claude --plugin-dir ./capability-orchestrator

# 正式安装（从当前目录）
claude plugin install .
```

## 使用

### 自动触发

正常对话即可。当任务复杂或模糊时，Claude 会自动加载 `orchestrate` skill，获取环境快照后选择最优执行路径。

### 手动查看能力摘要

```
/capability-orchestrator:capabilities
```

输出当前环境全部可用能力，不做任何判断。

### 安装新插件后刷新

```
/capability-orchestrator:refresh
```

重新扫描环境，并告知 Claude 哪些能力是新增的、哪些已移除。

## 验证安装

```bash
# 语法检查
claude plugin validate .

# 直接测试扫描脚本
node capability-orchestrator/scripts/scan-environment.cjs
```

## 架构

见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 已知限制

- 插件缓存目录 `~/.claude/plugins/cache/` 的结构未正式文档化，扫描插件信息为 best-effort
- `!command` 在 skill 渲染时执行，CWD 为 Claude Code 启动目录（即项目根目录）
- 输出硬限制 3000 字符；能力过多时自动缩短 description
