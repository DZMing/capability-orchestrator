# VERIFICATION

## 验证范围

- 源仓库自动化测试
- 本机已安装插件版本与 hook 配置
- `SessionStart` / `UserPromptSubmit` 的 CLI 级等价验证

## 环境

- 本机 Node：`v25.8.1`
- CI 矩阵：`ubuntu-latest` / `macos-latest` + `Node 18/20/22`
- 本机无 `nvm/fnm/mise/asdf` 等版本管理器，因此未在本机重复跑 `18/20/22`，这部分以 CI 配置为准

## 自动化测试

### 1. 仓库测试总入口

命令：

```bash
npm run test:all
```

结果：

- `npm test` 通过
- `npm run test:install` 通过
- `npm run test:idempotent` 通过

### 2. 新增回归点

已新增并通过的关键回归测试：

- `CLAUDE_USER_DIR` 自定义目录安装/路由
- malformed `settings.json` 安全失败
- 卸载保留 shared-entry 中的无关 hook
- 命中 skill 时不再泄漏原始 `!command`

## 本机安装态验证

### 1. 已安装插件版本

命令：

```bash
git -C "$HOME/.claude/plugins/cache/capability-orchestrator" rev-parse --short HEAD
```

结果：

- 已安装插件版本与本轮修复版本一致

### 2. hook 配置存在且唯一

检查项：

- `SessionStart` 中 capability-orchestrator hook 恰好 1 组
- `UserPromptSubmit` 中 capability-orchestrator hook 恰好 1 组

结果：

- 通过

## CLI 级等价验证

### 1. `SessionStart` 等价验证

命令：

```bash
node "$HOME/.claude/plugins/cache/capability-orchestrator/scripts/scan-environment.cjs" --mode=awareness
```

结果：

- 输出包含 `环境能力感知`
- 输出包含 skills / subagents / plugins / MCP servers 摘要

### 2. `UserPromptSubmit` 命中 skill

命令：

```bash
printf '%s' '{"prompt":"输出当前环境的全部可用能力摘要","cwd":".../capability-orchestrator"}' \
  | CLAUDE_USER_DIR="$HOME/.claude" \
    node "$HOME/.claude/plugins/cache/capability-orchestrator/scripts/route-matcher.cjs"
```

结果：

- 返回 `[AUTO-ROUTE]`
- 命中 `capabilities`
- 输出包含明确的 `/capabilities` 调用指令
- 不再泄漏原始 `!command`

### 3. `UserPromptSubmit` 未命中放行

命令：

```bash
printf '%s' '{"prompt":"tell me about the weather in Tokyo tomorrow","cwd":".../capability-orchestrator"}' \
  | CLAUDE_USER_DIR="$HOME/.claude" \
    node "$HOME/.claude/plugins/cache/capability-orchestrator/scripts/route-matcher.cjs"
```

结果：

```json
{ "continue": true }
```

### 4. `UserPromptSubmit` 显式逃逸

命令：

```bash
printf '%s' '{"prompt":"skip，直接做：输出当前环境能力","cwd":".../capability-orchestrator"}' \
  | CLAUDE_USER_DIR="$HOME/.claude" \
    node "$HOME/.claude/plugins/cache/capability-orchestrator/scripts/route-matcher.cjs"
```

结果：

```json
{ "continue": true }
```

## 未自动化的部分

- 没有直接打开一个新的 Claude Code GUI 会话做肉眼验证
- 这部分已用 `SessionStart` hook 命令的 CLI 等价执行替代
- 若需要最终人工签字，建议再做一次 GUI 新会话抽检

## 最终结论

- 自动化测试：通过
- 本机安装态：通过
- hook 生效链路：通过
- 文档 / 实现 / 配置一致性：通过
