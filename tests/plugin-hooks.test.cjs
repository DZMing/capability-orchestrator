'use strict';

/**
 * plugin-hooks.test.cjs
 * Verifies hooks/hooks.json structure, script existence, and version consistency.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');
const HOOKS_FILE = path.join(REPO_ROOT, 'hooks', 'hooks.json');
const PACKAGE_JSON = path.join(REPO_ROOT, 'package.json');
const CLAUDE_PLUGIN_JSON = path.join(REPO_ROOT, '.claude-plugin', 'plugin.json');
const CODEX_PLUGIN_JSON = path.join(REPO_ROOT, '.codex-plugin', 'plugin.json');
const HERMES_YAML = path.join(REPO_ROOT, 'adapters', 'hermes', 'plugin.yaml');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'scripts');

const EXPECTED_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'PreToolUse'];

test('hooks/hooks.json exists', () => {
  assert.ok(fs.existsSync(HOOKS_FILE), 'hooks/hooks.json file not found');
});

test('hooks/hooks.json is valid JSON', () => {
  const raw = fs.readFileSync(HOOKS_FILE, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    assert.fail('hooks/hooks.json JSON parse failed: ' + e.message);
  }
  assert.ok(parsed && typeof parsed === 'object', 'hooks.json top level should be object');
  assert.ok(parsed.hooks && typeof parsed.hooks === 'object', 'hooks.json should have hooks field');
});

test('hooks.json contains 4 required events', () => {
  const parsed = JSON.parse(fs.readFileSync(HOOKS_FILE, 'utf8'));
  const hooks = parsed.hooks;
  for (const event of EXPECTED_EVENTS) {
    assert.ok(event in hooks, 'hooks.json missing event: ' + event);
    assert.ok(Array.isArray(hooks[event]), 'hooks.' + event + ' should be array');
    assert.ok(hooks[event].length > 0, 'hooks.' + event + ' should not be empty');
  }
});

test('PreToolUse has matcher "Bash"', () => {
  const parsed = JSON.parse(fs.readFileSync(HOOKS_FILE, 'utf8'));
  const entries = parsed.hooks['PreToolUse'];
  const hasBash = entries.some(function(entry) { return entry.matcher === 'Bash'; });
  assert.ok(hasBash, 'PreToolUse should have matcher: "Bash"');
});

test('hooks.json command scripts exist on disk', () => {
  const parsed = JSON.parse(fs.readFileSync(HOOKS_FILE, 'utf8'));
  const hooks = parsed.hooks;
  const missing = [];
  const scriptPathRe = /\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/([^\s"]+)/;
  for (const event of Object.keys(hooks)) {
    for (const entry of hooks[event]) {
      const hookItems = entry.hooks || [];
      for (const hookItem of hookItems) {
        const cmd = hookItem.command || '';
        const m = scriptPathRe.exec(cmd);
        if (m) {
          const scriptFile = path.join(SCRIPTS_DIR, m[1]);
          if (!fs.existsSync(scriptFile)) {
            missing.push(event + ': ' + scriptFile);
          }
        }
      }
    }
  }
  assert.deepEqual(missing, [], 'Missing scripts:\n' + missing.join('\n'));
});

test('package.json / .claude-plugin/plugin.json / .codex-plugin/plugin.json versions match', () => {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
  const claude = JSON.parse(fs.readFileSync(CLAUDE_PLUGIN_JSON, 'utf8'));
  const codex = JSON.parse(fs.readFileSync(CODEX_PLUGIN_JSON, 'utf8'));
  assert.equal(claude.version, pkg.version, 'Claude plugin version should match package.json');
  assert.equal(codex.version, pkg.version, 'Codex plugin version should match package.json');
});

test('adapters/hermes/plugin.yaml version matches package.json', () => {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
  const yaml = fs.readFileSync(HERMES_YAML, 'utf8');
  const escapedVersion = pkg.version.replace(/\./g, '\\.');
  const versionRe = new RegExp('version:\\s*' + escapedVersion);
  assert.match(yaml, versionRe, 'Hermes plugin.yaml version should match package.json (' + pkg.version + ')');
});
