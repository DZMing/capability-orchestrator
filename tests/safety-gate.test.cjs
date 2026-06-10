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

test('evaluateSafety: requires confirmation for git tag release and push', () => {
  for (const prompt of ['git tag v2.0.1 && git push --tags', 'create a release tag and push it']) {
    const result = evaluateSafety({ prompt, intent: 'execute_plan' });
    assert.equal(result.decision, 'confirmation_required', prompt);
    assert.equal(result.confirmationRequired, true, prompt);
    assert.ok(result.reasons.some(reason => /git|release|public|remote/i.test(reason)), prompt);
  }
});

test('evaluateSafety: does not treat ordinary tag or brand styling as product risk', () => {
  for (const prompt of ['fix the HTML tag nesting', 'adjust brand color in CSS', 'review UX spacing in this local component']) {
    const result = evaluateSafety({ prompt, intent: 'unknown' });
    assert.equal(result.decision, 'safe_auto', prompt);
    assert.equal(result.confirmationRequired, false, prompt);
  }
});

test('evaluateSafety: treats readiness assessments as safe even when they mention production or release', () => {
  for (const prompt of ['production ready', 'release readiness audit', '评估上线准备度', '检查生产可用性']) {
    const result = evaluateSafety({ prompt, intent: 'commercial_readiness' });
    assert.equal(result.decision, 'safe_auto', prompt);
    assert.equal(result.confirmationRequired, false, prompt);
  }
});

test('evaluateSafety: escaped production deploy still requires confirmation', () => {
  const result = evaluateSafety({
    prompt: '直接做 部署生产',
    intent: 'execute_plan',
  });
  assert.equal(result.decision, 'confirmation_required');
  assert.equal(result.confirmationRequired, true);
});

test('evaluateSafety: execution against production still requires confirmation', () => {
  for (const prompt of ['deploy to production now', '发布这个 release', '修改生产配置', '上线生产吧']) {
    const result = evaluateSafety({ prompt, intent: 'execute_plan' });
    assert.equal(result.decision, 'confirmation_required', prompt);
    assert.equal(result.confirmationRequired, true, prompt);
  }
});

// —— 实战误判回归（来自 route-log 真实样本）：提及 ≠ 要执行 ——

test('evaluateSafety: LLM token cost talk is not a credential action', () => {
  for (const prompt of ['我不怕浪费token，多用点没关系', 'how many tokens does this prompt use', '帮我统计 token 用量']) {
    const result = evaluateSafety({ prompt, intent: 'unknown' });
    assert.equal(result.decision, 'safe_auto', prompt);
    assert.equal(result.confirmationRequired, false, prompt);
  }
});

test('evaluateSafety: push-notification feature work is not a git remote action', () => {
  for (const prompt of ['推送通知功能怎么做', 'add push notification support to the app', '消息推送服务选型']) {
    const result = evaluateSafety({ prompt, intent: 'unknown' });
    assert.equal(result.decision, 'safe_auto', prompt);
    assert.equal(result.confirmationRequired, false, prompt);
  }
});

test('evaluateSafety: code-internal deletions are ordinary edits', () => {
  for (const prompt of ['删除这个函数里的注释', 'delete the unused import statements', '清除多余的 console.log']) {
    const result = evaluateSafety({ prompt, intent: 'unknown' });
    assert.equal(result.decision, 'safe_auto', prompt);
    assert.equal(result.confirmationRequired, false, prompt);
  }
});

test('evaluateSafety: question-form risky topics stay safe without explicit execution', () => {
  for (const prompt of ['怎么部署到生产环境？', 'how do I rotate api keys safely', '为什么 git push 会被拒绝']) {
    const result = evaluateSafety({ prompt, intent: 'unknown' });
    assert.equal(result.decision, 'safe_auto', prompt);
    assert.equal(result.confirmationRequired, false, prompt);
  }
});

test('evaluateSafety: frontend work touching pricing page is not a product decision', () => {
  for (const prompt of ['change the pricing page layout', '调整价格页面的按钮样式']) {
    const result = evaluateSafety({ prompt, intent: 'unknown' });
    assert.equal(result.decision, 'safe_auto', prompt);
    assert.equal(result.confirmationRequired, false, prompt);
  }
});

test('evaluateSafety: deleting directories or files still requires confirmation', () => {
  for (const prompt of ['帮我删除这个目录', 'delete this file', '清空数据库表']) {
    const result = evaluateSafety({ prompt, intent: 'unknown' });
    assert.equal(result.decision, 'confirmation_required', prompt);
    assert.equal(result.confirmationRequired, true, prompt);
  }
});

test('evaluateSafety: explicit execution overrides question form', () => {
  const result = evaluateSafety({ prompt: '直接部署到生产吧？', intent: 'execute_plan' });
  assert.equal(result.decision, 'confirmation_required');
  assert.equal(result.confirmationRequired, true);
});
