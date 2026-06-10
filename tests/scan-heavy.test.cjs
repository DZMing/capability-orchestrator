'use strict';

// scan-heavy.test.cjs — B 类重型信号后台巡逻单测
// 覆盖:信任清单门禁 + 4 个重型信号采集 + 结果文件读写 + lock 并发 + 渲染 + 故障开放

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
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
} = require('../scripts/lib/scan-heavy.cjs');

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function makeGitRepo() {
  const dir = makeTmpDir('co-heavy-');
  git(dir, ['init', '-q', '-b', 'master']);
  git(dir, ['config', 'user.email', 'test@test.local']);
  git(dir, ['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'init\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'init']);
  return dir;
}

// fake runCommand:按命令前缀返回预设结果,记录调用
function makeFakeRunner(table) {
  const calls = [];
  const runner = (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    const key = [cmd, ...args].join(' ');
    for (const [prefix, result] of Object.entries(table)) {
      if (key.startsWith(prefix)) {
        if (result instanceof Error) throw result;
        return result; // {status, stdout}
      }
    }
    return { status: 0, stdout: '' };
  };
  runner.calls = calls;
  return runner;
}

// ─── 数据目录解析 ────────────────────────────────────────────────────────────

test('resolveDataDir:CLAUDE_PLUGIN_DATA 优先,无环境变量返回 null', () => {
  assert.strictEqual(resolveDataDir({ CLAUDE_PLUGIN_DATA: '/x' }), '/x');
  assert.strictEqual(resolveDataDir({ CODEX_PLUGIN_DATA: '/y' }), '/y');
  assert.strictEqual(resolveDataDir({}), null);
});

// ─── 信任清单 ────────────────────────────────────────────────────────────────

test('信任清单:无文件 → 不信任;含 cwd → 信任;坏 JSON → 不信任(故障开放)', () => {
  const dataDir = makeTmpDir('co-heavy-data-');
  const proj = makeTmpDir('co-heavy-proj-');

  assert.strictEqual(isTrusted(proj, loadTrust(dataDir)), false);

  fs.writeFileSync(path.join(dataDir, 'patrol-trust.json'), JSON.stringify({ projects: [proj] }));
  assert.strictEqual(isTrusted(proj, loadTrust(dataDir)), true);
  assert.strictEqual(isTrusted(makeTmpDir('co-other-'), loadTrust(dataDir)), false);

  fs.writeFileSync(path.join(dataDir, 'patrol-trust.json'), '{broken');
  assert.strictEqual(isTrusted(proj, loadTrust(dataDir)), false);
});

test('信任清单:symlink 路径归一化后仍匹配(macOS /tmp → /private/tmp)', () => {
  const dataDir = makeTmpDir('co-heavy-data-');
  const proj = makeTmpDir('co-heavy-proj-');
  const real = fs.realpathSync(proj);
  // 清单存 realpath,查询用原始路径(或反之)都应命中
  fs.writeFileSync(path.join(dataDir, 'patrol-trust.json'), JSON.stringify({ projects: [real] }));
  assert.strictEqual(isTrusted(proj, loadTrust(dataDir)), true);
});

// ─── 信号采集:信任门禁 ──────────────────────────────────────────────────────

test('不信任的项目:test/sync 不执行(reason=untrusted),todo 照常采集', async () => {
  const dir = makeGitRepo();
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'x', 'check:sync': 'y' } }));
  fs.writeFileSync(path.join(dir, 'a.js'), '// TODO one\n// FIXME two\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'add']);

  const runner = makeFakeRunner({});
  const r = await collectHeavySignals({ cwd: dir, trusted: false, runCommand: runner, env: {} });

  assert.strictEqual(r.signals.test.ran, false);
  assert.strictEqual(r.signals.test.reason, 'untrusted');
  assert.strictEqual(r.signals.sync.ran, false);
  assert.strictEqual(r.signals.todo.ran, true);
  assert.strictEqual(r.signals.todo.total, 2);
  // 不信任时绝不能碰 npm
  assert.strictEqual(runner.calls.filter(c => c.startsWith('npm')).length, 0);
});

