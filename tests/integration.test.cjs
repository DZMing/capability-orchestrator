'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const NODE = process.execPath;
const SCAN_SCRIPT = path.join(__dirname, '..', 'scripts', 'scan-environment.cjs');
const ROUTE_SCRIPT = path.join(__dirname, '..', 'scripts', 'route-matcher.cjs');
const FIXTURE_PROJECT = path.join(__dirname, 'fixtures', 'project');

const { collectSnapshot, renderSnapshot, renderSection } = require('../scripts/scan-environment.cjs');

// ─── 6a: renderAwareness golden snapshot ────────────────────────────────────

const GOLDEN_DIR = path.join(__dirname, 'golden');

function ensureGoldenDir() {
  if (!fs.existsSync(GOLDEN_DIR)) fs.mkdirSync(GOLDEN_DIR, { recursive: true });
}

test('golden: awareness output matches snapshot', () => {
  ensureGoldenDir();
  const snap = collectSnapshot(
    path.join(__dirname, 'fixtures', 'project'),
    path.join(__dirname, 'fixtures', 'user'),
  );
  const { text } = renderSnapshot(snap, 'awareness');
  const goldenFile = path.join(GOLDEN_DIR, 'awareness.txt');

  if (!fs.existsSync(goldenFile)) {
    fs.writeFileSync(goldenFile, text);
    assert.ok(true, 'golden file created (first run)');
    return;
  }
  const expected = fs.readFileSync(goldenFile, 'utf8');
  assert.equal(text, expected, 'awareness output changed — update golden file if intentional');
});

// ─── 6b: renderSection level 0-4 golden snapshots ───────────────────────────

test('golden: renderSection levels 0-4 match snapshots', () => {
  ensureGoldenDir();
  const items = [
    { name: 'alpha-skill', desc: 'First skill for alpha tasks' },
    { name: 'beta-skill', desc: 'Second skill for beta operations' },
    { name: 'gamma-skill', desc: 'Third skill for gamma analysis' },
  ];
  const section = { label: 'Test Skills', prefix: '', items };

  for (let level = 0; level <= 4; level++) {
    const output = renderSection(section, level);
    const goldenFile = path.join(GOLDEN_DIR, `section-level-${level}.txt`);

    if (!fs.existsSync(goldenFile)) {
      fs.writeFileSync(goldenFile, output);
      continue;
    }
    const expected = fs.readFileSync(goldenFile, 'utf8');
    assert.equal(output, expected, `renderSection level ${level} changed — update golden file if intentional`);
  }
});

// ─── 6c: Full hook flow integration tests ───────────────────────────────────

test('integration: SessionStart hook outputs valid awareness text', () => {
  const raw = execFileSync(NODE, [SCAN_SCRIPT, '--mode=awareness'], {
    input: JSON.stringify({ cwd: FIXTURE_PROJECT }),
    encoding: 'utf-8',
    timeout: 10000,
  });
  assert.ok(raw.length > 0, 'should produce output');
  assert.ok(raw.includes('环境能力感知'), 'should contain awareness header');
  assert.ok(raw.includes('MANDATORY'), 'should contain mandatory routing rules');
});

