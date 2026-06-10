'use strict';

// danger-rules.cjs — Bash 命令级别危险模式检测
// 只处理实际执行的 shell 命令字符串，不处理 prompt 文本
// 故障开放：任何异常调用方应捕获并放行

// rm -rf 危险范围：命令中含有 -r 和 -f 标志（组合或分开）
const DESTRUCTIVE_CMD_RE = /\brm\b.*-[^\s]*r[^\s]*f|-[^\s]*f[^\s]*r/i;

// git push --force / -f（force push 本身就危险，不区分目标分支）
const REMOTE_GIT_FORCE_RE = /git\s+push\b[^|&\n]*(?:--force|-f\b)/i;

// git reset --hard（会丢失未提交改动）
const RESET_HARD_RE = /git\s+reset\s+--hard/i;

// DROP TABLE / DROP DATABASE（不区分大小写）
const DROP_RE = /\bDROP\s+(TABLE|DATABASE)\b/i;

// chmod -R 777 / 或 chmod 777 /（开放根目录权限）
const DANGER_CHMOD_RE = /chmod\s+(?:-R\s+)?777\s+\/(?:\s|$)/i;

// 安全路径：包含这些模式的 rm -rf 目标是允许的
const SAFE_PATH_PATTERNS = [
  /\/tmp(?:\/|$|\s)/,
  /\btmp\/\b/,
  /node_modules(?:\/|$|\s|")/,
];

function isSafePath(command) {
  return SAFE_PATH_PATTERNS.some((re) => re.test(command));
}

/**
 * 判断 Bash 命令是否危险
 * @param {string} command — 待检测的 shell 命令字符串
 * @returns {{ dangerous: boolean, reason: string }}
 */
function isDangerous(command) {
  const cmd = String(command || '');

  // rm -rf：路径在安全区则放行
  if (DESTRUCTIVE_CMD_RE.test(cmd)) {
    if (!isSafePath(cmd)) {
      return {
        dangerous: true,
        reason: 'rm -rf 可能删除重要文件，目标路径不在安全区（/tmp / node_modules）',
      };
    }
  }

  // git push --force
  if (REMOTE_GIT_FORCE_RE.test(cmd)) {
    return {
      dangerous: true,
      reason: 'git push --force 会覆写远程历史，可能导致不可恢复的数据丢失',
    };
  }

  // git reset --hard
  if (RESET_HARD_RE.test(cmd)) {
    return {
      dangerous: true,
      reason: 'git reset --hard 会丢失所有未提交的本地改动',
    };
  }

  // DROP TABLE / DROP DATABASE
  if (DROP_RE.test(cmd)) {
    return {
      dangerous: true,
      reason: 'DROP TABLE/DATABASE 会永久删除数据库数据，无法恢复',
    };
  }

  // chmod -R 777 /
  if (DANGER_CHMOD_RE.test(cmd)) {
    return {
      dangerous: true,
      reason: 'chmod -R 777 / 会开放整个文件系统的权限，存在严重安全风险',
    };
  }

  return { dangerous: false, reason: '' };
}

module.exports = {
  isDangerous,
  // 导出正则常量供 safety-gate.cjs 复用，避免重复字面量
  DESTRUCTIVE_CMD_RE,
  REMOTE_GIT_FORCE_RE,
  RESET_HARD_RE,
  DROP_RE,
  DANGER_CHMOD_RE,
};
