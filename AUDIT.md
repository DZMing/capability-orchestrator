# AUDIT

## 范围

- 仓库源码：`install.sh`、`scripts/scan-environment.cjs`、`scripts/route-matcher.cjs`、测试与 CI
- 本机安装态：`~/.claude/plugins/cache/capability-orchestrator`
- Claude Code 配置态：`~/.claude/settings.json` 中由 capability-orchestrator 注册的 hooks

## 结论

- 当前结论：`PASS`
- 阻塞项：无 open `P0/P1/P2`
- 审核结果：核心安装契约、运行契约、hook 生效链路和现有测试矩阵已对齐

## 已验证并修复的问题

### P1 已修复：`CLAUDE_USER_DIR` 安装与运行目录不一致

- 现象：安装脚本支持 `CLAUDE_USER_DIR`，运行时脚本却 fallback 到默认 `~/.claude`
- 影响：自定义 home 安装后，运行时扫错用户目录
- 修复：运行时统一识别 `CAPABILITY_USER_DIR` / `CLAUDE_USER_DIR`，安装写入的 hook 显式带上 `CLAUDE_USER_DIR`
- 证据：新增集成测试与 e2e 测试覆盖自定义用户目录安装/路由

### P1 已修复：坏掉的 `settings.json` 会被静默覆盖

- 现象：安装阶段解析 JSON 失败时吞错并以空配置写回
- 影响：会丢失用户原有 `model`、`permissions`、其他 hooks
- 修复：安装阶段改为解析失败即退出，保留原文件不动
- 证据：新增集成测试覆盖 malformed `settings.json`

### P2 已修复：卸载会误删同 entry 内其他 hook

- 现象：只要 entry 中任意一个 command 命中 `capability-orchestrator`，整个 entry 都被删除
- 影响：同组中的无关 `SessionStart` / `UserPromptSubmit` hook 会被一起删掉
- 修复：卸载时只删除命中的 hook，保留同 entry 内其他命令
- 证据：新增集成测试覆盖 shared-entry 场景

### P1 已修复：`route-matcher` 命中 skill 时泄漏原始 `!command`

- 现象：命中 `capabilities` / `orchestrate` / `refresh` 等 skill 时，注入的是未渲染的 `SKILL.md` 原文
- 影响：Claude 收到的是原始 `!command` 文本，而不是明确的 skill 调用动作，动态内容不会真正执行
- 修复：`route-matcher` 现在注入明确的 `/<skill-name>` 调用指令，不再内联未渲染的 skill 正文
- 证据：新增 e2e 测试断言命中 skill 时不再出现原始 `!``...```

### P3 已修复：文档与真实 hook 命令不一致

- 现象：`README.md` / `ARCHITECTURE.md` 里的 hook 示例仍是旧写法，未体现 `CLAUDE_USER_DIR`
- 影响：手动配置 hook 时容易配出和安装脚本不同的行为
- 修复：文档示例统一改为和安装脚本一致，同时补上 `UserPromptSubmit` 示例

### P3 已修复：本机安装副本被 `.orphaned_at` 垃圾文件污染

- 现象：本机已安装 repo 中出现多处 `.orphaned_at`，导致 `git status` 持续有噪音
- 影响：本机安装态审计和升级排障成本变高
- 修复：仓库 `.gitignore` 新增 `.orphaned_at`

### P3 已修复：`scan-environment.cjs` 单文件复杂度过高

- 现象：核心扫描、渲染和 CLI 入口长期堆在同一个入口文件里
- 影响：后续继续迭代时，回归定位和行为对齐成本越来越高
- 修复：内部拆为 `scan-core` / `scan-render` / `user-dir`，保留 `scripts/scan-environment.cjs` 稳定入口

### P3 已修复：缺少正式的路由可解释性调试入口

- 现象：误路由排查只能靠看源码或手工猜测匹配过程
- 影响：回归测试、人工排障和审计说明都比较费劲
- 修复：新增 `route-matcher --explain` 与 `/debug-route`

## 当前剩余风险

- 无 open `P1/P2`
- 当前仅剩常规维护性优化项，不阻塞使用或发布

## 审核签字建议

- 可以签字通过
- 当前版本可继续推进合并与发布
