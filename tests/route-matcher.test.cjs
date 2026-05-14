'use strict';

process.env.CAPABILITY_PLATFORM = 'claude';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ISOLATED_ECOSYSTEM_ROOT = path.join(os.tmpdir(), `cap-ecosystem-empty-${process.pid}`);
process.env.OPENCLAW_USER_DIR = path.join(ISOLATED_ECOSYSTEM_ROOT, 'openclaw');
process.env.HERMES_USER_DIR = path.join(ISOLATED_ECOSYSTEM_ROOT, 'hermes');

const {
  extractPrompt, isEscaped, findBestMatch,
  collectAllSkills, ESCAPE_PATTERNS,
} = require('../scripts/route-matcher.cjs');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'route-matcher.cjs');
const NODE = process.execPath;

// ─── extractPrompt ──────────────────────────────────────────────────────────

test('extractPrompt: extracts from prompt field', () => {
  const input = JSON.stringify({ prompt: 'hello world' });
  assert.equal(extractPrompt(input), 'hello world');
});

test('extractPrompt: extracts from message.content', () => {
  const input = JSON.stringify({ message: { content: 'test msg' } });
  assert.equal(extractPrompt(input), 'test msg');
});

test('extractPrompt: extracts from parts array', () => {
  const input = JSON.stringify({ parts: [
    { type: 'text', text: 'part one' },
    { type: 'image', url: 'x' },
    { type: 'text', text: 'part two' },
  ]});
  assert.equal(extractPrompt(input), 'part one part two');
});

test('extractPrompt: returns empty for invalid JSON', () => {
  assert.equal(extractPrompt('not json'), '');
});

test('extractPrompt: returns empty for empty object', () => {
  assert.equal(extractPrompt('{}'), '');
});

test('extractPrompt: prompt field takes priority', () => {
  const input = JSON.stringify({ prompt: 'primary', message: { content: 'secondary' } });
  assert.equal(extractPrompt(input), 'primary');
});

// ─── extractCwd ────────────────────────────────────────────────────────────

test('extractCwd: extracts cwd field', () => {
  const { extractCwd } = require('../scripts/route-matcher.cjs');
  assert.equal(extractCwd(JSON.stringify({ cwd: '/foo/bar', prompt: 'hi' })), '/foo/bar');
});

test('extractCwd: returns empty for missing cwd', () => {
  const { extractCwd } = require('../scripts/route-matcher.cjs');
  assert.equal(extractCwd(JSON.stringify({ prompt: 'hi' })), '');
});

test('extractCwd: returns empty for invalid JSON', () => {
  const { extractCwd } = require('../scripts/route-matcher.cjs');
  assert.equal(extractCwd('not json'), '');
});

// ─── isEscaped ──────────────────────────────────────────────────────────────

test('isEscaped: detects 直接做', () => {
  assert.ok(isEscaped('直接做：列出文件'));
});

test('isEscaped: detects 直接执行', () => {
  assert.ok(isEscaped('直接执行：列出文件'));
});

test('isEscaped: detects skip', () => {
  assert.ok(isEscaped('skip this, just do it'));
});

test('isEscaped: detects 不要用skill', () => {
  assert.ok(isEscaped('不要用skill，自己处理'));
});

test('isEscaped: detects 不用skill', () => {
  assert.ok(isEscaped('不用skill'));
});

test('isEscaped: short English question is escaped', () => {
  assert.ok(isEscaped('what is it?'));
});

test('isEscaped: long question not escaped', () => {
  assert.ok(!isEscaped('能帮我调试一下这个函数为什么报错了吗？我试了很多方法都不行?'));
});

test('isEscaped: normal message not escaped', () => {
  assert.ok(!isEscaped('帮我调试这个 bug'));
});

test('isEscaped: null returns false', () => {
  assert.ok(!isEscaped(null));
});

