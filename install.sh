#!/usr/bin/env bash
# capability-orchestrator 一键安装脚本
# 用法：curl -fsSL https://raw.githubusercontent.com/DZMing/capability-orchestrator/master/install.sh | bash
# 默认安装最新已发布 tag；如需显式安装 master，请传 --channel=master
set -euo pipefail

REPO="DZMing/capability-orchestrator"
REPO_URL="${CAPABILITY_INSTALL_REPO_URL:-https://github.com/DZMing/capability-orchestrator.git}"
PLUGIN_NAME="capability-orchestrator"
VERSION_FALLBACK="1.11.22"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd || true)"
VERSION="$VERSION_FALLBACK"
if [[ -n "${SCRIPT_DIR:-}" ]]; then
  case "$SCRIPT_DIR" in
    /dev/fd*|/proc/*/fd*)
      SCRIPT_DIR=""
      ;;
  esac
fi
if [[ -n "${SCRIPT_DIR:-}" ]]; then
  for VERSION_FILE in "$SCRIPT_DIR/package.json" "$SCRIPT_DIR/.claude-plugin/plugin.json" "$SCRIPT_DIR/.codex-plugin/plugin.json"; do
    if [[ -f "$VERSION_FILE" ]]; then
      PARSED_VERSION="$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$VERSION_FILE" | head -n 1)"
      if [[ -n "${PARSED_VERSION:-}" ]]; then
        VERSION="$PARSED_VERSION"
        break
      fi
    fi
  done
fi

resolve_helper_script() {
  if [[ -f "$INSTALL_DIR/scripts/install-hooks.cjs" ]]; then
    printf '%s' "$INSTALL_DIR/scripts/install-hooks.cjs"
    return
  fi
  if [[ -n "${SCRIPT_DIR:-}" && -f "$SCRIPT_DIR/scripts/install-hooks.cjs" ]]; then
    printf '%s' "$SCRIPT_DIR/scripts/install-hooks.cjs"
    return
  fi
  return 1
}

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
PLATFORM="${CAPABILITY_PLATFORM:-}"

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
    --platform=*)
      PLATFORM="${1#*=}"
      shift
      ;;
    --platform)
      if [[ $# -lt 2 ]]; then
        red "错误：--platform 需要参数（claude / codex / openclaw / hermes）"
        exit 1
      fi
      PLATFORM="$2"
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

# ── 平台自动检测 ──────────────────────────────────────────────────────────
if [[ -z "$PLATFORM" ]]; then
  # 显式环境变量优先。当多个平台环境变量同时存在时，Claude 优先。
  if [[ -n "${CLAUDE_USER_DIR:-}" || -n "${CLAUDE_PLUGIN_DATA:-}" ]]; then
    PLATFORM="claude"
  elif [[ -n "${CODEX_USER_DIR:-}" || -n "${CODEX_PLUGIN_DATA:-}" ]]; then
    PLATFORM="codex"
  # 对于宿主环境变量，仅在 $HOME 下同时存在对应平台目录时才匹配，
  # 避免全局继承的环境变量覆盖 $HOME 下的目录检测。
  elif [[ -n "${OPENCLAW_USER_DIR:-}" || -n "${OPENCLAW_PLUGIN_DATA:-}" || -n "${OPENCLAW_CONFIG_PATH:-}" ]] \
       && ! [[ -d "$HOME/.claude" || -f "$HOME/.codex/config.toml" ]]; then
    PLATFORM="openclaw"
  elif [[ -n "${HERMES_HOME:-}" || -n "${HERMES_USER_DIR:-}" || -n "${HERMES_PLUGIN_DATA:-}" ]] \
       && ! [[ -d "$HOME/.claude" || -f "$HOME/.codex/config.toml" || -f "$HOME/.openclaw/openclaw.json" || -d "$HOME/.openclaw" ]]; then
    PLATFORM="hermes"
  elif [[ -d "$HOME/.claude" ]]; then
    PLATFORM="claude"
  elif [[ -f "$HOME/.codex/config.toml" ]]; then
    PLATFORM="codex"
  elif [[ -f "$HOME/.openclaw/openclaw.json" || -d "$HOME/.openclaw" ]]; then
    PLATFORM="openclaw"
  elif [[ -f "$HOME/.hermes/config.yaml" || -d "$HOME/.hermes" ]]; then
    PLATFORM="hermes"
  else
    PLATFORM="claude"
  fi
fi
if [[ "$PLATFORM" != "claude" && "$PLATFORM" != "codex" && "$PLATFORM" != "openclaw" && "$PLATFORM" != "hermes" ]]; then
  red "错误：--platform 仅支持 claude / codex / openclaw / hermes"
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
    if [[ -n "${SCRIPT_DIR:-}" ]] && git -C "$SCRIPT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
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

# 确定用户级平台目录
HOST_CONFIG_FILE=""
if [[ "$PLATFORM" == "codex" ]]; then
  CONFIG_DIR="${CODEX_USER_DIR:-$HOME/.codex}"
  CONFIG_DIR_ENV="CODEX_USER_DIR"
  HOOKS_FILE="$CONFIG_DIR/hooks.json"
  PLUGIN_DATA_ENV="CODEX_PLUGIN_DATA"
elif [[ "$PLATFORM" == "openclaw" ]]; then
  CONFIG_DIR="${OPENCLAW_USER_DIR:-$HOME/.openclaw}"
  CONFIG_DIR_ENV="OPENCLAW_USER_DIR"
  HOOKS_FILE=""
  PLUGIN_DATA_ENV="OPENCLAW_PLUGIN_DATA"
  HOST_CONFIG_FILE="${OPENCLAW_CONFIG_PATH:-$CONFIG_DIR/openclaw.json}"
elif [[ "$PLATFORM" == "hermes" ]]; then
  CONFIG_DIR="${HERMES_HOME:-${HERMES_USER_DIR:-$HOME/.hermes}}"
  CONFIG_DIR_ENV="HERMES_HOME"
  HOOKS_FILE=""
  PLUGIN_DATA_ENV="HERMES_PLUGIN_DATA"
else
  CONFIG_DIR="${CLAUDE_USER_DIR:-$HOME/.claude}"
  CONFIG_DIR_ENV="CLAUDE_USER_DIR"
  HOOKS_FILE=""
  PLUGIN_DATA_ENV="CLAUDE_PLUGIN_DATA"
fi
PLUGINS_DIR="$CONFIG_DIR/plugins/cache"
INSTALL_DIR="$PLUGINS_DIR/$PLUGIN_NAME"

install_openclaw_host() {
  local hook_pack_dir="$INSTALL_DIR/adapters/openclaw-hook-pack"
  local plugin_dir="$INSTALL_DIR/adapters/openclaw"
  if [[ ! -d "$hook_pack_dir" ]]; then
    red "错误：缺少 OpenClaw hook-pack 目录 $hook_pack_dir"
    exit 1
  fi
  if [[ ! -d "$plugin_dir" ]]; then
    red "错误：缺少 OpenClaw adapter 目录 $plugin_dir"
    exit 1
  fi
  yellow "正在安装 OpenClaw hook-pack..."
  OPENCLAW_CONFIG_PATH="${HOST_CONFIG_FILE}" \
    openclaw plugins install "$hook_pack_dir" --link
  yellow "正在安装 OpenClaw adapter..."
  OPENCLAW_CONFIG_PATH="${HOST_CONFIG_FILE}" \
    openclaw plugins install "$plugin_dir" --link
}

uninstall_openclaw_host() {
  if command -v openclaw >/dev/null 2>&1; then
    OPENCLAW_CONFIG_PATH="${HOST_CONFIG_FILE}" \
      openclaw plugins uninstall capability-orchestrator --force >/dev/null 2>&1 || true
    OPENCLAW_CONFIG_PATH="${HOST_CONFIG_FILE}" \
      openclaw config unset hooks.internal.entries.capability-orchestrator-bootstrap >/dev/null 2>&1 || true
    OPENCLAW_CONFIG_PATH="${HOST_CONFIG_FILE}" \
      openclaw config unset hooks.internal.installs.openclaw-hook-pack >/dev/null 2>&1 || true
    OPENCLAW_CONFIG_PATH="${HOST_CONFIG_FILE}" \
      openclaw config unset hooks.internal.load.extraDirs.0 >/dev/null 2>&1 || true
  fi
}

HERMES_TMP_REPO=""
create_hermes_adapter_repo() {
  local src="$INSTALL_DIR/adapters/hermes"
  local tmp_repo
  tmp_repo="$(mktemp -d "/tmp/cap-orch-hermes-adapter-XXXXXX")"
  cp -R "$src"/. "$tmp_repo"/
  printf '%s\n' "$INSTALL_DIR" > "$tmp_repo/.capability-orchestrator-core-root"
  git -C "$tmp_repo" init -q
  git -C "$tmp_repo" config user.email "capability-orchestrator@example.invalid"
  git -C "$tmp_repo" config user.name "capability-orchestrator"
  git -C "$tmp_repo" add -A
  git -C "$tmp_repo" commit -qm "seed hermes adapter"
  printf '%s' "$tmp_repo"
}

install_hermes_host() {
  local src="$INSTALL_DIR/adapters/hermes"
  if [[ ! -d "$src" ]]; then
    red "错误：缺少 Hermes adapter 目录 $src"
    exit 1
  fi
  HERMES_TMP_REPO="$(create_hermes_adapter_repo)"
  yellow "正在安装 Hermes adapter..."
  HERMES_HOME="${CONFIG_DIR}" \
    hermes plugins install "file://$HERMES_TMP_REPO" --force
}

uninstall_hermes_host() {
  if command -v hermes >/dev/null 2>&1; then
    HERMES_HOME="${CONFIG_DIR}" \
      hermes plugins remove capability-orchestrator >/dev/null 2>&1 || true
  fi
}

# --version 支持
if [[ "$MODE" == "version" ]]; then
  echo "$PLUGIN_NAME $VERSION"
  exit 0
fi

# --uninstall 支持
if [[ "$MODE" == "uninstall" ]]; then
  bold "=== capability-orchestrator 卸载 ==="
  echo ""
  HELPER_SCRIPT="$(resolve_helper_script || true)"
  # 清理 hook 配置
  if [[ "$PLATFORM" == "codex" ]]; then
    if [[ -f "$HOOKS_FILE" && -n "${HELPER_SCRIPT:-}" ]]; then
      node "$HELPER_SCRIPT" --mode codex-uninstall --file "$HOOKS_FILE"
      echo "Codex hooks 已移除"
    fi
  elif [[ "$PLATFORM" == "openclaw" ]]; then
    uninstall_openclaw_host
    echo "OpenClaw hook-pack 已移除"
  elif [[ "$PLATFORM" == "hermes" ]]; then
    uninstall_hermes_host
    echo "Hermes adapter 已移除"
  else
    SETTINGS_FILE="$CONFIG_DIR/settings.json"
    if [[ -f "$SETTINGS_FILE" && -n "${HELPER_SCRIPT:-}" ]]; then
      node "$HELPER_SCRIPT" --mode claude-uninstall --file "$SETTINGS_FILE"
      echo "hook 已移除"
    fi
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
TMP_ZIP=""
TMP_DIR=""
STAGE_DIR=""
BACKUP_PATH=""

cleanup_install_artifacts() {
  local status=$?
  if [[ $status -ne 0 && -n "${BACKUP_PATH:-}" && -e "$BACKUP_PATH" ]]; then
    rm -rf "$INSTALL_DIR"
    mv "$BACKUP_PATH" "$INSTALL_DIR" 2>/dev/null || true
  elif [[ -n "${BACKUP_PATH:-}" && -e "$BACKUP_PATH" ]]; then
    rm -rf "$BACKUP_PATH"
  fi

  [[ -n "${STAGE_DIR:-}" && -d "$STAGE_DIR" ]] && rm -rf "$STAGE_DIR"
  [[ -n "${TMP_ZIP:-}" && -e "$TMP_ZIP" ]] && rm -f "$TMP_ZIP"
  [[ -n "${TMP_DIR:-}" && -d "$TMP_DIR" ]] && rm -rf "$TMP_DIR"
  [[ -n "${HERMES_TMP_REPO:-}" && -d "$HERMES_TMP_REPO" ]] && rm -rf "$HERMES_TMP_REPO"

  return $status
}

trap cleanup_install_artifacts EXIT

if [[ -e "$INSTALL_DIR/.git" ]]; then
  if [[ -n "$(git -C "$INSTALL_DIR" status --porcelain)" ]]; then
    red "更新失败（检测到已安装副本有本地修改），请手动处理：cd $INSTALL_DIR && git status"
    exit 1
  fi
  yellow "检测到已安装（git），正在按目标 ref 重装..."
fi

STAGE_DIR=$(mktemp -d "$PLUGINS_DIR/.cap-orch-stage-XXXXXX")
STAGED_INSTALL_DIR="$STAGE_DIR/$PLUGIN_NAME"

if [[ "$USE_GIT" -eq 1 ]]; then
  yellow "正在克隆到 $STAGED_INSTALL_DIR ..."
  if [[ "$RESOLVED_KIND" == "tag" ]]; then
    git clone --depth=1 \
      "$REPO_URL" "$STAGED_INSTALL_DIR"
    git -C "$STAGED_INSTALL_DIR" fetch --depth=1 origin "refs/tags/$RESOLVED_REF:refs/tags/$RESOLVED_REF"
    GIT_CONFIG_COUNT=1 \
    GIT_CONFIG_KEY_0=advice.detachedHead \
    GIT_CONFIG_VALUE_0=false \
    git -C "$STAGED_INSTALL_DIR" checkout -q "$RESOLVED_REF"
  else
    git clone --depth=1 --branch "$RESOLVED_REF" \
      "$REPO_URL" "$STAGED_INSTALL_DIR"
  fi
else
  if [[ -n "${CAPABILITY_INSTALL_REPO_URL:-}" ]]; then
    red "错误：本地/自定义 CAPABILITY_INSTALL_REPO_URL 需要 git clone，当前环境未找到 git"
    exit 1
  fi
  if ! command -v unzip >/dev/null 2>&1; then
    red "错误：curl 下载方式需要 unzip，请先安装或改用 git"
    exit 1
  fi
  yellow "正在下载（无 git，使用 curl）..."
  TMP_ZIP=$(mktemp /tmp/cap-orch-XXXXXX.zip)
  TMP_DIR=$(mktemp -d)
  if [[ "$RESOLVED_KIND" == "tag" ]]; then
    ZIP_REF="refs/tags/$RESOLVED_REF"
  else
    ZIP_REF="refs/heads/$RESOLVED_REF"
  fi
  curl -fsSL "https://github.com/$REPO/archive/$ZIP_REF.zip" -o "$TMP_ZIP"
  unzip -q "$TMP_ZIP" -d "$TMP_DIR"
  EXTRACTED=$(find "$TMP_DIR" -mindepth 1 -maxdepth 1 -type d | head -1)
  mv "$EXTRACTED" "$STAGED_INSTALL_DIR"
fi

# 确保脚本可执行
chmod +x "$STAGED_INSTALL_DIR/scripts/scan-environment.cjs"
chmod +x "$STAGED_INSTALL_DIR/scripts/route-matcher.cjs"

if [[ -L "$INSTALL_DIR" || -d "$INSTALL_DIR" ]]; then
  BACKUP_PATH="$PLUGINS_DIR/.cap-orch-backup-$(date +%s)-$$"
  mv "$INSTALL_DIR" "$BACKUP_PATH"
fi
mv "$STAGED_INSTALL_DIR" "$INSTALL_DIR"
rm -rf "$STAGE_DIR"
STAGE_DIR=""

# ── 注册 hooks ─────────────────────────────────────────────────────────────────

if [[ "$PLATFORM" == "codex" ]]; then
  # Codex: 写入 hooks.json
  SCAN_CMD="CAPABILITY_ORCHESTRATOR_HOOK=session-start $CONFIG_DIR_ENV=$(shell_quote "$CONFIG_DIR") $PLUGIN_DATA_ENV=$(shell_quote "$INSTALL_DIR/data") node $(shell_quote "$INSTALL_DIR/scripts/scan-environment.cjs") --mode=awareness"
  ROUTE_CMD="CAPABILITY_ORCHESTRATOR_HOOK=user-prompt-submit $CONFIG_DIR_ENV=$(shell_quote "$CONFIG_DIR") $PLUGIN_DATA_ENV=$(shell_quote "$INSTALL_DIR/data") node $(shell_quote "$INSTALL_DIR/scripts/route-matcher.cjs")"
  HELPER_SCRIPT="$(resolve_helper_script)"

  yellow "正在注册 Codex hooks..."
  node "$HELPER_SCRIPT" --mode codex-install --file "$HOOKS_FILE" --scan-cmd "$SCAN_CMD" --route-cmd "$ROUTE_CMD"
  echo "Codex hooks 已注册"
elif [[ "$PLATFORM" == "claude" ]]; then
  # Claude Code: 写入 settings.json
  SETTINGS_FILE="$CONFIG_DIR/settings.json"
  HOOK_CMD="CAPABILITY_ORCHESTRATOR_HOOK=session-start $CONFIG_DIR_ENV=$(shell_quote "$CONFIG_DIR") $PLUGIN_DATA_ENV=$(shell_quote "$INSTALL_DIR/data") node $(shell_quote "$INSTALL_DIR/scripts/scan-environment.cjs") --mode=awareness"
  ROUTE_CMD="CAPABILITY_ORCHESTRATOR_HOOK=user-prompt-submit $CONFIG_DIR_ENV=$(shell_quote "$CONFIG_DIR") $PLUGIN_DATA_ENV=$(shell_quote "$INSTALL_DIR/data") node $(shell_quote "$INSTALL_DIR/scripts/route-matcher.cjs")"
  HELPER_SCRIPT="$(resolve_helper_script)"
  CLAUDE_INSTALL_JSON=$(node "$HELPER_SCRIPT" --mode claude-install --file "$SETTINGS_FILE" --scan-cmd "$HOOK_CMD" --route-cmd "$ROUTE_CMD")
  SESSION_STATUS=$(printf '%s' "$CLAUDE_INSTALL_JSON" | node -e "const data=JSON.parse(require('fs').readFileSync(0,'utf8')); process.stdout.write(data.sessionStatus)")
  ROUTE_STATUS=$(printf '%s' "$CLAUDE_INSTALL_JSON" | node -e "const data=JSON.parse(require('fs').readFileSync(0,'utf8')); process.stdout.write(data.routeStatus)")

  yellow "正在注册 SessionStart hook..."
  echo "$SESSION_STATUS"

  # ── 注册 UserPromptSubmit hook ───────────────────────────────────────────────
  yellow "正在注册 UserPromptSubmit hook..."
  echo "$ROUTE_STATUS"
elif [[ "$PLATFORM" == "openclaw" ]]; then
  install_openclaw_host
elif [[ "$PLATFORM" == "hermes" ]]; then
  install_hermes_host
fi

echo ""
green "✓ 安装完成：$INSTALL_DIR (平台: $PLATFORM)"
if [[ "$PLATFORM" == "claude" || "$PLATFORM" == "codex" ]]; then
  green "✓ SessionStart hook 已注册（每次新会话自动注入能力摘要）"
  green "✓ UserPromptSubmit hook 已注册（每条消息自动匹配 skill）"
elif [[ "$PLATFORM" == "openclaw" ]]; then
  green "✓ OpenClaw hook-pack + adapter 已安装（实验宿主路径）"
elif [[ "$PLATFORM" == "hermes" ]]; then
  green "✓ Hermes adapter 已安装（实验宿主路径）"
fi
echo ""
bold "使用方式："
echo "  新会话开始时自动感知环境能力（无需手动触发）"
if [[ "$PLATFORM" == "codex" ]]; then
  echo "  \$capabilities — 查看完整能力摘要"
  echo "  \$orchestrate  — 路由复杂任务"
  echo "  \$refresh      — 对比前后能力变化"
  echo ""
  yellow "提示：重启 Codex CLI 后生效"
elif [[ "$PLATFORM" == "claude" ]]; then
  echo "  /capability-orchestrator:capabilities — 查看完整能力摘要"
  echo "  /capability-orchestrator:orchestrate  — 路由复杂任务"
  echo "  /capability-orchestrator:refresh      — 对比前后能力变化"
  echo ""
  yellow "提示：重启 Claude Code 开新会话后生效"
elif [[ "$PLATFORM" == "openclaw" ]]; then
  yellow "提示：按 OpenClaw 输出重启 gateway 后生效（hook-pack + adapter）"
elif [[ "$PLATFORM" == "hermes" ]]; then
  yellow "提示：按 Hermes 输出重启 gateway 后生效"
fi
