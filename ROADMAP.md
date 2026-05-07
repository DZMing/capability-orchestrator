# Roadmap

更新时间：2026-05-07

这个文件记录后续优化方向，不替代正式契约。正式行为以
`README.md`、`SECURITY.md`、`SUPPORT.md`、`RELEASE.md` 为准。

## 已完成

- `SECURITY.md`
- `SUPPORT.md`
- `RELEASE.md`
- `CODEOWNERS`
- release-first 默认安装模型
- 显式 `master` 自用安装渠道
- legacy command 新契约：优先 slash command，必要时安全回退
- clean-room Claude CLI 真实验收
- 安装链路 stage/swap 原子重装
- `CODEX_USER_DIR` 自动检测收口
- release tag 安装 detached-head 提示去噪
- Windows / shell installer fallback 版本漂移护栏
- route matcher 与 scan core 热点拆分
- route / scan 测试文件按模块边界分层
- 便携 PowerShell Core 安装脚本 smoke 与 Codex live 验证补强
- Intent Router 两段式路径：普通未知 prompt 不读取上下文，短 prompt / 高风险动作才读取受限上下文
- safety gate 按动作、目标、作用域组合判断，减少 HTML tag / brand color / 局部 UX 等误触发
- route corpus eval 覆盖短中文 prompt、英文 prompt、escape、高风险、skill、command、MCP 和 no-match
- MCP / plugin 扫描结果带 host/source/scope/surfaceType/invocation/trust metadata，MCP 保持 advisory-only
- `/stats` 输出匿名聚合统计：prompt 类型、no-match、确认闸门、低置信度候选和热门目标

## P2 后续优化

### 1. GUI 交互抽检（可选）

- 目标：补一轮真实 Claude Code GUI 会话抽检
- 原因：当前已有 clean-room CLI + hook/log 验证 + live `claude` / `codex` 验证，GUI 更多是体验抽检而不是功能前置条件
- 验收标准：
  - 新会话可见 `SessionStart`
  - skill 路由、legacy command 路由、escape、no-match 与 CLI 结果一致

### 2. 质量信号持续校准

- 每次修改路由策略时同步扩充 route corpus，而不是只补单点回归
- 持续观察 `/stats` 的 no-match、确认闸门和低置信度候选，避免规则越加越重

### 3. 发布体验

- 评估是否需要更平滑的 release note 流程
- 评估是否要给 install target / resolved ref 增加更友好的用户提示

### 4. 研究文档持续更新

- 避免 `AUDIT.md`、`VERIFICATION.md`、`OPEN_SOURCE_READINESS_AUDIT.md` 再次与实现漂移
- 每次较大改动后同步更新结论，不把旧状态遗留到仓库里