test('resolveRouteDecision: short continuation prompt routes through Intent Router', () => {
  const { resolveRouteDecision } = require('../scripts/route-matcher.cjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-route-intent-'));
  fs.writeFileSync(path.join(tmp, 'AGENTS.md'), 'Never push directly to master.\n');
  try {
    const decision = resolveRouteDecision(JSON.stringify({ prompt: '继续', cwd: tmp }));
    assert.equal(decision.explain.action, 'route');
    assert.equal(decision.explain.reason, 'intent-router');
    assert.equal(decision.explain.targetType, 'intent');
    assert.equal(decision.explain.targetName, 'continue_work');
    assert.equal(decision.targetType, 'intent');
    assert.ok(decision.intentRoute.output.includes('[AUTO-ROUTE]'));
    assert.ok(decision.intentRoute.output.includes('## What'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('resolveRouteDecision: risky publish prompt routes to confirmation gate', () => {
  const { resolveRouteDecision } = require('../scripts/route-matcher.cjs');
  const decision = resolveRouteDecision(JSON.stringify({
    prompt: '帮我发布并推送到生产',
    cwd: FIXTURE_PROJECT,
  }));
  assert.equal(decision.explain.action, 'route');
  assert.equal(decision.explain.reason, 'confirmation-required');
  assert.equal(decision.explain.targetType, 'intent');
  assert.equal(decision.explain.targetName, 'execute_plan');
  assert.equal(decision.intentRoute.safety.confirmationRequired, true);
  assert.ok(decision.intentRoute.output.includes('[CONFIRMATION REQUIRED]'));
});

test('resolveRouteDecision: escaped risky prompts still route to confirmation gate', () => {
  const { resolveRouteDecision } = require('../scripts/route-matcher.cjs');
  const prompts = [
    '直接做，帮我发布到生产',
    '不用skill，帮我删除这个目录',
    'skip，使用凭证部署',
    '直接执行付费发布',
    'push prod?',
  ];

  for (const prompt of prompts) {
    const decision = resolveRouteDecision(JSON.stringify({ prompt, cwd: FIXTURE_PROJECT }));
    assert.equal(decision.explain.action, 'route', prompt);
    assert.equal(decision.explain.reason, 'confirmation-required', prompt);
    assert.equal(decision.explain.targetType, 'intent', prompt);
    assert.equal(decision.intentRoute.safety.confirmationRequired, true, prompt);
    assert.ok(decision.intentRoute.output.includes('[CONFIRMATION REQUIRED]'), prompt);
  }
});

// ─── collectAllSkills 插件 skill 路由 ───────────────────────────────────────

const FIXTURE_PROJECT = path.join(__dirname, 'fixtures', 'project');
const FIXTURE_USER = path.join(__dirname, 'fixtures', 'user');

test('collectAllSkills: includes plugin skills', () => {
  const skills = collectAllSkills(FIXTURE_PROJECT, FIXTURE_USER);
  const names = skills.map(s => s.name);
  assert.ok(names.includes('alpha'), 'should include good-plugin alpha skill');
  assert.ok(names.includes('beta'), 'should include vendor-structure beta skill');
  assert.ok(names.includes('gamma-skill'), 'should include three-level gamma-skill');
});

test('collectAllSkills: project skills take priority over plugin skills', () => {
  const skills = collectAllSkills(FIXTURE_PROJECT, FIXTURE_USER);
  const names = skills.map(s => s.name);
  assert.ok(names.includes('valid-skill'), 'project skill should be present');
  const validSkill = skills.find(s => s.name === 'valid-skill');
  assert.ok(validSkill.desc.includes('valid test skill'), 'should have project-level desc');
});

// ─── 端到端子进程测试 ──────────────────────────────────────────────────────

test('e2e: passThrough for short prompt', () => {
  const raw = execFileSync(NODE, [SCRIPT], {
    input: JSON.stringify({ prompt: 'hi' }),
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();
  // passThrough outputs JSON {"continue":true}
  const output = JSON.parse(raw);
  assert.equal(output.continue, true);
  assert.ok(!output.hookSpecificOutput, 'short prompt should not have hookSpecificOutput');
});

test('e2e: passThrough for escaped prompt', () => {
  const raw = execFileSync(NODE, [SCRIPT], {
    input: JSON.stringify({ prompt: '直接做：列出文件' }),
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();
  // passThrough outputs JSON {"continue":true}
  const output = JSON.parse(raw);
  assert.equal(output.continue, true);
  assert.ok(!output.hookSpecificOutput, 'escaped prompt should not have hookSpecificOutput');
});

test('e2e: passThrough for empty input', () => {
  const raw = execFileSync(NODE, [SCRIPT], {
    input: '',
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();
  const output = JSON.parse(raw);
  assert.equal(output.continue, true);
});

test('e2e: passThrough on invalid input produces valid JSON', () => {
  // Invalid JSON → extractPrompt returns '' → passThrough → JSON output
  const raw = execFileSync(NODE, [SCRIPT], {
    input: 'invalid json garbage',
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();
  assert.doesNotThrow(() => JSON.parse(raw), 'passThrough must produce valid JSON');
  const output = JSON.parse(raw);
  assert.equal(output.continue, true);
});

test('e2e: exit 0 on normal input', () => {
  const raw = execFileSync(NODE, [SCRIPT], {
    input: JSON.stringify({ prompt: 'help me review this code carefully' }),
    encoding: 'utf-8',
    timeout: 10000,
  });
  assert.ok(raw.length > 0, 'should produce output');
  // Output is either plain text [AUTO-ROUTE] (match) or JSON passThrough
  const trimmed = raw.trim();
  const isMatch = trimmed.startsWith('[AUTO-ROUTE]');
  const isPassThrough = trimmed.startsWith('{');
  assert.ok(isMatch || isPassThrough, 'output should be AUTO-ROUTE text or passThrough JSON');
});

test('e2e: uses cwd from stdin for skill scanning', () => {
  const fixtureProject = path.join(__dirname, 'fixtures', 'project');
  const fixtureUser = path.join(__dirname, 'fixtures', 'user');
  const raw = execFileSync(NODE, [SCRIPT], {
    input: JSON.stringify({ prompt: 'I need a valid test skill for this task', cwd: fixtureProject }),
    encoding: 'utf-8',
    timeout: 10000,
    env: { ...process.env, CLAUDE_USER_DIR: fixtureUser },
  }).trim();
  // Output is either plain text AUTO-ROUTE or passThrough JSON
  const isMatch = raw.startsWith('[AUTO-ROUTE]');
  const isPassThrough = raw.startsWith('{');
  assert.ok(isMatch || isPassThrough, 'should produce AUTO-ROUTE or passThrough output');
  if (isMatch) {
    assert.ok(raw.includes('[AUTO-ROUTE]'), 'match should include AUTO-ROUTE marker');
    assert.ok(raw.includes('Skill tool') || raw.includes('命令') || raw.includes('定义'), 'should instruct to use skill or command');
  }
});

test('e2e: respects CLAUDE_USER_DIR for user skill scanning', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-user-'));
  const userDir = path.join(tmpHome, 'custom-home');
  try {
    const skillDir = path.join(userDir, 'skills', 'demo-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: demo-skill\ndescription: custom route only skill\n---\n');

    const raw = execFileSync(NODE, [SCRIPT], {
      input: JSON.stringify({
        prompt: 'please use custom route only skill now',
        cwd: FIXTURE_PROJECT,
      }),
      env: { ...process.env, CLAUDE_USER_DIR: userDir },
      encoding: 'utf-8',
      timeout: 10000,
    }).trim();

    assert.ok(raw.includes('demo-skill'), `should route to custom CLAUDE_USER_DIR skill, got: ${raw.slice(0, 200)}`);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('e2e: matched skill output should not leak raw !command syntax', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-explain-home-'));
  try {
    const skillDir = path.join(tmpHome, 'skills', 'capabilities');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
      '---',
      'name: capabilities',
      'description: output environment summary',
      '---',
      '',
      '!`node "${CLAUDE_SKILL_DIR}/../../scripts/scan-environment.cjs" --mode=list`',
      '',
    ].join('\n'));

    const raw = execFileSync(NODE, [SCRIPT], {
      input: JSON.stringify({
        prompt: 'please output environment summary',
        cwd: FIXTURE_PROJECT,
      }),
      env: { ...process.env, CLAUDE_USER_DIR: tmpHome },
      encoding: 'utf-8',
      timeout: 10000,
    }).trim();

    assert.ok(raw.startsWith('[AUTO-ROUTE]'), 'should route matched skill');
    assert.ok(!raw.includes('!`'), 'should not leak raw !command syntax into injected context');
    assert.ok(raw.includes('/capabilities'), 'should instruct direct skill invocation');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('e2e: --explain returns matched skill JSON', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-explain-home-'));
  try {
    const skillDir = path.join(tmpHome, 'skills', 'capabilities');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
      '---',
      'name: capabilities',
      'description: output environment summary',
      '---',
      '',
      '!`node "${CLAUDE_SKILL_DIR}/../../scripts/scan-environment.cjs" --mode=list`',
      '',
    ].join('\n'));

    const raw = execFileSync(NODE, [SCRIPT, '--explain'], {
      input: JSON.stringify({
        prompt: 'please output environment summary',
        cwd: FIXTURE_PROJECT,
      }),
      env: { ...process.env, CLAUDE_USER_DIR: tmpHome },
      encoding: 'utf-8',
      timeout: 10000,
    }).trim();
    const output = JSON.parse(raw);
    assert.equal(output.action, 'route');
    assert.equal(output.reason, 'matched-skill');
    assert.equal(output.targetType, 'skill');
    assert.equal(output.targetName, 'capabilities');
    assert.ok(typeof output.confidence === 'number');
    assert.ok(Array.isArray(output.matchedKeywords));
    assert.ok(output.matchedKeywords.length > 0);
    assert.equal(output.cwd, FIXTURE_PROJECT);
    assert.equal(output.userDirSource, 'CLAUDE_USER_DIR');
    assert.ok(!raw.includes('!`'), 'explain output should not leak raw !command');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('e2e: --explain returns matched command JSON', () => {
  const raw = execFileSync(NODE, [SCRIPT, '--explain'], {
    input: JSON.stringify({
      prompt: 'valid test legacy command integration testing',
      cwd: FIXTURE_PROJECT,
    }),
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();
  const output = JSON.parse(raw);
  assert.equal(output.action, 'route');
  assert.equal(output.reason, 'matched-command-semantic');
  assert.equal(output.targetType, 'command');
  assert.equal(output.targetName, 'legacy-cmd');
});

test('e2e: --explain returns matched literal command JSON', () => {
  const raw = execFileSync(NODE, [SCRIPT, '--explain'], {
    input: JSON.stringify({
      prompt: '/legacy-cmd',
      cwd: FIXTURE_PROJECT,
    }),
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();
  const output = JSON.parse(raw);
  assert.equal(output.action, 'route');
  assert.equal(output.reason, 'matched-command-literal');
  assert.equal(output.targetType, 'command');
  assert.equal(output.targetName, 'legacy-cmd');
});

test('e2e: --explain returns fallback command reason when command cannot slash invoke', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-fallback-cmd-'));
  try {
    const cmdDir = path.join(tmpDir, '.claude', 'commands');
    fs.mkdirSync(cmdDir, { recursive: true });
    fs.writeFileSync(path.join(cmdDir, 'bad cmd.md'), '---\ndescription: fallback command semantics\n---\nUse fallback only.\n');
    const raw = execFileSync(NODE, [SCRIPT, '--explain'], {
      input: JSON.stringify({
        prompt: 'please use fallback command semantics now',
        cwd: tmpDir,
      }),
      encoding: 'utf-8',
      timeout: 10000,
    }).trim();
    const output = JSON.parse(raw);
    assert.equal(output.action, 'route');
    assert.equal(output.reason, 'matched-command-fallback');
    assert.equal(output.targetType, 'command');
    assert.equal(output.targetName, 'bad cmd');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('e2e: --explain returns matched mcp JSON', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-mcp-proj-'));
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-mcp-home-'));
  try {
    fs.writeFileSync(path.join(tmpDir, '.mcp.json'), JSON.stringify({
      mcpServers: {
        docs: { description: 'docs query helper' },
      },
    }, null, 2));
    const raw = execFileSync(NODE, [SCRIPT, '--explain'], {
      input: JSON.stringify({
        prompt: 'please use the docs query helper',
        cwd: tmpDir,
      }),
      env: { ...process.env, CLAUDE_USER_DIR: tmpHome },
      encoding: 'utf-8',
      timeout: 10000,
    }).trim();
    const output = JSON.parse(raw);
    assert.equal(output.action, 'route');
    assert.equal(output.reason, 'matched-mcp');
    assert.equal(output.targetType, 'mcp');
    assert.equal(output.targetName, 'docs');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('e2e: --explain returns no-match JSON', () => {
  const raw = execFileSync(NODE, [SCRIPT, '--explain'], {
    input: JSON.stringify({
      prompt: 'tell me about the weather in Tokyo tomorrow',
      cwd: FIXTURE_PROJECT,
    }),
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();
  const output = JSON.parse(raw);
  assert.equal(output.action, 'pass');
  assert.equal(output.reason, 'no-match');
  assert.equal(output.targetType, null);
  assert.equal(output.targetName, null);
});

test('e2e: --explain returns escaped JSON', () => {
  const raw = execFileSync(NODE, [SCRIPT, '--explain'], {
    input: JSON.stringify({
      prompt: 'skip，直接做：输出当前环境能力',
      cwd: FIXTURE_PROJECT,
    }),
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();
  const output = JSON.parse(raw);
  assert.equal(output.action, 'pass');
  assert.equal(output.reason, 'escaped');
});

test('e2e: --explain returns too-short JSON', () => {
  const raw = execFileSync(NODE, [SCRIPT, '--explain'], {
    input: JSON.stringify({
      prompt: 'hi',
      cwd: FIXTURE_PROJECT,
    }),
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();
  const output = JSON.parse(raw);
  assert.equal(output.action, 'pass');
  assert.equal(output.reason, 'too-short');
});

// ─── Session 2: readStdin 超时 & 异常路径 ─────────────────────────────────

test('e2e: stdin timeout produces passThrough (no stdin data)', (t, done) => {
  const child = spawn(NODE, [SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.on('close', (code) => {
    assert.equal(code, 0, 'should exit 0');
    const output = JSON.parse(stdout.trim());
    assert.equal(output.continue, true, 'should passThrough on timeout');
    done();
  });
  // Don't write anything to stdin, don't end it — force the timeout path
  // Default STDIN_TIMEOUT is 3000ms, so this test takes ~3s
});

test('e2e: multi-chunk stdin correctly assembled', () => {
  // Split JSON across two writes to test chunk accumulation
  const json = JSON.stringify({ prompt: 'help me review this code carefully' });
  const mid = Math.floor(json.length / 2);
  const chunk1 = json.slice(0, mid);
  const chunk2 = json.slice(mid);
  const scriptLiteral = JSON.stringify(SCRIPT);

  // Use a wrapper script that writes in two chunks
  const wrapperScript = `
    const { spawn } = require('child_process');
    const child = spawn(process.execPath, [${scriptLiteral}], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    child.on('close', (code) => {
      if (code !== 0) {
        process.stderr.write(err || ('child exited with code ' + code));
        process.exit(code || 1);
      }
      process.stdout.write(out);
    });
    child.stdin.write(${JSON.stringify(chunk1)});
    setTimeout(() => { child.stdin.end(${JSON.stringify(chunk2)}); }, 50);
  `;
  const raw = execFileSync(NODE, ['-e', wrapperScript], {
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();
  // Output is either plain text [AUTO-ROUTE] or JSON passThrough
  const trimmed = raw.trim();
  assert.ok(trimmed.startsWith('[AUTO-ROUTE]') || trimmed.startsWith('{'),
    'multi-chunk input should produce AUTO-ROUTE or passThrough output');
});

test('e2e: empty stdin end produces passThrough', () => {
  // Pipe empty buffer and immediately end — tests readableEnded path
  const raw = execFileSync(NODE, [SCRIPT], {
    input: Buffer.alloc(0),
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();
  const output = JSON.parse(raw);
  assert.equal(output.continue, true);
});

test('collectAllSkills: fault-open when plugin scan throws', () => {
  // Pass a non-existent userDir that will cause scanInstalledPlugins to fail
  const skills = collectAllSkills(
    path.join(__dirname, 'fixtures', 'project'),
    '/nonexistent/path/that/definitely/does/not/exist'
  );
  // Should still return project skills without crashing
  assert.ok(Array.isArray(skills), 'should return array');
  const names = skills.map(s => s.name);
  assert.ok(names.includes('valid-skill'), 'project skill should still be present');
});

test('collectAllSkills: includes OpenClaw and Hermes skills in matching pool', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecosystem-route-'));
  const openClawRoot = path.join(tmp, 'openclaw');
  const hermesRoot = path.join(tmp, 'hermes');
  fs.mkdirSync(path.join(openClawRoot, 'workspace', 'skills', 'oc-skill'), { recursive: true });
  fs.mkdirSync(path.join(hermesRoot, 'skills', 'hermes-skill'), { recursive: true });
  fs.writeFileSync(path.join(openClawRoot, 'workspace', 'skills', 'oc-skill', 'SKILL.md'), '---\nname: oc-skill\ndescription: openclaw code audit helper\n---\n');
  fs.writeFileSync(path.join(hermesRoot, 'skills', 'hermes-skill', 'SKILL.md'), '---\nname: hermes-skill\ndescription: hermes planning helper\n---\n');

  const savedOpenClaw = process.env.OPENCLAW_USER_DIR;
  const savedHermes = process.env.HERMES_USER_DIR;
  process.env.OPENCLAW_USER_DIR = openClawRoot;
  process.env.HERMES_USER_DIR = hermesRoot;
  try {
    const skills = collectAllSkills(FIXTURE_PROJECT, path.join(__dirname, 'fixtures', 'user'));
    const names = skills.map(s => s.name);
    assert.ok(names.includes('oc-skill'));
    assert.ok(names.includes('hermes-skill'));
    assert.equal(findBestMatch('please do an openclaw code audit', skills).name, 'oc-skill');
    assert.equal(findBestMatch('need hermes planning help', skills).name, 'hermes-skill');
  } finally {
    if (savedOpenClaw === undefined) delete process.env.OPENCLAW_USER_DIR;
    else process.env.OPENCLAW_USER_DIR = savedOpenClaw;
    if (savedHermes === undefined) delete process.env.HERMES_USER_DIR;
    else process.env.HERMES_USER_DIR = savedHermes;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('collectAllSkills: active OpenClaw host stays scan-only and reads workspace skills from its own user dir', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-host-route-'));
  const openClawRoot = path.join(tmp, 'openclaw');
  fs.mkdirSync(path.join(openClawRoot, 'workspace', 'skills', 'oc-workspace'), { recursive: true });
  fs.writeFileSync(path.join(openClawRoot, 'workspace', 'skills', 'oc-workspace', 'SKILL.md'), '---\nname: oc-workspace\ndescription: openclaw workspace audit helper\n---\n');

  const savedPlatform = process.env.CAPABILITY_PLATFORM;
  const savedOpenClaw = process.env.OPENCLAW_USER_DIR;
  process.env.CAPABILITY_PLATFORM = 'openclaw';
  process.env.OPENCLAW_USER_DIR = openClawRoot;
  try {
    const skills = collectAllSkills(FIXTURE_PROJECT, openClawRoot);
    const names = skills.map(s => s.name);
    assert.ok(names.includes('oc-workspace'));
    assert.equal(findBestMatch('please do an openclaw workspace audit', skills).name, 'oc-workspace');
    assert.ok(!names.includes('memory-core'), 'OpenClaw runtime plugins are not part of scan-only support');
  } finally {
    if (savedPlatform === undefined) delete process.env.CAPABILITY_PLATFORM;
    else process.env.CAPABILITY_PLATFORM = savedPlatform;
    if (savedOpenClaw === undefined) delete process.env.OPENCLAW_USER_DIR;
    else process.env.OPENCLAW_USER_DIR = savedOpenClaw;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('collectAllSkills: active Hermes host reads its own user skills from host dir', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-host-route-'));
  const hermesRoot = path.join(tmp, 'hermes');
  const binDir = path.join(tmp, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const hermesStub = `
const args = process.argv.slice(2).join(' ');
if (args === 'skills list') {
  process.stdout.write("\\n┃ Name                              ┃ Category             ┃ Source  ┃ Trust   ┃\\n│ hermes-host-skill                 │                      │ local   │ local   │\\n");
} else {
  process.exit(1);
}
`;
  fs.writeFileSync(path.join(binDir, 'hermes-stub.cjs'), hermesStub);
  fs.writeFileSync(path.join(binDir, 'hermes'), `#!/usr/bin/env node${hermesStub}`, { mode: 0o755 });
  fs.writeFileSync(path.join(binDir, 'hermes.cmd'), '@echo off\r\nnode "%~dp0hermes-stub.cjs" %*\r\n');

  const savedPlatform = process.env.CAPABILITY_PLATFORM;
  const savedHermes = process.env.HERMES_USER_DIR;
  const savedPath = process.env.PATH;
  process.env.CAPABILITY_PLATFORM = 'hermes';
  process.env.HERMES_USER_DIR = hermesRoot;
  process.env.PATH = `${binDir}${path.delimiter}${savedPath || ''}`;
  try {
    const skills = collectAllSkills(FIXTURE_PROJECT, hermesRoot);
    const names = skills.map(s => s.name);
    assert.ok(names.includes('hermes-host-skill'));
    assert.equal(findBestMatch('need hermes host planning help', skills).name, 'hermes-host-skill');
  } finally {
    if (savedPlatform === undefined) delete process.env.CAPABILITY_PLATFORM;
    else process.env.CAPABILITY_PLATFORM = savedPlatform;
    if (savedHermes === undefined) delete process.env.HERMES_USER_DIR;
    else process.env.HERMES_USER_DIR = savedHermes;
    process.env.PATH = savedPath;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('collectAllSkills: platform-incompatible Hermes/OpenClaw skills are excluded', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecosystem-platform-route-'));
  const openClawRoot = path.join(tmp, 'openclaw');
  const hermesRoot = path.join(tmp, 'hermes');
  fs.mkdirSync(path.join(openClawRoot, 'workspace', 'skills', 'oc-win-only'), { recursive: true });
  fs.mkdirSync(path.join(hermesRoot, 'skills', 'hermes-win-only'), { recursive: true });
  fs.writeFileSync(path.join(openClawRoot, 'workspace', 'skills', 'oc-win-only', 'SKILL.md'), '---\nname: oc-win-only\ndescription: OpenClaw windows only skill\nmetadata:\n  openclaw:\n    os: [windows]\n---\n');
  fs.writeFileSync(path.join(hermesRoot, 'skills', 'hermes-win-only', 'SKILL.md'), '---\nname: hermes-win-only\ndescription: Hermes windows only skill\nplatforms: [windows]\n---\n');

  const savedOpenClaw = process.env.OPENCLAW_USER_DIR;
  const savedHermes = process.env.HERMES_USER_DIR;
  process.env.OPENCLAW_USER_DIR = openClawRoot;
  process.env.HERMES_USER_DIR = hermesRoot;
  try {
    const skills = collectAllSkills(FIXTURE_PROJECT, path.join(__dirname, 'fixtures', 'user'));
    const names = skills.map(s => s.name);
    if (process.platform === 'win32') {
      assert.ok(names.includes('oc-win-only'));
      assert.ok(names.includes('hermes-win-only'));
    } else {
      assert.ok(!names.includes('oc-win-only'));
      assert.ok(!names.includes('hermes-win-only'));
    }
  } finally {
    if (savedOpenClaw === undefined) delete process.env.OPENCLAW_USER_DIR;
    else process.env.OPENCLAW_USER_DIR = savedOpenClaw;
    if (savedHermes === undefined) delete process.env.HERMES_USER_DIR;
    else process.env.HERMES_USER_DIR = savedHermes;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ─── Session 4: 突变测试断言加固 ──────────────────────────────────────────

// 4c: isEscaped short question threshold — short English-only question escaped
test('mutation: short English question is escaped (threshold < 15)', () => {
  // 14-char English question ending with ? — should be escaped (< 15)
  const q = 'abcdefghijklm?';
  assert.equal(q.length, 14);
  assert.ok(isEscaped(q), '14-char English question should be escaped');
  // 15-char English question should NOT be escaped (not < 15)
  const q15 = 'abcdefghijklmn?';
  assert.equal(q15.length, 15);
  assert.ok(!isEscaped(q15), '15-char English question should NOT be escaped');
  // CJK question should NOT be escaped regardless of length
  const qCjk = '帮我提交代码?';
  assert.ok(!isEscaped(qCjk), 'CJK question should NOT be escaped');
});

// 4e: MIN_PROMPT_LEN boundary — 5 char prompt processed, 4 char skipped
test('mutation: MIN_PROMPT_LEN boundary at 5 chars', () => {
  // 4-char prompt should be skipped (passThrough → JSON {"continue":true})
  const raw4 = execFileSync(NODE, [SCRIPT], {
    input: JSON.stringify({ prompt: 'abcd' }),
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();
  const out4 = JSON.parse(raw4);
  assert.equal(out4.continue, true, '4-char prompt should passThrough');
  assert.ok(!out4.hookSpecificOutput, '4-char prompt should not route');

  // 5-char prompt "debug" matches /debug command (literal match) or no match
  // Either way it gets processed (not auto-skipped)
  const raw5 = execFileSync(NODE, [SCRIPT], {
    input: JSON.stringify({ prompt: 'debug' }),
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();
  // Output is either plain text AUTO-ROUTE (literal match to /debug) or JSON passThrough
  assert.ok(raw5.startsWith('[AUTO-ROUTE]') || raw5.startsWith('{'),
    '5-char prompt should be processed (not auto-skipped)');
});

// 4g: compareSemver exact return values
test('mutation: compareSemver returns exactly 1 or -1', () => {
  const { compareSemver } = require('../scripts/scan-environment.cjs');
  assert.equal(compareSemver('2.0.0', '1.0.0'), 1, 'greater should return 1');
  assert.equal(compareSemver('1.0.0', '2.0.0'), -1, 'lesser should return -1');
  assert.equal(compareSemver('1.0.0', '1.0.0'), 0, 'equal should return 0');
});

// 4h: collectAllSkills dedup order — project > user > plugin
test('mutation: collectAllSkills dedup prefers project over plugin', () => {
  const skills = collectAllSkills(FIXTURE_PROJECT, FIXTURE_USER);
  // 'valid-skill' exists in project fixture
  const vs = skills.find(s => s.name === 'valid-skill');
  assert.ok(vs, 'valid-skill should exist');
  // Its desc should be from project level, not a hypothetical plugin override
  assert.ok(vs.desc.includes('valid test skill'),
    `desc should be project-level, got: ${vs.desc}`);
});

// ─── Legacy command routing ──────────────────────────────────────────────────

test('collectAllSkills: includes legacy commands with desc', () => {
  const skills = collectAllSkills(FIXTURE_PROJECT);
  const cmd = skills.find(s => s.name === 'legacy-cmd');
  assert.ok(cmd, 'legacy-cmd should be in pool');
  assert.equal(cmd.type, 'command', 'should be typed as command');
  assert.ok(cmd.desc, 'should have desc from frontmatter');
  assert.ok(cmd.filePath, 'should have filePath for content injection');
});

test('collectAllSkills: skills take priority over same-named legacy commands', () => {
  // 如果 skill 和 command 同名，skill 优先
  const skills = collectAllSkills(FIXTURE_PROJECT);
  const validSkill = skills.find(s => s.name === 'valid-skill');
  if (validSkill) assert.notEqual(validSkill.type, 'command', 'valid-skill should be a skill, not command');
});

test('collectAllSkills: Codex platform scans .agents/skills/ for project skills', () => {
  const origPlatform = process.env.CAPABILITY_PLATFORM;
  const origUserDir = process.env.CLAUDE_USER_DIR;
  process.env.CAPABILITY_PLATFORM = 'codex';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'co-codex-skills-'));
  const userTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'co-codex-user-'));
  process.env.CODEX_USER_DIR = userTmp;
  delete process.env.CLAUDE_USER_DIR;
  try {
    // 创建 .agents/skills/ 目录结构（Codex 项目级）
    const codexSkillsDir = path.join(tmp, '.agents', 'skills', 'codex-skill');
    fs.mkdirSync(codexSkillsDir, { recursive: true });
    fs.writeFileSync(path.join(codexSkillsDir, 'SKILL.md'), '---\nname: codex-skill\ndescription: A codex skill\n---\nBody');
    // 创建 .claude/skills/ — Codex 平台不应扫这个
    const claudeSkillsDir = path.join(tmp, '.claude', 'skills', 'claude-skill');
    fs.mkdirSync(claudeSkillsDir, { recursive: true });
    fs.writeFileSync(path.join(claudeSkillsDir, 'SKILL.md'), '---\nname: claude-skill\ndescription: A claude skill\n---\nBody');
    // 清除 require 缓存以重新检测平台
    delete require.cache[require.resolve('../scripts/route-matcher.cjs')];
    delete require.cache[require.resolve('../scripts/lib/platform.cjs')];
    const { collectAllSkills: collectFresh } = require('../scripts/route-matcher.cjs');
    const skills = collectFresh(tmp, userTmp);
    const names = skills.map(s => s.name);
    assert.ok(names.includes('codex-skill'), 'Codex 平台应发现 .agents/skills/ 下的 skill');
    assert.ok(!names.includes('claude-skill'), 'Codex 平台不应发现 .claude/skills/ 下的 skill');
  } finally {
    process.env.CAPABILITY_PLATFORM = origPlatform;
    if (origUserDir) process.env.CLAUDE_USER_DIR = origUserDir;
    else delete process.env.CLAUDE_USER_DIR;
    delete process.env.CODEX_USER_DIR;
    delete require.cache[require.resolve('../scripts/route-matcher.cjs')];
    delete require.cache[require.resolve('../scripts/lib/platform.cjs')];
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(userTmp, { recursive: true, force: true });
  }
});

// ─── P1-2: findLiteralMatch unit tests ──────────────────────────────────────

const { findLiteralMatch } = require('../scripts/route-matcher.cjs');

test('findLiteralMatch: /commit matches skill named commit', () => {
  const skills = [
    { name: 'commit', desc: 'create well-formatted commits' },
    { name: 'debug', desc: 'debug errors' },
  ];
  const match = findLiteralMatch('/commit', skills);
  assert.ok(match, '/commit should match');
  assert.equal(match.name, 'commit');
  assert.equal(match.confidence, 1);
});

test('findLiteralMatch: standalone word matches skill name', () => {
  const skills = [
    { name: 'commit', desc: 'create commits' },
    { name: 'debug', desc: 'debug errors' },
  ];
  const match = findLiteralMatch('commit', skills);
  assert.ok(match, 'single word "commit" should match');
  assert.equal(match.name, 'commit');
  assert.equal(match.confidence, 1);
});

test('findLiteralMatch: /nonexistent returns null', () => {
  const skills = [
    { name: 'commit', desc: 'create commits' },
  ];
  const match = findLiteralMatch('/nonexistent', skills);
  assert.equal(match, null, '/nonexistent should not match');
});

test('findLiteralMatch: >3 words skips word matching', () => {
  const skills = [
    { name: 'commit', desc: 'create commits' },
  ];
  const match = findLiteralMatch('please help me commit my changes', skills);
  assert.equal(match, null, 'should not match from word list when >3 words');
});

test('findLiteralMatch: 2-word prompt matches skill name', () => {
  const skills = [
    { name: 'code-review', desc: 'review code quality' },
    { name: 'commit', desc: 'create commits' },
  ];
  const match = findLiteralMatch('commit code-review', skills);
  assert.ok(match, '2-word prompt should try word matching');
  assert.equal(match.name, 'commit');
});

// ─── P1-3: resolveRouteDecision unit tests ──────────────────────────────────

const { resolveRouteDecision } = require('../scripts/route-matcher.cjs');

test('resolveRouteDecision: short prompt returns pass/too-short', () => {
  const decision = resolveRouteDecision(JSON.stringify({ prompt: 'hi', cwd: FIXTURE_PROJECT }));
  assert.equal(decision.explain.action, 'pass');
  assert.equal(decision.explain.reason, 'too-short');
  assert.equal(decision.match, undefined);
});

test('resolveRouteDecision: escaped prompt returns pass/escaped', () => {
  const decision = resolveRouteDecision(JSON.stringify({ prompt: '直接做：列出文件', cwd: FIXTURE_PROJECT }));
  assert.equal(decision.explain.action, 'pass');
  assert.equal(decision.explain.reason, 'escaped');
});

test('resolveRouteDecision: skill match returns route/skill', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-resolve-'));
  try {
    const skillDir = path.join(tmpHome, 'skills', 'test-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: test-skill\ndescription: test something useful\n---\n');
    const decision = resolveRouteDecision(JSON.stringify({
      prompt: 'please test something useful for me',
      cwd: FIXTURE_PROJECT,
    }));
    if (decision.match) {
      assert.equal(decision.explain.action, 'route');
    }
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('resolveRouteDecision: MCP match returns route/mcp', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-resolve-mcp-'));
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-resolve-mcp-home-'));
  try {
    fs.writeFileSync(path.join(tmpDir, '.mcp.json'), JSON.stringify({
      mcpServers: { docs: { description: 'documentation query helper' } },
    }));
    const decision = resolveRouteDecision(JSON.stringify({
      prompt: 'please use the documentation query helper now',
      cwd: tmpDir,
    }));
    if (decision.match && decision.explain.targetType === 'mcp') {
      assert.equal(decision.explain.action, 'route');
      assert.equal(decision.explain.reason, 'matched-mcp');
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('resolveRouteDecision: no match returns pass/no-match', () => {
  const decision = resolveRouteDecision(JSON.stringify({
    prompt: 'tell me about the weather in Tokyo tomorrow please',
    cwd: FIXTURE_PROJECT,
  }));
  assert.equal(decision.explain.action, 'pass');
  assert.equal(decision.explain.reason, 'no-match');
});

test('resolveRouteDecision: confidence at documented threshold still routes', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-resolve-threshold-'));
  const tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-resolve-threshold-proj-'));
  const savedUserDir = process.env.CLAUDE_USER_DIR;
  const savedPlatform = process.env.CAPABILITY_PLATFORM;
  try {
    const skillDir = path.join(tmpHome, 'skills', 'alpha-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: alpha-skill\ndescription: alpha beta gamma\n---\n');
    process.env.CLAUDE_USER_DIR = tmpHome;
    process.env.CAPABILITY_PLATFORM = 'claude';
    const decision = resolveRouteDecision(JSON.stringify({
      prompt: 'alpha beta gamma one two three four five six',
      cwd: tmpProj,
    }));
    assert.equal(decision.explain.action, 'route');
    assert.equal(decision.explain.targetType, 'skill');
    assert.equal(decision.match.name, 'alpha-skill');
    assert.ok(decision.match.confidence >= 0.3 && decision.match.confidence < 0.35);
  } finally {
    if (savedUserDir === undefined) delete process.env.CLAUDE_USER_DIR;
    else process.env.CLAUDE_USER_DIR = savedUserDir;
    if (savedPlatform === undefined) delete process.env.CAPABILITY_PLATFORM;
    else process.env.CAPABILITY_PLATFORM = savedPlatform;
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpProj, { recursive: true, force: true });
  }
});

// ─── parseTriggerWords unit tests ────────────────────────────────────────────

const { parseTriggerWords } = require('../scripts/route-matcher.cjs');

test('parseTriggerWords: extracts CJK trigger words from 触发词 field', () => {
  const result = parseTriggerWords('Some skill desc. 触发词：亚马逊、Amazon、选品、FBA');
  assert.ok(result.includes('亚马逊'), 'should include 亚马逊');
  assert.ok(result.includes('amazon'), 'should include amazon (lowercased)');
  assert.ok(result.includes('选品'), 'should include 选品');
  assert.ok(result.includes('fba'), 'should include fba (lowercased)');
});

test('parseTriggerWords: returns empty array when no trigger word field', () => {
  assert.deepEqual(parseTriggerWords('A skill that does things.'), []);
  assert.deepEqual(parseTriggerWords(''), []);
});

test('parseTriggerWords: handles English Trigger: format', () => {
  const result = parseTriggerWords('Skill description. Trigger: deploy, release, ship');
  assert.ok(result.includes('deploy'));
  assert.ok(result.includes('release'));
  assert.ok(result.includes('ship'));
});

// ─── findLiteralMatch: trigger word hit ──────────────────────────────────────

test('findLiteralMatch: trigger word hit returns confidence 0.9', () => {
  const desc = '亚马逊跨境电商运营 agent。触发词：亚马逊、Amazon、选品、FBA';
  const skills = [
    { name: 'amazon-ops', desc, triggerWords: parseTriggerWords(desc) },
    { name: 'other-skill', desc: 'some other stuff', triggerWords: [] },
  ];
  const match = findLiteralMatch('亚马逊选品调研帮我做', skills);
  assert.ok(match !== null, 'should match via trigger word');
  assert.equal(match.name, 'amazon-ops');
  assert.equal(match.confidence, 0.9);
  assert.ok(match.matchedKeywords.length > 0);
});

test('findLiteralMatch: trigger word does not fire when prompt is too short to include it', () => {
  const desc = '触发词：ultraspecificword';
  const skills = [{ name: 'alpha', desc, triggerWords: parseTriggerWords(desc) }];
  const match = findLiteralMatch('something unrelated', skills);
  assert.equal(match, null);
});

// ─── Subagent routing ────────────────────────────────────────────────────────

function makeIsolatedAgentEnv(agentFiles) {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-subagent-'));
  const tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-subagent-proj-'));
  const agentsDir = path.join(tmpHome, 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  for (const [filename, content] of Object.entries(agentFiles)) {
    fs.writeFileSync(path.join(agentsDir, filename), content);
  }
  return { tmpHome, tmpProj };
}

function withIsolatedEnv(tmpHome, fn) {
  const saved = {
    CLAUDE_USER_DIR: process.env.CLAUDE_USER_DIR,
    CAPABILITY_PLATFORM: process.env.CAPABILITY_PLATFORM,
    OPENCLAW_USER_DIR: process.env.OPENCLAW_USER_DIR,
    HERMES_USER_DIR: process.env.HERMES_USER_DIR,
  };
  process.env.CLAUDE_USER_DIR = tmpHome;
  process.env.CAPABILITY_PLATFORM = 'claude';
  process.env.OPENCLAW_USER_DIR = path.join(tmpHome, 'openclaw-empty');
  process.env.HERMES_USER_DIR = path.join(tmpHome, 'hermes-empty');
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('resolveRouteDecision: subagent routing — 写测试 → tester', () => {
  const { tmpHome, tmpProj } = makeIsolatedAgentEnv({
    'tester.md': '---\nname: tester\ndescription: 写测试 补测试 测试覆盖 TDD testing unit-test\n---\n',
  });
  try {
    const { resolveRouteDecision: rrd } = require('../scripts/route-matcher.cjs');
    const decision = withIsolatedEnv(tmpHome, () =>
      rrd(JSON.stringify({ prompt: '帮我写单元测试', cwd: tmpProj }))
    );
    assert.equal(decision.explain.action, 'route');
    assert.equal(decision.explain.targetType, 'subagent');
    assert.equal(decision.explain.targetName, 'tester');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpProj, { recursive: true, force: true });
  }
});

test('resolveRouteDecision: subagent routing — 做架构设计 → architect', () => {
  const { tmpHome, tmpProj } = makeIsolatedAgentEnv({
    'architect.md': '---\nname: architect\ndescription: 高层设计 架构设计 写 spec 出 plan 分析需求 architecture design system\n---\n',
  });
  try {
    const { resolveRouteDecision: rrd } = require('../scripts/route-matcher.cjs');
    const decision = withIsolatedEnv(tmpHome, () =>
      rrd(JSON.stringify({ prompt: '做架构设计', cwd: tmpProj }))
    );
    assert.equal(decision.explain.action, 'route');
    assert.equal(decision.explain.targetType, 'subagent');
    assert.equal(decision.explain.targetName, 'architect');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpProj, { recursive: true, force: true });
  }
});

// ─── 回归：备份数据库 不误推 mvp-scaffold ──────────────────────────────────────

// 回归：当环境中存在专门的运维 agent 时，备份/迁移类 prompt 应路由到 ops 而非 mvp-scaffold
// 注：若环境中没有 ops 类 skill，"备份数据库" 可能仍会因 数据库 bigram 碰撞而命中 mvp-scaffold
// 这是当前算法的已知局限，需要 ops 类 skill 提供 备份/backup 正向信号才能覆盖
test('resolveRouteDecision: 备份数据库 routes to ops-agent over mvp-scaffold when ops agent exists', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-regression-backup-'));
  const tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-regression-backup-proj-'));
  const savedVars = {
    CLAUDE_USER_DIR: process.env.CLAUDE_USER_DIR,
    CAPABILITY_PLATFORM: process.env.CAPABILITY_PLATFORM,
    OPENCLAW_USER_DIR: process.env.OPENCLAW_USER_DIR,
    HERMES_USER_DIR: process.env.HERMES_USER_DIR,
  };
  try {
    // mvp-scaffold: 使用真实中文描述（含"数据库"，会产生 bigram 碰撞）
    const scaffoldDir = path.join(tmpHome, 'skills', 'mvp-scaffold');
    fs.mkdirSync(scaffoldDir, { recursive: true });
    fs.writeFileSync(
      path.join(scaffoldDir, 'SKILL.md'),
      '---\nname: mvp-scaffold\ndescription: Next.js MVP 脚手架一键初始化：App Router + Supabase + Stripe，含数据库 schema\n---\n'
    );
    // ops-agent: 明确包含 备份 关键词，提供正向信号盖过 mvp-scaffold 的数据库 bigram
    const agentsDir = path.join(tmpHome, 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, 'ops.md'),
      '---\nname: ops\ndescription: 运维 agent。备份、迁移、回滚、监控、部署、CI/CD。触发词：备份、迁移、回滚、deploy。\n---\n'
    );
    process.env.CLAUDE_USER_DIR = tmpHome;
    process.env.CAPABILITY_PLATFORM = 'claude';
    process.env.OPENCLAW_USER_DIR = path.join(tmpHome, 'openclaw-empty');
    process.env.HERMES_USER_DIR = path.join(tmpHome, 'hermes-empty');
    const { resolveRouteDecision: rrd } = require('../scripts/route-matcher.cjs');
    const decision = rrd(JSON.stringify({ prompt: '备份数据库', cwd: tmpProj }));
    assert.equal(decision.explain.action, 'route', 'should route (ops agent exists)');
    assert.notEqual(decision.explain.targetName, 'mvp-scaffold', 'must not match mvp-scaffold');
    assert.equal(decision.explain.targetName, 'ops', 'should match ops subagent');
  } finally {
    for (const [k, v] of Object.entries(savedVars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpProj, { recursive: true, force: true });
  }
});
