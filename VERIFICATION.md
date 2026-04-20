# VERIFICATION

## 验证范围

- 源仓库自动化测试
- 安装/卸载/幂等安装链路
- `SessionStart` / `UserPromptSubmit` 的 CLI 级等价验证
- clean-room Claude CLI 真实行为验证

## 环境

- 本机 Node：`v25.8.1`
- CI 矩阵：`ubuntu-latest` / `macos-latest` + `Node 18/20/22`，另有 `windows-latest` 的 PowerShell 安装冒烟
- 本机无 `nvm/fnm/mise/asdf` 等版本管理器，因此未在本机重复跑 `18/20/22`

## 自动化测试

### 1. 仓库测试总入口

命令：

```bash
npm test
bash tests/install.test.sh
bash tests/install-idempotent.test.sh
```

结果：

- `npm test` 通过
- 当前自动化总数：`349`
- `bash tests/install.test.sh` 通过
- `bash tests/install-idempotent.test.sh` 通过

### 2. 关键回归点

已覆盖并通过的关键场景：

- `CLAUDE_USER_DIR` 自定义目录安装/路由
- malformed `settings.json` 安全失败
- 卸载保留 shared-entry 中的无关 hook
- 命中 skill 时不泄漏原始 `!command`
- legacy command 的 slash 主路径与 fallback 路径
- `--explain` 对 skill / command / mcp / no-match / escaped / too-short 的稳定 JSON 输出
- `install.sh` 默认 release 渠道
- `install.sh` 显式 `master` 渠道
- 失败重装保留旧安装
- `CODEX_USER_DIR` 自动检测走 Codex hooks 路径
- Claude / Codex plugin manifest 版本一致
- `/debug-route` skill 合约测试

## 安装链路验证

### 1. 默认安装渠道

结果：

- 默认安装会解析到最新 tag release
- 默认支持模型与 `SECURITY.md` / `SUPPORT.md` / `RELEASE.md` 保持一致

### 2. 显式 `master` 渠道

结果：

- `--channel=master` 可显式安装未发布分支
- 该渠道仅作为自用入口，不进入默认支持承诺

### 3. 幂等性

结果：

- 重复安装不会产生重复 hook
- 原有 `model` / `permissions` / 无关 hook 条目保留

## CLI 级等价验证

### 1. `SessionStart` 等价验证

命令：

```bash
node "$HOME/.claude/plugins/cache/capability-orchestrator/scripts/scan-environment.cjs" --mode=awareness
```

结果：

- 输出包含 `环境能力感知`
- 输出包含 skills / subagents / plugins / MCP servers 摘要

### 2. `UserPromptSubmit` explain 验证

命令：

```bash
printf '%s' '{"prompt":"输出当前环境的全部可用能力摘要","cwd":".../capability-orchestrator"}' \
  | CLAUDE_USER_DIR="$HOME/.claude" \
    node "$HOME/.claude/plugins/cache/capability-orchestrator/scripts/route-matcher.cjs" --explain
```

结果：

- 返回稳定 JSON
- explain 输出不包含原始 `!command`

## clean-room Claude CLI 验证

## 1. 验证方法

做法：

- 新建临时 `HOME`
- 只复制 `~/.claude/.credentials.json` 保留登录态
- 使用隔离的临时 `CLAUDE_USER_DIR`
- 同步 `~/.claude/settings.json` 中的运行时 `model + env`
- 在该目录安装插件
- 再把当前工作区版本同步到临时插件目录，确保验证的是当前工作区，而不是旧 tag
- 用真实 `claude` CLI 跑 `stream-json + include-hook-events + debug-file`

## 2. clean-room `SessionStart`

结果：

- 真实触发 `SessionStart` hook
- 输出最小 fixture 环境摘要：
  - `1 skills`
  - `1 subagents`
  - `1 plugins`
  - `1 MCP servers`
  - `1 Legacy Commands`
- 说明验证未混入真实用户目录中的全局 skills / hooks / plugins

