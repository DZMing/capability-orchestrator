---
name: debug-route
description: "解释一条用户消息为什么会命中某个 skill/command/MCP，或为什么被放行。用于排查误路由和回归测试。"
allowed-tools: Bash Read
---

## explain 示例

!`node "${CLAUDE_SKILL_DIR}/../../scripts/debug-route-example.cjs"`

<!-- Codex: 如果上方命令未自动执行，请用 Bash 运行: node ~/.codex/plugins/cache/capability-orchestrator/scripts/debug-route-example.cjs -->

---

## 你的任务

当用户调用 `/debug-route` 时：

1. 取本次请求中要分析的那条用户消息作为目标 prompt；如果用户没有单独给出，就用当前请求里除 `/debug-route` 之外的内容。
2. 调用 `node scripts/route-matcher.cjs --explain`，输入与 hook 相同的 JSON：
   - `prompt`: 目标消息
   - `cwd`: 当前项目目录
3. 把 explain JSON 翻译成简短中文，至少说明：
   - 这是路由还是放行
   - 命中了什么目标（skill / command / mcp）
   - 命中的关键词
   - 如果没命中，是 `escaped` / `too-short` / `no-match` 哪一种
4. 不修改任何文件，不执行 install / uninstall，不改 `settings.json`。
