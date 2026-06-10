'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const WORKTREE = path.join(__dirname, '..');
const TUNE_SCRIPT = path.join(WORKTREE, 'scripts', 'route-tune.cjs');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'co-tune-test-'));
}

function runTune(env = {}, args = []) {
  return execFileSync(process.execPath, [TUNE_SCRIPT, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

// ─── 空日志出空报告不崩 ───────────────────────────────────────────────────────

test('空日志：出空报告骨架，不崩溃', () => {
  const tmp = makeTempDir();
  try {
    const output = runTune({ CLAUDE_PLUGIN_DATA: tmp });
    assert.ok(output.includes('# route-tune 报告'), '应含报告标题');
    assert.ok(output.includes('## 总览'), '应含总览分区');
    assert.ok(output.includes('## Top-20 未路由关键词'), '应含关键词分区');
    assert.ok(output.includes('## 热门目标 Top-10'), '应含热门目标分区');
    assert.ok(output.includes('## 疑似误推'), '应含疑似误推分区');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ─── 正常日志各分区字段齐全 ───────────────────────────────────────────────────

test('正常日志：各分区字段齐全', () => {
  const tmp = makeTempDir();
  try {
    const logPath = path.join(tmp, 'route-log.jsonl');
    const now = new Date().toISOString();
    const entries = [
      { ts: now, action: 'route', reason: 'matched', targetType: 'skill', targetName: 'commit', confidence: 0.9 },
      { ts: now, action: 'route', reason: 'matched', targetType: 'skill', targetName: 'commit', confidence: 0.85 },
      { ts: now, action: 'pass', reason: 'no-match', confidence: 0 },
      { ts: now, action: 'route', reason: 'matched', targetType: 'mcp', targetName: 'context7', confidence: 0.7 },
    ];
    fs.writeFileSync(logPath, entries.map(e => JSON.stringify(e)).join('\n') + '\n');

    const output = runTune({ CLAUDE_PLUGIN_DATA: tmp });
    assert.ok(output.includes('## 总览'), '应含总览分区');
    assert.ok(output.includes('总路由数'), '总览应含路由数');
    assert.ok(output.includes('## 热门目标 Top-10'), '应含热门目标分区');
    assert.ok(output.includes('commit'), '热门目标应含 commit');
    assert.ok(output.includes('## Top-20 未路由关键词'), '应含关键词分区');
    assert.ok(output.includes('## 疑似误推'), '应含疑似误推分区');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ─── 损坏 JSONL 行跳过不崩 ───────────────────────────────────────────────────

test('损坏 JSONL 行跳过，报告正常生成不崩', () => {
  const tmp = makeTempDir();
  try {
    const logPath = path.join(tmp, 'route-log.jsonl');
    const now = new Date().toISOString();
    const content = [
      JSON.stringify({ ts: now, action: 'route', reason: 'matched', targetType: 'skill', targetName: 'commit', confidence: 0.9 }),
      'CORRUPTED LINE NOT JSON',
      JSON.stringify({ ts: now, action: 'pass', reason: 'no-match', confidence: 0 }),
      '{broken json incomplete',
      JSON.stringify({ ts: now, action: 'route', reason: 'matched', targetType: 'skill', targetName: 'review', confidence: 0.75 }),
    ].join('\n') + '\n';
    fs.writeFileSync(logPath, content);

    // Should not throw
    const output = runTune({ CLAUDE_PLUGIN_DATA: tmp });
    assert.ok(output.includes('# route-tune 报告'), '报告应正常生成');
    assert.ok(output.includes('commit'), '合法条目应被处理');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ─── --label 写入格式正确 ─────────────────────────────────────────────────────

test('--label: 写入 labeled-cases.jsonl，格式正确', () => {
  const tmp = makeTempDir();
  try {
    runTune({ CLAUDE_PLUGIN_DATA: tmp }, ['--label', '帮我提交代码|commit']);
    const labeledPath = path.join(tmp, 'labeled-cases.jsonl');
    assert.ok(fs.existsSync(labeledPath), 'labeled-cases.jsonl 应存在');

    const content = fs.readFileSync(labeledPath, 'utf8').trim();
    assert.ok(content.length > 0, '文件不应为空');

    // 每行应为 valid JSON
    for (const line of content.split('\n').filter(Boolean)) {
      let parsed;
      assert.doesNotThrow(() => { parsed = JSON.parse(line); }, 'labeled 行应为 valid JSON');
      assert.ok(parsed.ts, '应含 ts 字段');
      assert.equal(parsed.prompt, '帮我提交代码', 'prompt 字段应正确');
      assert.equal(parsed.expected, 'commit', 'expected 字段应正确');
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ─── --label 多次追加 ─────────────────────────────────────────────────────────

test('--label: 多次追加，每条都写入', () => {
  const tmp = makeTempDir();
  try {
    runTune({ CLAUDE_PLUGIN_DATA: tmp }, ['--label', 'prompt1|skill-a']);
    runTune({ CLAUDE_PLUGIN_DATA: tmp }, ['--label', 'prompt2|none']);
    const labeledPath = path.join(tmp, 'labeled-cases.jsonl');
    const lines = fs.readFileSync(labeledPath, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 2, '应有 2 条标注记录');
    const first = JSON.parse(lines[0]);
    const second = JSON.parse(lines[1]);
    assert.equal(first.prompt, 'prompt1');
    assert.equal(second.prompt, 'prompt2');
    assert.equal(second.expected, 'none');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
