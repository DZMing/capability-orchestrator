# Changelog

## [1.11.12] - 2026-04-20

### Fixed

- Raw/piped `install.ps1` now resolves version and hook helper paths without relying on `$MyInvocation.MyCommand.Path`, so PowerShell one-liner installs complete correctly

## [1.11.11] - 2026-04-20

### Fixed

- Piped-install smoke coverage now pins the target ref explicitly instead of relying on a live latest-tag lookup, eliminating that test's dependence on GitHub API timing during CI

## [1.11.10] - 2026-04-20

### Fixed

- Raw piped installs now ignore transient `/dev/fd` script locations when resolving local repo metadata, preventing the installer from treating the process-substitution path as a real checkout

## [1.11.9] - 2026-04-20

### Fixed

- Install smoke tests now report piped-install failures explicitly instead of aborting silently under `set -e`, keeping macOS CI failures diagnosable without changing installer behavior

## [1.11.8] - 2026-04-20

### Fixed

- Raw and piped `install.sh --version` now report the current published version again by keeping the installer fallback aligned with the release version

## [1.11.7] - 2026-04-20

### Fixed

- Raw piped installs from `install.sh` now resolve `install-hooks.cjs` from the staged/installed plugin instead of `/dev/fd`, so `bash <(curl .../install.sh)` completes hook registration correctly

## [1.11.6] - 2026-04-20

### Fixed

- `install.sh --version` now returns the published version even when the script is executed via a raw pipe instead of from a checked-out directory

## [1.11.5] - 2026-04-20

### Fixed

- The fake-git clone path used by install smoke tests now excludes `.git`, so Linux verification no longer emits misleading `.git/objects` permission noise while exercising the same install behavior

## [1.11.4] - 2026-04-20

### Changed

- CI now uses `actions/checkout@v5` and `actions/setup-node@v6`, aligning the workflow with GitHub's current Node 24 action runtime line

### Fixed

- The repository no longer relies on deprecated Node 20-based GitHub Actions runtime surfaces for checkout and setup-node

## [1.11.3] - 2026-04-20

### Fixed

- Linux no longer hangs in `tests/route-logger.test.cjs`; the failure-path test now uses a stable file-path conflict instead of `/proc/nonexistent/path`
- Linux container verification now confirms both `npm test` and `npm run test:all` complete, matching the intended Ubuntu CI gate

## [1.11.2] - 2026-04-20

### Changed

- `verify:release` now uses `GITHUB_TOKEN` when present so CI matrix jobs can authenticate release lookups instead of sharing the unauthenticated rate bucket

### Fixed

- Release metadata checks no longer fail sporadically on GitHub Actions due to unauthenticated GitHub API rate limits

## [1.11.1] - 2026-04-20

### Changed

- OpenClaw and Hermes ecosystem skills now honor declared platform metadata before entering the awareness snapshot or routing pool

### Fixed

- Windows-only or Linux-only external skills no longer bleed into incompatible hosts and create false routing candidates

## [1.11.0] - 2026-04-20

### Added

- OpenClaw skill discovery from `~/.openclaw/workspace/skills/`
- Hermes skill discovery from `~/.hermes/skills/`
- OpenClaw/Hermes scan and route regression tests

### Changed

- Awareness snapshot now includes compatible ecosystem skills in a dedicated section
- Route matching now includes OpenClaw and Hermes skills in the matching pool after project/user/plugin skills

## [1.10.0] - 2026-04-20

### Added

- `install.ps1` and `install.cmd` for Windows Claude Code native installation
- Windows `.cmd` wrappers for `scan-environment` and `route-matcher`
- `scripts/install-hooks.cjs` as a shared hook-config core used by installers
- `tests/install-hooks.test.cjs` and `tests/install.windows.ps1`
- `windows-latest` CI smoke coverage for the PowerShell installer

### Changed

