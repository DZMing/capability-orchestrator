# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test                    # 全部单元测试（243 项）
npm run test:install        # 安装/卸载/重装循环集成测试
npm run test:all            # 上两者全跑

# 单个测试文件
node --test tests/route-matcher.test.cjs
node --test tests/scan.test.cjs
node --test tests/integration.test.cjs

# 手动跑脚本验证路由
echo '{"prompt":"帮我提交代码","cwd":"'$(pwd)'"}' | node scripts/route-matcher.cjs
node scripts/scan-environment.cjs --mode=awareness
```

**修改后同步到已安装插件**（两处必须一致）：

```bash
cp scripts/*.cjs ~/.claude/plugins/cache/capability-orchestrator/scripts/
```

## 架构

两个 hook，两个脚本：

```
SessionStart hook
  → scan-environment.cjs --mode=awareness
  → 输出：能力清单 + <MANDATORY> 路由规则 → 注入会话上下文

UserPromptSubmit hook
  → route-matcher.cjs（从 stdin 读 JSON）
  → 输出：[AUTO-ROUTE] 纯文本（匹配时）或 {"continue":true} JSON（放行时）
```

### scan-environment.cjs

扫描来源：`.claude/skills/`、`.claude/agents/`、`.claude/commands/`（项目级 + 用户级）、`~/.claude/plugins/cache/`（已安装插件）、`.mcp.json`。

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

- 匹配 skill → 纯文本 `[AUTO-ROUTE] ... 【强制指令】Skill("name")`
- 匹配 legacy command → 纯文本 `[AUTO-ROUTE] ... 【强制指令】` + 命令文件内容注入
- 匹配 MCP → 纯文本 `[AUTO-ROUTE] ... mcp__server__*`
- 无匹配 → JSON `{"continue":true}`

故障开放：任何异常都 passThrough，不阻断用户操作。逃逸词："直接做"/"skip"。

### 辅助模块

- `stem-rules.cjs`：英文词干化规则（-ing/-ed/-s/-es，无外部依赖）
- `synonyms.cjs`：中英同义词表（70+ 条），`expandSynonyms()` 做双向扩展

### 测试文件对应关系

| 文件                      | 覆盖内容                                                                  |
| ------------------------- | ------------------------------------------------------------------------- |
| `scan.test.cjs`           | scan-environment.cjs 全部导出函数                                         |
| `route-matcher.test.cjs`  | route-matcher.cjs、stemming、synonym、MCP 路由、literal 匹配              |
| `fuzz.test.cjs`           | sanitize/extractKeywords/passThrough/findBestMatch 随机输入 property 测试 |
| `stress.test.cjs`         | 大规模 skills、超长 prompt、畸形 SKILL.md、MCP JSON 边界                  |
| `integration.test.cjs`    | 完整 hook 流程 E2E + golden snapshot + 安装卸载循环                       |
| `skill-contract.test.cjs` | skills/ 目录下每个 skill 的 frontmatter 结构契约                          |

## 关键约束

- **零外部依赖**：只用 Node.js 18+ stdlib，不能引入任何 npm 包
- **只读**：脚本只读文件系统，不写入任何文件，不联网，不修改权限
- **Token 预算**：awareness 输出上限 3000 字符（约 750 tokens）
- **CJK 感知**：中文用 bigram 分词，单字 + 相邻双字组合；bigram 覆盖的单字从评分中去重
- **IDF 加权**：出现在多个 skill desc 里的高频词权重降低，防止"代码"之类通用词误匹配
- **同名去重**：项目级 > 用户级 > 插件级；legacy command 不覆盖同名 skill
