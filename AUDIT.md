# AUDIT

## 范围

- 仓库源码：`install.sh`、`scripts/scan-environment.cjs`、`scripts/route-matcher.cjs`、测试与 CI
- 文档契约：`README.md`、`ARCHITECTURE.md`、`SECURITY.md`、`SUPPORT.md`、`RELEASE.md`、`CLAUDE.md`
- 安装态：隔离测试目录与 clean-room Claude CLI

## 当前结论

- 当前结论：`PASS`
- 阻塞项：无 open `P0/P1`
- 适用标准：高质量长期自用工业标准

## 已验证并修复的问题

### P1 已修复：默认安装绕过支持策略

- 现象：默认安装原本固定到 `master`，与“只支持最新 release”冲突
- 修复：默认安装改为最新 tag release，显式保留 `master` 自用渠道
- 证据：`tests/install*.sh` 与 `tests/integration.test.cjs` 已覆盖 release/master 两种路径

### P2 已修复：维护者同步说明遗漏 `scripts/lib/*.cjs`

- 现象：`CLAUDE.md` 只让维护者复制 `scripts/*.cjs`
- 修复：同步命令补入 `scripts/lib/*.cjs`
- 证据：文档已更新，当前实现与维护说明一致

### P2 已修复：legacy command fallback 重新引入 slash 语义

- 现象：unsafe command fallback 文案会重新出现 `/<name>`
- 修复：fallback 文案改为纯命令定义语义，并增加测试锁定
- 证据：`tests/route-matcher.test.cjs` 已覆盖

### P2 已修复：README 回滚示例写死旧 tag

- 现象：用户回滚示例固定为过时 tag
- 修复：改成 `vX.Y.Z` 占位
- 证据：README 已更新

### P2 已修复：git 安装副本会因 `chmod +x` 变脏

- 现象：`route-matcher.cjs` 仓库 tracked mode 为 `100644`，安装器会把 git 副本弄脏
- 修复：将 `scripts/route-matcher.cjs` tracked mode 改为可执行
- 证据：幂等安装和 integration 测试通过

### P1 已修复：失败重装会先删旧安装

- 现象：clone / extract 失败时，旧安装会在新安装落地前被删掉
- 修复：安装器改为 stage → swap；失败回滚保留旧安装
- 证据：`tests/install.test.sh` 已覆盖失败重装保留旧安装

### P1 已修复：Codex 自动检测与共享平台契约不一致

- 现象：仅设置 `CODEX_USER_DIR` 时，安装器仍可能走 Claude 路径
- 修复：平台自动检测改成 env-first，同时保留双安装场景下的 Claude 默认优先，并补 Codex 自动检测安装/卸载回归
- 证据：`tests/install.test.sh` 已覆盖 `CODEX_USER_DIR` 自动检测和 dual-install 默认 Claude

### P2 已修复：插件元数据版本漂移

- 现象：`.claude-plugin/plugin.json` 版本落后于 `package.json`
- 修复：同步 Claude manifest，新增 `.codex-plugin/plugin.json`，并加版本一致性测试
- 证据：`tests/skill-contract.test.cjs` 已覆盖

### P1 已修复：live verifier 可误判为通过

- 现象：Claude 只要任意 JSON 行里同时出现 `[AUTO-ROUTE]` 与 `valid-skill` 就会通过；Codex 只要 stdout 提到 `valid-skill` 就会通过
- 修复：Claude 必须在同一条 `UserPromptSubmit` hook 响应里看到目标路由；Codex 必须在 fresh `route-log.jsonl` 中看到目标 skill 路由条目
- 证据：新增 `tests/live-verify.test.cjs`，并已重跑 `npm run verify:live:claude` / `npm run verify:live:codex`

### P1 已修复：live verifier 原先验证的不是当前工作区

- 现象：live verifier 先装远端 ref，再直接执行真实 CLI，无法证明当前未发版工作区代码
- 修复：保留 `install.sh` 注册 hooks 的真实链路，但在隔离安装目录里覆盖成当前工作区快照后再跑真实 CLI
- 证据：本轮 live 验收输出显示最小 fixture 环境，且 route 证据来自当前工作区快照

### P2 已修复：release tag 安装仍会打印 annotated-tag / detached HEAD 噪音

- 现象：`git clone --branch vX.Y.Z` 安装 annotated tag 时会打印 `is not a commit` 与 detached HEAD 提示
- 修复：tag 安装改成 `clone default -> fetch tag -> quiet checkout`
- 证据：`tests/install.test.sh` 已新增断言，锁定 release tag 安装日志不得再出现上述噪音

### P2 已修复：git worktree 脏改动会绕过安装器保护

- 现象：原保护条件只检查 `.git/` 目录，git worktree 的 `.git` 文件会绕过 dirty guard
- 修复：改为检测 `.git` 文件或目录，并补 worktree 脏改动回归测试
- 证据：`tests/install.test.sh` 新增 worktree 场景，当前通过

### P2 已修复：hook 所有权识别过宽

- 现象：安装/卸载只要命令字符串包含 `capability-orchestrator` 就认定归本插件所有，可能误伤用户自定义 wrapper
- 修复：切换为精确的 hook marker（`CAPABILITY_ORCHESTRATOR_HOOK=*`）与 legacy 脚本路径双轨识别
- 证据：`tests/install-idempotent.test.sh` 现在覆盖带 `capability-orchestrator-helper.js` 的无关 hook 保留

## 当前剩余风险

- 真实 Claude Code GUI 会话尚未做肉眼验收，但功能级结论已由 clean-room CLI 的 hook 事件、输出和 debug 日志支撑
- 当前机器上的 Claude OAuth 令牌在 live run 中返回 `401 authentication_failed`；路由证据已在重试前落出，这属于本机凭证噪音，不是插件路由缺陷
- `OPEN_SOURCE_READINESS_AUDIT.md` 与 `ROADMAP.md` 属于研究/路线文档，不影响自用签字，但不应被误读为当前阻塞项清单

## 审核签字建议

- 按“长期稳定自用”标准：可以签字通过
- 若以后要按“公开发布/对外支持”标准继续打磨，再补 GUI 手工验收和 release 体验优化
