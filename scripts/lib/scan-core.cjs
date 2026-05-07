'use strict';

const fs = require('fs');
const path = require('path');
const { resolveUserDir } = require('./user-dir.cjs');
const {
  detectPlatform,
  getPlatformPaths,
  getUserSkillsPaths,
  getUserAgentsPaths,
  getUserCommandsPaths,
} = require('./platform.cjs');
const {
  MAX_DESC,
  tryRead,
  tryReadHead,
  tryReadDir,
  truncate,
  compareSemver,
  sanitize,
  extractFrontmatter,
  getDescription,
  getName,
  isSymlink,
  withCapabilityMeta,
} = require('./scan-text.cjs');
const { readMcpServers } = require('./scan-mcp.cjs');
const {
  parsePlatformList,
  extractSupportedPlatforms,
  isPlatformCompatible,
  scanCompatibleSkills,
  getOpenClawSkillDir,
  getHermesSkillDir,
} = require('./scan-host-skills.cjs');
const {
  MAX_PLUGIN_DEPTH,
  isPluginRoot,
  findPluginRoots,
  scanInstalledPlugins,
} = require('./scan-plugins.cjs');
const {
  parseHermesSkillsTable,
  parseHermesPluginsList,
  scanHermesRuntimeSkills,
  scanHermesRuntimePlugins,
} = require('./hermes-runtime.cjs');

function scanSkills(dir, errors, meta = {}) {
  const results = [];
  for (const dirent of tryReadDir(dir, true, errors)) {
    if (dirent.name.startsWith('.') || !dirent.isDirectory()) continue;
    const fullPath = path.join(dir, dirent.name);
    if (isSymlink(fullPath)) continue;
    const content = tryReadHead(path.join(fullPath, 'SKILL.md'), errors);
    if (content === null) continue;
    const name = getName(content, dirent.name);
    const desc = getDescription(content);
    const filePath = path.join(fullPath, 'SKILL.md');
    results.push(withCapabilityMeta({ name, desc, filePath }, { surfaceType: 'skill', ...meta }));
  }
  return results;
}

function scanAgents(dir, errors, meta = {}) {
  const results = [];
  for (const dirent of tryReadDir(dir, true, errors)) {
    if (dirent.name.startsWith('.') || !dirent.isFile() || !dirent.name.endsWith('.md')) continue;
    const fullPath = path.join(dir, dirent.name);
    if (isSymlink(fullPath)) continue;
    const content = tryReadHead(fullPath, errors);
    if (content === null) continue;
    const name = getName(content, dirent.name.replace(/\.md$/, ''));
    const desc = getDescription(content);
    results.push(withCapabilityMeta({ name, desc, filePath: fullPath }, { surfaceType: 'agent', ...meta }));
  }
  return results;
}

function scanCommands(dir, errors, meta = {}) {
  return tryReadDir(dir, true, errors)
    .filter(d => !d.name.startsWith('.') && d.isFile() && d.name.endsWith('.md'))
    .flatMap(d => {
      const name = sanitize(d.name.replace(/\.md$/, ''));
      const filePath = path.join(dir, d.name);
      const content = tryReadHead(filePath, errors);
      if (content === null) return [];
      const fm = extractFrontmatter(content);
      const desc = sanitize(fm.description || fm.name || '');
      return [withCapabilityMeta({ name, desc, filePath }, { surfaceType: 'slash_command', ...meta })];
    });
}

