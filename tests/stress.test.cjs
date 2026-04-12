'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const {
  scanSkills, readMcpServers, scanInstalledPlugins,
} = require('../scripts/scan-environment.cjs');

const { extractKeywords, findBestMatch } = require('../scripts/route-matcher.cjs');

// ─── 5a: Large-scale skills performance ─────────────────────────────────────

test('stress: findBestMatch with 10000 skills completes in <500ms', () => {
  const skills = Array.from({ length: 10000 }, (_, i) => ({
    name: `skill-${i}`,
    desc: `description for skill number ${i} with keywords alpha beta gamma`,
  }));
  const prompt = 'I need help with alpha beta gamma delta epsilon';
  const start = performance.now();
  const match = findBestMatch(prompt, skills);
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 500, `should complete in <500ms, took ${elapsed.toFixed(1)}ms`);
  assert.ok(match, 'should find a match');
});

// ─── 5b: Very long prompt ───────────────────────────────────────────────────

test('stress: extractKeywords with 100KB prompt completes in <1s', () => {
  const cjkBlock = '调试代码错误分析报告'.repeat(2000);
  const enBlock = 'debug analyze review test deploy build compile run check verify '.repeat(500);
  const prompt = cjkBlock + enBlock;
  assert.ok(prompt.length > 50000, `prompt should be >50KB, got ${prompt.length}`);
  const start = performance.now();
  const kw = extractKeywords(prompt);
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 1000, `should complete in <1s, took ${elapsed.toFixed(1)}ms`);
  assert.ok(Array.isArray(kw), 'should return array');
  assert.ok(kw.length > 0, 'should extract keywords');
});

// ─── 5c: Deep nested plugin directories ─────────────────────────────────────