test('信任 + 无对应 script:reason=no-script,不执行命令', async () => {
  const dir = makeGitRepo();
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: {} }));
  const runner = makeFakeRunner({});
  const r = await collectHeavySignals({ cwd: dir, trusted: true, runCommand: runner, env: {} });
  assert.strictEqual(r.signals.test.ran, false);
  assert.strictEqual(r.signals.test.reason, 'no-script');
  assert.strictEqual(r.signals.sync.ran, false);
  assert.strictEqual(runner.calls.filter(c => c.startsWith('npm')).length, 0);
});

// ─── B1 测试红绿 ─────────────────────────────────────────────────────────────

test('B1:npm test 失败 → ok=false 且保留输出尾部;通过 → ok=true', async () => {
  const dir = makeGitRepo();
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'x' } }));

  const fail = makeFakeRunner({ 'npm test': { status: 1, stdout: 'line1\nline2\n# fail 3\n' } });
  let r = await collectHeavySignals({ cwd: dir, trusted: true, runCommand: fail, env: {} });
  assert.strictEqual(r.signals.test.ran, true);
  assert.strictEqual(r.signals.test.ok, false);
  assert.ok(r.signals.test.tail.includes('# fail 3'));

  const pass = makeFakeRunner({ 'npm test': { status: 0, stdout: 'all good\n' } });
  r = await collectHeavySignals({ cwd: dir, trusted: true, runCommand: pass, env: {} });
  assert.strictEqual(r.signals.test.ok, true);
});

// ─── B3 缓存同步 ─────────────────────────────────────────────────────────────

test('B3:check:sync 退出非零 → ok=false', async () => {
  const dir = makeGitRepo();
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { 'check:sync': 'x' } }));
  const runner = makeFakeRunner({ 'npm run check:sync': { status: 1, stdout: 'hash mismatch\n' } });
  const r = await collectHeavySignals({ cwd: dir, trusted: true, runCommand: runner, env: {} });
  assert.strictEqual(r.signals.sync.ran, true);
  assert.strictEqual(r.signals.sync.ok, false);
});

// ─── B4 TODO 计数 ────────────────────────────────────────────────────────────

test('B4:统计 tracked 文件 TODO/FIXME 总数,prevTotal 透传', async () => {
  const dir = makeGitRepo();
  fs.writeFileSync(path.join(dir, 'a.js'), '// TODO a\n');
  fs.writeFileSync(path.join(dir, 'b.js'), '// FIXME b\n// TODO c\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'todos']);

  const r = await collectHeavySignals({
    cwd: dir, trusted: false, runCommand: makeFakeRunner({}), env: {},
    lastResult: { signals: { todo: { total: 1 } } },
  });
  assert.strictEqual(r.signals.todo.total, 3);
  assert.strictEqual(r.signals.todo.prevTotal, 1);
});

test('B4:非 git 目录不炸,todo 信号标记未采集', async () => {
  const dir = makeTmpDir('co-heavy-nogit-');
  const r = await collectHeavySignals({ cwd: dir, trusted: false, runCommand: makeFakeRunner({}), env: {} });
  assert.strictEqual(r.signals.todo.ran, false);
});

// ─── B2 audit 默认关 ─────────────────────────────────────────────────────────

test('B2:默认不跑 audit;信任 + CO_PATROL_AUDIT=1 才跑', async () => {
  const dir = makeGitRepo();
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'x' } }));
  const auditOut = JSON.stringify({ metadata: { vulnerabilities: { high: 2, critical: 1, moderate: 5 } } });

  let runner = makeFakeRunner({ 'npm test': { status: 0, stdout: '' }, 'npm audit': { status: 1, stdout: auditOut } });
  let r = await collectHeavySignals({ cwd: dir, trusted: true, runCommand: runner, env: {} });
  assert.strictEqual(r.signals.audit.ran, false);
  assert.strictEqual(runner.calls.filter(c => c.startsWith('npm audit')).length, 0);

  runner = makeFakeRunner({ 'npm test': { status: 0, stdout: '' }, 'npm audit': { status: 1, stdout: auditOut } });
  r = await collectHeavySignals({ cwd: dir, trusted: true, runCommand: runner, env: { CO_PATROL_AUDIT: '1' } });
  assert.strictEqual(r.signals.audit.ran, true);
  assert.strictEqual(r.signals.audit.high, 2);
  assert.strictEqual(r.signals.audit.critical, 1);
});

