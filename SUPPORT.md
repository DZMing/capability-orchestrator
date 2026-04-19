# Support

这个文档定义不同类型问题应该走哪条入口。

## 支持基线

公开支持只面向最新 tag release。

如果你运行的是旧 tag 或本地修改过的 checkout，请先升级，再提交支持请求；
除非问题本身就和升级路径有关。

如果你显式安装了 `master` 渠道，请优先切回最新 tag release 再提交公开支持请求；
除非问题本身就和 `master` 渠道有关。

## 什么问题走哪里

### Bug 报告

可复现的产品 bug 请走 GitHub Issues。

请至少包含：

- OS
- Node.js 版本
- Claude Code 版本
- 安装方式：`git` 或 `curl`
- 是否自定义了 `CLAUDE_USER_DIR`
- 触发问题的 prompt 或命令
- 预期行为和实际行为

### 使用问题

如果你不确定如何安装、验证、升级、回滚或排障，也请走 GitHub Issues。

建议标题加 `question:` 前缀，方便分流。

### 功能请求

功能请求和产品缺口也走 GitHub Issues。

建议标题加 `feature:` 前缀，并说明：

- 用户问题是什么
- 为什么现有行为不够
- 这个请求会影响安装行为、运行时路由还是仅文档层

### 安全问题

不要在公开 GitHub Issues 中提交漏洞详情。

请走 [SECURITY.md](SECURITY.md)。

## 提交 issue 前先检查

建议先看：

- [README.md](README.md) 中的兼容性和 Troubleshooting
- [RELEASE.md](RELEASE.md) 中的发布和回滚说明
- 问题是否能在最新 tag release 上复现

## 维护者可能直接关闭的情况

以下情况可能会被关闭或重定向：

- 实际上这是安全问题，应走 `SECURITY.md`
- 只在不受支持的旧版本上复现
- 请求补充信息后仍不足以复现
- 请求超出文档声明的产品边界或平台支持范围

## 响应预期

这个仓库采用轻量维护模式：

- GitHub Issues 上的公开支持为 best effort。
- 安装损坏和核心正确性问题的优先级高于功能请求。
- 安全问题遵循 [SECURITY.md](SECURITY.md) 中的响应目标。
