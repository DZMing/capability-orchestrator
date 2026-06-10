'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { checkCommand } = require('../scripts/pre-tool-guard.cjs');

// —— rm -rf 测试 ——

test('pre-tool-guard: rm -rf ~/Documents → permissionDecision ask', () => {
  const r = checkCommand('Bash', 'rm -rf ~/Documents');
  assert.ok(r !== null, '应当拦截');
  assert.equal(r.permissionDecision, 'ask');
  assert.ok(r.permissionDecisionReason.length > 0, '原因不应为空');
});

test('pre-tool-guard: rm -rf /tmp/foo → 放行（安全路径）', () => {
  const r = checkCommand('Bash', 'rm -rf /tmp/foo');
  assert.equal(r, null, '/tmp 路径应放行');
});

test('pre-tool-guard: rm -rf node_modules → 放行（安全路径）', () => {
  const r = checkCommand('Bash', 'rm -rf node_modules');
  assert.equal(r, null, 'node_modules 路径应放行');
});

// —— git push --force 测试 ——

test('pre-tool-guard: git push --force origin master → permissionDecision ask', () => {
  const r = checkCommand('Bash', 'git push --force origin master');
  assert.ok(r !== null, '应当拦截');
  assert.equal(r.permissionDecision, 'ask');
});

test('pre-tool-guard: git push origin feature → 放行（无 force）', () => {
  const r = checkCommand('Bash', 'git push origin feature');
  assert.equal(r, null, '普通 push 应放行');
});

// —— DROP TABLE 测试 ——

test('pre-tool-guard: DROP TABLE users → permissionDecision ask', () => {
  const r = checkCommand('Bash', 'DROP TABLE users');
  assert.ok(r !== null, '应当拦截');
  assert.equal(r.permissionDecision, 'ask');
});

// —— tool_name 非 Bash 测试 ——

test('pre-tool-guard: tool_name 非 Bash → 放行', () => {
  const r = checkCommand('Read', 'rm -rf ~/Documents');
  assert.equal(r, null, '非 Bash tool 应放行');
});

// —— 畸形输入测试 ——

test('pre-tool-guard: 空命令字符串 → 放行', () => {
  const r = checkCommand('Bash', '');
  assert.equal(r, null, '空命令应放行');
});
