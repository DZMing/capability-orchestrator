# VERIFICATION

## 验证范围

- 源仓库自动化测试
- 安装/卸载/幂等安装链路
- `SessionStart` / `UserPromptSubmit` 的 CLI 级等价验证
- Intent Router 执行契约层验证
- clean-room Claude CLI 真实行为验证
- Hermes 实验宿主 bridge 验证
- OpenClaw scan-only 兼容面验证，不再声明 host bridge 安装验证

## 环境

- 本机 Node：`v25.8.1`
- 本轮临时 PowerShell：便携版 PowerShell Core `7.6.1`（下载到 `/tmp`，未全局安装）
- CI 矩阵：`ubuntu-latest` / `macos-latest` + `Node 18/20/22`，另有 `windows-latest` 的 PowerShell 安装冒烟
- 本机无 `nvm/fnm/mise/asdf` 等版本管理器，因此未在本机重复跑 `18/20/22`

## 自动化测试

### 1. 仓库测试总入口

命令：

```bash
npm test
npm run test:all
bash tests/install.test.sh
bash tests/install-idempotent.test.sh
```

结果：

- `npm test` 通过
- 自动化总数以 `npm test` 的 TAP 汇总为准；2026-05-07 复验为 `361` tests / `5` suites
- `npm run test:all` 通过，包含 `npm test`、install smoke 和 idempotent smoke
- `bash tests/install.test.sh` 通过
- `bash tests/install-idempotent.test.sh` 通过

### 2. 关键回归点

已覆盖并通过的关键场景：

- `CLAUDE_USER_DIR` 自定义目录安装/路由
- malformed `settings.json` 安全失败
- 卸载保留 shared-entry 中的无关 hook
- 命中 skill 时不泄漏原始 `!command`
- legacy command 的 slash 主路径与 fallback 路径
- `--explain` 对 skill / command / mcp / no-match / escaped / too-short 的稳定 JSON 输出
- `install.sh` 默认 release 渠道
- `install.sh` 显式 `master` 渠道
- 失败重装保留旧安装
- `CODEX_USER_DIR` 自动检测走 Codex hooks 路径
- Claude / Codex plugin manifest 版本一致
- `install.sh` / `install.ps1` fallback 版本与 `package.json` 一致
- route matcher / scan core 的拆分模块均有 focused tests，历史聚合测试保留集成与端到端覆盖
- PowerShell Core 正斜杠 `.cmd` hook marker 可被卸载识别，避免非 Windows PowerShell smoke 残留 hook
- `/debug-route` skill 合约测试
- Intent Router 两段式路径：普通未知 prompt 不读取 work-context / profile / route log，短 prompt 和高风险 prompt 才读取受限上下文
- safety gate 组合判断：`git tag` / release / push / production deploy 触发确认，`HTML tag` / `brand color in CSS` 不触发
- route corpus eval 覆盖中文短 prompt、英文 prompt、低风险 escape、高风险 escape、skill、legacy command、MCP advisory 和 no-match
- MCP / plugin 扫描结果保留 host / source / scope / surfaceType / invocation / transport / authRequired / mayWrite / externalAccess
- route log 只写入白名单匿名字段，统计输出覆盖 prompt type、no-match、confirmation gate 和 low-confidence route candidates

### 2.1 Intent Router 执行契约层

这组测试已经纳入默认 `npm test`；如需单独复跑，仍可用 `node --test`
覆盖 Intent Router 的独立数据流。

命令：

```bash
node --test tests/intent-classifier.test.cjs tests/intent-router.test.cjs \
  tests/safety-gate.test.cjs tests/prompt-composer.test.cjs \
  tests/work-context.test.cjs tests/preference-profile.test.cjs
```

结果：

- `继续` / `执行吧` / `还有什么没做完` / `做到可以商用` 会映射到各自 intent
- `继续` 这类安全短口令会输出完整的五段式执行契约
- 发布、推送、部署、删除、付费、凭证、生产和真实产品 / UX 决策会触发确认闸门
- 偏好文件会先去除 secret-like 内容，再按 project 优先于 global 的顺序收集
- 工作上下文会读取受限的项目规则、git summary 和最近 route log
- 未知普通 prompt 不读取工作上下文、偏好文件或 route log
- `HTML tag`、`brand color in CSS`、局部 UX spacing 不会被普通技术词误判为高风险
- 高风险未知 prompt 会输出 `risk_review` confirmation gate，即使包含 escape wording

## 安装链路验证

### 1. 默认安装渠道

结果：

- 默认安装会解析到最新 tag release
- 默认支持模型与 `SECURITY.md` / `SUPPORT.md` / `RELEASE.md` 保持一致

### 2. 显式 `master` 渠道

结果：

