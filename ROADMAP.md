# Roadmap

更新时间：2026-04-19

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

## P1 应尽快收口

### 1. GUI 手工验收

- 目标：补一轮真实 Claude Code GUI 会话抽检
- 原因：当前已经有 clean-room CLI 验证，但还没有 GUI 肉眼签字
- 验收标准：
  - 新会话可见 `SessionStart`
  - skill 路由、legacy command 路由、escape、no-match 与 CLI 结果一致

### 2. 安装体验去噪

- 目标：评估并尽量消除 release tag 安装时的 detached-head 提示噪音
- 原因：不影响正确性，但会影响用户体验
- 验收标准：
  - 不改变默认 release-first 语义
  - 不引入新的安装复杂度

## P2 后续优化

### 1. 质量信号可见性

- 在 README 或 docs 里进一步解释测试矩阵、clean-room CLI 验证、未做 GUI 验收
- 让读者理解“哪些证据已经有，哪些还没有”

### 2. 发布体验

- 评估是否需要更平滑的 release note 流程
- 评估是否要给 install target / resolved ref 增加更友好的用户提示

### 3. 研究文档持续更新

- 避免 `AUDIT.md`、`VERIFICATION.md`、`OPEN_SOURCE_READINESS_AUDIT.md` 再次与实现漂移
- 每次较大改动后同步更新结论，不把旧状态遗留到仓库里
