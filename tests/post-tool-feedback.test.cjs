'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { extractToolInfo } = require('../scripts/post-tool-feedback.cjs');

test('extractToolInfo: Skill tool', () => {
  const r = extractToolInfo(JSON.stringify({
    tool_name: 'Skill',
    tool_input: { skill: 'orchestrate' },
  }));
  assert.deepEqual(r, { toolName: 'Skill', toolTarget: 'orchestrate' });
});

test('extractToolInfo: Agent tool with subagent_type', () => {
  const r = extractToolInfo(JSON.stringify({
    tool_name: 'Agent',
    tool_input: { subagent_type: 'reviewer' },
  }));
  assert.deepEqual(r, { toolName: 'Agent', toolTarget: 'reviewer' });
});

test('extractToolInfo: Task tool with agent_type fallback', () => {
  const r = extractToolInfo(JSON.stringify({
    tool_name: 'Task',
    tool_input: { agent_type: 'coder' },
  }));
  assert.deepEqual(r, { toolName: 'Task', toolTarget: 'coder' });
});

test('extractToolInfo: Bash slash command extracts first token', () => {
  const r = extractToolInfo(JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command: '/route-stats --format=json' },
  }));
  assert.deepEqual(r, { toolName: 'Bash', toolTarget: 'route-stats' });
});

test('extractToolInfo: Bash non-slash command yields empty target', () => {
  const r = extractToolInfo(JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command: 'ls -la' },
  }));
  assert.deepEqual(r, { toolName: 'Bash', toolTarget: '' });
});

test('extractToolInfo: legacy toolName/toolInput shape', () => {
  const r = extractToolInfo(JSON.stringify({
    toolName: 'Skill',
    toolInput: { skill: 'orchestrate' },
  }));
  assert.deepEqual(r, { toolName: 'Skill', toolTarget: 'orchestrate' });
});

test('extractToolInfo: nested tool.{name,input} shape', () => {
  const r = extractToolInfo(JSON.stringify({
    tool: { name: 'Agent', input: { subagent_type: 'tester' } },
  }));
  assert.deepEqual(r, { toolName: 'Agent', toolTarget: 'tester' });
});

test('extractToolInfo: malformed JSON returns empty', () => {
  const r = extractToolInfo('not-json{');
  assert.deepEqual(r, { toolName: '', toolTarget: '' });
});

test('extractToolInfo: empty input returns empty', () => {
  const r = extractToolInfo('');
  assert.deepEqual(r, { toolName: '', toolTarget: '' });
});

test('extractToolInfo: missing fields returns empty target', () => {
  const r = extractToolInfo(JSON.stringify({ tool_name: 'Skill' }));
  assert.equal(r.toolName, 'Skill');
  assert.equal(r.toolTarget, '');
});
