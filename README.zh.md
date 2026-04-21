[English](README.md) | 中文 | [Español](README.es.md)

# capability-orchestrator

> 面向 Claude Code 和 Codex 的能力感知与自动路由插件，并提供经过验证的
> OpenClaw / Hermes 实验宿主适配。

[![CI](https://github.com/DZMing/capability-orchestrator/actions/workflows/ci.yml/badge.svg)](https://github.com/DZMing/capability-orchestrator/actions/workflows/ci.yml)

`capability-orchestrator` 会扫描本地 agent 环境，总结可用的 skills、commands、
plugins、agents 和 MCP servers，然后把用户 prompt 路由到最合适的执行面。

## 它做什么

- 新 Claude Code / Codex 会话启动时自动注入能力摘要。
- 根据 prompt 自动路由到匹配的 skill、command 或 MCP server。
- Claude Code / Codex 是稳定主宿主。
- OpenClaw / Hermes 已有实验但可验证的 host bridge。
- install、reinstall、uninstall、lifecycle 和 release 检查都可执行验证。

## 快速开始

```bash
curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash
```

然后重启 Claude Code 或 Codex。

Windows Claude Code 原生安装：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

卸载：

```bash
bash ~/.claude/plugins/cache/capability-orchestrator/install.sh --uninstall
```

Codex 安装把 `~/.claude` 换成 `~/.codex`。

## 宿主支持

| 宿主        | 状态         | 说明                                                                                        |
| ----------- | ------------ | ------------------------------------------------------------------------------------------- |
| Claude Code | 稳定         | 使用 `SessionStart` 和 `UserPromptSubmit` hooks                                             |
| Codex       | 稳定         | Linux/macOS 原生；Windows 推荐 WSL2                                                         |
| OpenClaw    | 实验，已验证 | runtime snapshot、route bridge、bootstrap hook、adapter commands、lifecycle 验证            |
| Hermes      | 实验，已验证 | runtime snapshot、route bridge、slash command bridge、`pre_llm_call` bridge、lifecycle 验证 |

OpenClaw / Hermes 已经不只是 scan-only 集成；它们有 install / reinstall /
uninstall 和 bridge 行为验证。但在更广泛的宿主生命周期与 Windows 原生承诺冻结前，
仍标记为 experimental。

## 高级安装

```bash
# 安装指定 release
CAPABILITY_INSTALL_REF=vX.Y.Z \
  curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash

# 安装 master
curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash -s -- --channel=master

# 显式选择宿主
curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash -s -- --platform=codex
curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash -s -- --platform=openclaw
curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash -s -- --platform=hermes
```

## 验证

```bash
npm test
bash tests/install.test.sh
bash tests/install-idempotent.test.sh
npm run verify:host:openclaw
npm run verify:host:hermes
npm run verify:host:lifecycle
npm run verify:release
```

手工检查：

```bash
node ~/.claude/plugins/cache/capability-orchestrator/scripts/scan-environment.cjs --mode=awareness

printf '%s' '{"prompt":"输出当前环境的全部可用能力摘要","cwd":"."}' \
  | CLAUDE_USER_DIR="$HOME/.claude" \
    node ~/.claude/plugins/cache/capability-orchestrator/scripts/route-matcher.cjs --explain
```

## 安全模型

- 安装器只更新 capability-orchestrator 自己拥有的 hook 条目。
- install、reinstall、uninstall 都保留无关 hooks。
- runtime scan 是 best-effort 和 fault-open。
- scanner 不执行被扫描的 plugin 目录。
- release readiness 会检查 package、manifests、adapter versions、changelog、
  git tag、worktree clean 状态和 GitHub Release 状态。

## 文档

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [VERIFICATION.md](VERIFICATION.md)
- [RELEASE.md](RELEASE.md)
- [SECURITY.md](SECURITY.md)
- [SUPPORT.md](SUPPORT.md)
- [ROADMAP.md](ROADMAP.md)

## 已知边界

- Windows 原生支持目前只承诺 Claude Code。
- Windows 上的 Codex 推荐走 WSL2。
- OpenClaw / Hermes 是已验证的实验宿主 bridge，还不是正式跨平台支持矩阵。

## License

MIT
