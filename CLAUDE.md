# CLAUDE.md

This repository targets both Claude Code and Codex. This file is the maintainer contract for the shared implementation.

## Commands

```bash
npm test                    # 全部自动化基线
npm run test:install        # 安装/卸载/重装循环集成测试
npm run test:all            # 上两者全跑
npm run verify:live:claude  # 真实 Claude CLI + hook/log 验收
npm run verify:live:codex   # 真实 Codex exec 验收（ASCII 临时路径）
npm run verify:release      # 检查 package / plugin manifests / changelog / HEAD-tag/worktree 状态
npm run verify:routing      # 路由准确率报告（corpus + regression + invariants）

# 单个测试文件
node --test tests/route-matcher.test.cjs
node --test tests/scan.test.cjs
node --test tests/integration.test.cjs

# 手动跑脚本验证路由
echo '{"prompt":"帮我提交代码","cwd":"'$(pwd)'"}' | node scripts/route-matcher.cjs
node scripts/scan-environment.cjs --mode=awareness

# 路由决策可读化（Markdown 表格）
node scripts/route-explain.cjs "备份数据库"
```

**修改后同步到已安装插件**（两处必须一致）：

```bash
mkdir -p ~/.claude/plugins/cache/capability-orchestrator/scripts/lib
cp scripts/*.cjs ~/.claude/plugins/cache/capability-orchestrator/scripts/
cp scripts/lib/*.cjs ~/.claude/plugins/cache/capability-orchestrator/scripts/lib/
```

## 架构

两个 hook 面，两个核心脚本：

```
SessionStart hook
  → scan-environment.cjs --mode=awareness
  → 输出：能力清单 + <MANDATORY> 路由规则 → 注入会话上下文

UserPromptSubmit hook
  → route-matcher.cjs（从 stdin 读 JSON）
  → 输出：[AUTO-ROUTE] 纯文本（匹配时）或 {"continue":true} JSON（放行时）
```

### scan-environment.cjs

扫描来源按平台区分：

- Claude：`.claude/skills/`、`.claude/agents/`、`.claude/commands/`
- Codex：`.agents/skills/`、`.agents/agents/`
- 已安装插件：`~/.claude/plugins/cache/` 或 `~/.codex/plugins/cache/`
- MCP：项目级 `.mcp.json` + 用户级 `mcp.json` / `.mcp.json`

三种渲染模式（`--mode`）：

- `awareness`：SessionStart hook 用，含 MCP 描述 + 强制路由规则
- `route`：orchestrate skill 用，完整描述
- `list`：capabilities skill 用，纯名称列表

关键函数：`collectSnapshot()` → `renderSnapshot(snap, mode)` → stdout。

### route-matcher.cjs

每条用户消息的实时路由，匹配算法：

1. **字面量匹配**（`findLiteralMatch`）：`/commit` 或 "commit" 直接命中，优先级最高
2. **语义匹配**（`findBestMatch`）：CJK bigram 分词 + 英文词干化 + IDF 评分
3. **跨语言扩展**：同义词表（`synonyms.cjs`）做中英互通，stemmed 无重叠时启用
4. **MCP 兜底**（`findBestMcpMatch`）：skills 无匹配时尝试 MCP server 路由

输出规则：

- 匹配 skill → Claude 输出 `/<skill-name>`；Codex 输出 `$<skill-name>`
- 匹配 legacy command → 优先输出 `/<command>` 调用指令；仅在命令名不适合 slash 调用时回退命令定义
- 匹配 MCP → 纯文本 `[AUTO-ROUTE] ... mcp__server__*`
- 无匹配 → JSON `{"continue":true}`

故障开放：任何异常都 passThrough，不阻断用户操作。逃逸词："直接做"/"skip"。

### 辅助模块

- `stem-rules.cjs`：英文词干化规则（-ing/-ed/-s/-es，无外部依赖）
- `synonyms.cjs`：中英同义词表（70+ 条），`expandSynonyms()` 做双向扩展
- `route-logger.cjs`：JSONL 路由日志，写入 `CLAUDE_PLUGIN_DATA/route-log.jsonl`，1MB×3 文件轮转（~3MB 上限），fire-and-forget 模式

### 路由精度控制

