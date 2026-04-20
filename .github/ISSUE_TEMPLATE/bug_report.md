---
name: Bug report
about: 报告一个问题
labels: bug
---

> 安全漏洞不要公开提交 issue。请改走仓库根目录的 `SECURITY.md`。

**问题描述**

**复现步骤**

1.
2.

**期望行为**

**实际行为**

**环境**

- OS:
- Node.js 版本:
- Claude Code 版本:
- Codex 版本:
- 安装方式: git / curl
- 是否自定义 `CLAUDE_USER_DIR`:
- 是否自定义 `CODEX_USER_DIR`:

**建议附加信息**

- `node scripts/release-readiness-check.cjs` 输出
- 如为 Claude 路由问题：`npm run verify:live:claude` 的摘要
- 如为 Codex 路由问题：`npm run verify:live:codex` 的摘要
