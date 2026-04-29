'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { composeExecutionContract } = require('../scripts/lib/prompt-composer.cjs');

test('composeExecutionContract: always emits the five harness blocks', () => {
  const text = composeExecutionContract({
    prompt: '继续',
    intent: 'continue_work',
    safety: { decision: 'safe_auto', confirmationRequired: false, reasons: [] },
    context: {
      cwd: '/tmp/example',
      gitSummary: 'M README.md',
      recentRoutes: [{ reason: 'matched-skill', targetName: 'review' }],
      projectRules: ['Never push directly to master.'],
    },
    preferences: [{ text: 'Proceed on safe reversible technical work.', confidence: 0.9 }],
  });

  for (const heading of ['## What', '## Guardrails', '## Success', '## Budget', '## Verify']) {
    assert.ok(text.includes(heading), `missing ${heading}`);
  }
  assert.ok(text.includes('Never push directly to master.'));
  assert.ok(text.includes('Proceed on safe reversible technical work.'));
  assert.ok(text.includes('advisory-history: recent route: matched-skill -> review'));
  assert.ok(text.includes('advisory-preference: Proceed on safe reversible technical work.'));
  assert.ok(!text.includes('- preference: Proceed on safe reversible technical work.'));
});

test('composeExecutionContract: confirmation gate explains risky action', () => {
  const text = composeExecutionContract({
    prompt: '帮我发布并推送',
    intent: 'execute_plan',
    safety: {
      decision: 'confirmation_required',
      confirmationRequired: true,
      reasons: ['public/external action: publish', 'git history or remote action: push'],
    },
    context: { cwd: '/tmp/example' },
    preferences: [],
  });

  assert.ok(text.includes('[CONFIRMATION REQUIRED]'));
  assert.ok(text.includes('public/external action: publish'));
  assert.ok(text.includes('等待明确确认'));
});