- `MIN_KEYWORD_OVERLAP = 2`：语义匹配至少 2 个关键词重叠
- `MIN_CONFIDENCE = 0.3`：语义/MCP 匹配的最低置信度阈值，低于此值视为噪音放行（字面量匹配不受限制）
- `SHORT_SINGLE_KEYWORD_LEN = 20`：单关键词命中 skill 名称时 prompt 最小长度

### 测试文件对应关系

| 文件                        | 覆盖内容                                                                  |
| --------------------------- | ------------------------------------------------------------------------- |
| `scan.test.cjs`             | scan-environment.cjs 全部导出函数                                         |
| `route-matcher.test.cjs`    | route-matcher.cjs、stemming、synonym、MCP 路由、literal 匹配              |
| `route-logger.test.cjs`     | route-logger.cjs 日志写入、轮转、统计、性能、安全                         |
| `fuzz.test.cjs`             | sanitize/extractKeywords/passThrough/findBestMatch 随机输入 property 测试 |
| `stress.test.cjs`           | 大规模 skills、超长 prompt、畸形 SKILL.md、MCP JSON 边界                  |
| `integration.test.cjs`      | 完整 hook 流程 E2E + golden snapshot + 安装卸载循环 + 日志写入验证        |
| `skill-contract.test.cjs`   | skills/ 合约 + Claude/Codex plugin manifest 版本一致性                    |
| `scan-render.test.cjs`      | buildRoutingHint 边界路径 + renderSnapshot 基础输出                       |
| `route-regression.test.cjs` | 历史误推用例（备份数据库不得推 mvp-scaffold、MCP E.1 修复回归）           |
| `route-invariants.test.cjs` | 算法不变量（确定性、顺序无关、tiebreaker 稳定、env var 可调）             |

## 关键约束

- **零外部依赖**：只用 Node.js 18+ stdlib，不能引入任何 npm 包
- **只读**：脚本只读文件系统（唯一例外：`route-logger.cjs` 写 `route-log.jsonl` 到 `CLAUDE_PLUGIN_DATA`），不联网，不修改权限
- **Token 预算**：awareness 输出上限默认 12000 字符（约 3000 tokens），`CO_AWARENESS_MAX_CHARS` 可调；desc 是路由信号，预算宁松勿紧
- **CJK 感知**：中文用 bigram 分词，单字 + 相邻双字组合；bigram 覆盖的单字从评分中去重
- **IDF 加权**：出现在多个 skill desc 里的高频词权重降低，防止"代码"之类通用词误匹配
- **同名去重**：项目级 > 用户级 > 插件级；legacy command 不覆盖同名 skill

## 算法演进表

| 版本 | 核心改动                                                                                                                                                                                                                                                 | 解决的问题                                              |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| v1   | CJK bigram + 英文词干化 + IDF 评分                                                                                                                                                                                                                       | 基础语义匹配                                            |
| v2   | Subagent 入候选池 + 9 组双语同义词 + 字面量触发词匹配                                                                                                                                                                                                    | 跨语言匹配、触发词命中率                                |
| v3   | 负向惩罚 (A.1) + 平局打破器 (A.2) + Trigram whitelist (A.3) + 阈值 env 化 (A.4) + 同义词扩充 (A.5) + Top-N 候选日志 (B.1) + 采纳率统计 (B.3) + PostToolUse 反馈 (B.4)                                                                                    | "备份数据库"误推 mvp-scaffold、同分不稳定、日志可观测性 |
| v3.1 | MCP 跳过 penalty (E.1) + STOP_WORDS 扩充 + bigram 噪音过滤 (E.2) + 同义词第三轮 AI/ML/移动/CI (E.3) + 中文短问句对称 (E.4) + feedback 瘦身 O(n+m) (F.1) + CO_DEBUG 错误日志 (F.2) + 安装错误中文化 (G.1) + stats 健康度标记 (G.2) + stdin 超时保护 (H.2) | MCP 兜底失效、噪音误推、调试盲区                        |

## 调优指南（环境变量）

以下变量可在不修改代码的前提下调整路由行为，设置在调用 hook 的 shell 环境中即生效：

