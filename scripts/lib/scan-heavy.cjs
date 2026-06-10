'use strict';

// scan-heavy.cjs — B 类重型信号巡逻(后台 worker 采集,下次会话报告)
//
// 信号清单:
//   B1 test   npm test 红绿(仅信任项目)
//   B2 audit  依赖漏洞 high/critical(仅信任项目 + CO_PATROL_AUDIT=1 显式开启,因联网)
//   B3 sync   npm run check:sync 缓存一致性(仅信任项目)
//   B4 todo   tracked 文件 TODO/FIXME 计数增量(只读 git grep,无条件)
//
// 安全模型:B1/B2/B3 执行的是项目自带 npm scripts —— 等于执行仓库任意代码。
// 防"克隆恶意仓库一开会话就被执行":信任清单存在插件数据目录(仓库外,
// 仓库自身无法伪造),不在清单内的项目只跑 B4 只读统计。
//
// 铁律:零外部依赖、故障开放(任何信号失败 → null 记 errors,绝不抛出)、
// 唯一写入面 = CLAUDE_PLUGIN_DATA 下的结果/lock 文件(route-logger 同款例外)。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const { PATROL_FOOTER } = require('./scan-status.cjs');

const TRUST_FILE = 'patrol-trust.json';
const RESULT_PREFIX = 'patrol-heavy-';
const LOCK_STALE_MS = 10 * 60 * 1000;       // 超过 10 分钟的 lock 视为死 worker,可抢
const RESULT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 体检报告超过 24h 不再展示
const TEST_TIMEOUT_MS = 120000;
const SYNC_TIMEOUT_MS = 60000;
const AUDIT_TIMEOUT_MS = 60000;
const GIT_TIMEOUT_MS = 5000;
const TAIL_LINES = 5;
const TAIL_MAX_CHARS = 300;
const DEFAULT_MAX_CHARS = 1500;

function resolveDataDir(env) {
  return env.CLAUDE_PLUGIN_DATA || env.CODEX_PLUGIN_DATA || null;
}

// symlink 归一化(macOS /tmp → /private/tmp),失败回退 resolve
function normalizePath(p) {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

function loadTrust(dataDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dataDir, TRUST_FILE), 'utf8'));
    const projects = Array.isArray(parsed && parsed.projects) ? parsed.projects : [];
    return { projects: projects.map(p => normalizePath(String(p))) };
  } catch {
    return { projects: [] };
  }
}

function isTrusted(cwd, trust) {
  if (!trust || !Array.isArray(trust.projects)) return false;
  return trust.projects.includes(normalizePath(cwd));
}

function cwdKey(cwd) {
  return crypto.createHash('sha1').update(normalizePath(cwd)).digest('hex').slice(0, 12);
}

function resultFile(dataDir, cwd) {
  return path.join(dataDir, `${RESULT_PREFIX}${cwdKey(cwd)}.json`);
}

function saveResult(dataDir, result) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(resultFile(dataDir, result.cwd), JSON.stringify(result));
}

function loadLastResult(dataDir, cwd) {
  try {
    return JSON.parse(fs.readFileSync(resultFile(dataDir, cwd), 'utf8'));
  } catch {
    return null;
  }
}

function lockFile(dataDir, cwd) {
  return path.join(dataDir, `${RESULT_PREFIX}${cwdKey(cwd)}.lock`);
}

function acquireLock(dataDir, cwd) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = lockFile(dataDir, cwd);
  try {
    fs.writeFileSync(file, String(process.pid), { flag: 'wx' });
    return true;
  } catch {
    try {
      // lock 已存在:陈旧则抢占(覆盖),新鲜则退让
      if (Date.now() - fs.statSync(file).mtimeMs > LOCK_STALE_MS) {
        fs.writeFileSync(file, String(process.pid));
        return true;
      }
    } catch { /* stat 失败当作占用中 */ }
    return false;
  }
}

function releaseLock(dataDir, cwd) {
  try { fs.unlinkSync(lockFile(dataDir, cwd)); } catch { /* 已不存在即目的达成 */ }
}

function readPackageScripts(cwd) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
    return (pkg && pkg.scripts) || {};
  } catch {
    return {};
  }
}

function hasPackageJson(cwd) {
  return fs.existsSync(path.join(cwd, 'package.json'));
}

// 默认命令执行器:非零退出不抛(返回 status+输出),真错误(超时/找不到命令)才抛。
// Windows 上 npm 是 npm.cmd,新版 Node 对 .cmd 强制要求 shell(CVE-2024-27980)。
function defaultRunCommand(cmd, args, { cwd, timeout }) {
  const isWin = process.platform === 'win32';
  const bin = cmd === 'npm' && isWin ? 'npm.cmd' : cmd;
  try {
    const stdout = execFileSync(bin, args, {
      cwd,
      encoding: 'utf8',
      timeout,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: isWin,
    });
    return { status: 0, stdout };
  } catch (err) {
    if (err && typeof err.status === 'number') {
      return { status: err.status, stdout: `${err.stdout || ''}${err.stderr || ''}` };
    }
    throw err;
  }
}

