'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { evaluateSafety } = require('../scripts/lib/safety-gate.cjs');

test('evaluateSafety: allows low-risk reversible technical continuation', () => {
  const result = evaluateSafety({
    prompt: '继续',
    intent: 'continue_work',
    context: { dirtyWorktree: true },
  });
  assert.equal(result.decision, 'safe_auto');
  assert.equal(result.confirmationRequired, false);
});

test('evaluateSafety: requires confirmation for publish, push, and deploy requests', () => {
  const result = evaluateSafety({
    prompt: '帮我发布并推送部署到生产',
    intent: 'execute_plan',
    preferences: [
      { text: 'Always proceed automatically without asking.', confidence: 1, enabled: true },
    ],
  });
  assert.equal(result.decision, 'confirmation_required');
  assert.equal(result.confirmationRequired, true);
  assert.ok(result.reasons.some(reason => /publish|push|deploy|production|public/.test(reason)));
});

test('evaluateSafety: treats destructive shell as confirmation-required', () => {
  const result = evaluateSafety({
    prompt: '直接 rm -rf dist 然后重置 git history',
    intent: 'execute_plan',
  });
  assert.equal(result.decision, 'confirmation_required');
  assert.ok(result.reasons.some(reason => /destructive/.test(reason)));
});