- Compatibility matrix now treats Linux as fully supported, Windows Claude Code as native-install capable, and Windows Codex as WSL2-first
- `install.sh` now reuses the shared hook-config helper and supports `CAPABILITY_INSTALL_REPO_URL` for local/custom clone sources

### Fixed

- The project no longer depends on a POSIX-only installer path for Windows Claude users
- Hook registration semantics are now shared across Bash and PowerShell installers instead of drifting by shell

## [1.9.4] - 2026-04-20

### Added

- Claude live-verify 现在有 runtime-settings 提取测试，锁定 `model + env` 继承行为

### Changed

- `verify:live:claude` 现在会把真实 `~/.claude/settings.json` 中的运行时 `model` / `env` 同步到隔离环境，确保 live 验证贴近用户真实 API-key / base-url 配置

### Fixed

- 使用自定义 `ANTHROPIC_BASE_URL` / `glm-5.1` 之类设置时，Claude live verifier 不再只复制 OAuth 凭证而丢失实际认证路径

## [1.9.3] - 2026-04-20

### Added

- Claude live-verify 汇总新增 hook 事件计数断言，避免再出现“明明有 hook 事件却汇总为 0”的回归

### Changed

- CI coverage 命令补入 `tests/release-readiness-check.test.cjs`

### Fixed

- `verify:live:claude` 现在按 `hook_*` subtype 统计真实 hook 事件，而不是错误地从顶层 `type` 字段判断
- `verify:live:claude` 的 `matchedRouteSample` 不再把相同的 `output` / `stdout` 内容重复拼接

## [1.9.2] - 2026-04-20

### Added

- `tests/release-readiness-check.test.cjs`，锁定 release report 对 GitHub Release 就绪状态的判定

### Changed

- `verify:release` 现在会查询最新 tag 对应的 GitHub Release，并报告 release URL / publishedAt / draft / prerelease / ready 状态
- release 文档与模板同步到新的 release report 字段，不再把 GitHub Release 存在性留给人工脑补

### Fixed

- 发布后 `verify:release` 现在能直接发现“tag 已对齐但 GitHub Release 缺失或未发布”的状态

## [1.9.1] - 2026-04-20

### Added

- `tests/live-verify.test.cjs`，锁定 Claude/Codex live verifier 的正反例判定
- install smoke 新增 release tag 噪音回归与 git worktree 脏改动保护回归

### Changed

- `verify:live:claude` / `verify:live:codex` 先用 `install.sh` 注册隔离 hooks，再覆盖成当前工作区快照后执行真实 CLI
- `verify:release` 现在显式报告 `HEAD` / latest tag / worktree 状态，CI 与 PR 模板文案同步到这个真实语义
- CONTRIBUTING 切换到 Lore commit protocol，公开治理文档与当前仓库要求对齐

### Fixed

- release tag 安装不再打印 annotated-tag / detached HEAD 噪音
- live verifier 不再因为任意 stdout 子串而误判通过
- git worktree 安装副本的脏改动现在也会阻止覆盖升级
- hook 所有权识别从宽泛子串匹配收紧到 marker + legacy 脚本路径
- README 中“安装指定版本”现在会真正完成 hook 注册，而不是只落文件

## [1.9.0] - 2026-04-20

### Added

- `.codex-plugin/plugin.json`，让 Codex 路径具备一等插件元数据
- plugin manifest 与 `package.json` 版本一致性测试
- 安装失败保留旧安装、Codex 自动检测、Codex skill 调用格式等回归测试

### Changed

- 仓库元数据升级为 Claude Code + Codex 双平台描述
- 文档契约同步到当前的 Codex 路由与安装行为

### Fixed

- 安装器失败重装会先删旧安装的问题
- `CODEX_USER_DIR` 自动检测与共享平台契约不一致的问题
- release tag 安装时的 detached-head 提示噪音
- `.claude-plugin/plugin.json` 版本落后于 `package.json` 的元数据漂移

## [1.7.0] - 2026-04-17

### Added

