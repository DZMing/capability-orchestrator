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

# 生成一个 fake git 脚本，让 clone 变成 cp（避免网络请求）
FAKE_GIT="$TMP_GIT/git"
cat > "$FAKE_GIT" <<GITEOF
#!/usr/bin/env bash
# fake git: 把 clone 替换为从本地 repo 复制
if [ "\$1" = "clone" ]; then
  # 最后一个参数是目标目录
  TARGET="\${@: -1}"
  mkdir -p "\$TARGET"
  cp -r "$REPO_ROOT/." "\$TARGET/"
  # 初始化一个真实的 git repo（供 pull 使用）
  git -C "\$TARGET" init -q
  git -C "\$TARGET" add -A
  git -C "\$TARGET" -c user.email=t@t.com -c user.name=T commit -qm init
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

# ── 运行 install.sh ────────────────────────────────────────────────────────────
echo ""
echo "=== install.sh smoke test ==="
echo "CLAUDE_USER_DIR=$TMP_HOME"
echo ""

CLAUDE_USER_DIR="$TMP_HOME" PATH="$FAKE_PATH" \
  bash "$REPO_ROOT/install.sh" 2>&1 | sed 's/^/  /'

echo ""

# ── 断言文件落点 ───────────────────────────────────────────────────────────────
PLUGIN_DIR="$TMP_HOME/plugins/cache/capability-orchestrator"

assert_file "plugin manifest 存在"   "$PLUGIN_DIR/.claude-plugin/plugin.json"
assert_file "scan script 存在"        "$PLUGIN_DIR/scripts/scan-environment.cjs"
assert_exec "scan script 可执行"      "$PLUGIN_DIR/scripts/scan-environment.cjs"
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
assert "hook 命令含 --mode=list" \
  node -e "process.exit('$HOOK_CMD'.includes('--mode=list')?0:1)"

# ── 验证安装后脚本能运行 ──────────────────────────────────────────────────────
assert "scan script 可直接 node 执行" \
  node "$PLUGIN_DIR/scripts/scan-environment.cjs" --mode=list

# ── 结果 ──────────────────────────────────────────────────────────────────────
echo ""
echo "结果：$PASS 通过，$FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
