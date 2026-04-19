# Security Policy

`capability-orchestrator` 是一个会在本机安装 hook 并执行本地 Node.js 脚本的
Claude Code 插件，因此安全边界必须明确写清楚。

## 支持版本

只有默认分支上的最新 tag release 会收到安全修复支持。

| 版本                   | 是否支持 |
| ---------------------- | -------- |
| 最新 release           | 是       |
| 显式 `master` 渠道安装 | 不保证   |
| 更早的 release         | 否       |
| 本地未发布修改         | 不保证   |

如果你不在最新 release 上，请优先升级后再报告安全问题；除非你怀疑漏洞本身就
出在升级路径里。

## 如何报告漏洞

不要通过公开的 GitHub issue、pull request 或公开讨论提交安全漏洞详情。

优先路径：

1. 优先使用仓库 Security 页里的 GitHub Private Vulnerability Reporting，
   如果仓库已启用。
2. 如果私密漏洞报告入口当前不可用，请创建一个公开 issue，但内容只写
   `Private security contact requested`，不要包含任何技术细节。
3. 这个公开 issue 里不要放复现步骤、payload、截图、受影响路径或其他漏洞
   细节。

首次确认收到的目标时间：72 小时内。

报告时请尽量包含：

- 受影响的 release 或 commit
- OS 和 Node.js 版本
- Claude Code 版本
- 是否自定义了 `CLAUDE_USER_DIR`
- 影响范围
- 最小可复现步骤

## 当前安全边界

当前预期边界如下：

- 运行时脚本对项目文件和 Claude 用户配置文件保持只读；唯一例外是路由日志文件（`route-log.jsonl`），写入 `CLAUDE_PLUGIN_DATA` 目录（通常为 `~/.claude/plugins/cache/capability-orchestrator/data/`），用于记录路由决策统计。日志写入使用 fire-and-forget 模式，失败不影响路由。日志文件自动轮转，总量上限约 3MB。
- 运行时脚本不会主动发起网络请求。
- 运行时脚本不会主动执行被扫描插件目录中的代码，只读取 manifest 和元数据。
- 安装脚本会修改 `~/.claude/settings.json`，注册 `SessionStart` 和
  `UserPromptSubmit` 两个 hook。
- 安装阶段会通过 `git` 或 `curl` 拉取仓库内容，因此安装时存在网络信任边界；
  运行时没有这一层。

## 已知风险区域

下面这些是用户评估是否采用该插件时必须知道的信任边界：

- `~/.claude/plugins/cache/` 的插件缓存结构没有正式文档，因此扫描逻辑是
  best-effort。
- hook 注册会通过修改 `settings.json` 改变用户级 Claude Code 行为。
- 路由命中质量问题通常属于产品 bug，不自动构成安全漏洞；只有当它导致了非预期
  的保密性、完整性或执行影响时，才应按安全问题处理。

## 处理预期

- 公开披露通常会在修复或缓解措施准备好之后进行。
- 不受支持的旧版本问题，可能会被要求先在最新 release 上复现。
- 如果问题最终被判定为普通 bug 或路由质量问题，会被转回
  [SUPPORT.md](SUPPORT.md) 中的公开支持路径。