- `route-matcher.cjs --explain`：输出稳定 JSON，解释某条 prompt 为什么命中 skill / command / MCP，或为什么被放行
- 新增 `/debug-route` skill，供人工排查误路由和回归测试时使用
- `scripts/lib/user-dir.cjs`：共享用户目录解析
- `scripts/lib/scan-core.cjs` / `scripts/lib/scan-render.cjs`：扫描与渲染分层

### Changed

- `scan-environment.cjs` 保持稳定入口不变，但内部改为 core/render/user-dir 三层结构
- `route-matcher` explain 和默认路由共用同一套判定逻辑，避免两套行为漂移
- README / ARCHITECTURE / CONTRIBUTING 补充 explain 与 debug-route 的使用说明

### Fixed

- explain 模式下可稳定给出 `matched-skill` / `matched-command` / `matched-mcp` / `escaped` / `too-short` / `no-match`
- debug-route skill 可直接执行，且不会修改 repo 跟踪文件

## [1.6.0] - 2026-04-16

### Changed

- 路由输出格式从 `Skill("name")` 改为 `/name`，Claude 理解更精准
- 双层路由强化：SessionStart awareness 注入 AUTO-ROUTE 合规规则，UserPromptSubmit 输出具体 `/command`
- package.json 新增 keywords、homepage、bugs 字段
- README 新增英文摘要，提升 GitHub 发现性
- CONTRIBUTING.md 补充 test:install 安全警告

### Added

- CLAUDE.md 项目文档（命令、架构、约束）
- `findLiteralMatch()` 支持字面量匹配：`/commit` 或短 prompt 中的 skill 名直接命中
- 跨语言 name-match gate：单同义词匹配 skill 名称时直接通过
- 同义词表新增：提交↔commit、推送↔push

## [1.5.0] - 2026-04-12

### Fixed

- Unicode NFC/NFD 归一化：extractKeywords 对 NFC 和 NFD 输入产出相同结果（`café` vs `café`）
- CJK Extensions B-G 支持：CJK_RANGE 扩展到 U+20000-U+3134F，覆盖罕见汉字

### Added

- 17 项 fuzz/property 测试：sanitize、extractKeywords、findBestMatch、passThrough、createOutput（约 4700 次随机迭代）
- 7 项突变防护测试：MIN_KEYWORD_OVERLAP、SHORT_SINGLE_KEYWORD_LEN、isEscaped 阈值、MIN_PROMPT_LEN、compareSemver、dedup 顺序、renderSection level 边界
- 13 项压力测试：10k skills 性能、100KB prompt、深层嵌套插件目录、6 种畸形 SKILL.md、4 种 JSON 注释反斜杠边界
- 10 项集成测试：golden snapshot（awareness + renderSection level 0-4）、完整 hook 流程、安装/卸载/重装循环
- readStdin 超时路径、多 chunk 积累、空 stdin、插件异常 fault-open 4 项覆盖测试
- sanitize Markdown 正则回溯安全证明（10k 字符 <2ms）

### Changed

- 测试总数从 164 项增至 222 项（+58 项）
- 新增 3 个测试文件：fuzz.test.cjs、stress.test.cjs、integration.test.cjs
- 新增 golden 快照目录：tests/golden/

## [1.4.0] - 2026-04-12

### Added

- 插件 skill 路由：route-matcher 现在扫描 `~/.claude/plugins/cache/` 中安装的插件 skill
- 匹配置信度评分：findBestMatch 返回 confidence (0-1) 字段
- stdin CWD 解析：SessionStart 和 UserPromptSubmit hook 均从 stdin JSON 读取项目目录
- route-matcher 测试纳入 CI 流水线
- 15 项新测试：中文分词、插件路由、置信度、CWD 解析、符号链接安装

### Fixed

- 中文分词：CJK 文本拆为单字 + bigrams，修复中文匹配完全失效
- createOutput 注入防护：skill description 经 sanitize 清洗
- readStdin 进程挂起：超时后 unref stdin 确保进程退出
- 停词 "做"/"什么"/"要" 过度激进导致中文 false negative
- install.sh `&&`/`||` 条件链优先级 bug 改为 if/elif/fi

