#!/usr/bin/env bash
# install.sh 幂等性测试
# 连续运行两次 install.sh，断言：
#   - SessionStart 里 capability-orchestrator hook 只有一条
#   - 已有的无关 settings（permissions/model）不被破坏
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0

green() { printf '\033[0;32m✔ %s\033[0m\n' "$*"; }
red()   { printf '\033[0;31m✗ %s\033[0m\n' "$*"; }
assert() {
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then
    green "$desc"; PASS=$((PASS + 1))
  else
    red "$desc"; FAIL=$((FAIL + 1))
  fi
}

# ── 准备隔离环境 ───────────────────────────────────────────────────────────────
TMP_HOME=$(mktemp -d)
TMP_GIT=$(mktemp -d)
trap 'rm -rf "$TMP_HOME" "$TMP_GIT"' EXIT

FAKE_GIT="$TMP_GIT/git"
cat > "$FAKE_GIT" <<GITEOF
#!/usr/bin/env bash
if [ "\$1" = "clone" ]; then
  TARGET="\${@: -1}"
  mkdir -p "\$TARGET"
  cp -r "$REPO_ROOT/." "\$TARGET/"
  rm -rf "\$TARGET/.git"
  git -C "\$TARGET" init -q
  git -C "\$TARGET" add -A
  git -C "\$TARGET" -c user.email=t@t.com -c user.name=T commit -qm init
elif [ "\$1" = "-C" ] && [ "\$3" = "pull" ]; then
  echo "Already up to date."
else
  /usr/bin/git "\$@"
fi
GITEOF
chmod +x "$FAKE_GIT"
FAKE_PATH="$TMP_GIT:$(dirname "$(which node)"):$(dirname "$(which bash)"):/usr/bin:/bin"

# ── 预置一个已有的 settings.json（模拟真实用户环境）────────────────────────────
SETTINGS="$TMP_HOME/settings.json"
cat > "$SETTINGS" <<'JSON'
{
  "model": "opus",
  "permissions": { "allow": ["Bash(*)"] },
  "hooks": {
    "SessionStart": [
      {
        "hooks": [{ "type": "command", "command": "node /some/other/hook.js", "timeout": 5 }]
      }
    ]
  }
}
JSON

echo ""
echo "=== install.sh 幂等性测试 ==="
echo ""

# ── 第一次安装 ────────────────────────────────────────────────────────────────
echo "--- 第一次安装 ---"
CLAUDE_USER_DIR="$TMP_HOME" PATH="$FAKE_PATH" \
  bash "$REPO_ROOT/install.sh" 2>&1 | grep -E '✓|错误|hook' | sed 's/^/  /'

COUNT1=$(node -e "
  const s = JSON.parse(require('fs').readFileSync('$SETTINGS','utf8'));
  const hooks = (s.hooks||{}).SessionStart||[];
  process.stdout.write(String(hooks.filter(e=>e.hooks&&e.hooks.some(h=>h.command&&h.command.includes('capability-orchestrator'))).length));
")
assert "第一次安装后 hook 数量为 1" [ "$COUNT1" -eq 1 ]

# ── 第二次安装（模拟 upgrade）─────────────────────────────────────────────────
echo "--- 第二次安装 ---"
CLAUDE_USER_DIR="$TMP_HOME" PATH="$FAKE_PATH" \
  bash "$REPO_ROOT/install.sh" 2>&1 | grep -E '✓|错误|hook' | sed 's/^/  /'

COUNT2=$(node -e "
  const s = JSON.parse(require('fs').readFileSync('$SETTINGS','utf8'));
  const hooks = (s.hooks||{}).SessionStart||[];
  process.stdout.write(String(hooks.filter(e=>e.hooks&&e.hooks.some(h=>h.command&&h.command.includes('capability-orchestrator'))).length));
")
assert "第二次安装后 hook 数量仍为 1（无重复）" [ "$COUNT2" -eq 1 ]

# ── 断言无关 settings 未被破坏 ───────────────────────────────────────────────
assert "model 字段保留" node -e "
  const s = JSON.parse(require('fs').readFileSync('$SETTINGS','utf8'));
  process.exit(s.model === 'opus' ? 0 : 1);
"
assert "permissions 字段保留" node -e "
  const s = JSON.parse(require('fs').readFileSync('$SETTINGS','utf8'));
  process.exit((s.permissions&&s.permissions.allow) ? 0 : 1);
"
assert "原有 other/hook.js 未被删除" node -e "
  const s = JSON.parse(require('fs').readFileSync('$SETTINGS','utf8'));
  const hooks = (s.hooks||{}).SessionStart||[];
  const found = hooks.some(e=>e.hooks&&e.hooks.some(h=>h.command&&h.command.includes('other/hook.js')));
  process.exit(found ? 0 : 1);
"

# ── SessionStart 总条目数（原有1 + 新增1 = 2）────────────────────────────────
TOTAL=$(node -e "
  const s = JSON.parse(require('fs').readFileSync('$SETTINGS','utf8'));
  process.stdout.write(String((s.hooks||{}).SessionStart.length));
")
assert "SessionStart 总条目为 2（原有+新增）" [ "$TOTAL" -eq 2 ]

# ── 结果 ──────────────────────────────────────────────────────────────────────
echo ""
echo "结果：$PASS 通过，$FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
