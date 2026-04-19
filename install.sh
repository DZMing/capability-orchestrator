#!/usr/bin/env bash
# capability-orchestrator 一键安装脚本
# 用法：curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash
# 默认安装最新已发布 tag；如需显式安装 master，请传 --channel=master
set -euo pipefail

REPO="DZMing/capability-orchestrator"
PLUGIN_NAME="capability-orchestrator"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd || true)"
VERSION="unknown"
if [[ -n "${SCRIPT_DIR:-}" ]]; then
  for VERSION_FILE in "$SCRIPT_DIR/package.json" "$SCRIPT_DIR/.claude-plugin/plugin.json"; do
    if [[ -f "$VERSION_FILE" ]]; then
      PARSED_VERSION="$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$VERSION_FILE" | head -n 1)"
      if [[ -n "${PARSED_VERSION:-}" ]]; then
        VERSION="$PARSED_VERSION"
        break
      fi
    fi
  done
fi

# ── 颜色输出（必须在所有分支之前定义）────────────────────────────────────────
green() { printf '\033[0;32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$*"; }
red() { printf '\033[0;31m%s\033[0m\n' "$*"; }
bold() { printf '\033[1m%s\033[0m\n' "$*"; }
shell_quote() { printf '%q' "$1"; }
trim_newline() { printf '%s' "$1" | tr -d '\r\n'; }

MODE="install"
CHANNEL="${CAPABILITY_INSTALL_CHANNEL:-release}"
REF_OVERRIDE="${CAPABILITY_INSTALL_REF:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      MODE="version"
      shift
      ;;
    --uninstall)
      MODE="uninstall"
      shift
      ;;
    --channel=*)
      CHANNEL="${1#*=}"
      shift
      ;;
    --channel)
      if [[ $# -lt 2 ]]; then
        red "错误：--channel 需要参数（release 或 master）"
        exit 1
      fi
      CHANNEL="$2"
      shift 2
      ;;
    *)
      red "错误：未知参数 $1"
      exit 1
      ;;
  esac
done

if [[ "$CHANNEL" != "release" && "$CHANNEL" != "master" ]]; then
  red "错误：--channel 仅支持 release 或 master"
  exit 1
fi

resolve_latest_tag_from_github() {
  node - "$REPO" <<'NODE'
const https = require('https');
const repo = process.argv[2];

function cmp(a, b) {
  const normalize = (v) => v.replace(/^v/i, '').split('.').map(n => Number(n) || 0);
  const pa = normalize(a);
  const pb = normalize(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

https.get({
  hostname: 'api.github.com',
  path: `/repos/${repo}/git/matching-refs/tags/`,
  headers: {
    'User-Agent': 'capability-orchestrator-installer',
    'Accept': 'application/vnd.github+json',
  },
}, (res) => {
  let data = '';
  res.on('data', chunk => { data += chunk; });
  res.on('end', () => {
    if (res.statusCode !== 200) process.exit(1);
    try {
      const refs = JSON.parse(data);
      const tags = refs
        .map(item => String(item.ref || ''))
        .filter(ref => ref.startsWith('refs/tags/'))
        .map(ref => ref.slice('refs/tags/'.length))
        .filter(tag => /^v?\d+(\.\d+)*$/.test(tag))
        .sort(cmp);
      if (tags.length === 0) process.exit(1);
      process.stdout.write(tags[tags.length - 1]);
    } catch {
      process.exit(1);
    }
  });
}).on('error', () => process.exit(1));
NODE
}

resolve_latest_tag() {
  local tag=""
  if command -v git >/dev/null 2>&1; then
    if git -C "$SCRIPT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      tag="$(git -C "$SCRIPT_DIR" tag --list 'v*' | sort -V | tail -n 1)"
    fi
  fi
  if [[ -z "${tag:-}" ]]; then
    tag="$(resolve_latest_tag_from_github || true)"
  fi
  tag="$(trim_newline "${tag:-}")"
  if [[ -z "${tag:-}" ]]; then
    red "错误：无法解析最新 release tag。可显式传 CAPABILITY_INSTALL_REF 或使用 --channel=master"
    exit 1
  fi
  printf '%s' "$tag"
}

resolve_install_target() {
  if [[ -n "${REF_OVERRIDE:-}" ]]; then
    if [[ "$REF_OVERRIDE" == refs/heads/* ]]; then
      RESOLVED_KIND="head"
      RESOLVED_REF="${REF_OVERRIDE#refs/heads/}"
    elif [[ "$REF_OVERRIDE" == refs/tags/* ]]; then
      RESOLVED_KIND="tag"
      RESOLVED_REF="${REF_OVERRIDE#refs/tags/}"
    elif [[ "$REF_OVERRIDE" == "master" ]]; then
      RESOLVED_KIND="head"
      RESOLVED_REF="master"
    else
      RESOLVED_KIND="tag"
      RESOLVED_REF="$REF_OVERRIDE"
    fi
    return
  fi

  if [[ "$CHANNEL" == "master" ]]; then
    RESOLVED_KIND="head"
    RESOLVED_REF="master"
    return
  fi

  RESOLVED_KIND="tag"
  RESOLVED_REF="$(resolve_latest_tag)"
}

# 确定用户级 Claude 目录
CLAUDE_DIR="${CLAUDE_USER_DIR:-$HOME/.claude}"
PLUGINS_DIR="$CLAUDE_DIR/plugins/cache"
INSTALL_DIR="$PLUGINS_DIR/$PLUGIN_NAME"

# --version 支持
if [[ "$MODE" == "version" ]]; then
  echo "$PLUGIN_NAME $VERSION"
  exit 0
fi

# --uninstall 支持
if [[ "$MODE" == "uninstall" ]]; then
  bold "=== capability-orchestrator 卸载 ==="
  echo ""
  # 清理 settings.json 中的 hook
  SETTINGS_FILE="$CLAUDE_DIR/settings.json"
  if [ -f "$SETTINGS_FILE" ]; then
    node - "$SETTINGS_FILE" <<'UNINSTALL_JS'
const fs = require('fs');
const settingsFile = process.argv[2];
try {
  const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  if (!settings.hooks) settings.hooks = {};
  const marker = 'capability-orchestrator';
  const filterHooks = (arr) => (arr || [])
    .map(entry => {
      const hooks = (entry.hooks || []).filter(h => !(h.command && h.command.includes(marker)));
      return hooks.length > 0 ? { ...entry, hooks } : null;
    })
    .filter(Boolean);
  settings.hooks.SessionStart = filterHooks(settings.hooks.SessionStart);
  settings.hooks.UserPromptSubmit = filterHooks(settings.hooks.UserPromptSubmit);
  if (settings.hooks.SessionStart.length === 0) delete settings.hooks.SessionStart;
  if (settings.hooks.UserPromptSubmit.length === 0) delete settings.hooks.UserPromptSubmit;
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
  process.stdout.write('hook 已移除\n');
} catch (e) {
  process.stderr.write('清理 hook 失败: ' + e.message + '\n');
  process.exit(1);
}
UNINSTALL_JS
  fi
  # 删除插件目录（sanity check 防止空路径误删）
  if [[ -z "$INSTALL_DIR" || "$INSTALL_DIR" != *"capability-orchestrator"* ]]; then
    red "路径异常（$INSTALL_DIR），拒绝删除"; exit 1
  fi
  if [[ -L "$INSTALL_DIR" ]]; then
    rm "$INSTALL_DIR"
    green "✓ 已删除符号链接 $INSTALL_DIR"
  elif [[ -d "$INSTALL_DIR" ]]; then
    rm -rf "$INSTALL_DIR"
    green "✓ 已删除 $INSTALL_DIR"
  else
    yellow "插件目录不存在，跳过"
  fi
  green "✓ 卸载完成"
  exit 0
fi

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

resolve_install_target
echo "安装渠道：$CHANNEL"
echo "安装目标：$RESOLVED_REF"
if [[ -n "${REF_OVERRIDE:-}" ]]; then
  echo "安装目标来源：CAPABILITY_INSTALL_REF"
fi
echo ""

# ── 安装/更新 ─────────────────────────────────────────────────────────────────
mkdir -p "$PLUGINS_DIR"

if [[ -d "$INSTALL_DIR/.git" ]]; then
  if [[ -n "$(git -C "$INSTALL_DIR" status --porcelain)" ]]; then
    red "更新失败（检测到已安装副本有本地修改），请手动处理：cd $INSTALL_DIR && git status"
    exit 1
  fi
  yellow "检测到已安装（git），正在按目标 ref 重装..."
  if [[ -L "$INSTALL_DIR" ]]; then
    rm "$INSTALL_DIR"
  elif [[ -d "$INSTALL_DIR" ]]; then
    rm -rf "$INSTALL_DIR"
  fi
fi

if [[ "$USE_GIT" -eq 1 ]]; then
  if [[ -L "$INSTALL_DIR" ]]; then
    rm "$INSTALL_DIR"
  elif [[ -d "$INSTALL_DIR" ]]; then
    rm -rf "$INSTALL_DIR"
  fi
  yellow "正在克隆到 $INSTALL_DIR ..."
  git clone --depth=1 --branch "$RESOLVED_REF" \
    "https://github.com/$REPO.git" "$INSTALL_DIR"
else
  if ! command -v unzip >/dev/null 2>&1; then
    red "错误：curl 下载方式需要 unzip，请先安装或改用 git"
    exit 1
  fi
  yellow "正在下载（无 git，使用 curl）..."
  TMP_ZIP=$(mktemp /tmp/cap-orch-XXXXXX.zip)
  TMP_DIR=$(mktemp -d)
  trap 'rm -rf "$TMP_ZIP" "$TMP_DIR"' EXIT
  if [[ "$RESOLVED_KIND" == "tag" ]]; then
    ZIP_REF="refs/tags/$RESOLVED_REF"
  else
    ZIP_REF="refs/heads/$RESOLVED_REF"
  fi
  curl -fsSL "https://github.com/$REPO/archive/$ZIP_REF.zip" -o "$TMP_ZIP"
  unzip -q "$TMP_ZIP" -d "$TMP_DIR"
  # 目标目录可能存在（升级场景），先清理再移入
  if [[ -L "$INSTALL_DIR" ]]; then
    rm "$INSTALL_DIR"
  elif [[ -d "$INSTALL_DIR" ]]; then
    rm -rf "$INSTALL_DIR"
  fi
  # GitHub zip 内部目录名可能随仓库名变化，取第一个子目录（安全写法）
  EXTRACTED=$(find "$TMP_DIR" -mindepth 1 -maxdepth 1 -type d | head -1)
  mv "$EXTRACTED" "$INSTALL_DIR"
  rm -rf "$TMP_ZIP" "$TMP_DIR"
  trap - EXIT
fi

# 确保脚本可执行
chmod +x "$INSTALL_DIR/scripts/scan-environment.cjs"
chmod +x "$INSTALL_DIR/scripts/route-matcher.cjs"

# ── 注册 SessionStart hook ────────────────────────────────────────────────────
SETTINGS_FILE="$CLAUDE_DIR/settings.json"
HOOK_CMD="CLAUDE_USER_DIR=$(shell_quote "$CLAUDE_DIR") node $(shell_quote "$INSTALL_DIR/scripts/scan-environment.cjs") --mode=awareness"

yellow "正在注册 SessionStart hook..."
node - "$SETTINGS_FILE" "$HOOK_CMD" <<'NODEJS'
const fs = require('fs');
const path = require('path');

const settingsFile = process.argv[2];
const hookCmd = process.argv[3];

// 读取或初始化 settings.json
let settings = {};
if (fs.existsSync(settingsFile)) {
  try {
    settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  } catch (e) {
    process.stderr.write('settings.json 解析失败: ' + e.message + '\n');
    process.exit(1);
  }
}

// 确保 hooks.SessionStart 数组存在
if (!settings.hooks) settings.hooks = {};
if (!Array.isArray(settings.hooks.SessionStart)) settings.hooks.SessionStart = [];

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

# ── 注册 UserPromptSubmit hook ───────────────────────────────────────────────
ROUTE_CMD="CLAUDE_USER_DIR=$(shell_quote "$CLAUDE_DIR") node $(shell_quote "$INSTALL_DIR/scripts/route-matcher.cjs")"

yellow "正在注册 UserPromptSubmit hook..."
node - "$SETTINGS_FILE" "$ROUTE_CMD" <<'ROUTEJS'
const fs = require('fs');
const path = require('path');

const settingsFile = process.argv[2];
const hookCmd = process.argv[3];

let settings = {};
if (fs.existsSync(settingsFile)) {
  try {
    settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  } catch (e) {
    process.stderr.write('settings.json 解析失败: ' + e.message + '\n');
    process.exit(1);
  }
}

if (!settings.hooks) settings.hooks = {};
if (!Array.isArray(settings.hooks.UserPromptSubmit)) settings.hooks.UserPromptSubmit = [];

const marker = 'capability-orchestrator';
const alreadyRegistered = settings.hooks.UserPromptSubmit.some(entry =>
  entry.hooks && entry.hooks.some(h => h.command && h.command.includes(marker))
);

if (alreadyRegistered) {
  for (const entry of settings.hooks.UserPromptSubmit) {
    if (!entry.hooks) continue;
    for (const h of entry.hooks) {
      if (h.command && h.command.includes(marker)) {
        h.command = hookCmd;
      }
    }
  }
  process.stdout.write('updated\n');
} else {
  settings.hooks.UserPromptSubmit.push({
    hooks: [{ type: 'command', command: hookCmd, timeout: 5 }]
  });
  process.stdout.write('added\n');
}

fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
ROUTEJS

echo ""
green "✓ 安装完成：$INSTALL_DIR"
green "✓ SessionStart hook 已注册（每次新会话自动注入能力摘要）"
green "✓ UserPromptSubmit hook 已注册（每条消息自动匹配 skill）"
echo ""
bold "使用方式："
echo "  新会话开始时自动感知环境能力（无需手动触发）"
echo "  /capability-orchestrator:capabilities — 查看完整能力摘要"
echo "  /capability-orchestrator:orchestrate  — 路由复杂任务"
echo "  /capability-orchestrator:refresh      — 对比前后能力变化"
echo ""
yellow "提示：重启 Claude Code 开新会话后生效"