// ─── 故障开放 ────────────────────────────────────────────────────────────────

test('defaultRunCommand:子进程剔除插件环境变量(防 worker 把 PLUGIN_DATA 传染给被测项目)', () => {
  const saved = {
    CLAUDE_PLUGIN_DATA: process.env.CLAUDE_PLUGIN_DATA,
    CODEX_PLUGIN_DATA: process.env.CODEX_PLUGIN_DATA,
  };
  process.env.CLAUDE_PLUGIN_DATA = '/tmp/co-fake-claude-data';
  process.env.CODEX_PLUGIN_DATA = '/tmp/co-fake-codex-data';
  try {
    const r = defaultRunCommand(
      process.execPath,
      ['-e', 'console.log(process.env.CLAUDE_PLUGIN_DATA || process.env.CODEX_PLUGIN_DATA || "clean")'],
      { cwd: os.tmpdir(), timeout: 15000 },
    );
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout.trim(), 'clean', 'worker 子进程不应看到插件数据目录变量');
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('runCommand 抛异常:信号置 null,errors 记录,整体不炸', async () => {
  const dir = makeGitRepo();
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'x' } }));
  const runner = makeFakeRunner({ 'npm test': new Error('ETIMEDOUT') });
  const r = await collectHeavySignals({ cwd: dir, trusted: true, runCommand: runner, env: {} });
  assert.strictEqual(r.signals.test, null);
  assert.ok(r.errors.some(e => e.includes('ETIMEDOUT')));
});

// ─── 结果文件读写 ────────────────────────────────────────────────────────────

test('saveResult/loadLastResult:round-trip,不同 cwd 互不串台', () => {
  const dataDir = makeTmpDir('co-heavy-data-');
  const a = { version: 1, cwd: '/proj/a', at: 1000, signals: { todo: { total: 5 } } };
  const b = { version: 1, cwd: '/proj/b', at: 2000, signals: { todo: { total: 9 } } };
  saveResult(dataDir, a);
  saveResult(dataDir, b);
  assert.strictEqual(loadLastResult(dataDir, '/proj/a').signals.todo.total, 5);
  assert.strictEqual(loadLastResult(dataDir, '/proj/b').signals.todo.total, 9);
  assert.strictEqual(loadLastResult(dataDir, '/proj/c'), null);
});

test('loadLastResult:坏 JSON → null(故障开放)', () => {
  const dataDir = makeTmpDir('co-heavy-data-');
  const cwd = '/proj/x';
  saveResult(dataDir, { version: 1, cwd, at: 1, signals: {} });
  // 找到刚写的文件,写坏它
  const file = fs.readdirSync(dataDir).find(f => f.startsWith('patrol-heavy-'));
  fs.writeFileSync(path.join(dataDir, file), '{broken');
  assert.strictEqual(loadLastResult(dataDir, cwd), null);
});

// ─── lock 并发 ───────────────────────────────────────────────────────────────

test('lock:占用期间二次 acquire 失败;release 后可再 acquire;陈旧 lock 可抢', () => {
  const dataDir = makeTmpDir('co-heavy-data-');
  const cwd = '/proj/x';
  assert.strictEqual(acquireLock(dataDir, cwd), true);
  assert.strictEqual(acquireLock(dataDir, cwd), false);
  releaseLock(dataDir, cwd);
  assert.strictEqual(acquireLock(dataDir, cwd), true);

  // 把 lock 文件 mtime 改老(11 分钟前)→ 视为死 worker,可抢
  const lockFile = fs.readdirSync(dataDir).find(f => f.endsWith('.lock'));
  const old = new Date(Date.now() - 11 * 60 * 1000);
  fs.utimesSync(path.join(dataDir, lockFile), old, old);
  assert.strictEqual(acquireLock(dataDir, cwd), true);
});

// ─── 渲染 ────────────────────────────────────────────────────────────────────

const NOW = 1750000000000;

function freshResult(signals) {
  return { version: 1, cwd: '/p', at: NOW - 5 * 60 * 1000, trusted: true, signals, errors: [] };
}

