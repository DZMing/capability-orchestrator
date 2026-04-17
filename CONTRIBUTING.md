# Contributing

## 开发环境

```bash
git clone https://github.com/DZMing/capability-orchestrator.git
cd capability-orchestrator
```

需要 Node.js 18+，无其他依赖。

## 运行测试

> **注意**: 仓库内置的安装测试默认使用临时 `CLAUDE_USER_DIR`，不会污染真实 `~/.claude/settings.json`。
> 如果你手动执行 `install.sh` 或手动验证 hook，才会改动真实 `settings.json`。

```bash
# 单元测试
node --test tests/scan.test.cjs tests/skill-contract.test.cjs

# 安装脚本冒烟测试
bash tests/install.test.sh

# 幂等性测试
bash tests/install-idempotent.test.sh

# 全部
npm test && npm run test:install && npm run test:idempotent

# 调试 explain 输出
printf '%s' '{"prompt":"输出当前环境的全部可用能力摘要","cwd":"."}' \
  | node scripts/route-matcher.cjs --explain
```

## 提交规范

格式：`<type>(<scope>): <描述>`

类型：feat / fix / refactor / test / docs / chore

每次提交 <=50 行，测试全绿才提交。

## 代码风格

- 零依赖（仅 Node.js 标准库）
- 稳定入口允许存在，但复杂逻辑优先拆到 `scripts/lib/`
- 所有用户可见文本用中文
- sanitize 所有注入 Claude 上下文的字符串
