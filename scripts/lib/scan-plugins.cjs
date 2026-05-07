'use strict';

const fs = require('fs');
const path = require('path');
const {
  MAX_DESC,
  compareSemver,
  getDescription,
  getName,
  isSymlink,
  sanitize,
  truncate,
  tryRead,
  tryReadDir,
  tryReadHead,
} = require('./scan-text.cjs');

const MAX_PLUGIN_DEPTH = 3;

function detectPluginHost(pluginPath) {
  if (fs.existsSync(path.join(pluginPath, '.codex-plugin', 'plugin.json'))) return 'codex';
  if (fs.existsSync(path.join(pluginPath, '.claude-plugin', 'plugin.json'))) return 'claude';
  return 'unknown';
}

function invocationForHost(host) {
  return host === 'codex' ? 'dollar' : 'slash';
}

function isPluginRoot(dirPath, errors) {
  if (fs.existsSync(path.join(dirPath, '.claude-plugin', 'plugin.json'))) return true;
  if (fs.existsSync(path.join(dirPath, '.codex-plugin', 'plugin.json'))) return true;
  if (fs.existsSync(path.join(dirPath, 'plugin.json'))) return true;
  if (tryReadDir(path.join(dirPath, 'skills'), true, errors).some(d => d.isDirectory())) return true;
  return tryReadDir(path.join(dirPath, 'agents'), true, errors).some(d => d.isFile() && d.name.endsWith('.md'));
}

function findPluginRoots(dir, maxDepth, errors) {
  if (maxDepth <= 0) return [];
  if (isPluginRoot(dir, errors)) return [dir];
  const roots = [];
  for (const d of tryReadDir(dir, true, errors)) {
    if (!d.isDirectory() || d.name.startsWith('.')) continue;
    const child = path.join(dir, d.name);
    if (isSymlink(child)) continue;
    roots.push(...findPluginRoots(child, maxDepth - 1, errors));
  }
  return roots;
}

function scanInstalledPlugins(claudeUserDir, errors) {
  const cacheDir = path.join(claudeUserDir, 'plugins', 'cache');
  const results = [];

  for (const dirent of tryReadDir(cacheDir, true, errors)) {
    if (!dirent.isDirectory()) continue;
    const candidate = path.join(cacheDir, dirent.name);
    if (isSymlink(candidate)) continue;
    const pluginPaths = findPluginRoots(candidate, MAX_PLUGIN_DEPTH, errors);

    for (const pluginPath of pluginPaths) {
      const pluginName = path.basename(pluginPath);
      const host = detectPluginHost(pluginPath);
      const invocation = invocationForHost(host);
      const manifestContent =
        tryRead(path.join(pluginPath, '.claude-plugin', 'plugin.json'), errors) ||
        tryRead(path.join(pluginPath, '.codex-plugin', 'plugin.json'), errors) ||
        tryRead(path.join(pluginPath, 'plugin.json'), errors);

      let name = sanitize(pluginName);
      let version = '';
      let description = '';

      if (manifestContent) {
        try {
          const manifest = JSON.parse(manifestContent);
          name = sanitize(manifest.name || pluginName);
          version = sanitize(manifest.version || '');
          description = sanitize(truncate(manifest.description || '', MAX_DESC));
        } catch { /* use directory name */ }
      }

      const skillItems = tryReadDir(path.join(pluginPath, 'skills'), true, errors)
        .filter(d => !d.name.startsWith('.') && d.isDirectory()
          && fs.existsSync(path.join(pluginPath, 'skills', d.name, 'SKILL.md')))
        .map(d => {
          const skillPath = path.join(pluginPath, 'skills', d.name, 'SKILL.md');
          const head = tryReadHead(skillPath, errors);
          return {
            name: sanitize(getName(head, d.name)),
            desc: head ? getDescription(head) : '',
            filePath: skillPath,
            host,
            source: 'plugin-cache',
            scope: 'user',
            surfaceType: 'skill',
            state: 'enabled',
            invocation,
          };
        });
      const agentNames = tryReadDir(path.join(pluginPath, 'agents'), true, errors)
        .filter(d => !d.name.startsWith('.') && d.isFile() && d.name.endsWith('.md'))
        .map(d => sanitize(d.name.replace(/\.md$/, '')));

      results.push({
        name,
        version,
        description,
        skillItems,
        agentNames,
        host,
        surfaceType: 'plugin',
        state: 'discovered',
        source: 'plugin-cache',
        scope: 'user',
        invocation,
      });
    }
  }

  const seen = new Map();
  for (const p of results) {
    const prev = seen.get(p.name);
    if (!prev || (p.version && (!prev.version || compareSemver(p.version, prev.version) > 0))) {
      seen.set(p.name, p);
    }
  }
  return [...seen.values()];
}

module.exports = {
  MAX_PLUGIN_DEPTH,
  detectPluginHost,
  isPluginRoot,
  findPluginRoots,
  scanInstalledPlugins,
};
