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

## 当前剩余风险

- 真实 Claude Code GUI 会话尚未做肉眼验收
- install release tag 时，git 会输出 detached-head 提示；当前不影响正确性，但仍有体验优化空间
- `OPEN_SOURCE_READINESS_AUDIT.md` 与 `ROADMAP.md` 属于研究/路线文档，不影响自用签字，但不应被误读为当前阻塞项清单

## 审核签字建议

- 按“长期稳定自用”标准：可以签字通过
- 若以后要按“公开发布/对外支持”标准继续打磨，再补 GUI 手工验收和 release 体验优化
