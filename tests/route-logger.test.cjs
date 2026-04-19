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
