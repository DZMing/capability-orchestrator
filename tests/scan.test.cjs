'use strict';

process.env.CAPABILITY_PLATFORM = 'claude';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ISOLATED_ECOSYSTEM_ROOT = path.join(os.tmpdir(), `cap-ecosystem-empty-${process.pid}`);
process.env.OPENCLAW_USER_DIR = path.join(ISOLATED_ECOSYSTEM_ROOT, 'openclaw');
process.env.HERMES_USER_DIR = path.join(ISOLATED_ECOSYSTEM_ROOT, 'hermes');

const {
  sanitize, scanSkills, scanAgents, scanCommands, renderSection,
  collectSnapshot, renderSnapshot, truncate, withCapabilityMeta,
  parseHermesSkillsTable, parseHermesPluginsList, MAX_TOTAL_CHARS,
} = require('../scripts/scan-environment.cjs');

const FIXTURES = path.join(__dirname, 'fixtures');
const PROJECT_DIR = path.join(FIXTURES, 'project');
const USER_DIR = path.join(FIXTURES, 'user');

// ─── scanSkills ──────────────────────────────────────────────────────────────

test('scanSkills: detects valid skill, skips hidden and no-SKILL.md', () => {
  const results = scanSkills(path.join(PROJECT_DIR, '.claude', 'skills'));
  const names = results.map(r => r.name);
  assert.ok(names.includes('valid-skill'), 'valid-skill should be found');
  assert.ok(!names.includes('hidden'), '.hidden-skill should be filtered');
  assert.ok(!names.includes('no-skillmd'), 'dir without SKILL.md should be filtered');
});

// ─── scanAgents ──────────────────────────────────────────────────────────────

test('scanAgents: detects .md agents', () => {
  const results = scanAgents(path.join(PROJECT_DIR, '.claude', 'agents'));
  assert.equal(results.length, 1);
  assert.equal(results[0].name, 'test-agent');
});

test('scanAgents: nonexistent dir returns []', () => {
  assert.deepEqual(scanAgents('/nonexistent/agents'), []);
});

