#!/usr/bin/env bash
# install.sh smoke test
# 在隔离的临时目录里跑 install.sh，断言文件落点和 settings.json 结构
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0

green()  { printf '\033[0;32m✔ %s\033[0m\n' "$*"; }
red()    { printf '\033[0;31m✗ %s\033[0m\n' "$*"; }
assert() {
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then
    green "$desc"; PASS=$((PASS + 1))
  else
    red "$desc"; FAIL=$((FAIL + 1))
  fi
}
assert_file() { assert "$1" test -f "$2"; }
assert_exec() { assert "$1" test -x "$2"; }

# ── 准备隔离环境 ───────────────────────────────────────────────────────────────
TMP_HOME=$(mktemp -d)
TMP_GIT=$(mktemp -d)
trap 'rm -rf "$TMP_HOME" "$TMP_GIT"' EXIT
LATEST_TAG=$(/usr/bin/git -C "$REPO_ROOT" tag --list 'v*' | sort -V | tail -n 1)

# 生成一个 fake git 脚本，让 clone 变成 cp（避免网络请求）
FAKE_GIT="$TMP_GIT/git"
cat > "$FAKE_GIT" <<GITEOF
#!/usr/bin/env bash
# fake git: 把 clone 替换为从本地 repo 复制
if [ "\$1" = "clone" ]; then
  if [ -n "\${FAKE_GIT_FAIL_CLONE:-}" ]; then
    echo "simulated clone failure" >&2
    exit 1
  fi
  BRANCH=""
  for ((i=1; i<=\$#; i++)); do
    if [ "\${!i}" = "--branch" ]; then
      j=\$((i + 1))
      BRANCH="\${!j}"
      break
    fi
  done
  printf '%s' "\$BRANCH" > "$TMP_GIT/last-clone-branch.txt"
  # 最后一个参数是目标目录
  TARGET="\${@: -1}"
  mkdir -p "\$TARGET"
  cp -r "$REPO_ROOT/." "\$TARGET/"
  # 清除源仓库的 .git（防止复制 hooks 等影响测试）
  rm -rf "\$TARGET/.git"
  # 初始化一个干净的 git repo（供 pull 使用）
  git -C "\$TARGET" init -q
  git -C "\$TARGET" add -A
  git -C "\$TARGET" -c core.hooksPath=/dev/null -c user.email=t@t.com -c user.name=T commit -qm init
elif [ "\$1" = "-C" ] && [ "\$3" = "pull" ]; then
  echo "Already up to date."
else
  # 其他 git 命令透传
  /usr/bin/git "\$@"
fi
GITEOF
chmod +x "$FAKE_GIT"

# node/bash/git 使用真实的，fake git 排在最前面覆盖 clone 行为
FAKE_PATH="$TMP_GIT:$(dirname "$(which node)"):$(dirname "$(which bash)"):/usr/bin:/bin"

# ── 符号链接覆盖测试 ─────────────────────────────────────────────────────────
PLUGIN_DIR_PRE="$TMP_HOME/plugins/cache/capability-orchestrator"
SYMLINK_TARGET=$(mktemp -d)
mkdir -p "$(dirname "$PLUGIN_DIR_PRE")"
ln -s "$SYMLINK_TARGET" "$PLUGIN_DIR_PRE"

# ── 运行 install.sh（覆盖符号链接）────────────────────────────────────────────
echo ""
echo "=== install.sh smoke test ==="
echo "CLAUDE_USER_DIR=$TMP_HOME"
echo ""

CLAUDE_USER_DIR="$TMP_HOME" PATH="$FAKE_PATH" \
  bash "$REPO_ROOT/install.sh" 2>&1 | sed 's/^/  /'

# 验证符号链接被替换为真实目录，且原目标未被 rm -rf
assert "安装后是真实目录而非符号链接" test -d "$PLUGIN_DIR_PRE" -a ! -L "$PLUGIN_DIR_PRE"
assert "符号链接原目标未被删除" test -d "$SYMLINK_TARGET"
rm -rf "$SYMLINK_TARGET"

echo ""

# ── 断言文件落点 ───────────────────────────────────────────────────────────────
PLUGIN_DIR="$TMP_HOME/plugins/cache/capability-orchestrator"

assert_file "plugin manifest 存在"   "$PLUGIN_DIR/.claude-plugin/plugin.json"
assert_file "scan script 存在"        "$PLUGIN_DIR/scripts/scan-environment.cjs"
assert_exec "scan script 可执行"      "$PLUGIN_DIR/scripts/scan-environment.cjs"
assert_file "route-matcher 存在"      "$PLUGIN_DIR/scripts/route-matcher.cjs"
assert_exec "route-matcher 可执行"    "$PLUGIN_DIR/scripts/route-matcher.cjs"
assert_file "capabilities SKILL.md"  "$PLUGIN_DIR/skills/capabilities/SKILL.md"
assert_file "orchestrate SKILL.md"   "$PLUGIN_DIR/skills/orchestrate/SKILL.md"
assert_file "refresh SKILL.md"       "$PLUGIN_DIR/skills/refresh/SKILL.md"

# ── 断言 settings.json 结构 ───────────────────────────────────────────────────
SETTINGS="$TMP_HOME/settings.json"
assert_file "settings.json 已创建" "$SETTINGS"

# 验证 JSON 合法性
assert "settings.json 是合法 JSON" \
  node -e "JSON.parse(require('fs').readFileSync('$SETTINGS','utf8'))"

# 验证有且仅有一条 capability-orchestrator hook
HOOK_COUNT=$(node -e "
  const s = JSON.parse(require('fs').readFileSync('$SETTINGS','utf8'));
  const hooks = (s.hooks || {}).SessionStart || [];
  const n = hooks.filter(e => e.hooks && e.hooks.some(h => h.command && h.command.includes('capability-orchestrator'))).length;
  process.stdout.write(String(n));
")
assert "SessionStart hook 已注册" [ "$HOOK_COUNT" -eq 1 ]

# 验证 UserPromptSubmit hook
ROUTE_COUNT=$(node -e "
  const s = JSON.parse(require('fs').readFileSync('$SETTINGS','utf8'));
  const hooks = (s.hooks || {}).UserPromptSubmit || [];
  const n = hooks.filter(e => e.hooks && e.hooks.some(h => h.command && h.command.includes('capability-orchestrator'))).length;
  process.stdout.write(String(n));
")
assert "UserPromptSubmit hook 已注册" [ "$ROUTE_COUNT" -eq 1 ]

# 验证 hook 命令指向正确脚本
HOOK_CMD=$(node -e "
  const s = JSON.parse(require('fs').readFileSync('$SETTINGS','utf8'));
  const hooks = (s.hooks || {}).SessionStart || [];
  for (const e of hooks) {
    for (const h of (e.hooks||[])) {
      if (h.command && h.command.includes('capability-orchestrator')) {
        process.stdout.write(h.command); process.exit(0);
      }
    }
  }
")
assert "hook 命令含 scan-environment.cjs" \
  node -e "process.exit('$HOOK_CMD'.includes('scan-environment.cjs')?0:1)"
assert "hook 命令含 --mode=awareness" \
  node -e "process.exit('$HOOK_CMD'.includes('--mode=awareness')?0:1)"
assert "默认安装渠道使用最新 release tag" [ "$(cat "$TMP_GIT/last-clone-branch.txt")" = "$LATEST_TAG" ]

# ── 验证安装后脚本能运行 ──────────────────────────────────────────────────────
assert "scan script 可直接 node 执行" \
  node "$PLUGIN_DIR/scripts/scan-environment.cjs" --mode=awareness

# ── 验证显式 master 渠道 ─────────────────────────────────────────────────────
CLAUDE_USER_DIR="$TMP_HOME" PATH="$FAKE_PATH" CAPABILITY_INSTALL_CHANNEL=master CAPABILITY_INSTALL_REF=master \
  bash "$REPO_ROOT/install.sh" 2>&1 | sed 's/^/  /'

assert "显式 master 渠道仍可用" [ "$(cat "$TMP_GIT/last-clone-branch.txt")" = "master" ]

# ── 失败重装不应删除旧安装 ───────────────────────────────────────────────────
PRESERVE_HOME=$(mktemp -d)
mkdir -p "$PRESERVE_HOME/plugins/cache/capability-orchestrator"
echo "stable-install" > "$PRESERVE_HOME/plugins/cache/capability-orchestrator/keep.txt"

if CLAUDE_USER_DIR="$PRESERVE_HOME" PATH="$FAKE_PATH" FAKE_GIT_FAIL_CLONE=1 \
  bash "$REPO_ROOT/install.sh" >/tmp/cap-orch-install-fail.log 2>&1; then
  red "失败重装场景应返回非零退出码"; FAIL=$((FAIL + 1))
else
  green "失败重装场景返回非零退出码"; PASS=$((PASS + 1))
fi
assert_file "失败重装后旧安装仍保留" "$PRESERVE_HOME/plugins/cache/capability-orchestrator/keep.txt"
rm -rf "$PRESERVE_HOME" /tmp/cap-orch-install-fail.log

# ── 自动检测应优先识别 CODEX_USER_DIR ───────────────────────────────────────
AUTO_HOME=$(mktemp -d)
AUTO_CODEX="$AUTO_HOME/custom-codex"
mkdir -p "$AUTO_HOME/.claude" "$AUTO_CODEX"
HOME="$AUTO_HOME" CODEX_USER_DIR="$AUTO_CODEX" PATH="$FAKE_PATH" CAPABILITY_INSTALL_REF=master \
  bash "$REPO_ROOT/install.sh" >/tmp/cap-orch-codex-auto.log 2>&1

assert_file "CODEX_USER_DIR 自动检测写入 hooks.json" "$AUTO_CODEX/hooks.json"
assert "CODEX_USER_DIR 自动检测不会写 Claude settings.json" test ! -f "$AUTO_HOME/.claude/settings.json"

HOME="$AUTO_HOME" CODEX_USER_DIR="$AUTO_CODEX" PATH="$FAKE_PATH" CAPABILITY_INSTALL_REF=master \
  bash "$REPO_ROOT/install.sh" --uninstall >/tmp/cap-orch-codex-uninstall.log 2>&1

assert "自动检测的 Codex 卸载会清理 capability hooks" node -e "
  const hooks = JSON.parse(require('fs').readFileSync('$AUTO_CODEX/hooks.json', 'utf8'));
  const entries = (hooks.hooks || {}).SessionStart || [];
  process.exit(entries.some(e => e.hooks && e.hooks.some(h => (h.command || '').includes('capability-orchestrator'))) ? 1 : 0);
"
rm -rf "$AUTO_HOME" /tmp/cap-orch-codex-auto.log /tmp/cap-orch-codex-uninstall.log

# ── 同时存在 Claude + Codex 时，默认仍应保持 Claude 优先 ────────────────────
DUAL_HOME=$(mktemp -d)
mkdir -p "$DUAL_HOME/.claude" "$DUAL_HOME/.codex"
cat > "$DUAL_HOME/.codex/config.toml" <<'EOF'
model = "gpt-5.4"
EOF

HOME="$DUAL_HOME" PATH="$FAKE_PATH" CAPABILITY_INSTALL_REF=master \
  bash "$REPO_ROOT/install.sh" >/tmp/cap-orch-dual-auto.log 2>&1

assert_file "双安装默认检测仍写 Claude settings.json" "$DUAL_HOME/.claude/settings.json"
assert "双安装默认检测不会误写 Codex hooks.json" test ! -f "$DUAL_HOME/.codex/hooks.json"
rm -rf "$DUAL_HOME" /tmp/cap-orch-dual-auto.log

# ── 验证卸载 ─────────────────────────────────────────────────────────────────
CLAUDE_USER_DIR="$TMP_HOME" PATH="$FAKE_PATH" \
  bash "$REPO_ROOT/install.sh" --uninstall 2>&1 | sed 's/^/  /'

assert "卸载后插件目录已删除" test ! -d "$PLUGIN_DIR"

HOOK_AFTER=$(node -e "
  const s = JSON.parse(require('fs').readFileSync('$SETTINGS','utf8'));
  const hooks = (s.hooks || {}).SessionStart || [];
  const n = hooks.filter(e => e.hooks && e.hooks.some(h => h.command && h.command.includes('capability-orchestrator'))).length;
  process.stdout.write(String(n));
")
assert "卸载后 SessionStart hook 已移除" [ "$HOOK_AFTER" -eq 0 ]

ROUTE_AFTER=$(node -e "
  const s = JSON.parse(require('fs').readFileSync('$SETTINGS','utf8'));
  const hooks = (s.hooks || {}).UserPromptSubmit || [];
  const n = hooks.filter(e => e.hooks && e.hooks.some(h => h.command && h.command.includes('capability-orchestrator'))).length;
  process.stdout.write(String(n));
")
assert "卸载后 UserPromptSubmit hook 已移除" [ "$ROUTE_AFTER" -eq 0 ]

# ── 结果 ──────────────────────────────────────────────────────────────────────
echo ""
echo "结果：$PASS 通过，$FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
