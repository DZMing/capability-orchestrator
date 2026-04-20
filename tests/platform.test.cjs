'use strict';

const { describe, it } = require('node:test');
const assert = require('assert/strict');
const path = require('path');

const {
  detectPlatform,
  getPlatformPaths,
  getProjectSkillsPath,
  getProjectAgentsPath,
  getProjectCommandsPath,
} = require('../scripts/lib/platform.cjs');

describe('platform', () => {
  const savedEnv = {};

  function saveEnv(keys) {
    for (const k of keys) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  }

  function restoreEnv(keys) {
    for (const k of keys) {
      if (savedEnv[k] !== undefined) process.env[k] = savedEnv[k];
      else delete process.env[k];
    }
  }

  const envKeys = ['CAPABILITY_PLATFORM', 'CLAUDE_USER_DIR', 'CLAUDE_PLUGIN_DATA', 'CODEX_USER_DIR', 'CODEX_PLUGIN_DATA'];

  describe('detectPlatform', () => {
    it('respects CAPABILITY_PLATFORM=codex', () => {
      saveEnv(envKeys);
      process.env.CAPABILITY_PLATFORM = 'codex';
      assert.equal(detectPlatform(), 'codex');
      restoreEnv(envKeys);
    });

    it('respects CAPABILITY_PLATFORM=claude', () => {
      saveEnv(envKeys);
      process.env.CAPABILITY_PLATFORM = 'claude';
      assert.equal(detectPlatform(), 'claude');
      restoreEnv(envKeys);
    });

    it('detects codex via CODEX_USER_DIR', () => {
      saveEnv(envKeys);
      process.env.CODEX_USER_DIR = '/tmp/codex-test';
      assert.equal(detectPlatform(), 'codex');
      restoreEnv(envKeys);
    });

    it('defaults to claude when no codex config exists', () => {
      saveEnv(envKeys);
      // 设置一个不存在的 HOME，避免 ~/.codex/config.toml 误触发
      const savedHome = process.env.HOME;
      process.env.HOME = '/tmp/no-codex-here-' + Date.now();
      assert.equal(detectPlatform(), 'claude');
      process.env.HOME = savedHome;
      restoreEnv(envKeys);
    });

    it('claude env takes priority over codex env', () => {
      saveEnv(envKeys);
      process.env.CLAUDE_USER_DIR = '/home/.claude';
      process.env.CODEX_USER_DIR = '/home/.codex';
      assert.equal(detectPlatform(), 'claude');
      restoreEnv(envKeys);
    });
  });

  describe('getPlatformPaths', () => {
    it('returns .agents paths for codex', () => {
      const p = getPlatformPaths('codex');
      assert.equal(p.configDir, '.codex');
      assert.equal(p.projectSkillsDir, '.agents/skills');
      assert.equal(p.projectAgentsDir, '.agents/agents');
      assert.equal(p.projectCommandsDir, null);
      assert.equal(p.pluginDataEnv, 'CODEX_PLUGIN_DATA');
    });

    it('returns .claude paths for claude', () => {
      const p = getPlatformPaths('claude');
      assert.equal(p.configDir, '.claude');
      assert.equal(p.projectSkillsDir, '.claude/skills');
      assert.equal(p.projectAgentsDir, '.claude/agents');
      assert.equal(p.projectCommandsDir, '.claude/commands');
      assert.equal(p.pluginDataEnv, 'CLAUDE_PLUGIN_DATA');
    });

    it('falls back to claude for unknown platform', () => {
      const p = getPlatformPaths('unknown');
      assert.equal(p.configDir, '.claude');
    });
  });

  describe('path helpers', () => {
    it('getProjectSkillsPath joins cwd with platform skills dir', () => {
      assert.equal(
        getProjectSkillsPath('/proj', 'codex'),
        path.join('/proj', '.agents/skills')
      );
      assert.equal(
        getProjectSkillsPath('/proj', 'claude'),
        path.join('/proj', '.claude/skills')
      );
    });

    it('getProjectCommandsPath returns null for codex', () => {
      assert.equal(getProjectCommandsPath('/proj', 'codex'), null);
    });

    it('getProjectCommandsPath returns path for claude', () => {
      assert.equal(
        getProjectCommandsPath('/proj', 'claude'),
        path.join('/proj', '.claude/commands')
      );
    });
  });
});
