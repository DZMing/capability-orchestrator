'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOST_PRIORITY = ['claude', 'codex', 'openclaw', 'hermes'];

const PATHS = {
  claude: {
    hostId: 'claude',
    configDir: '.claude',
    configFile: 'settings.json',
    hookStorageKind: 'json',
    invocationStyle: 'slash',
    projectSkillsDir: '.claude/skills',
    projectAgentsDir: '.claude/agents',
    projectCommandsDir: '.claude/commands',
    userSkillsDirs: ['skills'],
    userAgentsDirs: ['agents'],
    userCommandsDirs: ['commands'],
    pluginMarker: '.claude-plugin',
    pluginDataEnv: 'CLAUDE_PLUGIN_DATA',
    userDirEnv: 'CLAUDE_USER_DIR',
    detectEnv: ['CLAUDE_USER_DIR', 'CLAUDE_PLUGIN_DATA'],
    detectFiles: ['.claude'],
  },
  codex: {
    hostId: 'codex',
    configDir: '.codex',
    configFile: 'hooks.json',
    hookStorageKind: 'json',
    invocationStyle: 'dollar',
    projectSkillsDir: '.agents/skills',
    projectAgentsDir: '.agents/agents',
    projectCommandsDir: null,
    userSkillsDirs: ['skills'],
    userAgentsDirs: ['agents'],
    userCommandsDirs: [],
    pluginMarker: '.codex-plugin',
    pluginDataEnv: 'CODEX_PLUGIN_DATA',
    userDirEnv: 'CODEX_USER_DIR',
    detectEnv: ['CODEX_USER_DIR', 'CODEX_PLUGIN_DATA'],
    detectFiles: ['.codex/config.toml'],
  },
  openclaw: {
    hostId: 'openclaw',
    configDir: '.openclaw',
    configFile: 'openclaw.json',
    hookStorageKind: 'host-cli',
    invocationStyle: 'slash',
    projectSkillsDir: '.openclaw/skills',
    projectAgentsDir: null,
    projectCommandsDir: '.openclaw/commands',
    userSkillsDirs: ['workspace/skills', 'skills'],
    userAgentsDirs: [],
    userCommandsDirs: ['commands'],
    pluginMarker: null,
    pluginDataEnv: 'OPENCLAW_PLUGIN_DATA',
    userDirEnv: 'OPENCLAW_USER_DIR',
    detectEnv: ['OPENCLAW_USER_DIR', 'OPENCLAW_PLUGIN_DATA'],
    detectFiles: ['.openclaw', '.openclaw/openclaw.json'],
  },
  hermes: {
    hostId: 'hermes',
    configDir: '.hermes',
    configFile: 'config.yaml',
    hookStorageKind: 'host-cli',
    invocationStyle: 'slash',
    projectSkillsDir: '.hermes/skills',
    projectAgentsDir: null,
    projectCommandsDir: '.hermes/commands',
    userSkillsDirs: ['skills'],
    userAgentsDirs: [],
    userCommandsDirs: ['commands'],
    pluginMarker: null,
    pluginDataEnv: 'HERMES_PLUGIN_DATA',
    userDirEnv: 'HERMES_USER_DIR',
    detectEnv: ['HERMES_USER_DIR', 'HERMES_PLUGIN_DATA'],
    detectFiles: ['.hermes/config.yaml', '.hermes'],
  },
};

function detectPlatform() {
  if (process.env.CAPABILITY_PLATFORM) return process.env.CAPABILITY_PLATFORM;
  const home = os.homedir();
  for (const host of HOST_PRIORITY) {
    const spec = PATHS[host];
    if (spec.detectEnv.some((key) => !!process.env[key])) return host;
  }
  for (const host of HOST_PRIORITY) {
    const spec = PATHS[host];
    if (spec.detectFiles.some((rel) => fs.existsSync(path.join(home, rel)))) return host;
  }
  return 'claude';
}

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

function joinAll(base, relPaths = []) {
  return relPaths.filter(Boolean).map((rel) => path.join(base, rel));
}

function getUserSkillsPaths(userDir, platform) {
  return joinAll(userDir, getPlatformPaths(platform).userSkillsDirs);
}

function getUserAgentsPaths(userDir, platform) {
  return joinAll(userDir, getPlatformPaths(platform).userAgentsDirs);
}

function getUserCommandsPaths(userDir, platform) {
  return joinAll(userDir, getPlatformPaths(platform).userCommandsDirs);
}

function formatInvocation(name, platform, surfaceType = 'skill') {
  const style = getPlatformPaths(platform).invocationStyle;
  if (platform === 'openclaw' && surfaceType === 'skill') {
    return `/skill ${name}`;
  }
  return style === 'dollar' ? `$${name}` : `/${name}`;
}

module.exports = {
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
};