function collectSnapshot(projectDir, userDir) {
  const cwd = projectDir || process.cwd();
  const activeUserDir = userDir || resolveUserDir();
  const errors = [];
  const sections = [];
  const platform = detectPlatform();
  const pp = getPlatformPaths(platform);

  function tryCollect(label, prefix, fn) {
    try {
      const items = fn();
      if (items.length > 0) sections.push({ label, prefix, items });
    } catch (e) {
      errors.push(`${label}: ${e.message}`);
    }
  }

  tryCollect('项目级 Skills', '', () =>
    scanSkills(path.join(cwd, pp.projectSkillsDir), errors, {
      host: platform,
      source: 'project',
      scope: 'project',
      state: 'enabled',
      invocation: pp.invocationStyle,
    }));
  if (pp.projectAgentsDir) {
    tryCollect('项目级 Subagents', '@', () =>
      scanAgents(path.join(cwd, pp.projectAgentsDir), errors, {
        host: platform,
        source: 'project',
        scope: 'project',
        state: 'enabled',
      }));
  }

  try {
    const mcpItems = [];
    readMcpServers(path.join(cwd, '.mcp.json'), errors, {
      host: platform,
      source: 'project',
      scope: 'project',
    }).forEach(s =>
      mcpItems.push({
        ...s,
        name: sanitize(s.name),
        desc: sanitize(truncate(s.desc, MAX_DESC)) || '项目级',
        extra: `source: ${s.source} | transport: ${s.transport} | auth: ${s.authRequired ? 'required' : 'none'} | write: ${s.mayWrite ? 'possible' : 'not indicated'} | external: ${s.externalAccess ? 'possible' : 'not indicated'}`,
      }));

    const userMcpFile = fs.existsSync(path.join(activeUserDir, 'mcp.json'))
      ? path.join(activeUserDir, 'mcp.json')
      : path.join(activeUserDir, '.mcp.json');
    const projMcpNames = new Set(mcpItems.map(s => s.name));
    readMcpServers(userMcpFile, errors, {
      host: platform,
      source: 'user',
      scope: 'user',
    }).forEach(s => {
      const name = sanitize(s.name);
      if (!projMcpNames.has(name)) {
        mcpItems.push({
          ...s,
          name,
          desc: sanitize(truncate(s.desc, MAX_DESC)) || '用户级',
          extra: `source: ${s.source} | transport: ${s.transport} | auth: ${s.authRequired ? 'required' : 'none'} | write: ${s.mayWrite ? 'possible' : 'not indicated'} | external: ${s.externalAccess ? 'possible' : 'not indicated'}`,
        });
      }
    });
    if (mcpItems.length > 0) sections.push({ label: 'MCP Servers', prefix: '', items: mcpItems });
  } catch (e) {
    errors.push(`MCP: ${e.message}`);
  }

  if (platform !== 'openclaw' && platform !== 'hermes') {
    const userSkillPaths = getUserSkillsPaths(activeUserDir, platform);
    tryCollect('用户级 Skills', '', () => userSkillPaths.flatMap((dir, index) => scanSkills(dir, errors, {
      host: platform,
      source: index === 0 ? 'user' : 'external',
      scope: 'user',
      state: 'enabled',
      invocation: pp.invocationStyle,
    })));

    const userAgentPaths = getUserAgentsPaths(activeUserDir, platform);
    if (userAgentPaths.length > 0) {
      tryCollect('用户级 Subagents', '@', () => userAgentPaths.flatMap((dir) => scanAgents(dir, errors, {
        host: platform,
        source: 'user',
        scope: 'user',
        state: 'enabled',
      })));
    }
  }

  tryCollect('OpenClaw Skills', '', () => scanCompatibleSkills(getOpenClawSkillDir(), 'openclaw', errors, {
    scope: 'workspace',
    invocation: pp.invocationStyle,
  }));
  if (platform !== 'hermes') {
    tryCollect('Hermes Skills', '', () => scanCompatibleSkills(getHermesSkillDir(), 'hermes', errors, {
      scope: 'user',
      invocation: pp.invocationStyle,
    }));
  } else {
    const runtimeHelpers = { sanitize, truncate, withCapabilityMeta };
    tryCollect('Hermes Runtime Skills', '', () => scanHermesRuntimeSkills(errors, runtimeHelpers));
    tryCollect('Hermes Runtime Plugins', '', () => scanHermesRuntimePlugins(errors, runtimeHelpers));
  }

  try {
    const plugins = scanInstalledPlugins(activeUserDir, errors);
    if (plugins.length > 0) {
      const items = plugins.map(p => ({
        name: `${p.name}${p.version ? ' (v' + p.version + ')' : ''}`,
        desc: p.description,
        extra: [
          p.skillItems.length > 0 ? `skills: ${p.skillItems.map(s => s.name).join(', ')}` : '',
          p.agentNames.length > 0 ? `agents: ${p.agentNames.join(', ')}` : '',
        ].filter(Boolean).join(' | ')
      }));
      sections.push({ label: '已安装插件', prefix: '', items });
    }
  } catch (e) {
    errors.push(`插件扫描: ${e.message}`);
  }

  try {
    if (pp.projectCommandsDir) {
      const projCmds = scanCommands(path.join(cwd, pp.projectCommandsDir), errors);
      const userCmds = getUserCommandsPaths(activeUserDir, platform)
        .flatMap((dir) => scanCommands(dir, errors, {
          host: platform,
          source: 'user',
          scope: 'user',
          state: 'enabled',
          invocation: pp.invocationStyle,
        }));
      const cmds = [
        ...projCmds.map(c => ({
          ...c,
          host: platform,
          source: 'project',
          scope: 'project',
          state: 'enabled',
          invocation: pp.invocationStyle,
          name: c.name,
          desc: c.desc || 'legacy，建议迁移到 skills/',
        })),
        ...userCmds.map(c => ({ name: c.name, desc: c.desc || 'legacy' })),
      ];
      if (cmds.length > 0) sections.push({ label: 'Legacy Commands', prefix: '', items: cmds });
    }
  } catch (e) {
    errors.push(`commands: ${e.message}`);
  }

  const projSkillNames = new Set(
    (sections.find(s => s.label === '项目级 Skills') || { items: [] }).items.map(i => i.name)
  );
  const userSkillNames = new Set(
    (sections.find(s => s.label === '用户级 Skills') || { items: [] }).items.map(i => i.name)
  );
  const projAgentNames = new Set(
    (sections.find(s => s.label === '项目级 Subagents') || { items: [] }).items.map(i => i.name)
  );
  for (const s of sections) {
    if (s.label === '用户级 Skills') s.items = s.items.filter(i => !projSkillNames.has(i.name));
    if (s.label === 'OpenClaw Skills' || s.label === 'Hermes Skills') {
      s.items = s.items.filter(i => !projSkillNames.has(i.name) && !userSkillNames.has(i.name));
    }
    if (s.label === '用户级 Subagents') s.items = s.items.filter(i => !projAgentNames.has(i.name));
  }

  const nonEmpty = sections.filter(s => s.items.length > 0);
  sections.length = 0;
  sections.push(...nonEmpty);

  for (const s of sections) {
    s.items.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  }

  return { sections, errors };
}

module.exports = {
  MAX_DESC,
  MAX_PLUGIN_DEPTH,
  tryRead,
  tryReadHead,
  tryReadDir,
  truncate,
  compareSemver,
  sanitize,
  extractFrontmatter,
  getDescription,
  getName,
  parsePlatformList,
  extractSupportedPlatforms,
  isPlatformCompatible,
  isSymlink,
  scanSkills,
  scanCompatibleSkills,
  scanAgents,
  scanCommands,
  readMcpServers,
  isPluginRoot,
  findPluginRoots,
  scanInstalledPlugins,
  getOpenClawSkillDir,
  getHermesSkillDir,
  parseHermesSkillsTable,
  parseHermesPluginsList,
  scanHermesRuntimeSkills,
  scanHermesRuntimePlugins,
  collectSnapshot,
  withCapabilityMeta,
};