test('渲染:全部健康 → 空串(不刷存在感)', () => {
  const r = freshResult({
    test: { ran: true, ok: true },
    sync: { ran: true, ok: true },
    todo: { ran: true, total: 3, prevTotal: 3 },
    audit: { ran: false },
  });
  assert.strictEqual(renderHeavyReport(r, { now: NOW }), '');
});

test('渲染:测试失败 + 缓存不同步 + TODO 新增 → 各占一条,含 [PATROL] 分档', () => {
  const r = freshResult({
    test: { ran: true, ok: false, tail: '# fail 2' },
    sync: { ran: true, ok: false },
    todo: { ran: true, total: 10, prevTotal: 7 },
    audit: { ran: true, high: 1, critical: 0 },
  });
  const text = renderHeavyReport(r, { now: NOW });
  assert.ok(text.includes('测试'));
  assert.ok(text.includes('# fail 2'));
  assert.ok(text.includes('缓存'));
  assert.ok(text.includes('3 个'), 'TODO 增量 = 10-7');
  assert.ok(text.includes('high'));
  assert.ok(text.includes('[PATROL]'));
});

test('渲染:TODO 无新增不报;结果超过 24h 不展示(过期体检报告)', () => {
  const onlyTodoFlat = freshResult({
    test: { ran: false, reason: 'untrusted' },
    sync: { ran: false, reason: 'untrusted' },
    todo: { ran: true, total: 5, prevTotal: 5 },
    audit: { ran: false },
  });
  assert.strictEqual(renderHeavyReport(onlyTodoFlat, { now: NOW }), '');

  const stale = freshResult({ test: { ran: true, ok: false, tail: 'x' } });
  stale.at = NOW - 25 * 60 * 60 * 1000;
  assert.strictEqual(renderHeavyReport(stale, { now: NOW }), '');
});

test('渲染:maxChars 截断', () => {
  const r = freshResult({ test: { ran: true, ok: false, tail: 'y'.repeat(500) } });
  const text = renderHeavyReport(r, { now: NOW, maxChars: 100 });
  assert.ok(text.length <= 100);
});

// ─── CLI 入口集成(真实子进程)────────────────────────────────────────────────

const ENTRY = path.join(__dirname, '..', 'scripts', 'scan-heavy.cjs');

function runEntry(args, { env = {}, input = '' } = {}) {
  return execFileSync(process.execPath, [ENTRY, ...args], {
    encoding: 'utf8',
    input,
    env: { ...process.env, CLAUDE_PLUGIN_DATA: undefined, CODEX_PLUGIN_DATA: undefined, ...env },
    timeout: 30000,
  });
}

test('入口:无数据目录环境变量 → 静默退出 0', () => {
  const out = runEntry([], { input: '{}' });
  assert.strictEqual(out.trim(), '');
});

test('入口:--worker 真实采集(不信任项目只跑 todo)并落盘结果', () => {
  const dir = makeGitRepo();
  fs.writeFileSync(path.join(dir, 'todo.js'), '// TODO real\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'todo']);
  const dataDir = makeTmpDir('co-heavy-data-');

  runEntry(['--worker', '--cwd', dir], { env: { CLAUDE_PLUGIN_DATA: dataDir } });

  const saved = loadLastResult(dataDir, dir);
  assert.ok(saved, 'worker 应落盘结果');
  assert.strictEqual(saved.trusted, false);
  assert.strictEqual(saved.signals.todo.total, 1);
  assert.strictEqual(saved.signals.test.ran, false);
});

test('入口:hook 模式读到新鲜异常结果 → stdout 输出报告', () => {
  const dir = makeGitRepo();
  const dataDir = makeTmpDir('co-heavy-data-');
  saveResult(dataDir, {
    version: 1, cwd: dir, at: Date.now() - 60 * 1000, trusted: true,
    signals: { test: { ran: true, ok: false, tail: '# fail 7' } }, errors: [],
  });

  const out = runEntry([], { env: { CLAUDE_PLUGIN_DATA: dataDir, CO_PATROL_HEAVY_SPAWN: 'off' }, input: JSON.stringify({ cwd: dir }) });
  assert.ok(out.includes('# fail 7'));
  assert.ok(out.includes('[PATROL]'));
});