function outputTail(stdout) {
  const lines = String(stdout || '').split('\n').map(l => l.trim()).filter(Boolean);
  return lines.slice(-TAIL_LINES).join(' | ').slice(0, TAIL_MAX_CHARS);
}

// B4:tracked 文件 TODO/FIXME 总数。git grep -c 输出 per-file "path:count";
// 无匹配时退出码 1 且无输出 → 0,非 git 仓库 → 抛(由调用方标记未采集)。
function countTodos(cwd) {
  let out;
  try {
    out = execFileSync('git', ['grep', '-c', '-e', 'TODO', '-e', 'FIXME'], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GIT_TIMEOUT_MS,
    });
  } catch (err) {
    if (err && err.status === 1 && !String(err.stdout || '').trim()) return 0;
    throw err;
  }
  return String(out).split('\n').filter(Boolean)
    .reduce((sum, line) => sum + (parseInt(line.slice(line.lastIndexOf(':') + 1), 10) || 0), 0);
}

async function collectHeavySignals({ cwd, trusted, runCommand = defaultRunCommand, env = process.env, lastResult = null } = {}) {
  const errors = [];
  const safe = (label, fn) => {
    try { return fn(); } catch (err) {
      errors.push(`${label}: ${err && err.message ? err.message : String(err)}`);
      return null;
    }
  };
  const scripts = readPackageScripts(cwd);

  const test = safe('test', () => {
    if (!trusted) return { ran: false, reason: 'untrusted' };
    if (!scripts.test) return { ran: false, reason: 'no-script' };
    const r = runCommand('npm', ['test'], { cwd, timeout: TEST_TIMEOUT_MS });
    return r.status === 0
      ? { ran: true, ok: true }
      : { ran: true, ok: false, tail: outputTail(r.stdout) };
  });

  const sync = safe('sync', () => {
    if (!trusted) return { ran: false, reason: 'untrusted' };
    if (!scripts['check:sync']) return { ran: false, reason: 'no-script' };
    const r = runCommand('npm', ['run', 'check:sync'], { cwd, timeout: SYNC_TIMEOUT_MS });
    return { ran: true, ok: r.status === 0 };
  });

  const audit = safe('audit', () => {
    if (!trusted || env.CO_PATROL_AUDIT !== '1') return { ran: false, reason: 'disabled' };
    if (!hasPackageJson(cwd)) return { ran: false, reason: 'no-package' };
    const r = runCommand('npm', ['audit', '--json'], { cwd, timeout: AUDIT_TIMEOUT_MS });
    const vulns = (JSON.parse(r.stdout).metadata || {}).vulnerabilities || {};
    return { ran: true, high: vulns.high || 0, critical: vulns.critical || 0 };
  });

  const todo = safe('todo', () => {
    let total;
    try { total = countTodos(cwd); } catch { return { ran: false }; }
    const prev = lastResult && lastResult.signals && lastResult.signals.todo;
    return { ran: true, total, prevTotal: prev && typeof prev.total === 'number' ? prev.total : null };
  });

  return {
    version: 1,
    cwd: String(cwd),
    at: Date.now(),
    trusted: !!trusted,
    signals: { test, sync, audit, todo },
    errors,
  };
}

function ageLabel(ms) {
  const min = Math.max(1, Math.round(ms / 60000));
  return min < 60 ? `${min} 分钟前` : `${Math.round(min / 60)} 小时前`;
}

function renderHeavyReport(result, { now = Date.now(), maxChars = DEFAULT_MAX_CHARS } = {}) {
  if (!result || !result.signals) return '';
  const age = now - (result.at || 0);
  if (age < 0 || age > RESULT_MAX_AGE_MS) return '';

  const s = result.signals;
  const items = [];

  if (s.test && s.test.ran && s.test.ok === false) {
    items.push(`测试有失败:${s.test.tail || '(无输出摘要)'} — 可逆,可自动修(同思路 ≤3 轮),修不动再报告`);
  }
  if (s.sync && s.sync.ran && s.sync.ok === false) {
    items.push('插件缓存与仓库不同步 — 可逆,可直接 npm run sync 后报备');
  }
  if (s.audit && s.audit.ran && (s.audit.critical > 0 || s.audit.high > 0)) {
    items.push(`依赖安全漏洞:critical ${s.audit.critical}、high ${s.audit.high} — 给修复方案,改依赖需先问用户`);
  }
  if (s.todo && s.todo.ran && typeof s.todo.prevTotal === 'number' && s.todo.total > s.todo.prevTotal) {
    items.push(`TODO/FIXME 较上次新增 ${s.todo.total - s.todo.prevTotal} 个(现共 ${s.todo.total})— 记录即可,不必处理`);
  }

  if (items.length === 0) return '';

  const lines = [
    `🔍 后台体检报告(${items.length} 件,检查于 ${ageLabel(age)}):`,
    ...items.map((t, i) => `${i + 1}. ❗ ${t}`),
    PATROL_FOOTER,
  ];
  const text = lines.join('\n');
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

module.exports = {
  resolveDataDir,
  loadTrust,
  isTrusted,
  saveResult,
  loadLastResult,
  acquireLock,
  releaseLock,
  collectHeavySignals,
  renderHeavyReport,
  defaultRunCommand,
};
