---
name: orchestrate
description: "感知当前环境全部可用能力（skills/agents/plugins/MCP/commands），并根据任务自动选择最优执行路径。收到复杂或模糊任务时自动使用。"
allowed-tools: Read Grep Glob Bash Agent
---

## 当前环境能力快照

!`node "${CLAUDE_SKILL_DIR}/../../scripts/scan-environment.cjs"`

---

## 路由策略

收到任务后，按以下优先级决定执行路径：

1. **任务简单且明确** → 直接执行，不调用任何 skill/agent，直接做是最短路径
2. **任务匹配某个 skill 的 description** → 优先使用该 skill（通过 `/skill-name` 或让 Claude 自动调用）
3. **任务需要专业化或隔离执行** → 委派给 description 最匹配的 subagent（`@agent-name`）
4. **任务涉及外部服务且有对应 MCP server** → 通过对应的 MCP 工具调用，不重复造轮子
5. **以上都不匹配** → 用自身能力直接完成，不强行路由

**核心原则：不要为了"使用能力"而使用能力。没有能力比直接做更快时，直接做。**
