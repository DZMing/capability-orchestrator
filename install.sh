#!/usr/bin/env bash
# capability-orchestrator 一键安装脚本
# 用法：curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash
set -euo pipefail

REPO="DZMing/capability-orchestrator"
BRANCH="master"
PLUGIN_NAME="capability-orchestrator"

# 确定用户级 Claude 目录
CLAUDE_DIR="${CLAUDE_USER_DIR:-$HOME/.claude}"
PLUGINS_DIR="$CLAUDE_DIR/plugins/cache"
INSTALL_DIR="$PLUGINS_DIR/$PLUGIN_NAME"

# ── 颜色输出 ──────────────────────────────────────────────────────────────────
green() { printf '\033[0;32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$*"; }
red() { printf '\033[0;31m%s\033[0m\n' "$*"; }
bold() { printf '\033[1m%s\033[0m\n' "$*"; }

bold "=== capability-orchestrator 安装程序 ==="
echo ""

# ── 检查依赖 ──────────────────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  red "错误：未找到 node，请先安装 Node.js (https://nodejs.org)"
  exit 1
fi

NODE_VER=$(node -e "process.stdout.write(process.versions.node)")
NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  red "错误：需要 Node.js 18+，当前版本 $NODE_VER"
  exit 1
fi

# ── 下载方式检测 ──────────────────────────────────────────────────────────────
if command -v git >/dev/null 2>&1; then
  USE_GIT=1
elif command -v curl >/dev/null 2>&1; then
  USE_GIT=0
else
  red "错误：需要 git 或 curl 其中之一"
  exit 1
fi

# ── 安装/更新 ─────────────────────────────────────────────────────────────────
mkdir -p "$PLUGINS_DIR"

if [ -d "$INSTALL_DIR/.git" ]; then
  yellow "检测到已安装，正在更新..."
  git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH"
elif [ "$USE_GIT" -eq 1 ]; then
  yellow "正在克隆到 $INSTALL_DIR ..."
  git clone --depth=1 --branch "$BRANCH" \
    "https://github.com/$REPO.git" "$INSTALL_DIR"
else
  yellow "正在下载（无 git，使用 curl）..."
  TMP_ZIP=$(mktemp /tmp/cap-orch-XXXXXX.zip)
  curl -fsSL "https://github.com/$REPO/archive/refs/heads/$BRANCH.zip" -o "$TMP_ZIP"
  TMP_DIR=$(mktemp -d)
  unzip -q "$TMP_ZIP" -d "$TMP_DIR"
  mv "$TMP_DIR/${PLUGIN_NAME}-${BRANCH}" "$INSTALL_DIR"
  rm -rf "$TMP_ZIP" "$TMP_DIR"
fi

# 确保脚本可执行
chmod +x "$INSTALL_DIR/scripts/scan-environment.cjs"

# ── 注册 SessionStart hook ────────────────────────────────────────────────────
SETTINGS_FILE="$CLAUDE_DIR/settings.json"
HOOK_CMD="node \"$INSTALL_DIR/scripts/scan-environment.cjs\" --mode=list"

yellow "正在注册 SessionStart hook..."
node - "$SETTINGS_FILE" "$HOOK_CMD" <<'NODEJS'
const fs = require('fs');
const path = require('path');

const settingsFile = process.argv[2];
const hookCmd = process.argv[3];

// 读取或初始化 settings.json
let settings = {};
if (fs.existsSync(settingsFile)) {
  try { settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch {}
}

// 确保 hooks.SessionStart 数组存在
if (!settings.hooks) settings.hooks = {};
if (!settings.hooks.SessionStart) settings.hooks.SessionStart = [];

// 检查是否已注册（避免重复）
const marker = 'capability-orchestrator';
const alreadyRegistered = settings.hooks.SessionStart.some(entry =>
  entry.hooks && entry.hooks.some(h => h.command && h.command.includes(marker))
);

if (alreadyRegistered) {
  // 更新已有条目的路径（升级场景）
  for (const entry of settings.hooks.SessionStart) {
    if (!entry.hooks) continue;
    for (const h of entry.hooks) {
      if (h.command && h.command.includes(marker)) {
        h.command = hookCmd;
      }
    }
  }
  process.stdout.write('updated\n');
} else {
  settings.hooks.SessionStart.push({
    hooks: [{ type: 'command', command: hookCmd, timeout: 10 }]
  });
  process.stdout.write('added\n');
}

fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
NODEJS

echo ""
green "✓ 安装完成：$INSTALL_DIR"
green "✓ SessionStart hook 已注册（每次新会话自动注入能力摘要）"
echo ""
bold "使用方式："
echo "  新会话开始时自动感知环境能力（无需手动触发）"
echo "  /capability-orchestrator:capabilities — 查看完整能力摘要"
echo "  /capability-orchestrator:orchestrate  — 路由复杂任务"
echo "  /capability-orchestrator:refresh      — 对比前后能力变化"
echo ""
yellow "提示：重启 Claude Code 开新会话后生效"
