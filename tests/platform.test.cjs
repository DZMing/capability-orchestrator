'use strict';

const { describe, it } = require('node:test');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const {
  HOST_PRIORITY,
  detectPlatform,
  getPlatformPaths,
  getProjectSkillsPath,
  getProjectAgentsPath,
  getProjectCommandsPath,
  getUserSkillsPaths,
  getUserAgentsPaths,
  getUserCommandsPaths,
  formatInvocation,
} = require('../scripts/lib/platform.cjs');
const { resolveUserDirWithSource } = require('../scripts/lib/user-dir.cjs');

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

  const envKeys = [
    'CAPABILITY_PLATFORM',
    'CLAUDE_USER_DIR', 'CLAUDE_PLUGIN_DATA',
    'CODEX_USER_DIR', 'CODEX_PLUGIN_DATA',
    'OPENCLAW_USER_DIR', 'OPENCLAW_PLUGIN_DATA',
    'HERMES_USER_DIR', 'HERMES_PLUGIN_DATA',
  ];
  const savedExistsSync = fs.existsSync;

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

    it('respects CAPABILITY_PLATFORM=openclaw', () => {
      saveEnv(envKeys);
      process.env.CAPABILITY_PLATFORM = 'openclaw';
      assert.equal(detectPlatform(), 'openclaw');
      restoreEnv(envKeys);
    });

    it('respects CAPABILITY_PLATFORM=hermes', () => {
      saveEnv(envKeys);
      process.env.CAPABILITY_PLATFORM = 'hermes';
      assert.equal(detectPlatform(), 'hermes');
      restoreEnv(envKeys);
    });

    it('detects codex via CODEX_USER_DIR', () => {
      saveEnv(envKeys);
      process.env.CODEX_USER_DIR = '/tmp/codex-test';
      assert.equal(detectPlatform(), 'codex');
      restoreEnv(envKeys);
    });

    it('detects openclaw via OPENCLAW_USER_DIR', () => {
      saveEnv(envKeys);
      process.env.OPENCLAW_USER_DIR = '/tmp/openclaw-test';
      assert.equal(detectPlatform(), 'openclaw');
      restoreEnv(envKeys);
    });

    it('detects hermes via HERMES_USER_DIR', () => {
      saveEnv(envKeys);
      process.env.HERMES_USER_DIR = '/tmp/hermes-test';
      assert.equal(detectPlatform(), 'hermes');
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

    it('defaults to claude when both .claude and .codex config exist', () => {
      saveEnv(envKeys);
      const savedHome = process.env.HOME;
      process.env.HOME = '/tmp/dual-install-home-' + Date.now();
      fs.existsSync = (target) => {
        if (target === path.join(process.env.HOME, '.claude')) return true;
        if (target === path.join(process.env.HOME, '.codex', 'config.toml')) return true;
        return savedExistsSync(target);
      };
      assert.equal(detectPlatform(), 'claude');
      fs.existsSync = savedExistsSync;
      process.env.HOME = savedHome;
      restoreEnv(envKeys);
    });

    it('detects openclaw from home config when claude/codex are absent', () => {
      saveEnv(envKeys);
      const savedHome = process.env.HOME;
      process.env.HOME = '/tmp/openclaw-home-' + Date.now();
      fs.existsSync = (target) => {
        if (target === path.join(process.env.HOME, '.openclaw')) return true;
        if (target === path.join(process.env.HOME, '.openclaw', 'openclaw.json')) return true;
        return false;
      };
      assert.equal(detectPlatform(), 'openclaw');
      fs.existsSync = savedExistsSync;
      process.env.HOME = savedHome;
      restoreEnv(envKeys);
    });

    it('detects hermes from home config when higher-priority hosts are absent', () => {
      saveEnv(envKeys);
      const savedHome = process.env.HOME;
      process.env.HOME = '/tmp/hermes-home-' + Date.now();
      fs.existsSync = (target) => {
        if (target === path.join(process.env.HOME, '.hermes', 'config.yaml')) return true;
        if (target === path.join(process.env.HOME, '.hermes')) return true;
        return false;
      };
      assert.equal(detectPlatform(), 'hermes');
      fs.existsSync = savedExistsSync;
      process.env.HOME = savedHome;
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

    it('returns openclaw paths and invocation style', () => {
      const p = getPlatformPaths('openclaw');
      assert.equal(p.configDir, '.openclaw');
      assert.equal(p.configFile, 'openclaw.json');
      assert.equal(p.userDirEnv, 'OPENCLAW_USER_DIR');
      assert.equal(p.invocationStyle, 'slash');
      assert.deepEqual(p.userSkillsDirs, ['workspace/skills', 'skills']);
    });

    it('returns hermes paths and invocation style', () => {
      const p = getPlatformPaths('hermes');
      assert.equal(p.configDir, '.hermes');
      assert.equal(p.configFile, 'config.yaml');
      assert.equal(p.userDirEnv, 'HERMES_USER_DIR');
      assert.equal(p.invocationStyle, 'slash');
      assert.deepEqual(p.userSkillsDirs, ['skills']);
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

    it('getUserSkillsPaths returns host-specific user skill roots', () => {
      assert.deepEqual(
        getUserSkillsPaths('/home/user/.openclaw', 'openclaw'),
        [
          path.join('/home/user/.openclaw', 'workspace/skills'),
          path.join('/home/user/.openclaw', 'skills'),
        ]
      );
      assert.deepEqual(
        getUserSkillsPaths('/home/user/.hermes', 'hermes'),
        [path.join('/home/user/.hermes', 'skills')]
      );
    });

    it('getUserCommandsPaths returns host-specific command roots', () => {
      assert.deepEqual(
        getUserCommandsPaths('/home/user/.openclaw', 'openclaw'),
        [path.join('/home/user/.openclaw', 'commands')]
      );
      assert.deepEqual(
        getUserCommandsPaths('/home/user/.codex', 'codex'),
        []
      );
    });

    it('formatInvocation keeps codex dollar style and slash for other hosts', () => {
      assert.equal(formatInvocation('review', 'codex'), '$review');
      assert.equal(formatInvocation('review', 'claude'), '/review');
      assert.equal(formatInvocation('review', 'openclaw'), '/skill review');
      assert.equal(formatInvocation('review', 'openclaw', 'slash_command'), '/review');
      assert.equal(formatInvocation('review', 'hermes'), '/review');
    });
  });

  describe('resolveUserDirWithSource', () => {
    it('uses host-specific env override for openclaw', () => {
      saveEnv(envKeys);
      process.env.CAPABILITY_PLATFORM = 'openclaw';
      process.env.OPENCLAW_USER_DIR = '/tmp/oc-user';
      assert.deepEqual(resolveUserDirWithSource(), { dir: '/tmp/oc-user', source: 'OPENCLAW_USER_DIR' });
      restoreEnv(envKeys);
    });

    it('uses host-specific env override for hermes', () => {
      saveEnv(envKeys);
      process.env.CAPABILITY_PLATFORM = 'hermes';
      process.env.HERMES_USER_DIR = '/tmp/hermes-user';
      assert.deepEqual(resolveUserDirWithSource(), { dir: '/tmp/hermes-user', source: 'HERMES_USER_DIR' });
      restoreEnv(envKeys);
    });

    it('falls back to HOME_DEFAULT for openclaw when no env is set', () => {
      saveEnv(envKeys);
      process.env.CAPABILITY_PLATFORM = 'openclaw';
      const savedHome = process.env.HOME;
      process.env.HOME = '/tmp/openclaw-default-' + Date.now();
      assert.deepEqual(resolveUserDirWithSource(), {
        dir: path.join(process.env.HOME, '.openclaw'),
        source: 'HOME_DEFAULT',
      });
      process.env.HOME = savedHome;
      restoreEnv(envKeys);
    });
  });
});
