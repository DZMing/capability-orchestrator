# capability-orchestrator 优化计划

> Claude (Sonnet 4.6) + Codex (GPT-5.4) 联合分析，2026-04-09
> 原则：保持 zero-state / zero-process 哲学，原子提交 ≤50 行

---

## 第一批：P0（核心缺陷，必须修）

### 1. YAML block scalar 解析

- **问题**: `extractFrontmatter()` (scan-environment.sh:53) 只匹配单行 `key: value`，`description: >` / `description: |` 返回 `>` 或 `|` 而非实际内容
- **影响**: 当前 58 个 skill 中 21 个（36%）description 丢失
- **修复**: 逐行状态机，检测 `>` / `|` / `>-` / `|-` 后读取后续缩进行
- **代码**:

```js
function extractFrontmatter(content) {
  // ... 匹配 --- 块 ...
  const lines = fm.split("\n");
  const result = {};
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\w[\w-]*):\s*(.*?)\s*$/);
    if (!m) continue;
    const [, key, rawVal] = m;
    // block scalar: 值是 >、|、>-、|-
    if (/^[>|][-+]?$/.test(rawVal)) {
      const blockLines = [];
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) {
        blockLines.push(lines[++i].trim());
      }
      // > 折叠换行为空格，| 保留换行
      result[key] = rawVal.startsWith(">")
        ? blockLines.join(" ")
        : blockLines.join("\n");
    } else {
      result[key] = rawVal.replace(/^["']|["']$/g, "");
    }
  }
  return result;
}
```

- **工时**: 1 commit（~40 行）
- **来源**: Claude + Codex 共识

### 2. 假阳性能力过滤

- **问题**: `scanSkills()` (scan-environment.sh:86) 将所有子目录视为 skill，即使没有 `SKILL.md`；以 `.` 开头的目录（`.disabled-claude`、`.system`）也被列出
- **影响**: 输出含无效条目，占用 token 预算
- **修复**: 只在 `SKILL.md` 存在时纳入；跳过 `.` 开头的目录
- **代码**:

```js
function scanSkills(dir) {
  const results = [];
  for (const entry of tryReadDir(dir)) {
    if (entry.startsWith(".")) continue;
    const skillDir = path.join(dir, entry);
    if (!isDir(skillDir)) continue;
    const skillMdPath = path.join(skillDir, "SKILL.md");
    const content = tryRead(skillMdPath);
    if (content === null) continue; // 无 SKILL.md → 不是有效 skill
    // ...
  }
}
```

- **工时**: 1 commit（~10 行改动）
- **来源**: Codex 发现

### 3. 渐进式截断（替代信息断崖）

- **问题**: 超 3000 字符时直接丢掉插件/MCP/legacy 整块，重建只保留 4 类 section。这是"断崖"不是"退化"
- **修复**: 预算分配器，按优先级逐级降级：full desc → short desc → 仅名称 → `+N more`
- **设计**:

```
优先级: 项目级 Skills > 项目级 Agents > MCP Servers > 用户级 Skills >
        用户级 Agents > 已安装插件 > Legacy Commands > 内置命令
降级顺序:
  Level 0: 名称 + 完整 description（≤100字符）
  Level 1: 名称 + 短 description（≤50字符）
  Level 2: 仅名称，逗号分隔
  Level 3: "{section}: {N} 个"
```

- **关键**: 先 collect snapshot（一次扫描），再 render 多次尝试不同 level
- **工时**: 2 commits（collect/render 拆分 + 渐进截断逻辑，各 ~40 行）
- **来源**: Claude + Codex 共识

### 4. 统一脚本调用方式

- **问题**: Node.js v22+ 不接受 `.sh` 扩展名作为模块，当前用 `node --input-type=commonjs < file` 绕过
- **修复方案 A（Codex 推荐）**: 改扩展名为 `.cjs`，直接 `node scan-environment.cjs`
- **修复方案 B（Claude 当前方案）**: 保持 `.sh` 命名，统一用 stdin 调用
- **决策**: **方案 A** 更干净。改名为 `scan-environment.cjs`，所有 SKILL.md 和 README 同步更新
- **工时**: 1 commit（~15 行改动，纯重命名+路径更新）
- **来源**: Codex 提出，Claude 同意

