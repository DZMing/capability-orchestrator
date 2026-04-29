[English](README.md) | 中文 | [Español](README.es.md)

# capability-orchestrator

> 面向 Claude Code 和 Codex 的能力感知与自动路由插件，并提供 Hermes
> 实验宿主适配；OpenClaw 保留只读兼容扫描面。

[![CI](https://github.com/DZMing/capability-orchestrator/actions/workflows/ci.yml/badge.svg)](https://github.com/DZMing/capability-orchestrator/actions/workflows/ci.yml)

`capability-orchestrator` 会扫描本地 agent 环境，总结可用的 skills、commands、
plugins、agents 和 MCP servers，然后把用户 prompt 路由到最合适的执行面。它还
包含一个独立的 Intent Router 层，会把短操作口令补全成五段执行契约。

## 它做什么

- 新 Claude Code / Codex 会话启动时自动注入能力摘要。
- 根据 prompt 自动路由到匹配的 skill、command 或 MCP server。
- 把“继续”“执行吧”“还有什么没做完”这类短口令补全成完整的
  What / Guardrails / Success / Budget / Verify 契约。
- 对发布、推送、部署、删除、付费、凭证、生产环境和真实产品 / UX 决策要求确认。
- Claude Code / Codex 是稳定主宿主。
- Hermes 已有实验但可验证的 host bridge。
- OpenClaw host bridge 安装路径当前冻结，仅保留本地 skill 只读扫描兼容。
- install、reinstall、uninstall、lifecycle 和 release 检查都可执行验证。

## Intent Router

Intent Router 层只负责短操作口令，不替代直接的能力匹配。它会先识别
intent，再收集实时工作上下文，套用安全闸门，最后生成完整执行契约。

常见 intent 包括：

| 短口令           | Intent                 | 结果                                     |
| ---------------- | ---------------------- | ---------------------------------------- |
| `继续`           | `continue_work`        | 结合当前上下文继续安全、可逆的技术工作。 |
| `执行吧`         | `execute_plan`         | 带验证地执行已经讨论过的计划。           |
| `还有什么没做完` | `work_status`          | 总结剩余工作，并选择下一个可执行任务。   |
| `做到可以商用`   | `commercial_readiness` | 把项目推进到可商用、可发布的状态。       |

执行契约始终包含：

- `What`
- `Guardrails`
- `Success`
- `Budget`
- `Verify`

它会合并来自仓库规则、git 状态、最近 route 记录，以及可选偏好文件
`~/.config/capability-orchestrator/preferences.json` 的受限上下文。偏好只作为
建议，不会降低风险等级。如果 prompt 不像安全的操作意图，现有的 skill /
command / MCP matcher 仍然负责直接路由。

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

| 宿主        | 状态            | 说明                                                                                        |
| ----------- | --------------- | ------------------------------------------------------------------------------------------- |
| Claude Code | 稳定            | 使用 `SessionStart` 和 `UserPromptSubmit` hooks                                             |
| Codex       | 稳定            | Linux/macOS 原生；Windows 推荐 WSL2                                                         |
| OpenClaw    | 冻结，scan-only | 可只读扫描 workspace skills；不提供 host bridge 安装、adapter commands 或 lifecycle 承诺    |
| Hermes      | 实验，已验证    | runtime snapshot、route bridge、slash command bridge、`pre_llm_call` bridge、lifecycle 验证 |

Hermes 已经不只是 scan-only 集成；它有 install / reinstall / uninstall 和
bridge 行为验证。但在更广泛的宿主生命周期与 Windows 原生承诺冻结前，仍标记为
experimental。OpenClaw host bridge 已冻结，仅保留只读本地 skill 扫描兼容面。

## 高级安装

```bash
# 安装指定 release
CAPABILITY_INSTALL_REF=vX.Y.Z \
  curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash

# 安装 master
curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash -s -- --channel=master

# 显式选择宿主
curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash -s -- --platform=codex
curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash -s -- --platform=hermes
```

## 验证

```bash
npm test
bash tests/install.test.sh
bash tests/install-idempotent.test.sh
npm run verify:host:hermes
npm run verify:host:lifecycle
npm run verify:release
npm run verify:release:strict  # 仅真实发版/tag 发布前需要
```

手工检查：

```bash
node ~/.claude/plugins/cache/capability-orchestrator/scripts/scan-environment.cjs --mode=awareness

printf '%s' '{"prompt":"输出当前环境的全部可用能力摘要","cwd":"."}' \
  | CLAUDE_USER_DIR="$HOME/.claude" \
    node ~/.claude/plugins/cache/capability-orchestrator/scripts/route-matcher.cjs --explain

node --test tests/intent-classifier.test.cjs tests/intent-router.test.cjs \
  tests/safety-gate.test.cjs tests/prompt-composer.test.cjs \
  tests/work-context.test.cjs tests/preference-profile.test.cjs
```

## 安全模型

- 安装器只更新 capability-orchestrator 自己拥有的 hook 条目。
- install、reinstall、uninstall 都保留无关 hooks。
- runtime scan 是 best-effort 和 fault-open。
- scanner 不执行被扫描的 plugin 目录。
- `verify:release` 是 pre-landing audit，会检查 package、manifests、已支持
  adapter versions、changelog、tag metadata、GitHub Release 状态，并拒绝任何残留
  OpenClaw host bridge surface 或脚本。
- `verify:release:strict` 是真实发布前的 hard release gate，还要求工作树 clean
  且 `HEAD` 等于最新 release tag。
- 高风险意图，如发布、推送、部署、删除、付费、凭证操作、生产变更和真实产品 / UX
  决策，在执行前都需要确认。

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
- OpenClaw host bridge 支持已冻结，仅保留只读扫描兼容。
- Hermes 是已验证的实验宿主 bridge，还不是正式跨平台支持矩阵。
- Intent Router 层与直接的能力匹配是分开的；当 prompt 不是安全的操作意图时，
  matcher 仍然负责 skill、command 和 MCP 路由。

## License

MIT
