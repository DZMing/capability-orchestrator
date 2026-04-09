---
name: refresh
description: "强制重新扫描环境能力并报告变化。在安装、卸载或更新插件后使用，用于确认新能力已就绪。"
disable-model-invocation: true
---

!`node "${CLAUDE_SKILL_DIR}/../../scripts/scan-environment.cjs"`

对比本次扫描结果与你之前对当前环境能力的认知，报告：

- 新增的能力（skills / agents / plugins / MCP servers）
- 移除的能力
- 如果没有变化，说明"环境能力无变化"