---

## 第二批：P1（质量提升）

### 5. collect/normalize/render 三层拆分

- **问题**: `buildOutput()` (scan-environment.sh:173) 耦合发现、规范化、格式化、截断，400 行单体函数
- **修复**: 拆成三个纯函数：
  - `collectSnapshot(projectDir, userDir)` → 结构化数据
  - `normalizeSnapshot(snapshot)` → 排序、去重、过滤
  - `renderSnapshot(snapshot, { maxChars, mode })` → 文本输出
- **好处**: 可测试、可扩展 mode、截断不需要重新扫描
- **工时**: 2 commits（~80 行重构）
- **来源**: Codex 提出，Claude 赞同

### 6. 稳定排序 + 去重

- **问题**: 输出顺序依赖文件系统枚举顺序（不同 OS 不一致），`refresh` skill 的变化对比会产生伪 diff
- **修复**: 所有 section 内按 `name.localeCompare()` 排序；跨级别去重（同名 skill 项目级优先）
- **工时**: 1 commit（~15 行）
- **来源**: Codex 发现

### 7. UTF-8 BOM 处理

- **问题**: `extractFrontmatter()` 的 `^---` 匹配不到 BOM 开头的文件
- **修复**: `content = content.replace(/^\uFEFF/, '')`
- **工时**: 1 commit（1 行）
- **来源**: Codex 发现

### 8. 改进错误上报

- **问题**: `tryRead()` / `tryReadDir()` 吞掉所有异常，`ENOENT`（不存在）和 `EACCES`（权限）被当成同一种情况
- **修复**: 区分 `ENOENT`（静默跳过）和其他错误（上报到 errors 数组）
- **工时**: 1 commit（~20 行）
- **来源**: Codex 发现

### 9. 使用 `withFileTypes` 减少系统调用

- **问题**: `readdirSync` + 逐个 `statSync` 有 TOCTOU 风险且系统调用多
- **修复**: `fs.readdirSync(dir, { withFileTypes: true })`，用 `dirent.isDirectory()`
- **工时**: 1 commit（~15 行改动）
- **来源**: Codex 发现

### 10. description fallback 不排除冒号行

- **问题**: `getDescription()` fallback 排除含 `:` 的行，但 `Use when:` / `场景：` 是最有信息量的
- **修复**: 只排除 YAML frontmatter 行和 Markdown 标题
- **工时**: 1 commit（~5 行改动）
- **来源**: Codex 发现

### 11. route / list 双模式

- **问题**: orchestrate 需要可判别的描述用于路由，capabilities 需要高密度目录用于展示
- **修复**: 脚本加 `--mode=route|list` 参数；`route` 保留短描述，`list` 优先名称+来源
- **工时**: 1 commit（~30 行）
- **来源**: Codex 提出

### 12. 限制 frontmatter 读取量

- **问题**: `tryRead()` 读取整个 SKILL.md 文件，但只需前 ~1KB 提取 frontmatter
- **修复**: 改为读取前 2048 字节 `fs.readFileSync(path, { encoding: 'utf8' }).slice(0, 2048)` 或用 `fd.read()` + `Buffer`
- **工时**: 1 commit（~10 行）
- **来源**: Claude 发现

### 13. 内置命令压缩

- **问题**: 24 个内置命令占 ~230 字符，信息价值低（Claude 已知这些）
- **修复**: 默认输出 `内置命令 24 个（/help 查看详情）`，仅 `--mode=full` 展开
- **工时**: 1 commit（~10 行）
- **来源**: Codex 提出，Claude 赞同

### 14. 可配置根目录

- **问题**: 项目根和用户根硬编码，难以测试和适配 WSL/CI
- **修复**: 支持 `--project-dir` / `--user-dir` 参数或 `CAPABILITY_PROJECT_DIR` / `CAPABILITY_USER_DIR` 环境变量
- **工时**: 1 commit（~20 行）
- **来源**: Codex 提出

