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

test('resolveIntentRoute: unknown ordinary prompt does not read work context or profile', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-intent-router-lazy-'));
  const profilePath = path.join(tmp, 'preferences.json');
  fs.writeFileSync(path.join(tmp, 'AGENTS.md'), 'This line should not be read for unknown ordinary prompts.\n');
  fs.writeFileSync(profilePath, JSON.stringify({
    enabled: true,
    global: [{ id: 'sentinel', text: 'This preference should not be read.', confidence: 1 }],
  }));

  const originalOpenSync = fs.openSync;
  const originalReadFileSync = fs.readFileSync;
  const touched = [];
  fs.openSync = function patchedOpenSync(filePath, ...args) {
    if (String(filePath).startsWith(tmp)) touched.push(['open', path.basename(filePath)]);
    return originalOpenSync.call(this, filePath, ...args);
  };
  fs.readFileSync = function patchedReadFileSync(filePath, ...args) {
    if (String(filePath).startsWith(tmp)) touched.push(['read', path.basename(filePath)]);
    return originalReadFileSync.call(this, filePath, ...args);
  };

  try {
    const route = resolveIntentRoute({
      prompt: 'summarize the local folder names',
      cwd: tmp,
      profilePath,
      routeLogPath: path.join(tmp, 'route-log.jsonl'),
    });
    assert.equal(route, null);
    assert.deepEqual(touched, []);
  } finally {
    fs.openSync = originalOpenSync;
    fs.readFileSync = originalReadFileSync;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('resolveIntentRoute: short prompt reads context and preferences for five-block contract', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-intent-router-context-'));
  const profilePath = path.join(tmp, 'preferences.json');
  fs.writeFileSync(path.join(tmp, 'AGENTS.md'), 'Always verify before completion.\n');
  fs.writeFileSync(profilePath, JSON.stringify({
    enabled: true,
    global: [{ id: 'five-block', text: 'Prefer five-block Harness Prompt output.', confidence: 0.9 }],
  }));
  try {
    const route = resolveIntentRoute({
      prompt: '继续',
      cwd: tmp,
      profilePath,
      routeLogPath: path.join(tmp, 'missing-log.jsonl'),
    });
    assert.equal(route.intent, 'continue_work');
    assert.ok(route.output.includes('Always verify before completion.'));
    assert.ok(route.output.includes('advisory-preference: Prefer five-block Harness Prompt output.'));
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

test('resolveIntentRoute: high-risk unknown prompt returns risk_review without a classified intent', () => {
  const route = resolveIntentRoute({
    prompt: 'rotate the production credential token now',
    cwd: os.tmpdir(),
  });
  assert.equal(route.intent, 'risk_review');
  assert.equal(route.safety.decision, 'confirmation_required');
  assert.ok(route.output.includes('[CONFIRMATION REQUIRED]'));
});
