'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function detectPlatform() {
  if (process.env.CAPABILITY_PLATFORM) return process.env.CAPABILITY_PLATFORM;
  if (process.env.CLAUDE_USER_DIR || process.env.CLAUDE_PLUGIN_DATA) return 'claude';
  if (process.env.CODEX_USER_DIR || process.env.CODEX_PLUGIN_DATA) return 'codex';
  const home = os.homedir();
  if (fs.existsSync(path.join(home, '.claude'))) return 'claude';
  if (fs.existsSync(path.join(home, '.codex', 'config.toml'))) return 'codex';
  return 'claude';
}

const PATHS = {
  claude: {
    configDir: '.claude',
    projectSkillsDir: '.claude/skills',
    projectAgentsDir: '.claude/agents',
    projectCommandsDir: '.claude/commands',
    pluginMarker: '.claude-plugin',
    pluginDataEnv: 'CLAUDE_PLUGIN_DATA',
    userDirEnv: 'CLAUDE_USER_DIR',
  },
  codex: {
    configDir: '.codex',
    projectSkillsDir: '.agents/skills',
    projectAgentsDir: '.agents/agents',
    projectCommandsDir: null,
    pluginMarker: '.codex-plugin',
    pluginDataEnv: 'CODEX_PLUGIN_DATA',
    userDirEnv: 'CODEX_USER_DIR',
  },
};

function getPlatformPaths(platform) {
  return PATHS[platform] || PATHS.claude;
}

function getProjectSkillsPath(cwd, platform) {
  const p = getPlatformPaths(platform);
  return path.join(cwd, p.projectSkillsDir);
}

function getProjectAgentsPath(cwd, platform) {
  const p = getPlatformPaths(platform);
  return p.projectAgentsDir ? path.join(cwd, p.projectAgentsDir) : null;
}

function getProjectCommandsPath(cwd, platform) {
  const p = getPlatformPaths(platform);
  return p.projectCommandsDir ? path.join(cwd, p.projectCommandsDir) : null;
}

module.exports = {
  detectPlatform,
  getPlatformPaths,
  getProjectSkillsPath,
  getProjectAgentsPath,
  getProjectCommandsPath,
};
