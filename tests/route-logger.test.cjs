'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  getLogDir,
  rotateIfNeeded,
  appendRouteLog,
  readLogs,
  aggregateStats,
  MAX_LOG_SIZE,
} = require('../scripts/lib/route-logger.cjs');

// ─── helpers ────────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'co-logger-test-'));
}

// ─── getLogDir ──────────────────────────────────────────────────────────────

test('getLogDir: uses CLAUDE_PLUGIN_DATA when set', () => {
  const orig = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = '/tmp/co-test-plugin-data';
  try {
    assert.equal(getLogDir(), '/tmp/co-test-plugin-data');
  } finally {
    if (orig) process.env.CLAUDE_PLUGIN_DATA = orig;
    else delete process.env.CLAUDE_PLUGIN_DATA;
  }
});

test('getLogDir: falls back to plugin cache when CLAUDE_PLUGIN_DATA unset', () => {
  const orig = process.env.CLAUDE_PLUGIN_DATA;
  delete process.env.CLAUDE_PLUGIN_DATA;
  try {
    const dir = getLogDir();
    assert.ok(dir.includes('capability-orchestrator'));
  } finally {
    if (orig) process.env.CLAUDE_PLUGIN_DATA = orig;
  }
});

test('getLogDir: uses CODEX_PLUGIN_DATA when set', () => {
  const origClaude = process.env.CLAUDE_PLUGIN_DATA;
  const origCodex = process.env.CODEX_PLUGIN_DATA;
  delete process.env.CLAUDE_PLUGIN_DATA;
  process.env.CODEX_PLUGIN_DATA = '/tmp/co-test-codex-data';
  try {
    assert.equal(getLogDir(), '/tmp/co-test-codex-data');
  } finally {
    if (origClaude) process.env.CLAUDE_PLUGIN_DATA = origClaude;
    else delete process.env.CLAUDE_PLUGIN_DATA;
    if (origCodex) process.env.CODEX_PLUGIN_DATA = origCodex;
    else delete process.env.CODEX_PLUGIN_DATA;
  }
});

test('getLogDir: CLAUDE_PLUGIN_DATA takes priority over CODEX_PLUGIN_DATA', () => {
  const origClaude = process.env.CLAUDE_PLUGIN_DATA;
  const origCodex = process.env.CODEX_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = '/tmp/co-claude-priority';
  process.env.CODEX_PLUGIN_DATA = '/tmp/co-codex-secondary';
  try {
    assert.equal(getLogDir(), '/tmp/co-claude-priority');
  } finally {
    if (origClaude) process.env.CLAUDE_PLUGIN_DATA = origClaude;
    else delete process.env.CLAUDE_PLUGIN_DATA;
    if (origCodex) process.env.CODEX_PLUGIN_DATA = origCodex;
    else delete process.env.CODEX_PLUGIN_DATA;
  }
});

// ─── appendRouteLog + readLogs ───────────────────────────────────────────────

