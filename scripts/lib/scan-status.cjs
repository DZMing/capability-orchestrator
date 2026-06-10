'use strict';

// scan-status.cjs — 会话启动状态巡逻(秒级信号)
//
// 职责:发现"值得主动处理的待办信号",只采集 + 报告,不执行任何修复动作。
// 执行决策由主会话模型按 [PATROL] 分档规则做(零风险直接做/可逆做完报备/不可逆先问)。
//
// 信号清单(设计见仓库顶层 .planning/proactive-agent-design.md):
//   A1 dirty        工作区未提交文件(过滤运行时噪音路径)
//   A2 unpushed     本地领先 upstream 的提交数
//   A3 wrongBranch  活已干完(无脏/无领先)却停在非主分支
//   A4 unfinished   近 7 天的中断现场文件(.planning/STATE.md 等)
//   A5 dailySummary 用户日总结流程存在但今日缺文件
//   A6 stashes      stash 暂存堆积(挂起未完成的工作)
//
// 铁律:只读、零外部依赖、故障开放(任何信号失败 → null,绝不抛出)。

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const GIT_TIMEOUT_MS = 800;
const UNFINISHED_MAX_AGE_DAYS = 7;
const DEFAULT_MAX_CHARS = 1500;

// 运行时状态目录的改动不算"人工干到一半的活"
const DEFAULT_NOISE_PREFIXES = ['.omc/', '.claude/', '.planning/', '.codex/'];

// 中断现场标记文件(相对项目根)。
// 注意:不含 .omc/state/mission-state.json — 它是 OMC 运行时心跳,mtime 恒新,报了等于噪音。
const UNFINISHED_MARKERS = [
  path.join('.planning', 'STATE.md'),
  path.join('.planning', 'HANDOFF.json'),
];

// raw=true 保留原始输出(porcelain 首行的前导空格是状态列,trim 会切歪解析)
function gitOut(cwd, args, { raw = false } = {}) {
  const out = execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: GIT_TIMEOUT_MS,
  });
  return raw ? out : out.trim();
}

function noisePrefixes() {
  const env = process.env.CO_STATUS_NOISE;
  if (!env) return DEFAULT_NOISE_PREFIXES;
  return env.split(',').map(s => s.trim()).filter(Boolean);
}

function isNoise(file, prefixes) {
  const normalized = file.replace(/\\/g, '/');
  return prefixes.some(p => normalized.startsWith(p));
}

// A1:porcelain 行 → 非噪音脏文件
function collectDirty(cwd) {
  const out = gitOut(cwd, ['status', '--porcelain'], { raw: true });
  if (!out.trim()) return null;
  const prefixes = noisePrefixes();
  const files = [];
  for (const line of out.split(/\r?\n/)) {
    if (line.length < 4) continue;
    let file = line.slice(3);
    const arrow = file.indexOf(' -> '); // rename 取新路径
    if (arrow !== -1) file = file.slice(arrow + 4);
    if (!isNoise(file, prefixes)) files.push(file);
  }
  if (files.length === 0) return null;
  return { count: files.length, samples: files.slice(0, 3) };
}

// A2:本地领先 upstream 提交数(无 upstream → null)
function collectUnpushed(cwd) {
  const out = gitOut(cwd, ['rev-list', '--count', '@{upstream}..HEAD']);
  const count = Number.parseInt(out, 10);
  if (!Number.isFinite(count) || count <= 0) return null;
  return { count };
}