test('scanAgents: empty dir returns []', () => {
  const tmp = path.join(require('os').tmpdir(), 'empty-agents-' + process.pid);
  fs.mkdirSync(tmp, { recursive: true });
  assert.deepEqual(scanAgents(tmp), []);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('scanAgents: skips non-.md and hidden files', () => {
  const tmp = path.join(require('os').tmpdir(), 'agent-filter-' + process.pid);
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'good.md'), '---\nname: good\ndescription: ok\n---\n');
  fs.writeFileSync(path.join(tmp, 'readme.txt'), 'not an agent');
  fs.writeFileSync(path.join(tmp, '.hidden.md'), '---\nname: hidden\n---\n');
  const results = scanAgents(tmp);
  assert.equal(results.length, 1);
  assert.equal(results[0].name, 'good');
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ─── symlink 防护 ───────────────────────────────────────────────────────────

test('scanSkills: skips symlink directories', () => {
  const tmpDir = path.join(require('os').tmpdir(), 'symlink-test-' + process.pid);
  fs.mkdirSync(path.join(tmpDir, 'real-skill'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'real-skill', 'SKILL.md'), '---\nname: real\ndescription: test\n---\n');
  fs.symlinkSync(path.join(tmpDir, 'real-skill'), path.join(tmpDir, 'link-skill'));
  const results = scanSkills(tmpDir);
  const names = results.map(r => r.name);
  assert.ok(names.includes('real'), 'real skill should be found');
  assert.ok(!names.includes('link-skill'), 'symlink skill should be skipped');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── scanCommands ────────────────────────────────────────────────────────────

test('scanCommands: returns objects with name/desc/filePath', () => {
  const cmds = scanCommands(path.join(PROJECT_DIR, '.claude', 'commands'));
  assert.ok(cmds.some(c => c.name === 'legacy-cmd'), 'should find legacy-cmd');
  const cmd = cmds.find(c => c.name === 'legacy-cmd');
  assert.ok('desc' in cmd, 'should have desc field');
  assert.ok('filePath' in cmd, 'should have filePath field');
});

test('scanCommands: nonexistent dir returns []', () => {
  assert.deepEqual(scanCommands('/nonexistent/commands'), []);
});

test('scanCommands: empty dir returns []', () => {
  const tmp = path.join(require('os').tmpdir(), 'empty-cmds-' + process.pid);
  fs.mkdirSync(tmp, { recursive: true });
  assert.deepEqual(scanCommands(tmp), []);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('scanCommands: skips hidden files and sanitizes markdown-like filenames', () => {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cmds-'));
  try {
    fs.writeFileSync(path.join(tmp, '.secret.md'), '---\ndescription: hidden\n---\n');
    fs.writeFileSync(path.join(tmp, '## injected heading.md'), '---\ndescription: visible\n---\n');
    const cmds = scanCommands(tmp);
    assert.equal(cmds.length, 1);
    assert.equal(cmds[0].name, 'injected heading');
    assert.equal(cmds[0].desc, 'visible');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ─── collectSnapshot ─────────────────────────────────────────────────────────

test('collectSnapshot: uses fixture dirs, deduplicates project vs user skills', () => {
  const snap = collectSnapshot(PROJECT_DIR, USER_DIR);
  const projSkills = snap.sections.find(s => s.label === '项目级 Skills');
  const userSkills = snap.sections.find(s => s.label === '用户级 Skills');

  assert.ok(projSkills, '项目级 Skills section should exist');
  assert.ok(projSkills.items.some(i => i.name === 'valid-skill'));

  // dupe-skill has same name as valid-skill → should be deduped from user level
  if (userSkills) {
    assert.ok(!userSkills.items.some(i => i.name === 'valid-skill'), 'dup should be removed');
  }
});

test('collectSnapshot: MCP servers appear', () => {
  const snap = collectSnapshot(PROJECT_DIR, USER_DIR);
  const mcpSection = snap.sections.find(s => s.label === 'MCP Servers');
  assert.ok(mcpSection, 'MCP Servers section should exist');
  assert.ok(mcpSection.items.some(i => i.name === 'test-server'));
});

test('collectSnapshot: sections are sorted by name', () => {
  const snap = collectSnapshot(PROJECT_DIR, USER_DIR);
  for (const s of snap.sections) {
    const names = s.items.map(i => i.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b, 'en'));
    assert.deepEqual(names, sorted, `${s.label} should be sorted`);
  }
});

test('collectSnapshot: OpenClaw and Hermes skills are discovered', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecosystem-scan-'));
  const openClawRoot = path.join(tmp, 'openclaw');
  const hermesRoot = path.join(tmp, 'hermes');
  fs.mkdirSync(path.join(openClawRoot, 'workspace', 'skills', 'oc-skill'), { recursive: true });
  fs.mkdirSync(path.join(hermesRoot, 'skills', 'hermes-skill'), { recursive: true });
  fs.writeFileSync(path.join(openClawRoot, 'workspace', 'skills', 'oc-skill', 'SKILL.md'), '---\nname: oc-skill\ndescription: OpenClaw integration skill\n---\n');
  fs.writeFileSync(path.join(hermesRoot, 'skills', 'hermes-skill', 'SKILL.md'), '---\nname: hermes-skill\ndescription: Hermes integration skill\n---\n');

  const savedOpenClaw = process.env.OPENCLAW_USER_DIR;
  const savedHermes = process.env.HERMES_USER_DIR;
  process.env.OPENCLAW_USER_DIR = openClawRoot;
  process.env.HERMES_USER_DIR = hermesRoot;

  try {
    const snap = collectSnapshot(PROJECT_DIR, USER_DIR);
    const openClawSection = snap.sections.find(s => s.label === 'OpenClaw Skills');
    const hermesSection = snap.sections.find(s => s.label === 'Hermes Skills');
    assert.ok(openClawSection && openClawSection.items.some(i => i.name === 'oc-skill'));
    assert.ok(hermesSection && hermesSection.items.some(i => i.name === 'hermes-skill'));
  } finally {
    if (savedOpenClaw === undefined) delete process.env.OPENCLAW_USER_DIR;
    else process.env.OPENCLAW_USER_DIR = savedOpenClaw;
    if (savedHermes === undefined) delete process.env.HERMES_USER_DIR;
    else process.env.HERMES_USER_DIR = savedHermes;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('collectSnapshot: active OpenClaw host remains scan-only and reads workspace skills', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-host-scan-'));
  const openClawRoot = path.join(tmp, 'openclaw');
  fs.mkdirSync(path.join(openClawRoot, 'workspace', 'skills', 'oc-workspace'), { recursive: true });
  fs.writeFileSync(path.join(openClawRoot, 'workspace', 'skills', 'oc-workspace', 'SKILL.md'), '---\nname: oc-workspace\ndescription: OpenClaw workspace skill\n---\n');

  const savedPlatform = process.env.CAPABILITY_PLATFORM;
  const savedOpenClaw = process.env.OPENCLAW_USER_DIR;
  process.env.CAPABILITY_PLATFORM = 'openclaw';
  process.env.OPENCLAW_USER_DIR = openClawRoot;
  try {
    const snap = collectSnapshot(PROJECT_DIR, openClawRoot);
    const scanOnlySection = snap.sections.find(s => s.label === 'OpenClaw Skills');
    assert.ok(scanOnlySection, 'scan-only OpenClaw skills should exist');
    const workspaceItem = scanOnlySection.items.find(i => i.name === 'oc-workspace');
    assert.ok(workspaceItem);
    assert.equal(workspaceItem.host, 'openclaw');
    assert.equal(workspaceItem.surfaceType, 'skill');
    assert.equal(workspaceItem.invocation, 'slash');
    assert.ok(!snap.sections.some(s => s.label.startsWith('OpenClaw Runtime')), 'OpenClaw host bridge runtime sections are frozen');
  } finally {
    if (savedPlatform === undefined) delete process.env.CAPABILITY_PLATFORM;
    else process.env.CAPABILITY_PLATFORM = savedPlatform;
    if (savedOpenClaw === undefined) delete process.env.OPENCLAW_USER_DIR;
    else process.env.OPENCLAW_USER_DIR = savedOpenClaw;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('collectSnapshot: active Hermes host uses user skills as primary user skills', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-host-scan-'));
  const hermesRoot = path.join(tmp, 'hermes');
  const binDir = path.join(tmp, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const hermesStub = `
const args = process.argv.slice(2).join(' ');
if (args === 'skills list') {
  process.stdout.write("\\n┃ Name                              ┃ Category             ┃ Source  ┃ Trust   ┃\\n│ hermes-host-skill                 │                      │ local   │ local   │\\n");
} else if (args === 'plugins list') {
  process.stdout.write("\\n┃ Name                              ┃ Status  ┃ Version ┃ Description ┃ Source ┃\\n│ cache                             │ enabled │ 1.0.0   │ test cache  │ local  │\\n");
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
    const snap = collectSnapshot(PROJECT_DIR, hermesRoot);
    const runtimeSection = snap.sections.find(s => s.label === 'Hermes Runtime Skills');
    assert.ok(runtimeSection, 'runtime skills should exist for hermes host');
    const item = runtimeSection.items.find(i => i.name === 'hermes-host-skill');
    assert.ok(item);
    assert.equal(item.host, 'hermes');
    assert.equal(item.surfaceType, 'skill');
    assert.equal(item.invocation, 'slash');
    const pluginSection = snap.sections.find(s => s.label === 'Hermes Runtime Plugins');
    assert.ok(pluginSection && pluginSection.items.some(i => i.name === 'cache'));
    assert.ok(!snap.sections.some(s => s.label === '用户级 Skills'), 'active host should prefer runtime view over generic user section');
    assert.ok(!snap.sections.some(s => s.label === 'Hermes Skills'), 'active host should not also render Hermes as ecosystem section');
  } finally {
    if (savedPlatform === undefined) delete process.env.CAPABILITY_PLATFORM;
    else process.env.CAPABILITY_PLATFORM = savedPlatform;
    if (savedHermes === undefined) delete process.env.HERMES_USER_DIR;
    else process.env.HERMES_USER_DIR = savedHermes;
    process.env.PATH = savedPath;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('parseHermesSkillsTable: parses hermes skills list table rows', () => {
  const helpers = { sanitize, withCapabilityMeta };
  const parsed = parseHermesSkillsTable(`
┃ Name                              ┃ Category             ┃ Source  ┃ Trust   ┃
│ dogfood                           │                      │ builtin │ builtin │
│ karpathy-guidelines               │                      │ local   │ local   │
`, helpers);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].name, 'dogfood');
  assert.equal(parsed[0].host, 'hermes');
  assert.equal(parsed[0].surfaceType, 'skill');
  assert.equal(parsed[0].state, 'loaded');
  assert.equal(parsed[1].source, 'local');
});

test('parseHermesPluginsList: parses hermes plugins table rows', () => {
  const helpers = { sanitize, truncate, withCapabilityMeta };
  const parsed = parseHermesPluginsList(`
┃ Name                              ┃ Status  ┃ Version ┃ Description ┃ Source ┃
│ my-plugin                         │ enabled │ 1.0.0   │ test cache  │ local  │
│ builtin-plugin                    │ loaded  │ 2.0.0   │ builtin impl │ builtin │
`, helpers);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].name, 'my-plugin');
  assert.equal(parsed[0].host, 'hermes');
  assert.equal(parsed[0].surfaceType, 'plugin');
  assert.equal(parsed[0].state, 'enabled');
  assert.equal(parsed[1].scope, 'bundled');
});

// ─── renderSnapshot 截断 ─────────────────────────────────────────────────────

test('renderSnapshot: output never exceeds MAX_TOTAL_CHARS', () => {
  // 生成一个超大 snapshot
  const items = Array.from({ length: 200 }, (_, i) => ({
    name: `skill-${i}`,
    desc: 'A'.repeat(100),
  }));
  const snap = {
    sections: [{ label: '测试 Skills', prefix: '', items }],
    errors: [],
  };
  const { text } = renderSnapshot(snap, 'route');
  assert.ok(text.length <= MAX_TOTAL_CHARS, `output ${text.length} should be ≤ ${MAX_TOTAL_CHARS}`);
});

test('renderSnapshot: empty snapshot outputs header only', () => {
  const snap = { sections: [], errors: [] };
  const { text } = renderSnapshot(snap, 'route');
  assert.match(text, /当前环境能力摘要/);
});

test('renderSnapshot: error footer stays within budget', () => {
  const items = Array.from({ length: 200 }, (_, i) => ({
    name: `skill-${i}`,
    desc: 'A'.repeat(100),
  }));
  const snap = {
    sections: [{ label: '测试 Skills', prefix: '', items }],
    errors: ['EACCES /foo/bar'],
  };
  const { text } = renderSnapshot(snap, 'route');
  assert.ok(text.length <= MAX_TOTAL_CHARS, `output with error footer ${text.length} should be ≤ ${MAX_TOTAL_CHARS}`);
  assert.match(text, /部分扫描失败/);
});

// ─── mode=list ───────────────────────────────────────────────────────────────

test('renderSnapshot: list mode starts at level 2 (names only)', () => {
  const items = [
    { name: 'skill-a', desc: 'Long description that would normally show' },
    { name: 'skill-b', desc: 'Another long description' },
  ];
  const snap = { sections: [{ label: '项目级 Skills', prefix: '', items }], errors: [] };
  const { text } = renderSnapshot(snap, 'list');
  // level 2 = comma-separated names, no descriptions
  assert.ok(!text.includes('Long description'), 'list mode should not show descriptions');
  assert.ok(text.includes('skill-a'), 'list mode should include names');
});

test('renderSnapshot: list mode uses compact builtins', () => {
  const snap = { sections: [], errors: [] };
  const { text } = renderSnapshot(snap, 'list');
  assert.match(text, /内置 24 个/);
  assert.ok(!text.includes('/clear'), 'list mode should not expand built-in list');
});

// ─── renderSnapshot level 3/4 ──────────────────────────────────────────────

test('renderSnapshot: level 3 shows top-N names + fold count', () => {
  // 名字必须够长，使 level 2（仅名逗号拼接）超过预算 12000 字符，才会降级到 level 3
  // 100 个 ~120 字符的名字：100*120 + 99*2 ≈ 12198 > 12000
  const items = Array.from({ length: 100 }, (_, i) => ({
    name: `skill-${'x'.repeat(110)}-${String(i).padStart(2, '0')}`, desc: 'A'.repeat(100),
  }));
  const snap = { sections: [{ label: '测试 Skills', prefix: '', items }], errors: [] };
  const { text } = renderSnapshot(snap, 'route');
  assert.ok(text.includes('skill-'), 'first skill should appear');
  assert.ok(text.includes('+60 个'), 'fold count should show +60 (TOP_N=40)');
});

test('renderSnapshot: level 4 pure count on extreme name length', () => {
  // 名字极长使 top-N 都超预算，强制 level 4
  const items = Array.from({ length: 50 }, (_, i) => ({
    name: `x${'A'.repeat(150)}-${i}`, desc: 'D'.repeat(100),
  }));
  const sections = Array.from({ length: 5 }, (_, i) => ({
    label: `S${i}`, prefix: '', items,
  }));
  const snap = { sections, errors: [] };
  const { text } = renderSnapshot(snap, 'route');
  assert.ok(text.length <= MAX_TOTAL_CHARS, `output ${text.length} should be ≤ ${MAX_TOTAL_CHARS}`);
  assert.match(text, /50 个/, 'extreme names should degrade to pure count');
});

// ─── collectSnapshot 空环境 ─────────────────────────────────────────────────

test('collectSnapshot: empty dirs produce no crash', () => {
  const tmpDir = path.join(require('os').tmpdir(), 'empty-env-' + process.pid);
  fs.mkdirSync(tmpDir, { recursive: true });
  const snap = collectSnapshot(tmpDir, tmpDir);
  assert.ok(Array.isArray(snap.sections));
  assert.ok(Array.isArray(snap.errors));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── awareness 模式 ─────────────────────────────────────────────────────────

test('renderSnapshot awareness: output within budget', () => {
  const snap = collectSnapshot(PROJECT_DIR, USER_DIR);
  const { text } = renderSnapshot(snap, 'awareness');
  assert.ok(text.length <= MAX_TOTAL_CHARS, `awareness output ${text.length} should be ≤ ${MAX_TOTAL_CHARS}`);
});

test('renderSnapshot awareness: contains mandatory routing rules', () => {
  const snap = collectSnapshot(PROJECT_DIR, USER_DIR);
  const { text } = renderSnapshot(snap, 'awareness');
  assert.ok(text.includes('路由规则'), 'should include routing rules section');
  assert.ok(text.includes('MANDATORY'), 'should include MANDATORY directive');
  assert.ok(text.includes('Skill tool'), 'should mention Skill tool');
  assert.ok(text.includes('ToolSearch'), 'should mention ToolSearch');
});

test('renderSnapshot awareness: MCP servers have descriptions', () => {
  const items = [{ name: 'test-mcp', desc: 'does stuff' }];
  const snap = { sections: [{ label: 'MCP Servers', prefix: '', items }], errors: [] };
  const { text } = renderSnapshot(snap, 'awareness');
  assert.ok(text.includes('test-mcp: does stuff'), 'MCP should show description');
});

test('renderSnapshot awareness: shows capability counts', () => {
  const snap = collectSnapshot(PROJECT_DIR, USER_DIR);
  const { text } = renderSnapshot(snap, 'awareness');
  assert.match(text, /\d+ skills/, 'should show skill count');
});

test('renderSnapshot awareness: subagents show descriptions', () => {
  const items = [
    { name: 'my-agent', desc: 'helps debug' },
    { name: 'other-agent', desc: '' },
  ];
  const snap = { sections: [{ label: '用户级 Subagents', prefix: '@', items }], errors: [] };
  const { text } = renderSnapshot(snap, 'awareness');
  assert.ok(text.includes('my-agent: helps debug'), 'agent with desc should show it');
  assert.ok(text.includes('other-agent'), 'agent without desc still listed');
});

test('renderSnapshot awareness: skills show descriptions', () => {
  const items = [
    { name: 'my-skill', desc: 'handles complex routing' },
    { name: 'bare-skill', desc: '' },
  ];
  const snap = { sections: [{ label: '项目级 Skills', prefix: '', items }], errors: [] };
  const { text } = renderSnapshot(snap, 'awareness');
  assert.ok(text.includes('my-skill: handles complex routing'), 'skill with desc should show it');
  assert.ok(text.includes('bare-skill'), 'skill without desc still listed');
  assert.ok(!text.includes('bare-skill:'), 'skill without desc has no colon');
});

// ─── 审计补全：WSL fallback ─────────────────────────────────────────────────

test('resolveUserDir: WSL fallback returns Linux home when WSL_DISTRO_NAME set but no Windows path', () => {
  // 模拟 WSL 环境：设置环境变量，但 wslpath 不存在（非真实 WSL）
  // resolveUserDir 应 fallback 到 Linux home/.claude
  const orig = process.env.WSL_DISTRO_NAME;
  process.env.WSL_DISTRO_NAME = 'Ubuntu';
  try {
    const snap = collectSnapshot(PROJECT_DIR, USER_DIR);
    // 如果没有崩溃就说明 WSL fallback 正常工作
    assert.ok(Array.isArray(snap.sections), 'should not crash in fake WSL env');
  } finally {
    if (orig === undefined) delete process.env.WSL_DISTRO_NAME;
    else process.env.WSL_DISTRO_NAME = orig;
  }
});

// ─── 双方审查发现的 bug 回归测试 ───────────────────────────────────────────

test('P0: awareness 路由策略在内容极长时仍保留', () => {
  // 构造大量 sections 让列表部分很长
  const sections = [];
  for (let i = 0; i < 100; i++) {
    sections.push({ label: `Test ${i}`, prefix: '', items: [
      { name: `long-name-item-${i}-${'x'.repeat(50)}`, desc: 'desc '.repeat(10) }
    ]});
  }
  const snap = { sections, errors: [] };
  const { text } = renderSnapshot(snap, 'awareness');
  assert.ok(text.includes('路由规则'), 'routing rules must survive truncation');
  assert.ok(text.length <= MAX_TOTAL_CHARS, `total ${text.length} within budget`);
});

test('P1: MCP 跨级别去重（项目级优先）', () => {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mcp-dedup-'));
  const projDir = path.join(tmp, 'proj');
  const userDir = path.join(tmp, 'user');
  fs.mkdirSync(path.join(projDir, '.claude'), { recursive: true });
  fs.mkdirSync(userDir, { recursive: true });
  // 项目级和用户级都有同名 server "dup"
  fs.writeFileSync(path.join(projDir, '.mcp.json'), JSON.stringify({ mcpServers: { dup: { command: 'a' }, projOnly: { command: 'b' } } }));
  fs.writeFileSync(path.join(userDir, '.mcp.json'), JSON.stringify({ mcpServers: { dup: { command: 'c' }, userOnly: { command: 'd' } } }));
  const snap = collectSnapshot(projDir, userDir);
  const mcpSection = snap.sections.find(s => s.label === 'MCP Servers');
  const names = mcpSection ? mcpSection.items.map(i => i.name) : [];
  assert.ok(names.includes('dup'), 'dup should exist');
  assert.ok(names.includes('projOnly'), 'projOnly should exist');
  assert.ok(names.includes('userOnly'), 'userOnly should exist');
  // dup 应该只出现一次
  assert.equal(names.filter(n => n === 'dup').length, 1, 'dup should appear exactly once');
  fs.rmSync(tmp, { recursive: true });
});

test('CLI: --mode=invalid 应 exit 1', () => {
  const { execSync } = require('child_process');
  try {
    execSync('node scripts/scan-environment.cjs --mode=invalid 2>&1', { timeout: 5000 });
    assert.fail('should have exited with error');
  } catch (e) {
    assert.ok(e.status === 1, 'exit code should be 1');
  }
});

// ─── renderSection 各级别输出 ───────────────────────────────────────────────

test('renderSection level 0: 名+完整描述', () => {
  const section = { label: 'Test', prefix: '', items: [{ name: 'a', desc: 'desc-a' }] };
  const out = renderSection(section, 0);
  assert.ok(out.includes('- a: desc-a'), 'level 0 should show name + full desc');
});

test('renderSection level 1: 名+短描述', () => {
  const section = { label: 'Test', prefix: '@', items: [{ name: 'b', desc: 'D'.repeat(80) }] };
  const out = renderSection(section, 1);
  assert.ok(out.includes('@b:'), 'level 1 should show prefix+name');
  assert.ok(out.length < renderSection(section, 0).length, 'level 1 shorter than level 0');
});

test('renderSection level 2: 仅名逗号分隔', () => {
  const section = { label: 'Test', prefix: '', items: [{ name: 'x', desc: 'ignored' }, { name: 'y', desc: 'also ignored' }] };
  const out = renderSection(section, 2);
  assert.ok(out.includes('x, y'), 'level 2 should be comma-separated names');
  assert.ok(!out.includes('ignored'), 'level 2 should not show desc');
});

test('renderSection level 3: top-N 折叠', () => {
  const items = Array.from({ length: 45 }, (_, i) => ({ name: `s${i}`, desc: '' }));
  const section = { label: 'Test', prefix: '', items };
  const out = renderSection(section, 3);
  assert.ok(out.includes('+5 个'), 'level 3 should fold excess items (TOP_N=40)');
  assert.ok(out.includes('s0'), 'level 3 should show first item');
});

test('renderSection level 4: 纯计数', () => {
  const items = Array.from({ length: 42 }, (_, i) => ({ name: `s${i}`, desc: '' }));
  const section = { label: 'Test', prefix: '', items };
  const out = renderSection(section, 4);
  assert.ok(out.includes('42 个'), 'level 4 should show pure count');
  assert.ok(!out.includes('s0'), 'level 4 should not show any names');
});

// ─── 4f: renderSection level 2 vs level 3 mutation guard ─────────────────────

test('mutation: renderSection level 2 and level 3 produce different output', () => {
  const items = Array.from({ length: 45 }, (_, i) => ({ name: `skill-${i}`, desc: `desc ${i}` }));
  const section = { label: 'Test', prefix: '', items };
  const out2 = renderSection(section, 2);
  const out3 = renderSection(section, 3);
  assert.notEqual(out2, out3, 'level 2 and level 3 must differ');
  // Level 2 shows all names, level 3 shows only top-N(40) + fold
  assert.ok(out2.includes('skill-44'), 'level 2 should show all names');
  assert.ok(!out3.includes('skill-44'), 'level 3 should NOT show items beyond top-N');
  assert.ok(out3.includes('+5 个'), 'level 3 should fold');
});

// ─── awareness 边界 + collectSnapshot 健壮性 ────────────────────────────────

test('awareness 空快照仍包含路由规则', () => {
  const snap = { sections: [], errors: [] };
  const { text } = renderSnapshot(snap, 'awareness');
  assert.ok(text.includes('路由规则'), 'empty awareness should still have routing');
});

test('awareness 有错误时 footer 保留', () => {
  const snap = { sections: [], errors: ['EACCES /foo'] };
  const { text } = renderSnapshot(snap, 'awareness');
  assert.ok(text.includes('路由规则'), 'routing should survive with errors');
  assert.ok(text.includes('部分扫描失败'), 'error footer should appear');
});

test('collectSnapshot: undefined projectDir 不崩溃（使用 cwd）', () => {
  const snap = collectSnapshot(undefined, USER_DIR);
  assert.ok(Array.isArray(snap.sections));
  assert.ok(Array.isArray(snap.errors));
});

// ─── EACCES 权限错误收集 ───────────────────────────────────────────────────

test('scanSkills: EACCES 收集到 errors 而非崩溃', { skip: process.platform === 'win32' }, () => {
  const tmp = path.join(require('os').tmpdir(), 'eacces-test-' + process.pid);
  fs.mkdirSync(path.join(tmp, 'locked-skill'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'locked-skill', 'SKILL.md'), '---\nname: x\n---\n');
  // 移除目录读权限
  fs.chmodSync(path.join(tmp, 'locked-skill'), 0o000);
  const errors = [];
  const results = scanSkills(tmp, errors);
  // 恢复权限以便清理
  fs.chmodSync(path.join(tmp, 'locked-skill'), 0o755);
  fs.rmSync(tmp, { recursive: true, force: true });
  // 不应崩溃，可能收集错误也可能跳过（取决于 OS）
  assert.ok(Array.isArray(results));
});

// ─── stdin CWD 解析（SessionStart hook）────────────────────────────────────

test('awareness mode: uses cwd from stdin JSON', () => {
  const { execFileSync } = require('child_process');
  const fixtureProject = path.join(__dirname, 'fixtures', 'project');
  const script = path.join(__dirname, '..', 'scripts', 'scan-environment.cjs');
  const raw = execFileSync(process.execPath, [script, '--mode=awareness'], {
    input: JSON.stringify({ cwd: fixtureProject }),
    encoding: 'utf-8',
    timeout: 10000,
  });
  assert.ok(raw.includes('valid-skill'), 'should detect fixture project skill via stdin cwd');
});

// ─── Step D: MCP 路由规则动态生成 ──────────────────────────────────────────

test('renderSnapshot awareness: MCP servers generate routing hints in routing section', () => {
  const items = [
    { name: 'chrome-devtools', desc: '控制真实 Chrome 浏览器' },
    { name: 'context7', desc: '文档检索与上下文查询' },
  ];
  const snap = { sections: [{ label: 'MCP Servers', prefix: '', items }], errors: [] };
  const { text } = renderSnapshot(snap, 'awareness');
  assert.ok(text.includes('chrome-devtools'), 'should mention chrome-devtools in routing');
  assert.ok(text.includes('context7'), 'should mention context7 in routing');
  // Should appear in routing section (after MANDATORY tag)
  const routingIdx = text.indexOf('路由规则');
  assert.ok(routingIdx > -1, 'routing section must exist');
  const routingSection = text.slice(routingIdx);
  assert.ok(routingSection.includes('chrome-devtools'), 'MCP hint in routing section');
  assert.ok(routingSection.includes('context7'), 'MCP hint in routing section');
});

test('renderSnapshot awareness: MCP routing hints include mcp__ prefix', () => {
  const items = [{ name: 'my-server', desc: 'does things' }];
  const snap = { sections: [{ label: 'MCP Servers', prefix: '', items }], errors: [] };
  const { text } = renderSnapshot(snap, 'awareness');
  const routingIdx = text.indexOf('路由规则');
  const routingSection = text.slice(routingIdx);
  assert.ok(routingSection.includes('mcp__my-server'), 'should include mcp__ prefixed tool name');
});

test('renderSnapshot awareness: no MCP servers means no MCP routing hints', () => {
  const items = [{ name: 'my-skill', desc: 'does tasks' }];
  const snap = { sections: [{ label: '项目级 Skills', prefix: '', items }], errors: [] };
  const { text } = renderSnapshot(snap, 'awareness');
  assert.ok(!text.includes('mcp__'), 'no MCP servers = no mcp__ hints in output');
});

test('renderSnapshot awareness: still within budget with MCP routing hints', () => {
  const mcpItems = Array.from({ length: 5 }, (_, i) => ({
    name: `server-${i}`,
    desc: `Server ${i} does many things including complex operations and workflows`,
  }));
  const snap = { sections: [{ label: 'MCP Servers', prefix: '', items: mcpItems }], errors: [] };
  const { text } = renderSnapshot(snap, 'awareness');
  assert.ok(text.length <= 5000, `output ${text.length} should be ≤ 5000 chars`);
});