---

## 第三批：P2（打磨）

### 15. 测试框架

- **问题**: 零测试覆盖
- **修复**: 添加 `tests/` 目录，用 Node.js 内置 `node:test` + `node:assert`，覆盖：
  - frontmatter 解析（block scalar / BOM / 空文件 / 损坏 YAML）
  - 截断（超长输出 / 刚好临界 / 空环境）
  - 假阳性过滤
- **工时**: 2 commits（fixture 准备 + 测试用例）
- **来源**: Codex 提出，符合 CLAUDE.md TDD 铁律

### 16. WSL home 探测

- **问题**: WSL 下 `os.homedir()` 返回 Linux home，可能不是 Claude 安装位置
- **修复**: 检测 `WSL_DISTRO_NAME` 环境变量时，额外探测 Windows `%USERPROFILE%\.claude`
- **工时**: 1 commit（~15 行）
- **来源**: Codex 发现

### 17. MCP JSON5 / 注释容错

- **问题**: `.mcp.json` 可能含注释（JSON5），`JSON.parse` 静默失败返回空
- **修复**: 至少在 stderr 输出格式警告
- **工时**: 1 commit（~5 行）
- **来源**: Codex 发现

### 18. 文档同步

- **问题**: ARCHITECTURE.md 宣称"macOS / Linux / WSL 通用"但未列兼容矩阵
- **修复**: 添加兼容矩阵表，明确每个平台的已知限制
- **工时**: 1 commit
- **来源**: Codex 发现

---

## 实施顺序

```
Phase 1 — P0（4 commits）
  commit 1: 修复扩展名 .sh → .cjs + 更新所有引用路径
  commit 2: YAML block scalar 解析状态机
  commit 3: 假阳性过滤（要求 SKILL.md 存在 + 跳过点目录）
  commit 4: collect/render 拆分 + 渐进式截断

Phase 2 — P1（9 commits）
  commit 5: 稳定排序 + 去重
  commit 6: BOM 处理
  commit 7: 错误分类上报
  commit 8: withFileTypes 优化
  commit 9: description fallback 修复
  commit 10: route/list 双模式
  commit 11: frontmatter 读取量限制
  commit 12: 内置命令压缩
  commit 13: 可配置根目录

Phase 3 — P2（4 commits）
  commit 14-15: 测试 fixtures + 测试用例
  commit 16: WSL home 探测
  commit 17: MCP 容错 + 文档同步
```

## 预期效果

| 指标                   | 当前                       | 优化后                         |
| ---------------------- | -------------------------- | ------------------------------ |
| Description 解析成功率 | 64% (37/58)                | ~95%+                          |
| 假阳性条目             | 2+ (`.disabled-claude` 等) | 0                              |
| 截断行为               | 断崖（丢整块 section）     | 渐进（desc→name→count）        |
| 系统调用数             | ~2N（readdir + stat 每项） | ~N（withFileTypes）            |
| 可测试性               | 无                         | 覆盖 frontmatter + 截断 + 过滤 |
| 跨平台                 | macOS + Linux              | + WSL 探测                     |

## 两个 AI 的分歧与共识

| 议题                 | Claude             | Codex                      | 决策                                        |
| -------------------- | ------------------ | -------------------------- | ------------------------------------------- |
| 文件扩展名           | `.sh` + stdin 绕过 | 改 `.cjs`                  | 采纳 Codex（更干净）                        |
| Token vs 字符计量    | 字符足够           | 应改 `Buffer.byteLength()` | 暂不改（中文 char≈1.5 token，预算本就保守） |
| 是否加 `--mode` 参数 | 非必要             | 推荐 route/list            | 采纳 Codex（明确意图更好）                  |
| 是否加测试           | 先发布再补         | 必须有 fixtures            | 采纳 Codex（符合 CLAUDE.md TDD 铁律）       |