## 3. clean-room skill 路由

输入 prompt：

```text
I need a valid test skill for this important task
```

结果：

- `UserPromptSubmit` 真实触发
- 真实输出 `[AUTO-ROUTE]`
- 命中 `valid-skill`
- 输出包含明确的 `立即调用：/valid-skill`

## 4. clean-room legacy command 路由

输入 prompt：

```text
/legacy-cmd
```

结果：

- `UserPromptSubmit` 真实触发
- 真实输出 `[AUTO-ROUTE]`
- 命中 `/legacy-cmd`
- 输出同时包含：
  - `优先立即调用 /legacy-cmd`
  - `[回退定义]`
  - `Legacy command content.`

这证明当前工作区里的 legacy command 新契约已经在真实 Claude CLI 行为中生效。

## 5. 2026-04-20 命令 + 日志级复验

做法：

- 重新创建隔离 `CLAUDE_USER_DIR`
- 用当前工作区版本安装插件
- 运行真实 `claude -p --verbose --output-format stream-json --include-hook-events --debug-file ...`
- 读取 stream-json 输出与 debug 尾日志

结果：

- 真实出现多条 `SessionStart` hook 事件
- stream 输出中出现 capability-orchestrator 注入的 awareness 内容
- `UserPromptSubmit` 真实触发，输出里能看到 `[AUTO-ROUTE]` 与 `valid-skill`
- 这条 live run 在 20s 窗口内没有完整结束，但 hook 证据已经落出

观察到的额外噪音：

- debug 尾日志里有用户环境中的 `plugin:github:github` MCP 认证格式错误重试
- 该噪音不影响 capability-orchestrator 的 `SessionStart` / `UserPromptSubmit` 证据判定，但说明真实用户环境仍可能夹带外部 MCP 干扰项

## 6. 仓库内置 live 验收脚本

当前仓库已提供：

```bash
npm run verify:live:claude
npm run verify:live:codex
npm run verify:release
```

说明：

- `verify:live:claude`：隔离 `HOME + CLAUDE_USER_DIR`，用 `install.sh` 注册 hooks 后再覆盖成当前工作区快照，并继承真实 `settings.json` 中的 `model + env` 运行时配置，调用真实 `claude` CLI，要求同一条 `UserPromptSubmit` hook 响应中同时出现 `[AUTO-ROUTE]` 和目标 skill
- `verify:live:codex`：隔离 `HOME + CODEX_USER_DIR`，用 `install.sh` 注册 hooks 后再覆盖成当前工作区快照，调用真实 `codex exec`；为绕过 Codex 在非 ASCII 工作区路径下的 websocket header 编码问题，脚本会自动使用 ASCII 临时别名路径，并要求 fresh `route-log.jsonl` 里出现目标 skill 路由条目
- `verify:release`：用于发布前检查版本/manifest/changelog 同步，并显式报告 `HEAD` 是否已经等于最新 tag、以及工作树是否 clean；这些状态需要人工检查，不能只看退出码

注意：

- 这两个 live 脚本的通过标准都是“目标路由证据已经出现”，不是要求所有 hook 或 route-log 侧信号在每台机器上都完全一致
- Claude live 验收更稳定地依赖 stream-json 中出现 `[AUTO-ROUTE]` 和目标 skill
- Codex live 验收更稳定地依赖真实 `codex exec` 已进入目标 skill 工作流，route log 仍视为 best-effort 证据

## 未完成的部分

- 没有直接打开 Claude Code 桌面 GUI 做肉眼会话验收
- 但当前功能级签字建立在 clean-room CLI + stream-json hook 事件 + debug 日志上；GUI 不再是功能正确性的前置条件

## 最终结论

- 自动化测试：通过
- 安装/卸载/幂等链路：通过
- 文档 / 实现 / 配置一致性：通过
- clean-room Claude CLI：通过
- 严格手工 GUI 验收：未做

如果标准是“高质量长期自用工业标准”，当前状态可签字通过。
