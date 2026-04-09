'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const {
  extractFrontmatter, getDescription,
  scanSkills, scanAgents, scanCommands, readMcpServers,
  collectSnapshot, renderSnapshot, truncate,
} = require('../scripts/scan-environment.cjs');

const FIXTURES = path.join(__dirname, 'fixtures');
const PROJECT_DIR = path.join(FIXTURES, 'project');
const USER_DIR = path.join(FIXTURES, 'user');

// ─── extractFrontmatter ──────────────────────────────────────────────────────

test('extractFrontmatter: plain scalar', () => {
  const fm = extractFrontmatter('---\nname: my-skill\ndescription: Simple\n---\n');
  assert.equal(fm.name, 'my-skill');
  assert.equal(fm.description, 'Simple');
});

test('extractFrontmatter: quoted scalar', () => {
  const content = fs.readFileSync(path.join(FIXTURES, 'frontmatter-quoted.md'), 'utf8');
  const fm = extractFrontmatter(content);
  assert.equal(fm.name, 'quoted-name');
  assert.equal(fm.description, 'single quoted desc');
});

test('extractFrontmatter: block fold (>)', () => {
  const content = fs.readFileSync(path.join(FIXTURES, 'frontmatter-block-fold.md'), 'utf8');
  const fm = extractFrontmatter(content);
  assert.equal(fm.name, 'block-fold');
  assert.match(fm.description, /This is a folded/);
  // folded: newline → space
  assert.ok(!fm.description.includes('\n'), 'folded block should not have newlines');
});

test('extractFrontmatter: block literal (|)', () => {
  const content = fs.readFileSync(path.join(FIXTURES, 'frontmatter-block-literal.md'), 'utf8');
  const fm = extractFrontmatter(content);
  assert.equal(fm.name, 'block-literal');
  assert.match(fm.description, /Line one/);
  assert.match(fm.description, /Line two/);
  assert.ok(fm.description.includes('\n'), 'literal block should preserve newlines');
});

test('extractFrontmatter: UTF-8 BOM stripped', () => {
  const content = fs.readFileSync(path.join(FIXTURES, 'frontmatter-bom.md'));
  const fm = extractFrontmatter(content.toString('utf8'));
  assert.equal(fm.name, 'bom-test');
  assert.equal(fm.description, 'Has BOM');
});

test('extractFrontmatter: no frontmatter returns {}', () => {
  const content = fs.readFileSync(path.join(FIXTURES, 'frontmatter-none.md'), 'utf8');
  const fm = extractFrontmatter(content);
  assert.deepEqual(fm, {});
});

test('extractFrontmatter: null/empty returns {}', () => {
  assert.deepEqual(extractFrontmatter(null), {});
  assert.deepEqual(extractFrontmatter(''), {});
});

// ─── getDescription fallback ─────────────────────────────────────────────────

test('getDescription: fallback to first non-heading line', () => {
  const content = fs.readFileSync(path.join(FIXTURES, 'frontmatter-none.md'), 'utf8');
  const desc = getDescription(content);
  assert.ok(desc.length > 0);
  assert.ok(!desc.startsWith('#'));
});

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

// ─── scanCommands ────────────────────────────────────────────────────────────

test('scanCommands: returns command names without .md', () => {
  const cmds = scanCommands(path.join(PROJECT_DIR, '.claude', 'commands'));
  assert.ok(cmds.includes('legacy-cmd'));
});

// ─── readMcpServers ──────────────────────────────────────────────────────────

test('readMcpServers: reads mcpServers key', () => {
  const servers = readMcpServers(path.join(PROJECT_DIR, '.mcp.json'));
  assert.ok(servers.includes('test-server'));
});

test('readMcpServers: missing file returns []', () => {
  const servers = readMcpServers('/nonexistent/.mcp.json');
  assert.deepEqual(servers, []);
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
  assert.ok(text.length <= 3000, `output ${text.length} should be ≤ 3000`);
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
  assert.ok(text.length <= 3000, `output with error footer ${text.length} should be ≤ 3000`);
  assert.match(text, /部分扫描失败/);
});

// ─── truncate ────────────────────────────────────────────────────────────────

test('truncate: trims long strings with ellipsis', () => {
  const result = truncate('A'.repeat(200), 100);
  assert.ok(result.length <= 100);
  assert.ok(result.endsWith('…'));
});

test('truncate: leaves short strings unchanged', () => {
  assert.equal(truncate('hello', 100), 'hello');
});

test('truncate: handles null/empty', () => {
  assert.equal(truncate(null, 100), '');
  assert.equal(truncate('', 100), '');
});
