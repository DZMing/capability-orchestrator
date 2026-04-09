# Contributing

## 开发环境

```bash
git clone https://github.com/DZMing/capability-orchestrator.git
cd capability-orchestrator
```

需要 Node.js 18+，无其他依赖。

## 运行测试

```bash
# 单元测试
node --test tests/scan.test.cjs tests/skill-contract.test.cjs

# 安装脚本冒烟测试
bash tests/install.test.sh

# 幂等性测试
bash tests/install-idempotent.test.sh

# 全部
npm test && npm run test:install && npm run test:idempotent
```

## 提交规范

格式：`<type>(<scope>): <描述>`

类型：feat / fix / refactor / test / docs / chore

每次提交 <=50 行，测试全绿才提交。

## 代码风格

- 零依赖（仅 Node.js 标准库）
- 单文件架构（scan-environment.cjs），超 600 行时考虑拆分
- 所有用户可见文本用中文
- sanitize 所有注入 Claude 上下文的字符串
