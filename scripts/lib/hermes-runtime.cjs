'use strict';

const { execFileSync } = require('child_process');

function parseHermesSkillsTable(text, helpers) {
  const { sanitize, withCapabilityMeta } = helpers;
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (!line.includes('│')) continue;
    const rawParts = line.split('│').map((part) => part.trim());
    if (rawParts.length < 6) continue;
    const [name, category, source, trust] = rawParts.slice(1, 5);
    if (!name || name === 'Name' || name.startsWith('Installed Skills')) continue;
    if (/^[-┏┗┡└┌]/.test(name)) continue;
    out.push(withCapabilityMeta({
      name: sanitize(name),
      desc: sanitize(category ? `category: ${category}` : ''),
      filePath: '',
    }, {
      host: 'hermes',
      surfaceType: 'skill',
      source: sanitize(source || 'hermes-runtime'),
      scope: source === 'builtin' ? 'bundled' : 'user',
      state: 'loaded',
      invocation: 'slash',
      trust: sanitize(trust || ''),
      restartRequirement: 'session',
    }));
  }
  return out;
}

function scanHermesRuntimeSkills(errors, helpers) {
  try {
    const stdout = execFileSync('hermes', ['skills', 'list'], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });
    return parseHermesSkillsTable(stdout, helpers);
  } catch (e) {
    if (errors) errors.push(`Hermes skills CLI: ${e.code || e.message}`);
    return [];
  }
}

function parseHermesPluginsList(text, helpers) {
  const { sanitize, truncate, withCapabilityMeta } = helpers;
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (!line.includes('│')) continue;
    const rawParts = line.split('│').map((part) => part.trim());
    if (rawParts.length < 7) continue;
    const [name, status, version, description, source] = rawParts.slice(1, 6);
    if (!name || name === 'Name' || /^[-┏┗┡└┌]/.test(name)) continue;
    out.push(withCapabilityMeta({
      name: sanitize(name),
      desc: sanitize(truncate(description || '', 100)),
      filePath: '',
    }, {
      host: 'hermes',
      surfaceType: 'plugin',
      source: sanitize(source || 'hermes-runtime'),
      scope: source === 'builtin' ? 'bundled' : 'user',
      state: sanitize(status || 'loaded'),
      version: sanitize(version || ''),
      invocation: '',
      restartRequirement: 'gateway-restart',
    }));
  }
  return out;
}

function scanHermesRuntimePlugins(errors, helpers) {
  try {
    const stdout = execFileSync('hermes', ['plugins', 'list'], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });
    if (/No plugins installed\./.test(stdout)) return [];
    return parseHermesPluginsList(stdout, helpers);
  } catch (e) {
    if (errors) errors.push(`Hermes plugins CLI: ${e.code || e.message}`);
    return [];
  }
}

module.exports = {
  parseHermesSkillsTable,
  parseHermesPluginsList,
  scanHermesRuntimeSkills,
  scanHermesRuntimePlugins,
};
