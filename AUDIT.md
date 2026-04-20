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

## 当前剩余风险

- 真实 Claude Code GUI 会话尚未做肉眼验收，但功能级结论已由 clean-room CLI 的 hook 事件、输出和 debug 日志支撑
- `OPEN_SOURCE_READINESS_AUDIT.md` 与 `ROADMAP.md` 属于研究/路线文档，不影响自用签字，但不应被误读为当前阻塞项清单

## 审核签字建议

- 按“长期稳定自用”标准：可以签字通过
- 若以后要按“公开发布/对外支持”标准继续打磨，再补 GUI 手工验收和 release 体验优化
