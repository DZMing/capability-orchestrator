'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  claudeInstall,
  claudeUninstall,
  codexInstall,
  codexUninstall,
} = require('../scripts/install-hooks.cjs');

function withTempFile(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-hook-test-'));
  try {
    const file = path.join(dir, 'config.json');
    return run(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('claudeInstall preserves unrelated hooks and reports added/updated correctly', () => withTempFile((file) => {
  fs.writeFileSync(file, JSON.stringify({
    hooks: {
      SessionStart: [{
        hooks: [{ type: 'command', command: 'node /some/other/capability-orchestrator-helper.js', timeout: 5 }],
      }],
    },
  }, null, 2));

  const first = claudeInstall(file, 'CAPABILITY_ORCHESTRATOR_HOOK=session-start node scan', 'CAPABILITY_ORCHESTRATOR_HOOK=user-prompt-submit node route');
  assert.deepEqual(first, { sessionStatus: 'added', routeStatus: 'added' });

  const second = claudeInstall(file, 'CAPABILITY_ORCHESTRATOR_HOOK=session-start node scan2', 'CAPABILITY_ORCHESTRATOR_HOOK=user-prompt-submit node route2');
  assert.deepEqual(second, { sessionStatus: 'updated', routeStatus: 'updated' });

  const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(settings.hooks.SessionStart.length, 2);
  assert.ok(settings.hooks.SessionStart.some((entry) => entry.hooks.some((hook) => hook.command.includes('capability-orchestrator-helper.js'))));
  assert.ok(settings.hooks.UserPromptSubmit.some((entry) => entry.hooks.some((hook) => hook.command.includes('node route2'))));
}));

test('claudeUninstall removes owned hooks but keeps unrelated helper wrapper', () => withTempFile((file) => {
  fs.writeFileSync(file, JSON.stringify({
    hooks: {
      SessionStart: [
        { hooks: [{ type: 'command', command: 'CAPABILITY_ORCHESTRATOR_HOOK=session-start node scan', timeout: 10 }] },
        { hooks: [{ type: 'command', command: 'node /some/other/capability-orchestrator-helper.js', timeout: 5 }] },
      ],
      UserPromptSubmit: [
        { hooks: [{ type: 'command', command: 'cmd.exe /d /s /c ""C:\\Users\\me\\.claude\\plugins\\cache\\capability-orchestrator\\scripts\\route-matcher.cmd""', timeout: 5 }] },
      ],
    },
  }, null, 2));

  claudeUninstall(file);
  const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(settings.hooks.SessionStart.length, 1);
  assert.ok(settings.hooks.SessionStart[0].hooks[0].command.includes('capability-orchestrator-helper.js'));
  assert.equal(settings.hooks.UserPromptSubmit, undefined);
}));

test('codexInstall and codexUninstall preserve non-owned entries', () => withTempFile((file) => {
  fs.writeFileSync(file, JSON.stringify({
    hooks: {
      SessionStart: [{ matcher: 'foo', hooks: [{ type: 'command', command: 'node other.js', statusMessage: 'other' }] }],
    },
  }, null, 2));

  codexInstall(file, 'CAPABILITY_ORCHESTRATOR_HOOK=session-start node scan', 'CAPABILITY_ORCHESTRATOR_HOOK=user-prompt-submit node route');
  let hooks = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(hooks.hooks.SessionStart.length, 2);
  assert.equal(hooks.hooks.SessionStart[0].matcher, 'foo');

  codexUninstall(file);
  hooks = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(hooks.hooks.SessionStart.length, 1);
  assert.equal(hooks.hooks.UserPromptSubmit, undefined);
}));
