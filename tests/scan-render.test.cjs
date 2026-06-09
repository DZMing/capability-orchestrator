'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

const {
  buildRoutingHint,
  renderSnapshot,
  MAX_TOTAL_CHARS,
} = require('../scripts/lib/scan-render.cjs');

// 空快照（正确结构：{ sections, errors }）
const EMPTY_SNAP = { sections: [], errors: [] };

// ── buildRoutingHint 边界路径 ─────────────────────────────────────────────────

test('buildRoutingHint: CO_AWARENESS_HINT=off 返回空串', () => {
  const prev = process.env.CO_AWARENESS_HINT;
  process.env.CO_AWARENESS_HINT = 'off';
  try {
    assert.strictEqual(buildRoutingHint(), '');
  } finally {
    if (prev === undefined) delete process.env.CO_AWARENESS_HINT;
    else process.env.CO_AWARENESS_HINT = prev;
  }
});

test('buildRoutingHint: 无 CLAUDE_PLUGIN_DATA 且未显式开启，返回空串', () => {
  const prevHint = process.env.CO_AWARENESS_HINT;
  const prevData = process.env.CLAUDE_PLUGIN_DATA;
  const prevCodex = process.env.CODEX_PLUGIN_DATA;
  delete process.env.CO_AWARENESS_HINT;
  delete process.env.CLAUDE_PLUGIN_DATA;
  delete process.env.CODEX_PLUGIN_DATA;
  try {
    assert.strictEqual(buildRoutingHint(), '');
  } finally {
    if (prevHint !== undefined) process.env.CO_AWARENESS_HINT = prevHint;
    if (prevData !== undefined) process.env.CLAUDE_PLUGIN_DATA = prevData;
    if (prevCodex !== undefined) process.env.CODEX_PLUGIN_DATA = prevCodex;
  }
});

test('buildRoutingHint: CO_AWARENESS_HINT=on 但日志不足返回空串', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'co-sr-test-'));
  const prevHint = process.env.CO_AWARENESS_HINT;
  const prevData = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CO_AWARENESS_HINT = 'on';
  process.env.CLAUDE_PLUGIN_DATA = tmpDir;
  try {
    assert.strictEqual(buildRoutingHint(), '');
  } finally {
    process.env.CO_AWARENESS_HINT = prevHint !== undefined ? prevHint : '';
    if (prevHint === undefined) delete process.env.CO_AWARENESS_HINT;
    process.env.CLAUDE_PLUGIN_DATA = prevData !== undefined ? prevData : '';
    if (prevData === undefined) delete process.env.CLAUDE_PLUGIN_DATA;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── renderSnapshot 基础输出 ───────────────────────────────────────────────────

test('renderSnapshot: 空快照 awareness 模式返回 text 字符串', () => {
  const { text, errors } = renderSnapshot(EMPTY_SNAP, 'awareness');
  assert.ok(typeof text === 'string', 'text should be string');
  assert.ok(text.length > 0, 'text should not be empty');
  assert.ok(Array.isArray(errors), 'errors should be array');
});

test('renderSnapshot: 输出 text 不超过 MAX_TOTAL_CHARS 上限', () => {
  const { text } = renderSnapshot(EMPTY_SNAP, 'awareness');
  assert.ok(text.length <= MAX_TOTAL_CHARS, `output ${text.length} exceeds MAX_TOTAL_CHARS ${MAX_TOTAL_CHARS}`);
});

test('MAX_TOTAL_CHARS: 正整数', () => {
  assert.ok(typeof MAX_TOTAL_CHARS === 'number' && MAX_TOTAL_CHARS > 0);
});

// ── P1 预算放开：awareness 注入更多路由信号 ──────────────────────────────────

function bigSnapshot(n = 60) {
  const items = Array.from({ length: n }, (_, i) => ({
    name: `skill-${String(i).padStart(2, '0')}`,
    desc: `触发词与场景描述 trigger words for routing case ${i} `.repeat(3),
  }));
  return { sections: [{ label: '项目级 Skills', prefix: '/', items }], errors: [] };
}

test('renderSnapshot: awareness 默认预算 12000，60 个 skill 不再被 5000 截断', () => {
  const prev = process.env.CO_AWARENESS_MAX_CHARS;
  delete process.env.CO_AWARENESS_MAX_CHARS;
  try {
    const { text } = renderSnapshot(bigSnapshot(60), 'awareness');
    assert.equal(MAX_TOTAL_CHARS, 12000);
    assert.ok(text.length > 5000, `期望超过旧预算 5000，实际 ${text.length}`);
    assert.ok(text.length <= MAX_TOTAL_CHARS, `超出新预算：${text.length}`);
    assert.ok(!text.includes('（已截断）'), '默认预算下 60 skill 不应触发截断');
    // TOP_N 15→40：第 40 个 skill（index 39）必须可见
    assert.ok(text.includes('skill-39'), 'TOP_N 应放宽到 40');
    assert.ok(!text.includes('skill-41'), 'TOP_N=40 之外不展示');
  } finally {
    if (prev !== undefined) process.env.CO_AWARENESS_MAX_CHARS = prev;
  }
});

test('renderSnapshot: CO_AWARENESS_MAX_CHARS 运行时可调且被遵守', () => {
  const prev = process.env.CO_AWARENESS_MAX_CHARS;
  process.env.CO_AWARENESS_MAX_CHARS = '800';
  try {
    const { text } = renderSnapshot(bigSnapshot(60), 'awareness');
    assert.ok(text.length <= 800, `env 预算 800 未被遵守：${text.length}`);
  } finally {
    if (prev === undefined) delete process.env.CO_AWARENESS_MAX_CHARS;
    else process.env.CO_AWARENESS_MAX_CHARS = prev;
  }
});

test('renderAwareness: skill desc 展示放宽到 120 字符（触发词不再被 40 截掉）', () => {
  const longDesc = 'D'.repeat(110);
  const snap = {
    sections: [{ label: '项目级 Skills', prefix: '/', items: [{ name: 'long-desc-skill', desc: longDesc }] }],
    errors: [],
  };
  const { text } = renderSnapshot(snap, 'awareness');
  assert.ok(text.includes(longDesc), '110 字符 desc 应完整展示，不被旧上限 40 截断');
});
