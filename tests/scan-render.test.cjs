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