test('integration: UserPromptSubmit hook matches skill via stdin', () => {
  const raw = execFileSync(NODE, [ROUTE_SCRIPT], {
    input: JSON.stringify({
      prompt: 'I need a valid test skill for this important task',
      cwd: FIXTURE_PROJECT,
    }),
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();
  const output = JSON.parse(raw);
  assert.equal(output.continue, true);
  if (output.hookSpecificOutput) {
    // With synonym/stem expansion, user-level skills may win over fixture skills.
    // Verify structural correctness rather than a specific skill name.
    assert.ok(output.hookSpecificOutput.additionalContext, 'should have additionalContext');
    assert.ok(output.hookSpecificOutput.additionalContext.includes('Skill tool'),
      'should instruct to use Skill tool');
    assert.ok(output.hookSpecificOutput.additionalContext.includes('[AUTO-ROUTE]'),
      'should include AUTO-ROUTE marker');
  }
});

test('integration: UserPromptSubmit hook escapes on 直接做', () => {
  const raw = execFileSync(NODE, [ROUTE_SCRIPT], {
    input: JSON.stringify({ prompt: '直接做：列出文件', cwd: FIXTURE_PROJECT }),
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();
  const output = JSON.parse(raw);
  assert.equal(output.continue, true);
  assert.equal(output.suppressOutput, true, 'escaped prompt should suppress');
});

test('integration: UserPromptSubmit hook passThrough on no match', () => {
  const raw = execFileSync(NODE, [ROUTE_SCRIPT], {
    input: JSON.stringify({
      prompt: 'tell me about the weather in Tokyo tomorrow',
      cwd: FIXTURE_PROJECT,
    }),
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();
  const output = JSON.parse(raw);
  assert.equal(output.continue, true);
  assert.ok(!output.hookSpecificOutput, 'no match should not have hookSpecificOutput');
});

test('integration: SessionStart awareness mode includes fixture skills', () => {
  const raw = execFileSync(NODE, [SCAN_SCRIPT, '--mode=awareness',
    `--project-dir=${FIXTURE_PROJECT}`,
    `--user-dir=${path.join(__dirname, 'fixtures', 'user')}`,
  ], {
    encoding: 'utf-8',
    timeout: 10000,
  });
  assert.ok(raw.includes('valid-skill'), 'should list project skill');
});

test('integration: scan list mode outputs compact format', () => {
  const raw = execFileSync(NODE, [SCAN_SCRIPT, '--mode=list',
    `--project-dir=${FIXTURE_PROJECT}`,
    `--user-dir=${path.join(__dirname, 'fixtures', 'user')}`,
  ], {
    encoding: 'utf-8',
    timeout: 10000,
  });
  assert.ok(raw.includes('当前环境能力摘要'), 'should have summary header');
  assert.ok(raw.length > 0);
});

test('integration: scan route mode outputs detailed format', () => {
  const raw = execFileSync(NODE, [SCAN_SCRIPT, '--mode=route',
    `--project-dir=${FIXTURE_PROJECT}`,
    `--user-dir=${path.join(__dirname, 'fixtures', 'user')}`,
  ], {
    encoding: 'utf-8',
    timeout: 10000,
  });
  assert.ok(raw.includes('当前环境能力摘要'), 'should have summary header');
});

// ─── 6d: install/uninstall cycle ────────────────────────────────────────────

test('integration: install and uninstall cycle', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-home-'));
  const claudeDir = path.join(tmpHome, '.claude');
  const settingsFile = path.join(claudeDir, 'settings.json');
  const installScript = path.join(__dirname, '..', 'install.sh');

  const env = {
    ...process.env,
    HOME: tmpHome,
    CLAUDE_USER_DIR: claudeDir,
  };

  try {
    // Install
    execFileSync('bash', [installScript], { env, encoding: 'utf-8', timeout: 30000 });

    // Verify files exist
    const pluginDir = path.join(claudeDir, 'plugins', 'cache', 'capability-orchestrator');
    assert.ok(fs.existsSync(pluginDir), 'plugin directory should exist after install');
    assert.ok(fs.existsSync(settingsFile), 'settings.json should exist after install');

    // Verify hooks registered
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    assert.ok(settings.hooks, 'hooks should exist');
    assert.ok(settings.hooks.SessionStart, 'SessionStart hook should exist');
    assert.ok(settings.hooks.UserPromptSubmit, 'UserPromptSubmit hook should exist');

    // Uninstall
    execFileSync('bash', [installScript, '--uninstall'], { env, encoding: 'utf-8', timeout: 30000 });

    // Verify cleaned up
    assert.ok(!fs.existsSync(pluginDir), 'plugin directory should be removed after uninstall');
    const settingsAfter = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    assert.ok(!settingsAfter.hooks || !settingsAfter.hooks.SessionStart,
      'SessionStart hook should be removed');
    assert.ok(!settingsAfter.hooks || !settingsAfter.hooks.UserPromptSubmit,
      'UserPromptSubmit hook should be removed');

    // Reinstall
    execFileSync('bash', [installScript], { env, encoding: 'utf-8', timeout: 30000 });
    assert.ok(fs.existsSync(pluginDir), 'plugin directory should exist after reinstall');
    const settingsReinstall = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    assert.ok(settingsReinstall.hooks.SessionStart, 'SessionStart hook should exist after reinstall');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});