### Changed

- 测试总数从 149 项增至 164 项

## [1.3.0] - 2026-04-12

### Added

- UserPromptSubmit hook 实时路由：每条用户消息自动匹配 skill 并注入强制调用指令
- route-matcher.cjs 核心匹配器（关键词提取、逃逸检测、故障开放）
- awareness 模式 skill 展示升级：名字 + 描述（供路由匹配使用）
- 35 项新测试：route-matcher 单元测试 + 端到端子进程测试

### Changed

- 路由策略升级为强制路由规则（`<MANDATORY>` 包裹，匹配到 skill 必须调用）
- install.sh 新增 UserPromptSubmit hook 注册 + 卸载清理
- 安装测试新增 4 项断言（route-matcher 存在/可执行、hook 注册/卸载）

## [1.2.0] - 2026-04-09

### Added

- renderSection 导出供测试使用
- 魔法数字提取为顶层常量（TOP*N / MAX_PLUGIN_DEPTH / AWARENESS*\*\_DESC）
- 安全审计注释（UNSAFE_UNICODE ReDoS 分析、WSL execSync 注入防护、ENOENT 静默策略）
- 18 项新测试：renderSection level 0-4、scanAgents/scanCommands 边界、isPluginRoot 全路径、awareness 空快照/错误 footer、EACCES 权限、collectSnapshot undefined projectDir

### Changed

- 测试总数从 111 项增至 129 项（109 unit + 14 install + 6 idempotent）

## [1.1.0] - 2026-04-09

### Added

- awareness 渲染模式：SessionStart hook 差异化注入（MCP 描述 + agent 描述 + 路由策略）
- 三级插件结构扫描（vendor/name/version/），覆盖真实 Claude Code 插件缓存
- MCP server description 字段读取，disabled server 自动过滤
- 插件内 skill description 提取（之前只取目录名）
- 降级策略 top-15 折叠（替代无信息量的纯计数）
- 插件多版本去重（按版本号保留最新）
- install.sh: --version / --uninstall 支持、符号链接保护
- CLI --mode 白名单校验（无效模式 exit 1）
- 15 项回归 + 8 项边界测试
- LICENSE / CONTRIBUTING.md / CHANGELOG.md

### Fixed

- awareness 路由策略截断保护（预留空间保证不被截断）
- JSON 注释剥离正确处理连续转义反斜杠（`\\"`）
- block scalar 含空行不再截断解析
- semver 比较支持 v 前缀和 4 段版本号
- tryReadHead UTF-8 多字节截断产生的 U+FFFD
- extractServers 对非 object 值（null / array / string）不崩溃
- getDescription 全局 frontmatter 正则与 extractFrontmatter 对齐
- MCP 跨级别去重（项目级优先，用户级同名跳过）
- sanitize: HTML entities 解码防护、heading 正则精确化、C# 不误伤
- isSymlink fail-safe 返回 true（异常时宁可跳过）
- WSL 路径获取拆两步（避免嵌套 shell 替换）
- MCP description 未经 sanitize 的注入漏洞

### Changed

- 降级策略导致 skills 信息归零（"118 个"无路由价值）→ top-15 折叠
- ARCHITECTURE.md / README.md 更新设计定位从纯感知到"感知 + 路由引导层"
- install.sh 条件语法统一为 `[[ ]]`

## [1.0.0] - 2026-04-09

### Added

- 核心扫描引擎：skills / agents / plugins / MCP servers / commands
- 三个 skill：capabilities / orchestrate / refresh
- 一键安装脚本（git clone / curl 双模式）
- SessionStart hook 自动注入
- 多级降级渲染（route / list 模式）
- sanitize 防 prompt injection
- 56 项测试（单元 + 安装冒烟 + 幂等性）
- GitHub Actions CI（Node 18/20/22, ubuntu/macOS）
