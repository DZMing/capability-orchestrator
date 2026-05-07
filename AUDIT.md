# AUDIT

## 范围

- 仓库源码：`install.sh`、`scripts/scan-environment.cjs`、`scripts/route-matcher.cjs`、测试与 CI
- 文档契约：`README.md`、`ARCHITECTURE.md`、`SECURITY.md`、`SUPPORT.md`、`RELEASE.md`、`CLAUDE.md`
- 安装态：隔离测试目录与 clean-room Claude CLI

## 当前结论

- 当前结论：`PASS`
- 阻塞项：无 open `P0/P1`
- 适用标准：高质量长期自用工业标准
- 最近复核：2026-05-07，技术债收口分支 `codex/tech-debt-hardening`

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

### P1 已修复：Windows 安装脚本 fallback 版本漂移

- 现象：`install.ps1` 的 `$VersionFallback` 仍停在旧版本，`install.sh` 已是 `2.0.0`
- 修复：同步 PowerShell fallback，并把 `install.sh` / `install.ps1` fallback 纳入 release readiness 版本一致性检查
- 证据：`tests/release-readiness-check.test.cjs` 覆盖 fallback 解析和漂移阻断；`npm run verify:release` 输出 `installShFallbackVersion=2.0.0` 与 `installPs1FallbackVersion=2.0.0`

### P2 已修复：路由和扫描热点文件过大

- 现象：`scripts/route-matcher.cjs` 同时承担 tokenization、scoring、output rendering 和 CLI 主流程；`scripts/lib/scan-core.cjs` 同时承担 frontmatter、MCP、插件和宿主兼容扫描
- 修复：拆出 `route-keywords`、`route-scoring`、`route-output`、`scan-text`、`scan-mcp`、`scan-host-skills`、`scan-plugins`，保留原外部 exports
- 证据：`route-matcher.cjs` 从 662 行降到 411 行；`scan-core.cjs` 从 629 行降到 292 行；route/scan/integration focused tests 和全量 `npm test` 均通过

### P2 已修复：route / scan 测试文件过度聚合

- 现象：`tests/route-matcher.test.cjs` 与 `tests/scan.test.cjs` 同时承载纯单元、集成和端到端断言，后续改动容易误删边界覆盖
- 修复：按模块边界拆出 `route-keywords`、`route-scoring`、`route-output`、`scan-text`、`scan-mcp`、`scan-plugins`、`scan-host-skills` focused tests；历史聚合文件保留端到端、快照、渲染和跨模块集成断言
- 证据：`tests/route-matcher.test.cjs` 从 1585 行降到 951 行；`tests/scan.test.cjs` 从 1202 行降到 642 行；focused test 与全量 `npm test` 均通过

### P1 已修复：普通 prompt 每轮 hook 成本偏高

- 现象：Intent Router 在未知普通 prompt 上也可能读取 AGENTS、偏好文件和 route log
- 修复：改成两段式路径，先做 prompt-level intent 分类和高风险预检；只有短 prompt 或高风险动作才读取受限上下文
- 证据：`tests/intent-router.test.cjs` 覆盖普通未知 prompt 不读取上下文、短 prompt 读取上下文、高风险未知 prompt 进入 `risk_review`

### P1 已修复：安全闸门误触发普通技术词

- 现象：`tag`、`brand`、`ux` 等普通技术词可能触发确认，导致 HTML tag、CSS brand color、局部 UX spacing 这类低风险任务被拦
- 修复：按“动作 + 目标 + 作用域”组合判断风险；保留 publish / push / deploy / delete / paid / credential / production / real product decision / release tag 的确认闸门
- 证据：`tests/safety-gate.test.cjs` 覆盖 `git tag` / release / push 触发确认，`HTML tag` 和 `brand color in CSS` 不触发，`直接做 部署生产` 仍触发

### P2 已修复：路由质量不可量化

- 现象：只有离散场景测试，缺少覆盖短中文 prompt、英文 prompt、escape、高风险、MCP advisory、no-match 的统一 eval
- 修复：新增 `tests/fixtures/route-corpus.json` 和 route corpus 断言，用 precision / recall 风格锁定路由行为
- 证据：`tests/route-corpus.test.cjs` 已纳入默认 `npm test`

### P2 已修复：MCP / 插件来源缺少信任分级

- 现象：扫描结果能匹配 MCP / plugin，但 explain 和 route output 对 local / remote、auth、write、external access 的差异不够清楚
- 修复：扫描结果保留 `host`、`source`、`scope`、`surfaceType`、`invocation`、`transport`、`authRequired`、`mayWrite`、`externalAccess`；MCP 仍 advisory-only
- 证据：`tests/scan-mcp.test.cjs`、`tests/scan-plugins.test.cjs`、`tests/route-output.test.cjs`、`tests/route-matcher.test.cjs` 已覆盖

### P2 已修复：route log 可观测性不足

- 现象：只有单条路由记录，难以看到 no-match、误路由候选或确认闸门趋势
- 修复：route log 白名单化字段并新增匿名聚合统计，覆盖 prompt type、no-match、confirmation gate 和 low-confidence route candidates
- 证据：`tests/route-logger.test.cjs` 覆盖匿名字段白名单和聚合统计；`/stats` skill 已同步新指标

## 当前剩余风险

- 真实 Claude Code GUI 会话尚未做肉眼验收；功能级结论仍由 clean-room CLI、hook 事件、真实 `claude` / `codex` live 验证、scenario matrix 和安装链路验证支撑
- Windows 原生内核仍需 CI 的 `windows-latest` smoke；本机已用临时便携版 PowerShell Core 7.6.1 在当前工作区快照上跑通 `tests/install.windows.ps1`
- 当前 worktree 未提交，因此 `npm run verify:release:strict` 仍会因为 clean-worktree 条件失败；这是发布流程状态阻塞，不是功能测试失败

## 审核签字建议

- 按“长期稳定自用”标准：可以签字通过
- 若以后要按“公开发布/对外支持”标准继续打磨，再补 GUI 手工验收和 Windows 原生 CI 证据