function detectMainBranch(cwd) {
  try {
    const ref = gitOut(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
    const name = ref.replace(/^origin\//, '');
    if (name) return name;
  } catch { /* 无远端 HEAD 时回退到常见名 */ }
  for (const name of ['master', 'main']) {
    try {
      gitOut(cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${name}`]);
      return name;
    } catch { /* 该分支不存在,试下一个 */ }
  }
  return null;
}

// A3:干净 + 无领先 + 非主分支 → 活干完了停错地方
function collectWrongBranch(cwd, dirty, unpushed) {
  if (dirty || unpushed) return null;
  const current = gitOut(cwd, ['branch', '--show-current']);
  if (!current) return null; // detached HEAD 不判
  const main = detectMainBranch(cwd);
  if (!main || current === main) return null;
  return { current, main };
}

// A4:近 7 天的中断现场文件
function collectUnfinished(cwd, nowMs) {
  const found = [];
  for (const rel of UNFINISHED_MARKERS) {
    try {
      const stat = fs.statSync(path.join(cwd, rel));
      const ageDays = (nowMs - stat.mtimeMs) / (24 * 3600 * 1000);
      if (ageDays <= UNFINISHED_MAX_AGE_DAYS) {
        found.push({ file: rel.replace(/\\/g, '/'), ageDays: Math.max(0, Math.round(ageDays)) });
      }
    } catch { /* 文件不存在 → 跳过 */ }
  }
  return found;
}

function localDateString(nowMs) {
  const d = new Date(nowMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// A5:日总结目录存在(用户有此流程)但今日文件缺失
function collectDailySummary(userDir, nowMs) {
  const dir = path.join(userDir, 'daily-summaries');
  try {
    if (!fs.statSync(dir).isDirectory()) return null;
  } catch {
    return null; // 用户没有此流程 → 静默
  }
  const todayFile = path.join(dir, `${localDateString(nowMs)}.md`);
  return { missing: !fs.existsSync(todayFile), dir };
}

// A6:stash 计数(挂起未完成的工作)。
// 不查 last-tool-error.json — OMC 运行时频繁刷新该文件,信号恒真无区分度。
function collectStashes(cwd) {
  const out = gitOut(cwd, ['stash', 'list', '--format=%gd']);
  const count = out ? out.split(/\r?\n/).filter(Boolean).length : 0;
  return count > 0 ? { count } : null;
}

function collectStatusSignals({ cwd = process.cwd(), userDir, now } = {}) {
  const nowMs = typeof now === 'number' ? now : Date.now();
  const home = userDir || path.join(os.homedir(), '.claude');
  const errors = [];
  const safe = (label, fn) => {
    try { return fn(); } catch (err) {
      errors.push(`${label}: ${err && err.message ? err.message : String(err)}`);
      return null;
    }
  };

  const dirty = safe('dirty', () => collectDirty(cwd));
  const unpushed = safe('unpushed', () => collectUnpushed(cwd));
  return {
    dirty,
    unpushed,
    wrongBranch: safe('wrongBranch', () => collectWrongBranch(cwd, dirty, unpushed)),
    unfinished: safe('unfinished', () => collectUnfinished(cwd, nowMs)) || [],
    dailySummary: safe('dailySummary', () => collectDailySummary(home, nowMs)),
    stashes: safe('stashes', () => collectStashes(cwd)),
    errors,
  };
}

function renderStatusReport(signals, { maxChars = DEFAULT_MAX_CHARS } = {}) {
  if (!signals) return '';
  const items = [];

  if (signals.dirty) {
    items.push(`工作区有 ${signals.dirty.count} 个未提交文件(${signals.dirty.samples.join('、')}${signals.dirty.count > signals.dirty.samples.length ? '…' : ''})— 上次的活没收尾?`);
  }
  if (signals.unpushed) {
    items.push(`本地领先远端 ${signals.unpushed.count} 个提交 — 可推送`);
  }
  if (signals.wrongBranch) {
    items.push(`活已干完但停在 ${signals.wrongBranch.current} 分支(主分支 ${signals.wrongBranch.main})— 可切回`);
  }
  for (const u of signals.unfinished) {
    items.push(`发现上次工作现场 ${u.file}(${u.ageDays} 天前)— 可恢复续做`);
  }
  if (signals.dailySummary && signals.dailySummary.missing) {
    items.push('今日工作总结尚未生成 — 可补(/daily-summary)');
  }
  if (signals.stashes) {
    items.push(`${signals.stashes.count} 个 stash 暂存(挂起的工作)— 可清点`);
  }

  if (items.length === 0) return '';

  const lines = [
    `🔍 状态巡逻(${items.length} 件值得注意):`,
    ...items.map((t, i) => `${i + 1}. ❓ ${t}`),
    '[PATROL] 处理分档:查/统计/报告类直接做;可逆操作(提交、切分支、同步缓存)做完报备;删除、推主干、发布、付费必须先问用户。',
  ];
  const text = lines.join('\n');
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

module.exports = {
  collectStatusSignals,
  renderStatusReport,
};