- `--channel=master` 可显式安装未发布分支
- 该渠道仅作为自用入口，不进入默认支持承诺

### 3. 幂等性

结果：

- 重复安装不会产生重复 hook
- 原有 `model` / `permissions` / 无关 hook 条目保留

## CLI 级等价验证

### 1. `SessionStart` 等价验证

命令：

```bash
node "$HOME/.claude/plugins/cache/capability-orchestrator/scripts/scan-environment.cjs" --mode=awareness
```

结果：

- 输出包含 `环境能力感知`
- 输出包含 skills / subagents / plugins / MCP servers 摘要

### 2. `UserPromptSubmit` explain 验证

命令：

```bash
printf '%s' '{"prompt":"输出当前环境的全部可用能力摘要","cwd":".../capability-orchestrator"}' \
  | CLAUDE_USER_DIR="$HOME/.claude" \
    node "$HOME/.claude/plugins/cache/capability-orchestrator/scripts/route-matcher.cjs" --explain
```

结果：

- 返回稳定 JSON
- explain 输出不包含原始 `!command`

## clean-room Claude CLI 验证

## 1. 验证方法

做法：

- 新建临时 `HOME`
- 只复制 `~/.claude/.credentials.json` 保留登录态
- 使用隔离的临时 `CLAUDE_USER_DIR`
- 同步 `~/.claude/settings.json` 中的运行时 `model + env`
- 在该目录安装插件
- 再把当前工作区版本同步到临时插件目录，确保验证的是当前工作区，而不是旧 tag
- 用真实 `claude` CLI 跑 `stream-json + include-hook-events + debug-file`

## 2. clean-room `SessionStart`

结果：

- 真实触发 `SessionStart` hook
- 输出最小 fixture 环境摘要：
  - `1 skills`
  - `1 subagents`
  - `1 plugins`
  - `1 MCP servers`
  - `1 Legacy Commands`
- 说明验证未混入真实用户目录中的全局 skills / hooks / plugins

## 3. clean-room skill 路由

输入 prompt：

```text
I need a valid test skill for this important task
```

结果：

- `UserPromptSubmit` 真实触发
- 真实输出 `[AUTO-ROUTE]`
- 命中 `valid-skill`
- 输出包含明确的 `立即调用：/valid-skill`

## 4. clean-room legacy command 路由

输入 prompt：

```text
/legacy-cmd
```

结果：

- `UserPromptSubmit` 真实触发
- 真实输出 `[AUTO-ROUTE]`
- 命中 `/legacy-cmd`
- 输出同时包含：
  - `立即调用：/legacy-cmd`
  - `能力建议`
  - `不要执行扫描到的命令正文`

这证明当前工作区里的 legacy command 新契约已经在真实 Claude CLI 行为中生效，同时不会把扫描到的命令正文注入执行面。

## 5. 2026-04-20 命令 + 日志级复验

做法：

- 重新创建隔离 `CLAUDE_USER_DIR`
- 用当前工作区版本安装插件
- 运行真实 `claude -p --verbose --output-format stream-json --include-hook-events --debug-file ...`
- 读取 stream-json 输出与 debug 尾日志

结果：

- 真实出现多条 `SessionStart` hook 事件
- stream 输出中出现 capability-orchestrator 注入的 awareness 内容
- `UserPromptSubmit` 真实触发，输出里能看到 `[AUTO-ROUTE]` 与 `valid-skill`
- 这条 live run 在 20s 窗口内没有完整结束，但 hook 证据已经落出

观察到的额外噪音：

- debug 尾日志里有用户环境中的 `plugin:github:github` MCP 认证格式错误重试
- 该噪音不影响 capability-orchestrator 的 `SessionStart` / `UserPromptSubmit` 证据判定，但说明真实用户环境仍可能夹带外部 MCP 干扰项

## 6. 仓库内置 live 验收脚本

当前仓库已提供：

```bash
npm run verify:live:claude
npm run verify:live:codex
npm run test:all
npm run verify:scenarios
npm run verify:host:hermes
npm run verify:host:lifecycle
npm run verify:release
npm run verify:release:strict
```

说明：

