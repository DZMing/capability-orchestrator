'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  collectWorkContext,
  readRecentRouteLogs,
  redactContextText,
} = require('../scripts/lib/work-context.cjs');

test('readRecentRouteLogs: skips corrupt lines and caps count', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-route-log-'));
  const logPath = path.join(tmp, 'route-log.jsonl');
  fs.writeFileSync(logPath, [
    JSON.stringify({ ts: '2026-04-29T00:00:00Z', action: 'route', targetName: 'one' }),
    '{bad-json',
    JSON.stringify({ ts: '2026-04-29T00:01:00Z', action: 'pass', reason: 'no-match' }),
    JSON.stringify({ ts: '2026-04-29T00:02:00Z', action: 'route', targetName: 'three' }),
  ].join('\n'));
  try {
    const items = readRecentRouteLogs(logPath, { limit: 2 });
    assert.deepEqual(items.map(item => item.targetName || item.reason), ['no-match', 'three']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('collectWorkContext: reads bounded project rules and git summary', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-context-'));
  fs.writeFileSync(path.join(tmp, 'AGENTS.md'), 'Never push directly to master.\nUse codex branches.\n');
  try {
    const context = collectWorkContext({ cwd: tmp, routeLogPath: path.join(tmp, 'missing.jsonl') });
    assert.equal(context.cwd, tmp);
    assert.ok(context.projectRules.some(rule => rule.includes('Never push directly')));
    assert.ok('gitSummary' in context);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('redactContextText: redacts tokens before context enters prompts', () => {
  const redacted = redactContextText('API_KEY=abc1234567890 and Authorization: Bearer tokenvalue');
  assert.ok(!redacted.includes('abc1234567890'));
  assert.ok(!redacted.includes('tokenvalue'));
});
