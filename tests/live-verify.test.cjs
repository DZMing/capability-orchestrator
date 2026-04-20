'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  summarizeClaude,
  summarizeCodexRouteLog,
} = require('../scripts/live-verify.cjs');

test('summarizeClaude: only passes when the same UserPromptSubmit hook response contains AUTO-ROUTE and target skill', () => {
  const positive = [
    JSON.stringify({
      type: 'system',
      subtype: 'hook_started',
      hook_event: 'SessionStart',
    }),
    JSON.stringify({
      type: 'system',
      subtype: 'hook_response',
      hook_event: 'UserPromptSubmit',
      output: '[AUTO-ROUTE] 立即调用：/valid-skill',
      stdout: '[AUTO-ROUTE] 立即调用：/valid-skill',
    }),
  ].join('\n');

  const negative = [
    JSON.stringify({
      type: 'system',
      subtype: 'hook_response',
      hook_event: 'SessionStart',
      output: '## 环境能力感知\n- valid-skill: A valid test skill',
      stdout: '## 环境能力感知\n- valid-skill: A valid test skill',
    }),
    JSON.stringify({
      type: 'assistant_message',
      content: '[AUTO-ROUTE] route some other tool',
    }),
  ].join('\n');

  const positiveSummary = summarizeClaude(positive);
  assert.equal(positiveSummary.hookEvents, 2);
  assert.equal(positiveSummary.matchedRouteSeen, true);
  assert.match(positiveSummary.matchedRouteSample, /立即调用：\/valid-skill/);

  assert.equal(summarizeClaude(negative).matchedRouteSeen, false);
});

test('summarizeClaude: unrelated UserPromptSubmit route does not satisfy target-skill evidence', () => {
  const mixed = JSON.stringify({
    type: 'system',
    subtype: 'hook_response',
    hook_event: 'UserPromptSubmit',
    output: '[AUTO-ROUTE] 立即调用：/pua',
    stdout: '[AUTO-ROUTE] 立即调用：/pua',
  });

  const summary = summarizeClaude(mixed);
  assert.equal(summary.autoRouteSeen, true);
  assert.equal(summary.validSkillSeen, false);
  assert.equal(summary.matchedRouteSeen, false);
});

test('summarizeClaude: avoids duplicating matchedRouteSample when output and stdout are identical', () => {
  const stream = JSON.stringify({
    type: 'system',
    subtype: 'hook_response',
    hook_event: 'UserPromptSubmit',
    output: '[AUTO-ROUTE] 立即调用：/valid-skill',
    stdout: '[AUTO-ROUTE] 立即调用：/valid-skill',
  });

  assert.equal(summarizeClaude(stream).matchedRouteSample, '[AUTO-ROUTE] 立即调用：/valid-skill');
});

test('summarizeCodexRouteLog: requires a real route entry to the target skill', () => {
  const positive = [
    JSON.stringify({
      action: 'route',
      targetType: 'skill',
      targetName: 'valid-skill',
      reason: 'matched-skill',
    }),
  ].join('\n');

  const negative = [
    JSON.stringify({
      action: 'pass',
      targetType: null,
      targetName: null,
      reason: 'no-match',
    }),
    JSON.stringify({
      action: 'route',
      targetType: 'skill',
      targetName: 'other-skill',
      reason: 'matched-skill',
    }),
  ].join('\n');

  assert.equal(summarizeCodexRouteLog(positive).matchedRouteSeen, true);
  assert.equal(summarizeCodexRouteLog(negative).matchedRouteSeen, false);
});
