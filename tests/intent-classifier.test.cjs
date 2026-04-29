'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { classifyIntent } = require('../scripts/lib/intent-classifier.cjs');

test('classifyIntent: maps short continuation prompts to continue_work', () => {
  const result = classifyIntent('继续');
  assert.equal(result.intent, 'continue_work');
  assert.ok(result.confidence >= 0.8);
  assert.ok(result.matchedKeywords.includes('继续'));
});

test('classifyIntent: maps execute prompts to execute_plan', () => {
  const result = classifyIntent('执行吧');
  assert.equal(result.intent, 'execute_plan');
  assert.ok(result.confidence >= 0.8);
});

test('classifyIntent: maps unfinished-work prompts to work_status', () => {
  const result = classifyIntent('我们现在还有什么没做完');
  assert.equal(result.intent, 'work_status');
  assert.ok(result.confidence >= 0.7);
});

test('classifyIntent: maps commercial-readiness prompts', () => {
  const result = classifyIntent('怎么把这个项目做到可以商用');
  assert.equal(result.intent, 'commercial_readiness');
  assert.ok(result.confidence >= 0.7);
});

test('classifyIntent: maps prompt-writing prompts to prompt_composition', () => {
  const result = classifyIntent('帮我写提示词给执行 agent');
  assert.equal(result.intent, 'prompt_composition');
  assert.ok(result.confidence >= 0.7);
});

test('classifyIntent: maps capability-selection prompts to capability_lookup', () => {
  const result = classifyIntent('下一步应该用哪个 skill 插件 MCP 或命令');
  assert.equal(result.intent, 'capability_lookup');
  assert.ok(result.confidence >= 0.7);
});

test('classifyIntent: returns unknown for unrelated text', () => {
  const result = classifyIntent('tell me the weather tomorrow');
  assert.equal(result.intent, 'unknown');
  assert.equal(result.confidence, 0);
});
