'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveIntentRoute } = require('../scripts/lib/intent-router.cjs');

test('resolveIntentRoute: safe short prompt returns executable contract', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-intent-router-'));
  fs.writeFileSync(path.join(tmp, 'AGENTS.md'), 'Never push directly to master.\n');
  try {
    const route = resolveIntentRoute({
      prompt: '继续',
      cwd: tmp,
      profilePath: path.join(tmp, 'missing-profile.json'),
      routeLogPath: path.join(tmp, 'missing-log.jsonl'),
    });
    assert.equal(route.intent, 'continue_work');
    assert.equal(route.safety.decision, 'safe_auto');
    assert.equal(route.targetType, 'intent');
    assert.ok(route.output.includes('[AUTO-ROUTE]'));
    assert.ok(route.output.includes('## What'));
    assert.ok(route.output.includes('Never push directly to master.'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('resolveIntentRoute: risky publishing prompt returns confirmation gate', () => {
  const route = resolveIntentRoute({
    prompt: '帮我发布并推送到生产',
    cwd: os.tmpdir(),
  });
  assert.equal(route.safety.decision, 'confirmation_required');
  assert.ok(route.output.includes('[CONFIRMATION REQUIRED]'));
  assert.ok(route.output.includes('发布'));
});

test('resolveIntentRoute: unknown intent returns null for existing matcher fallback', () => {
  const route = resolveIntentRoute({
    prompt: 'I need a valid test skill for this important task',
    cwd: os.tmpdir(),
  });
  assert.equal(route, null);
});

test('resolveIntentRoute: unclassified destructive prompt still returns confirmation gate', () => {
  const route = resolveIntentRoute({
    prompt: '帮我删除这个目录',
    cwd: os.tmpdir(),
  });
  assert.equal(route.intent, 'risk_review');
  assert.equal(route.safety.decision, 'confirmation_required');
  assert.ok(route.output.includes('[CONFIRMATION REQUIRED]'));
});
