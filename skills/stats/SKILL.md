---
name: stats
description: "展示路由统计摘要：匹配率、热门目标、置信度分布。用于诊断路由健康度。"
allowed-tools: Bash Read
---

## 统计输出

!`node "${CLAUDE_SKILL_DIR}/../../scripts/route-stats.cjs"`

<!-- Codex: 如果上方命令未自动执行，请用 Bash 运行: node ~/.codex/plugins/cache/capability-orchestrator/scripts/route-stats.cjs -->

---

## 你的任务

当用户调用 `/stats` 时：

1. 上方命令已自动执行并输出统计摘要。
2. 把输出翻译成简短的中文解读：
   - 路由匹配率（routed / total）是否健康（>50% 正常）
   - 最常用的目标是哪些
   - 如果 `no-match` 占比高，说明哪些类型的需求没被覆盖
   - 置信度均值是否合理
3. 给出具体建议（如"考虑给 X 添加 skill"），但不要自行修改任何文件。
4. 不修改任何文件，不执行 install / uninstall，不改 `settings.json`。