test('stress: findPluginRoots stops at maxDepth', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-stress-'));
  try {
    // Create 10-level deep nesting (well beyond MAX_PLUGIN_DEPTH=3)
    let current = tmpDir;
    for (let i = 0; i < 10; i++) {
      current = path.join(current, `level-${i}`);
      fs.mkdirSync(current);
    }
    // Put a plugin.json at the deepest level
    fs.mkdirSync(path.join(current, '.claude-plugin'));
    fs.writeFileSync(path.join(current, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'deep-plugin', version: '1.0.0' }));

    // scanInstalledPlugins uses maxDepth=3 internally
    // It should NOT find the deeply nested plugin
    const fakeUserDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-user-'));
    const cacheDir = path.join(fakeUserDir, 'plugins', 'cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    // Copy the deep structure into cache
    fs.renameSync(path.join(tmpDir, 'level-0'), path.join(cacheDir, 'level-0'));

    const plugins = scanInstalledPlugins(fakeUserDir, []);
    const names = plugins.map(p => p.name);
    assert.ok(!names.includes('deep-plugin'),
      'should NOT find plugin beyond maxDepth');

    fs.rmSync(fakeUserDir, { recursive: true, force: true });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── 5d: Malformed SKILL.md files ───────────────────────────────────────────

test('stress: scanSkills handles empty SKILL.md (0 bytes)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-skill-'));
  try {
    const skillDir = path.join(tmpDir, 'empty-skill');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '');
    const errors = [];
    const skills = scanSkills(tmpDir, errors);
    assert.ok(Array.isArray(skills), 'should return array');
    // Empty file should still produce a skill with fallback name
    assert.equal(skills.length, 1);
    assert.equal(skills[0].name, 'empty-skill');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('stress: scanSkills handles frontmatter-only SKILL.md (no description)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-skill-'));
  try {
    const skillDir = path.join(tmpDir, 'bare-skill');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\n---\n');
    const errors = [];
    const skills = scanSkills(tmpDir, errors);
    assert.equal(skills.length, 1);
    assert.equal(skills[0].name, 'bare-skill');
    assert.equal(skills[0].desc, '');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('stress: scanSkills handles oversized frontmatter (>2KB)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-skill-'));
  try {
    const skillDir = path.join(tmpDir, 'big-skill');
    fs.mkdirSync(skillDir);
    const bigDesc = 'x'.repeat(5000);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'),
      `---\nname: big\ndescription: ${bigDesc}\n---\n`);
    const errors = [];
    const skills = scanSkills(tmpDir, errors);
    assert.equal(skills.length, 1);
    // tryReadHead reads only 2KB, so the 5000-char description is cut mid-way.
    // extractFrontmatter may fail to parse truncated YAML, falling back to dir name.
    assert.ok(skills[0].name === 'big' || skills[0].name === 'big-skill',
      `name should be 'big' or fallback 'big-skill', got: ${skills[0].name}`);
    assert.ok(skills[0].desc.length <= 200, 'desc should be truncated');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('stress: scanSkills handles binary content', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-skill-'));
  try {
    const skillDir = path.join(tmpDir, 'binary-skill');
    fs.mkdirSync(skillDir);
    const buf = Buffer.alloc(256);
    for (let i = 0; i < 256; i++) buf[i] = i;
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), buf);
    const errors = [];
    const skills = scanSkills(tmpDir, errors);
    assert.ok(Array.isArray(skills), 'should not crash on binary');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('stress: scanSkills handles BOM + empty frontmatter', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-skill-'));
  try {
    const skillDir = path.join(tmpDir, 'bom-skill');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '\uFEFF---\nname: bom-test\n---\n');
    const errors = [];
    const skills = scanSkills(tmpDir, errors);
    assert.equal(skills.length, 1);
    assert.equal(skills[0].name, 'bom-test');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('stress: scanSkills handles control chars in description', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-skill-'));
  try {
    const skillDir = path.join(tmpDir, 'ctrl-skill');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'),
      '---\nname: ctrl\ndescription: hello\x00\x01\x02world\n---\n');
    const errors = [];
    const skills = scanSkills(tmpDir, errors);
    assert.equal(skills.length, 1);
    // sanitize should strip control characters
    assert.ok(!skills[0].desc.includes('\x00'), 'control chars stripped');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── 5e: JSON comment stripping backslash edge cases ────────────────────────

test('stress: readMcpServers handles URL in string (// not stripped)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-mcp-'));
  try {
    const mcpFile = path.join(tmpDir, '.mcp.json');
    fs.writeFileSync(mcpFile, '{"mcpServers": {"s1": {"url": "http://a.com/path", "description": "test"}}}');
    const servers = readMcpServers(mcpFile, []);
    assert.equal(servers.length, 1);
    assert.equal(servers[0].name, 's1');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('stress: readMcpServers handles escaped backslash before quote + comment', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-mcp-'));
  try {
    const mcpFile = path.join(tmpDir, '.mcp.json');
    // {"val": "a\\"} // comment  — the \\\\ is two literal backslashes, so " closes the string
    fs.writeFileSync(mcpFile, '{"mcpServers": {"s1": {"val": "a\\\\"}}}\n');
    const servers = readMcpServers(mcpFile, []);
    assert.equal(servers.length, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('stress: readMcpServers handles line-start comment', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-mcp-'));
  try {
    const mcpFile = path.join(tmpDir, '.mcp.json');
    fs.writeFileSync(mcpFile, '// this is a comment\n{"mcpServers": {"s1": {"description": "ok"}}}');
    const servers = readMcpServers(mcpFile, []);
    assert.equal(servers.length, 1);
    assert.equal(servers[0].desc, 'ok');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('stress: readMcpServers handles four backslashes before comment', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-mcp-'));
  try {
    const mcpFile = path.join(tmpDir, '.mcp.json');
    // 4 backslashes = 2 literal, string ends at next quote, // is a comment
    fs.writeFileSync(mcpFile, '{"mcpServers": {"s1": {"val": "a\\\\\\\\"}}} // trailing\n');
    const servers = readMcpServers(mcpFile, []);
    assert.equal(servers.length, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