- `verify:live:claude`：隔离 `HOME + CLAUDE_USER_DIR`，用 `install.sh` 注册 hooks 后再覆盖成当前工作区快照，并继承真实 `settings.json` 中的 `model + env` 运行时配置，调用真实 `claude` CLI，要求同一条 `UserPromptSubmit` hook 响应中同时出现 `[AUTO-ROUTE]` 和目标 skill
- `verify:live:codex`：隔离 `HOME + CODEX_HOME + CODEX_USER_DIR`，用 `install.sh` 注册 hooks 后再覆盖成当前工作区快照；脚本会直接执行安装后的 Codex `SessionStart` / `UserPromptSubmit` hook 命令并要求 fresh `route-log.jsonl` 出现目标 skill 路由条目，同时调用真实 `codex exec` 证明当前 Codex CLI 能加载并使用 `valid-skill`
- `verify:scenarios`：在隔离 fixture 中分别模拟 Claude / Codex 目录表面，覆盖短提示词五段合同、高风险确认闸门、低风险 escape passthrough、skill 调用格式、MCP advisory-only、legacy command 不注入正文，以及偏好 / 项目规则里的 secret redaction
- `verify:release`：pre-landing audit，用于检查版本/manifest/changelog 同步、GitHub Release 状态和 OpenClaw host bridge 冻结边界；它会报告 `HEAD` 是否已经等于最新 tag、以及工作树是否 clean，但不会把 dirty/ahead 工作树当作审查失败
- `verify:release:strict`：真实发布前 hard release gate；除 `verify:release` 的检查外，还要求工作树 clean 且 `HEAD` 等于最新 release tag
- `verify:host:hermes`：在隔离 `HERMES_HOME` 下把 Hermes adapter bridge 包装成临时 git repo，并验证：
  - `hermes plugins install file://...` 返回成功
  - `hermes plugins list` 可见 `capability-orchestrator`
  - plugin slash command `cap-orch` 可返回 status / route bridge 输出
  - `pre_llm_call` hook 可注入 awareness context
  - `disable / enable / remove` 管理链路可闭环
- `verify:host:lifecycle`：用当前工作区生成隔离临时 git 源，并通过 `install.sh` 验证：
  - Hermes install / reinstall / slash bridge / pre-LLM bridge / disable / enable / uninstall
  - 卸载后宿主视角不再可见该 adapter

注意：

- 这两个 live 脚本的通过标准都是“目标路由证据已经出现”，不是要求所有 hook 或 route-log 侧信号在每台机器上都完全一致
- Claude live 验收更稳定地依赖 stream-json 中出现 `[AUTO-ROUTE]` 和目标 skill
- Codex live 验收更稳定地依赖真实 `codex exec` 已进入目标 skill 工作流，route log 仍视为 best-effort 证据

## 2026-05-07 全方位复验

本轮在 `codex/tech-debt-hardening` 上完成以下验证：

- `npm test`：通过，`361` tests / `5` suites
- `npm run test:all`：通过，包含 `npm test`、`test:install`、`test:idempotent`
- `npm run verify:scenarios`：通过，`31` 个 Claude / Codex 场景
- `npm run verify:release`：通过 pre-landing audit，`prelandingAuditOk=true`，`releaseAuditOk=true`
- `npm run verify:release:strict`：按预期失败，唯一 blocker 是 `worktree is not clean`
- `npm run verify:host:hermes`：通过 install / list / bridge / disable / reenable / remove
- `npm run verify:host:lifecycle`：通过 Hermes install / reinstall / bridge / disable / enable / uninstall / removed
- `npm run verify:live:claude`：通过，真实 Claude CLI 触发 hook 并命中目标 skill route
- `npm run verify:live:codex`：通过，真实 Codex CLI 可加载 skill，fresh route log 出现目标路由条目
- `git diff --check`：通过

## 未完成的部分

- 没有直接打开 Claude Code 桌面 GUI 做肉眼会话验收
- 本机用临时 portable PowerShell Core 7.6.1 跑过当前工作区快照的 `tests/install.windows.ps1`；Windows 原生内核 smoke 仍交给 CI 的 `windows-latest`
- 但当前功能级签字建立在 clean-room CLI + stream-json hook 事件 + debug 日志上；GUI 不再是功能正确性的前置条件
- OpenClaw host bridge 当前冻结，仅保留 scan-only 兼容面
- Hermes 当前仍是实验宿主路径，而非正式支持承诺
- 当前保守点主要是正式支持矩阵、Windows 原生支持、以及更广泛宿主生命周期承诺
- Intent Router 已接入主 `UserPromptSubmit` hook；短 prompt 与高风险动作会先
  生成 execution contract 或 confirmation gate，未命中的请求再回退到
  skill / command / MCP matcher
- 严格 release gate 仍要求 clean worktree；当前分支有未提交改动，因此不应直接发 tag

## 最终结论

- 自动化测试：通过
- 安装/卸载/幂等链路：通过
- 文档 / 实现 / 配置一致性：通过
- clean-room Claude CLI：通过
- live Claude / Codex：通过
- Hermes host / lifecycle：通过
- pre-landing release audit：通过
- strict release gate：未通过，原因是 worktree 未提交
- portable PowerShell Windows install smoke：通过
- 严格手工 GUI 验收：未做

如果标准是“高质量长期自用工业标准”，当前状态可签字通过。