test('appendRouteLog: writes JSONL entry and readLogs reads it back', () => {
  const tmp = makeTempDir();
  process.env.CLAUDE_PLUGIN_DATA = tmp;
  try {
    appendRouteLog({ action: 'route', targetType: 'skill', targetName: 'commit', reason: 'matched', confidence: 0.9 });
    const entries = readLogs();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].action, 'route');
    assert.equal(entries[0].targetName, 'commit');
    assert.ok(entries[0].ts);
  } finally {
    delete process.env.CLAUDE_PLUGIN_DATA;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('appendRouteLog: appends multiple entries in order', () => {
  const tmp = makeTempDir();
  process.env.CLAUDE_PLUGIN_DATA = tmp;
  try {
    appendRouteLog({ action: 'route', reason: 'a', confidence: 0.8 });
    appendRouteLog({ action: 'pass', reason: 'b', confidence: 0 });
    appendRouteLog({ action: 'route', reason: 'c', confidence: 0.5 });
    const entries = readLogs();
    assert.equal(entries.length, 3);
    // sorted by ts
    assert.equal(entries[0].reason, 'a');
    assert.equal(entries[1].reason, 'b');
    assert.equal(entries[2].reason, 'c');
  } finally {
    delete process.env.CLAUDE_PLUGIN_DATA;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('appendRouteLog: failure does not throw', () => {
  const orig = process.env.CLAUDE_PLUGIN_DATA;
  // point to a path that can't be created (root-owned)
  process.env.CLAUDE_PLUGIN_DATA = '/proc/nonexistent/path';
  try {
    // should not throw
    appendRouteLog({ action: 'route', reason: 'test', confidence: 0.5 });
  } finally {
    if (orig) process.env.CLAUDE_PLUGIN_DATA = orig;
    else delete process.env.CLAUDE_PLUGIN_DATA;
  }
});

// ─── rotateIfNeeded ─────────────────────────────────────────────────────────

test('rotateIfNeeded: rotates when file exceeds MAX_LOG_SIZE', () => {
  const tmp = makeTempDir();
  const logPath = path.join(tmp, 'test-log.jsonl');
  // write a file larger than MAX_LOG_SIZE
  const bigLine = JSON.stringify({ ts: '2026-01-01', action: 'route', reason: 'x' }) + '\n';
  const repeats = Math.ceil(MAX_LOG_SIZE / bigLine.length) + 1;
  fs.writeFileSync(logPath, bigLine.repeat(repeats));
  const sizeBefore = fs.statSync(logPath).size;
  assert.ok(sizeBefore >= MAX_LOG_SIZE);

  rotateIfNeeded(logPath);

  // original should have moved to .0
  assert.ok(fs.existsSync(logPath + '.0'));
  // original file no longer has old content (it was renamed)
  assert.ok(!fs.existsSync(logPath) || fs.statSync(logPath).size === 0);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('rotateIfNeeded: no rotation when file is small', () => {
  const tmp = makeTempDir();
  const logPath = path.join(tmp, 'test-log.jsonl');
  fs.writeFileSync(logPath, '{"ts":"2026-01-01"}\n');

  rotateIfNeeded(logPath);

  // .0 should NOT exist
  assert.ok(!fs.existsSync(logPath + '.0'));
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ─── aggregateStats ─────────────────────────────────────────────────────────

test('aggregateStats: empty entries returns zeros', () => {
  const stats = aggregateStats([]);
  assert.equal(stats.total, 0);
  assert.equal(stats.routed, 0);
  assert.equal(stats.passed, 0);
  assert.equal(stats.avgConfidence, '0');
});

test('aggregateStats: counts routed vs passed correctly', () => {
  const entries = [
    { action: 'route', reason: 'matched', targetType: 'skill', targetName: 'commit', confidence: 0.9, ts: new Date().toISOString() },
    { action: 'pass', reason: 'no-match', confidence: 0, ts: new Date().toISOString() },
    { action: 'route', reason: 'matched', targetType: 'mcp', targetName: 'context7', confidence: 0.7, ts: new Date().toISOString() },
  ];
  const stats = aggregateStats(entries);
  assert.equal(stats.total, 3);
  assert.equal(stats.routed, 2);
  assert.equal(stats.passed, 1);
});

test('aggregateStats: computes average confidence', () => {
  const entries = [
    { action: 'route', reason: 'a', confidence: 0.8, ts: new Date().toISOString() },
    { action: 'route', reason: 'b', confidence: 0.6, ts: new Date().toISOString() },
  ];
  const stats = aggregateStats(entries);
  assert.equal(stats.avgConfidence, '0.70');
});

test('aggregateStats: aggregates byTargetType and topTargets', () => {
  const entries = [
    { action: 'route', reason: 'a', targetType: 'skill', targetName: 'commit', confidence: 0.9, ts: new Date().toISOString() },
    { action: 'route', reason: 'b', targetType: 'skill', targetName: 'commit', confidence: 0.8, ts: new Date().toISOString() },
    { action: 'route', reason: 'c', targetType: 'mcp', targetName: 'context7', confidence: 0.7, ts: new Date().toISOString() },
  ];
  const stats = aggregateStats(entries);
  assert.equal(stats.byTargetType.skill, 2);
  assert.equal(stats.byTargetType.mcp, 1);
  assert.equal(stats.topTargets.commit, 2);
  assert.equal(stats.topTargets.context7, 1);
});

test('aggregateStats: last24h only counts recent entries', () => {
  const now = Date.now();
  const entries = [
    { action: 'route', reason: 'a', confidence: 0.5, ts: new Date(now - 1000).toISOString() },        // 1s ago — within 24h
    { action: 'pass', reason: 'b', confidence: 0, ts: new Date(now - 50000 * 1000).toISOString() },    // ~14h ago — within 24h
    { action: 'pass', reason: 'c', confidence: 0, ts: new Date(now - 200000 * 1000).toISOString() },   // ~56h ago — outside 24h
  ];
  const stats = aggregateStats(entries);
  assert.equal(stats.last24h, 2);
});

// ─── 完整轮转链 ─────────────────────────────────────────────────────────────

test('rotateIfNeeded: full rotation chain .0 → .1 → .2 → delete', () => {
  const tmp = makeTempDir();
  const logPath = path.join(tmp, 'test-log.jsonl');
  const bigLine = JSON.stringify({ ts: '2026-01-01', action: 'route', reason: 'x' }) + '\n';
  const repeats = Math.ceil(MAX_LOG_SIZE / bigLine.length) + 1;
  const bigContent = bigLine.repeat(repeats);

  // 第 1 次轮转：main → .0
  fs.writeFileSync(logPath, bigContent);
  rotateIfNeeded(logPath);
  assert.ok(fs.existsSync(logPath + '.0'), '.0 should exist after 1st rotation');

  // 第 2 次轮转：.0 → .1, main → .0
  fs.writeFileSync(logPath, bigContent);
  rotateIfNeeded(logPath);
  assert.ok(fs.existsSync(logPath + '.1'), '.1 should exist after 2nd rotation');
  assert.ok(fs.existsSync(logPath + '.0'), '.0 should still exist');

  // 第 3 次轮转：.1 → .2, .0 → .1, main → .0
  fs.writeFileSync(logPath, bigContent);
  rotateIfNeeded(logPath);
  assert.ok(fs.existsSync(logPath + '.2'), '.2 should exist after 3rd rotation');
  assert.ok(fs.existsSync(logPath + '.1'), '.1 should still exist');

  // 第 4 次轮转：.2 应被删除，.1 → .2, .0 → .1, main → .0
  fs.writeFileSync(logPath, bigContent);
  rotateIfNeeded(logPath);
  assert.ok(!fs.existsSync(logPath + '.3'), '.3 should never exist');
  assert.ok(fs.existsSync(logPath + '.2'), '.2 should exist');

  fs.rmSync(tmp, { recursive: true, force: true });
});

// ─── 损坏 JSONL 行被跳过 ────────────────────────────────────────────────────

test('readLogs: skips corrupted JSONL lines', () => {
  const tmp = makeTempDir();
  process.env.CLAUDE_PLUGIN_DATA = tmp;
  try {
    const logPath = path.join(tmp, 'route-log.jsonl');
    // 写入混合内容：损坏行 + 合法行
    const lines = [
      '{"ts":"2026-01-01T00:00:00Z","action":"route","reason":"valid1"}\n',
      'CORRUPTED LINE\n',
      '{"ts":"2026-01-01T00:01:00Z","action":"pass","reason":"valid2"}\n',
      '{broken json\n',
      '{"ts":"2026-01-01T00:02:00Z","action":"route","reason":"valid3"}\n',
    ];
    fs.writeFileSync(logPath, lines.join(''));

    const entries = readLogs();
    assert.equal(entries.length, 3);
    assert.equal(entries[0].reason, 'valid1');
    assert.equal(entries[1].reason, 'valid2');
    assert.equal(entries[2].reason, 'valid3');
  } finally {
    delete process.env.CLAUDE_PLUGIN_DATA;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ─── 冷启动：目录不存在 ──────────────────────────────────────────────────────

test('appendRouteLog: cold start — creates directory and file from scratch', () => {
  const tmp = path.join(os.tmpdir(), 'co-logger-coldstart-' + process.pid);
  // 确保目录不存在
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.ok(!fs.existsSync(tmp), 'temp dir should not exist');

  process.env.CLAUDE_PLUGIN_DATA = tmp;
  try {
    appendRouteLog({ action: 'route', reason: 'cold', confidence: 0.5 });
    assert.ok(fs.existsSync(path.join(tmp, 'route-log.jsonl')), 'log file should be created');
    const entries = readLogs();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].reason, 'cold');
  } finally {
    delete process.env.CLAUDE_PLUGIN_DATA;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ─── readLogs 读多个轮转文件 ────────────────────────────────────────────────

test('readLogs: reads main + rotated files and sorts by time', () => {
  const tmp = makeTempDir();
  process.env.CLAUDE_PLUGIN_DATA = tmp;
  try {
    const logPath = path.join(tmp, 'route-log.jsonl');
    // .1 文件（最老）
    fs.writeFileSync(logPath + '.1', '{"ts":"2026-01-01T00:00:00Z","action":"route","reason":"oldest"}\n');
    // .0 文件（中间）
    fs.writeFileSync(logPath + '.0', '{"ts":"2026-01-01T01:00:00Z","action":"pass","reason":"middle"}\n');
    // 主文件（最新）
    fs.writeFileSync(logPath, '{"ts":"2026-01-01T02:00:00Z","action":"route","reason":"newest"}\n');

    const entries = readLogs();
    assert.equal(entries.length, 3);
    assert.equal(entries[0].reason, 'oldest');
    assert.equal(entries[1].reason, 'middle');
    assert.equal(entries[2].reason, 'newest');
  } finally {
    delete process.env.CLAUDE_PLUGIN_DATA;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ─── 性能基准 ────────────────────────────────────────────────────────────────

test('performance: 100 sequential writes complete in < 100ms', () => {
  const tmp = makeTempDir();
  process.env.CLAUDE_PLUGIN_DATA = tmp;
  try {
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      appendRouteLog({ action: 'route', reason: 'perf', confidence: 0.5 });
    }
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 100, `100 writes took ${elapsed.toFixed(1)}ms, expected < 100ms`);
  } finally {
    delete process.env.CLAUDE_PLUGIN_DATA;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('performance: rotation does not cause excessive latency (< 50ms)', () => {
  const tmp = makeTempDir();
  process.env.CLAUDE_PLUGIN_DATA = tmp;
  try {
    const logPath = path.join(tmp, 'route-log.jsonl');
    // 预填充一个大文件触发轮转
    const bigLine = JSON.stringify({ ts: '2026-01-01', action: 'route', reason: 'x' }) + '\n';
    const repeats = Math.ceil(MAX_LOG_SIZE / bigLine.length) + 1;
    fs.writeFileSync(logPath, bigLine.repeat(repeats));

    const start = performance.now();
    appendRouteLog({ action: 'route', reason: 'rotated', confidence: 0.5 });
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 50, `rotation write took ${elapsed.toFixed(1)}ms, expected < 50ms`);
  } finally {
    delete process.env.CLAUDE_PLUGIN_DATA;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ─── 安全：日志不含原始 prompt ───────────────────────────────────────────────

test('security: logged entry does not contain raw user prompt', () => {
  const tmp = makeTempDir();
  process.env.CLAUDE_PLUGIN_DATA = tmp;
  try {
    appendRouteLog({
      action: 'route',
      reason: 'matched-skill',
      targetType: 'skill',
      targetName: 'commit',
      confidence: 0.9,
      matchedKeywords: ['提交', 'commit'],
      cwd: '/home/user/project',
    });
    const logPath = path.join(tmp, 'route-log.jsonl');
    const content = fs.readFileSync(logPath, 'utf8');
    const entry = JSON.parse(content.trim());

    // 只允许的元数据字段
    const allowedFields = new Set([
      'ts', 'action', 'reason', 'targetType', 'targetName',
      'confidence', 'matchedKeywords', 'cwd', 'userDirSource',
    ]);
    for (const key of Object.keys(entry)) {
      assert.ok(allowedFields.has(key), `unexpected field: ${key}`);
    }
    // 不含原始 prompt 字段
    assert.equal(entry.prompt, undefined, 'raw prompt should NOT be logged');
    assert.equal(entry.message, undefined, 'raw message should NOT be logged');
  } finally {
    delete process.env.CLAUDE_PLUGIN_DATA;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
