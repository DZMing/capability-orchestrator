'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  isPluginRoot,
  scanInstalledPlugins,
} = require('../scripts/lib/scan-plugins.cjs');

const USER_DIR = path.join(__dirname, 'fixtures', 'user');

test('isPluginRoot: detects supported plugin root shapes', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-root-'));
  try {
    assert.equal(isPluginRoot(path.join(tmp, 'missing')), false);

    const empty = path.join(tmp, 'empty');
    fs.mkdirSync(empty);
    assert.equal(isPluginRoot(empty), false);

    const claude = path.join(tmp, 'claude');
    fs.mkdirSync(path.join(claude, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(claude, '.claude-plugin', 'plugin.json'), '{}');
    assert.equal(isPluginRoot(claude), true);

    const codex = path.join(tmp, 'codex');
    fs.mkdirSync(path.join(codex, '.codex-plugin'), { recursive: true });
    fs.writeFileSync(path.join(codex, '.codex-plugin', 'plugin.json'), '{}');
    assert.equal(isPluginRoot(codex), true);

    const rootManifest = path.join(tmp, 'root-manifest');
    fs.mkdirSync(rootManifest);
    fs.writeFileSync(path.join(rootManifest, 'plugin.json'), '{}');
    assert.equal(isPluginRoot(rootManifest), true);

    const skillRoot = path.join(tmp, 'skill-root');
    fs.mkdirSync(path.join(skillRoot, 'skills', 'my-skill'), { recursive: true });
    assert.equal(isPluginRoot(skillRoot), true);

    const agentRoot = path.join(tmp, 'agent-root');
    fs.mkdirSync(path.join(agentRoot, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(agentRoot, 'agents', 'helper.md'), '---\nname: helper\n---\n');
    assert.equal(isPluginRoot(agentRoot), true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('scanInstalledPlugins: fixture plugin cache exposes manifests and nested skills', () => {
  const plugins = scanInstalledPlugins(USER_DIR);
  const good = plugins.find(p => p.name.startsWith('good-plugin'));
  const bad = plugins.find(p => p.name === 'bad-plugin');
  const deep = plugins.find(p => p.name.startsWith('deep-plugin'));
  const inner = plugins.find(p => p.name.startsWith('inner-plugin'));
  assert.ok(good, 'good-plugin should be detected');
  assert.ok(bad, 'bad-plugin should fall back to dir name with bad JSON');
  assert.ok(deep && deep.skillItems.some(s => s.name === 'gamma-skill'), 'deep gamma skill should be detected');
  assert.ok(inner && inner.skillItems.some(s => s.name === 'beta'), 'nested beta skill should be detected');
  assert.equal(good.host, 'claude');
  assert.equal(good.source, 'plugin-cache');
  assert.equal(good.scope, 'user');
  assert.equal(good.surfaceType, 'plugin');
  const alpha = good.skillItems.find(s => s.name === 'alpha');
  assert.ok(alpha, 'alpha skill should be present');
  assert.equal(alpha.host, 'claude');
  assert.equal(alpha.source, 'plugin-cache');
  assert.equal(alpha.scope, 'user');
  assert.equal(alpha.surfaceType, 'skill');
  assert.equal(alpha.invocation, 'slash');
});

test('scanInstalledPlugins: dedup keeps highest semver version', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-dedup-'));
  try {
    const cacheDir = path.join(tmp, 'plugins', 'cache');
    const v1 = path.join(cacheDir, 'vendor-a', 'myplugin', '.claude-plugin');
    const v2 = path.join(cacheDir, 'vendor-b', 'myplugin', '.claude-plugin');
    fs.mkdirSync(v1, { recursive: true });
    fs.mkdirSync(v2, { recursive: true });
    fs.writeFileSync(path.join(v1, 'plugin.json'), '{"name":"myplugin","version":"1.9.0"}');
    fs.writeFileSync(path.join(v2, 'plugin.json'), '{"name":"myplugin","version":"1.10.0"}');

    const myplugin = scanInstalledPlugins(tmp).find(p => p.name === 'myplugin');
    assert.ok(myplugin);
    assert.equal(myplugin.version, '1.10.0');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