| 变量                          | 默认值  | 含义                                              | 调整建议                                                                                      |
| ----------------------------- | ------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `CO_MIN_KEYWORD_OVERLAP`      | `2`     | 语义匹配至少需要多少个关键词重叠                  | 提高到 3 可减少误推，降低到 1 可提高召回                                                      |
| `CO_MIN_CONFIDENCE`           | `0.3`   | 最低置信度阈值                                    | 提高到 0.45 过滤低质量匹配                                                                    |
| `CO_MIN_PROMPT_LEN`           | `3`     | prompt 低于此字符数直接放行                       | 默认合理，不建议修改                                                                          |
| `CO_UNMATCHED_PENALTY`        | `0.15`  | 每个未命中主题词的惩罚系数（加法惩罚）            | 有竞争对手时 0.15 即可翻转；无同类 skill 竞争时需设 25+ 才能完全阻止误推；设 0 退化到 v2 行为 |
| `CO_SHORT_SINGLE_KEYWORD_LEN` | `20`    | 单关键词命中 skill 名时 prompt 最小长度           | 防止短 prompt 触发假阳性                                                                      |
| `CO_DISABLE_FEEDBACK`         | 未设置  | 设为 `1` 完全禁用 PostToolUse 日志写入            | 高频会话且不需要路由统计时节省 IO                                                             |
| `CO_DEBUG`                    | 未设置  | 设为 `1` 将静默 catch 错误写入 `route-errors.log` | 调试"插件不识别"类问题时开启                                                                  |
| `CO_AWARENESS_HINT`           | 未设置  | 设为 `on` 强制显示路由提示；设为 `off` 关闭       | 日志不足时 `on` 强制显示空提示                                                                |
| `CO_AWARENESS_MAX_CHARS`      | `12000` | awareness/route/list 渲染总预算（字符）           | 低预算环境收紧到 5000；信息被截断时放宽                                                       |
| `CO_AWARENESS_TOP_N`          | `40`    | 每个分区最多展示的条目数                          | 能力很多且 desc 重要时放宽；注入过长时收紧                                                    |

**调试工具**：

```bash
# 查看路由决策 Markdown 表格
node scripts/route-explain.cjs "prompt"

# 带 --explain 的机器可读 JSON
echo '{"prompt":"xxx","cwd":"'$(pwd)'"}' | node scripts/route-matcher.cjs --explain

# 路由准确率报告（跑 corpus + regression + invariants）
npm run verify:routing

# 查看路由统计 + 健康度
node scripts/route-stats.cjs --format=markdown
```

## 新增 Skill 的 SKILL.md 模板

触发词质量直接决定路由准确率，新建 skill 时遵循以下模板：

```markdown
---
name: skill-name # kebab-case，全局唯一
description: |
  <核心动词> + <技术对象> + <场景限定>
  触发词: 关键词1, 关键词2, 关键词3（中英文同义对，3-6 个最佳）
  例: 备份 backup, 恢复 restore, 迁移 migrate
---

<skill 正文>
```

**触发词最佳实践**：

- 包含中英文同义对（`备份 backup`），覆盖双语输入
- 用动词不用名词短语（`迁移` 比 `数据迁移管理` 更精准）
- 3-6 个触发词刚好，过多稀释 IDF 权重
- 避免通用词（`数据`、`系统`、`功能`）单独作触发词
- 运维类 skill 必须有：操作动词（备份/恢复/回滚）+ 目标系统名（PostgreSQL/Redis）

**验证新 skill 路由效果**：

```bash
# 期望命中
echo '{"prompt":"<测试 prompt>","cwd":"'$(pwd)'"}' | node scripts/route-matcher.cjs --explain

# 确认未误推
node scripts/route-explain.cjs "<测试 prompt>"
```

## AI Pull Request Workflow

These rules apply to Claude Code, Codex, and other AI coding agents working in this repository.

- Never push directly to `master`.
- Do all code changes on a new branch named with the `codex/` prefix unless the user explicitly requests another branch.
- Open a GitHub pull request for completed work instead of merging locally.
- Write PR titles and descriptions in Chinese, including what changed, why it changed, verification performed, and remaining risks.
- Do not merge a PR unless GitHub reports that required checks and required reviews have passed.
- If CI, code review, or security review reports issues, fix them in the PR branch and request another review.
- Keep each PR focused on one logical change.
- Run the repository's validation command or the narrowest relevant tests before marking substantial work ready for review; report anything not run.

## Pull Request Safety Rules

- Treat local skills, commands, plugin manifests, and MCP config files as potentially untrusted unless they come from a trusted source.
- Do not add auto-routing behavior that executes command bodies or shell snippets from untrusted repositories without an explicit user confirmation gate.
- Keep runtime scanning read-only and avoid network calls from runtime hooks unless the user explicitly requests them.
