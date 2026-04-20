# Release Policy

这个项目采用轻量的手工发布流程。

## 版本策略

从这个文档开始，仓库层面的 release 以 semantic versioning 为预期。

- Patch：向后兼容的修复、文档修复、兼容性说明修正、仅测试变更
- Minor：向后兼容的新功能或行为扩展
- Major：安装行为、文档声明的兼容性、公开命令面或路由契约发生破坏性变化

只有最新 tag release 受支持。

默认安装渠道也应指向最新 tag release；`master` 只作为显式自用渠道存在，不进入
默认支持承诺。

## 发布前检查清单

切 release 之前必须检查：

1. `README.md`、`SECURITY.md`、`SUPPORT.md`、`RELEASE.md`、
   `CONTRIBUTING.md` 和 issue 模板之间没有互相矛盾。
2. `package.json`、`.claude-plugin/plugin.json` 和 `.codex-plugin/plugin.json` 中的版本号已同步。
3. `CHANGELOG.md` 已更新。
4. 安装、升级、卸载和回滚说明仍然和仓库真实行为一致。
5. 工作区除了本次 release 需要的改动外保持干净。

## 必跑验证

打 tag 前必须执行：

```bash
npm test
bash tests/install.test.sh
bash tests/install-idempotent.test.sh
npm run verify:release
```

任一命令失败，都不要打 release tag。

另外，`npm run verify:release` 的 JSON 输出必须人工检查：

- `versionSyncOk` 和 `changelogSyncOk` 必须为 `true`
- 打 tag 之前，`worktreeClean` 必须为 `true`
- 打 tag 并 push 完之后，重新执行一次，确认 `headMatchesLatestTag` 变为 `true`

## 打 tag 与发布

标准流程：

1. 将 release-ready 的变更合并到默认分支。
2. 创建 `vX.Y.Z` 形式的 annotated tag。
3. 推送这个 tag。
4. 发布 GitHub release notes，至少总结：
   - 关键变化
   - 兼容性变化
   - 升级说明
   - 如果安装或 hook 行为变了，要补回滚说明

## 发布后验证

发布后至少验证：

```bash
bash install.sh --version
node scripts/scan-environment.cjs --mode=awareness
printf '%s' '{"prompt":"输出当前环境的全部可用能力摘要","cwd":"."}' | node scripts/route-matcher.cjs --explain
```

同时确认最新 release 文档仍然指向当前 tag，README 里的安装说明没有漂移。

如果发布验证依赖 `verify:live:claude` / `verify:live:codex`，应确认它们验证的是“当前工作区快照”，而不是某个旧 release 安装副本。

## 回滚策略

回滚是手工流程。

### 如果已安装副本是 git checkout

```bash
git -C ~/.claude/plugins/cache/capability-orchestrator fetch --tags
git -C ~/.claude/plugins/cache/capability-orchestrator checkout vX.Y.Z
```

因为 Claude Code 的 hooks 指向的是同一个安装路径，所以同目录内 tag 之间回滚
不需要重写 settings。

### 如果已安装副本不是 git checkout

删除当前安装目录，再换成指定 tag：

```bash
rm -rf ~/.claude/plugins/cache/capability-orchestrator
git clone --branch vX.Y.Z --depth=1 https://github.com/DZMing/capability-orchestrator.git \
  ~/.claude/plugins/cache/capability-orchestrator
```

无论走哪条回滚路径，回滚后都要重新执行 `README.md` 里的验证命令。

## 何时算破坏性变更

以下变化需要 major version：

- 改变安装哪些 hooks 或 hooks 如何注册
- 改变文档声明的支持平台或最低运行时要求
- 删除已文档化的 skill，或改变其预期契约
- 改变公开承诺的回滚或卸载保证
