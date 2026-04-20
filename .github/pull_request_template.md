## Summary

## Test plan

- [ ] `npm test` 通过
- [ ] `bash tests/install.test.sh` 通过
- [ ] `bash tests/install-idempotent.test.sh` 通过
- [ ] `npm run verify:release` 已检查（至少确认版本同步、`headMatchesLatestTag`、`worktreeClean`、`githubReleaseReady`）
- [ ] 如果改动触及真实 CLI / hooks / 路由：补充 `verify:live:claude` 或 `verify:live:codex` 结果
