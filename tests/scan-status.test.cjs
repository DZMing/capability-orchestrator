'use strict';

// scan-status.test.cjs — 状态巡逻模块单测
// 覆盖:6 个秒级信号的采集 + 渲染 + 故障开放边界

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { collectStatusSignals: collectRaw, renderStatusReport } = require('../scripts/lib/scan-status.cjs');

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// 测试隔离:默认注入干净 userDir,避免读取真实 ~/.claude 状态
function collectStatusSignals(opts = {}) {
  return collectRaw({ userDir: makeTmpDir('co-isolated-user-'), ...opts });
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function makeGitRepo() {
  const dir = makeTmpDir('co-status-');
  git(dir, ['init', '-q', '-b', 'master']);
  git(dir, ['config', 'user.email', 'test@test.local']);
  git(dir, ['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'init\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'init']);
  return dir;
}

// ─── A1 脏文件 ──────────────────────────────────────────────────────────────

test('干净 repo:dirty 为 null,unfinished 为空', () => {
  const dir = makeGitRepo();
  const s = collectStatusSignals({ cwd: dir });
  assert.strictEqual(s.dirty, null);
  assert.deepStrictEqual(s.unfinished, []);
});

test('脏文件被发现且统计正确,路径完整(porcelain 首行前导空格不被切歪)', () => {
  const dir = makeGitRepo();
  fs.writeFileSync(path.join(dir, 'work.js'), 'console.log(1)\n');
  fs.writeFileSync(path.join(dir, 'README.md'), 'changed\n');
  const s = collectStatusSignals({ cwd: dir });
  assert.ok(s.dirty);
  assert.strictEqual(s.dirty.count, 2);
  // ' M README.md' 是 porcelain 首行,trim 整段输出会把状态列切歪 → 路径变 'EADME.md'
  assert.deepStrictEqual([...s.dirty.samples].sort(), ['README.md', 'work.js']);
});

test('噪音路径(.omc/.claude/.planning)被过滤,不算脏', () => {
  const dir = makeGitRepo();
  fs.mkdirSync(path.join(dir, '.omc'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.omc', 'state.json'), '{}');
  fs.mkdirSync(path.join(dir, '.planning'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.planning', 'STATE.md'), 'x');
  const s = collectStatusSignals({ cwd: dir });
  assert.strictEqual(s.dirty, null);
});

// ─── A2 未推送 / A3 停错分支 ────────────────────────────────────────────────

test('无 upstream 时 unpushed 为 null,不报错', () => {
  const dir = makeGitRepo();
  const s = collectStatusSignals({ cwd: dir });
  assert.strictEqual(s.unpushed, null);
});

test('干净 + 停在非主分支 → wrongBranch 提示', () => {
  const dir = makeGitRepo();
  git(dir, ['checkout', '-q', '-b', 'codex/feature-x']);
  const s = collectStatusSignals({ cwd: dir });
  assert.ok(s.wrongBranch);
  assert.strictEqual(s.wrongBranch.current, 'codex/feature-x');
  assert.strictEqual(s.wrongBranch.main, 'master');
});

test('非主分支但有脏文件 → 不提示 wrongBranch(活没干完)', () => {
  const dir = makeGitRepo();
  git(dir, ['checkout', '-q', '-b', 'codex/feature-y']);
  fs.writeFileSync(path.join(dir, 'wip.js'), 'x');
  const s = collectStatusSignals({ cwd: dir });
  assert.strictEqual(s.wrongBranch, null);
});

test('本身在主分支 → 不提示 wrongBranch', () => {
  const dir = makeGitRepo();
  const s = collectStatusSignals({ cwd: dir });
  assert.strictEqual(s.wrongBranch, null);
});

// ─── A4 未完成任务现场 ──────────────────────────────────────────────────────

test('近期 STATE.md 被报告,带文件名', () => {
  const dir = makeGitRepo();
  fs.mkdirSync(path.join(dir, '.planning'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.planning', 'STATE.md'), '# 上次现场');
  const s = collectStatusSignals({ cwd: dir });
  assert.strictEqual(s.unfinished.length, 1);
  assert.match(s.unfinished[0].file, /STATE\.md/);
});

test('超过 7 天的现场文件不报(陈迹)', () => {
  const dir = makeGitRepo();
  fs.mkdirSync(path.join(dir, '.planning'), { recursive: true });
  const f = path.join(dir, '.planning', 'STATE.md');
  fs.writeFileSync(f, '# 老现场');
  const old = new Date(Date.now() - 8 * 24 * 3600 * 1000);
  fs.utimesSync(f, old, old);
  const s = collectStatusSignals({ cwd: dir });
  assert.deepStrictEqual(s.unfinished, []);
});

// ─── A5 日总结 ──────────────────────────────────────────────────────────────

test('daily-summaries 目录存在但缺今天文件 → missing', () => {
  const userDir = makeTmpDir('co-user-');
  fs.mkdirSync(path.join(userDir, 'daily-summaries'), { recursive: true });
  const s = collectStatusSignals({ cwd: makeGitRepo(), userDir });
  assert.ok(s.dailySummary);
  assert.strictEqual(s.dailySummary.missing, true);
});

test('今天文件已存在 → missing=false', () => {
  const userDir = makeTmpDir('co-user-');
  const dir = path.join(userDir, 'daily-summaries');
  fs.mkdirSync(dir, { recursive: true });
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  fs.writeFileSync(path.join(dir, `${today}.md`), '总结');
  const s = collectStatusSignals({ cwd: makeGitRepo(), userDir });
  assert.strictEqual(s.dailySummary.missing, false);
});

test('用户没有 daily-summaries 流程 → null 静默跳过', () => {
  const userDir = makeTmpDir('co-user-');
  const s = collectStatusSignals({ cwd: makeGitRepo(), userDir });
  assert.strictEqual(s.dailySummary, null);
});

// ─── A6 stash 残留 ──────────────────────────────────────────────────────────

test('stash 残留被计数', () => {
  const dir = makeGitRepo();
  fs.writeFileSync(path.join(dir, 'tmp.js'), 'x');
  git(dir, ['stash', 'push', '-u', '-q', '-m', 'wip']);
  const s = collectStatusSignals({ cwd: dir });
  assert.ok(s.stashes);
  assert.strictEqual(s.stashes.count, 1);
});

test('运行时心跳文件(mission-state.json)不算中断现场', () => {
  const dir = makeGitRepo();
  fs.mkdirSync(path.join(dir, '.omc', 'state'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.omc', 'state', 'mission-state.json'), '{}');
  const s = collectStatusSignals({ cwd: dir });
  assert.deepStrictEqual(s.unfinished, []);
});

// ─── 故障开放 ───────────────────────────────────────────────────────────────

test('非 git 目录:不抛异常,git 类信号全 null', () => {
  const dir = makeTmpDir('co-nogit-');
  const s = collectStatusSignals({ cwd: dir });
  assert.strictEqual(s.dirty, null);
  assert.strictEqual(s.unpushed, null);
  assert.strictEqual(s.wrongBranch, null);
});

test('不存在的 cwd:不抛异常', () => {
  const s = collectStatusSignals({ cwd: path.join(os.tmpdir(), 'co-definitely-missing-xyz') });
  assert.ok(s);
  assert.ok(Array.isArray(s.errors));
});

// ─── 渲染 ───────────────────────────────────────────────────────────────────

test('无信号 → 渲染空串(不刷存在感)', () => {
  const dir = makeGitRepo();
  const s = collectStatusSignals({ cwd: dir });
  assert.strictEqual(renderStatusReport(s), '');
});

test('有信号 → 含巡逻标题、❓ 项、执行分档指引', () => {
  const dir = makeGitRepo();
  fs.writeFileSync(path.join(dir, 'work.js'), 'x');
  const s = collectStatusSignals({ cwd: dir });
  const text = renderStatusReport(s);
  assert.match(text, /状态巡逻/);
  assert.match(text, /未提交/);
  assert.match(text, /\[PATROL\]/);
});

test('渲染受 maxChars 预算约束', () => {
  const dir = makeGitRepo();
  for (let i = 0; i < 30; i++) {
    fs.writeFileSync(path.join(dir, `file-with-a-rather-long-name-${i}.js`), 'x');
  }
  const s = collectStatusSignals({ cwd: dir });
  const text = renderStatusReport(s, { maxChars: 300 });
  assert.ok(text.length <= 300);
});
