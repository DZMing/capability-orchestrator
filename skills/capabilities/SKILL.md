---
name: capabilities
description: "输出当前环境的全部可用能力摘要（skills/agents/plugins/MCP/commands）。不做路由判断，只展示。安装/升级插件后可用此命令查看最新状态。"
disable-model-invocation: true
---

!`node "${CLAUDE_SKILL_DIR}/../../scripts/scan-environment.cjs" --mode=list`

<!-- Codex: 如果上方命令未自动执行，请用 Bash 运行: node <plugin-dir>/scripts/scan-environment.cjs --mode=list -->
