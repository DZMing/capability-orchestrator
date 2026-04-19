# Contributing

## 开发环境

```bash
git clone https://github.com/DZMing/capability-orchestrator.git
cd capability-orchestrator
```

要求：

- Node.js 18+
- 无额外运行时依赖

## 提 PR 前请先确认

请尽量保持改动小而聚焦。

推荐的贡献形态：

- 一个 PR 只做一件清晰的事
- 不要把无关清理混进同一 PR
- 行为变化时，文档和实现要一起更新
- README、SECURITY、SUPPORT、RELEASE 和 issue 模板要保持一致

如果你改的是纯文档，也要把这些 policy 文档当作公开产品面来维护。改其中一份
时，请顺手检查其他几份有没有漂移：

- `README.md`
- `SECURITY.md`
- `SUPPORT.md`
- `RELEASE.md`
- `CONTRIBUTING.md`
- `.github/ISSUE_TEMPLATE/bug_report.md`

## 运行测试

> 注意：仓库内置的安装测试使用临时 `CLAUDE_USER_DIR`，不会改动你真实的
> `~/.claude/settings.json`。手动执行 `install.sh` 则会改动真实设置。

```bash
# 完整自动化基线
npm test
bash tests/install.test.sh
bash tests/install-idempotent.test.sh

# 或直接跑封装脚本
npm run test:all

# 手工调试 explain 输出
printf '%s' '{"prompt":"输出当前环境的全部可用能力摘要","cwd":"."}' \
  | node scripts/route-matcher.cjs --explain
```

## 维护预期

这个仓库采用轻量 review 流程。

- 欢迎 bug 修复、测试补充和文档澄清。
- 只要改动会影响安装行为、hook 注册、支持平台或公开路由契约，就必须在同一
  个 PR 里更新对应文档。
- 破坏性变化必须在 PR 摘要里明确点出，并与 `RELEASE.md` 保持一致。
- 安全敏感问题不要走普通 PR 流程，请遵循 `SECURITY.md`。

## 提交风格

格式：

```text
<type>(<scope>): <description>
```

推荐类型：

- `feat`
- `fix`
- `refactor`
- `test`
- `docs`
- `chore`

## 代码风格

- 除 Node.js 标准库外保持零依赖
- 即使内部重构，稳定入口也应尽量保持稳定
- 用户可见文本在公开文档中保持一致
- 所有注入 Claude 上下文的字符串都要 sanitize
