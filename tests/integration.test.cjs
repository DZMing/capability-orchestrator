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
  // Output is plain text [AUTO-ROUTE] or JSON passThrough
  const isMatch = raw.startsWith('[AUTO-ROUTE]');
  const isPassThrough = raw.startsWith('{');
  assert.ok(isMatch || isPassThrough, 'should produce AUTO-ROUTE or passThrough output');
  if (isMatch) {
    assert.ok(raw.includes('[AUTO-ROUTE]'), 'should include AUTO-ROUTE marker');
    assert.ok(raw.includes('Skill tool') || raw.includes('命令') || raw.includes('定义'), 'should instruct to use skill or command');
  }
});

test('integration: UserPromptSubmit hook escapes on 直接做', () => {
  const raw = execFileSync(NODE, [ROUTE_SCRIPT], {
    input: JSON.stringify({ prompt: '直接做：列出文件', cwd: FIXTURE_PROJECT }),
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();
  // Escaped prompt → passThrough → JSON {"continue":true}
  const output = JSON.parse(raw);
  assert.equal(output.continue, true);
  assert.ok(!output.hookSpecificOutput, 'escaped prompt should not route');
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

test('integration: scan script respects CLAUDE_USER_DIR env', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-user-'));
  const userDir = path.join(tmpHome, 'custom-home');
  try {
    const skillDir = path.join(userDir, 'skills', 'demo-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: demo-skill\ndescription: custom scan only skill\n---\n');

    const raw = execFileSync(NODE, [SCAN_SCRIPT, '--mode=list', `--project-dir=${FIXTURE_PROJECT}`], {
      env: { ...process.env, CLAUDE_USER_DIR: userDir },
      encoding: 'utf-8',
      timeout: 10000,
    });
    assert.ok(raw.includes('demo-skill'), 'should list skills from CLAUDE_USER_DIR');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
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

test('integration: install fails safely on malformed settings.json', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-home-'));
  const settingsFile = path.join(tmpHome, 'settings.json');
  const installScript = path.join(__dirname, '..', 'install.sh');
  const original = '{"model":"opus", invalid\n';
  fs.writeFileSync(settingsFile, original);

  const env = {
    ...process.env,
    HOME: tmpHome,
    CLAUDE_USER_DIR: tmpHome,
  };

  try {
    assert.throws(
      () => execFileSync('bash', [installScript], {
        env,
        encoding: 'utf-8',
        timeout: 30000,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
      /settings\.json|JSON|解析/u
    );
    assert.equal(fs.readFileSync(settingsFile, 'utf8'), original, 'malformed settings.json should stay untouched');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('integration: uninstall keeps unrelated hooks in same entry', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-home-'));
  const settingsFile = path.join(tmpHome, 'settings.json');
  const installScript = path.join(__dirname, '..', 'install.sh');
  fs.writeFileSync(settingsFile, JSON.stringify({
    hooks: {
      SessionStart: [
        {
          hooks: [
            { type: 'command', command: 'node /x/capability-orchestrator/scripts/scan-environment.cjs --mode=awareness', timeout: 10 },
            { type: 'command', command: 'node /keep/me.js', timeout: 10 },
          ],
        },
      ],
    },
  }, null, 2));

  const env = {
    ...process.env,
    HOME: tmpHome,
    CLAUDE_USER_DIR: tmpHome,
  };

  try {
    execFileSync('bash', [installScript, '--uninstall'], {
      env,
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    const hooks = (settings.hooks || {}).SessionStart || [];
    assert.equal(hooks.length, 1, 'shared hook entry should stay');
    assert.equal(hooks[0].hooks.length, 1, 'only unrelated hook should remain');
    assert.equal(hooks[0].hooks[0].command, 'node /keep/me.js');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('integration: install.sh --version matches package.json version', () => {
  const installScript = path.join(__dirname, '..', 'install.sh');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const raw = execFileSync('bash', [installScript, '--version'], {
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();

  assert.equal(raw, `capability-orchestrator ${pkg.version}`);
});

test('integration: install respects CAPABILITY_INSTALL_REF release override', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-home-'));
  const installScript = path.join(__dirname, '..', 'install.sh');
  const latestTag = execFileSync('bash', ['-lc', "git tag --list 'v*' | sort -V | tail -n 1"], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf-8',
  }).trim();

  const env = {
    ...process.env,
    HOME: tmpHome,
    CLAUDE_USER_DIR: tmpHome,
    CAPABILITY_INSTALL_REF: latestTag,
  };

  try {
    const raw = execFileSync('bash', [installScript], {
      env,
      encoding: 'utf-8',
      timeout: 30000,
    });
    assert.ok(raw.includes('安装渠道：release'));
    assert.ok(raw.includes(`安装目标：${latestTag}`));
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('integration: install accepts explicit master channel', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-home-'));
  const installScript = path.join(__dirname, '..', 'install.sh');

  const env = {
    ...process.env,
    HOME: tmpHome,
    CLAUDE_USER_DIR: tmpHome,
    CAPABILITY_INSTALL_REF: 'master',
    CAPABILITY_INSTALL_CHANNEL: 'release',
  };

  try {
    const raw = execFileSync('bash', [installScript, '--channel=master'], {
      env,
      encoding: 'utf-8',
      timeout: 30000,
    });
    assert.ok(raw.includes('安装渠道：master'));
    assert.ok(raw.includes('安装目标：master'));
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('integration: uninstall aborts on malformed settings.json and preserves plugin dir', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-home-'));
  const installScript = path.join(__dirname, '..', 'install.sh');
  const pluginDir = path.join(tmpHome, 'plugins', 'cache', 'capability-orchestrator');
  const settingsFile = path.join(tmpHome, 'settings.json');
  const original = '{"hooks": {"SessionStart": [invalid\n';

  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(settingsFile, original);

  const env = {
    ...process.env,
    HOME: tmpHome,
    CLAUDE_USER_DIR: tmpHome,
  };

  try {
    assert.throws(
      () => execFileSync('bash', [installScript, '--uninstall'], {
        env,
        encoding: 'utf-8',
        timeout: 30000,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
      /settings\.json|JSON|解析|清理 hook 失败/u
    );
    assert.ok(fs.existsSync(pluginDir), 'plugin dir should stay when uninstall cannot safely clean hooks');
    assert.equal(fs.readFileSync(settingsFile, 'utf8'), original, 'malformed settings.json should stay untouched');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

// ─── hook → 磁盘日志验证 ─────────────────────────────────────────────────────

test('integration: UserPromptSubmit hook writes route log to disk', () => {
  const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'co-int-log-'));
  const raw = execFileSync(NODE, [ROUTE_SCRIPT], {
    input: JSON.stringify({
      prompt: 'I need a valid test skill for this important task',
      cwd: FIXTURE_PROJECT,
    }),
    encoding: 'utf-8',
    timeout: 10000,
    env: { ...process.env, CLAUDE_PLUGIN_DATA: tmpData, CLAUDE_USER_DIR: path.join(__dirname, 'fixtures', 'user') },
  }).trim();

  // hook 本身应该正常输出
  const isMatch = raw.startsWith('[AUTO-ROUTE]');
  const isPassThrough = raw.startsWith('{');
  assert.ok(isMatch || isPassThrough, 'hook should produce valid output');

  // 日志文件应该存在
  const logPath = path.join(tmpData, 'route-log.jsonl');
  assert.ok(fs.existsSync(logPath), 'route-log.jsonl should be created');

  // 日志内容应该是合法 JSON
  const logContent = fs.readFileSync(logPath, 'utf8').trim();
  const entry = JSON.parse(logContent);
  assert.ok(entry.ts, 'log entry should have timestamp');
  assert.ok(entry.action === 'route' || entry.action === 'pass', 'log entry should have valid action');

  fs.rmSync(tmpData, { recursive: true, force: true });
});
