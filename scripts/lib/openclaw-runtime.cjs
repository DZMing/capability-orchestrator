'use strict';

const { execFileSync } = require('child_process');

const MAX_DESC = 100;

function tryExecJson(cmd, args, errors, label) {
  try {
    const stdout = execFileSync(cmd, args, { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });
    return JSON.parse(stdout);
  } catch (e) {
    if (errors) errors.push(`${label}: ${e.code || e.message}`);
    return null;
  }
}

function parseOpenClawSkillsJson(data, helpers) {
  const { sanitize, truncate, withCapabilityMeta } = helpers;
  const items = Array.isArray(data && data.skills) ? data.skills : [];
  return items.map((skill) => withCapabilityMeta({
    name: sanitize(skill.name || ''),
    desc: sanitize(truncate(skill.description || '', MAX_DESC)),
    filePath: sanitize(skill.path || ''),
  }, {
    host: 'openclaw',
    surfaceType: 'skill',
    source: sanitize(skill.source || 'openclaw-runtime'),
    scope: skill.bundled ? 'bundled' : 'workspace',
    state: skill.eligible && !skill.disabled ? 'loaded' : 'discovered',
    invocation: 'slash',
    restartRequirement: 'session',
  })).filter((item) => item.name);
}

function parseOpenClawPluginsJson(data, helpers) {
  const { sanitize, truncate, withCapabilityMeta } = helpers;
  const items = Array.isArray(data && data.plugins) ? data.plugins : [];
  return items.map((plugin) => withCapabilityMeta({
    name: sanitize(plugin.id || plugin.name || ''),
    desc: sanitize(truncate(plugin.description || '', MAX_DESC)),
  }, {
    host: 'openclaw',
    surfaceType: 'plugin',
    source: sanitize(plugin.origin || plugin.source || 'openclaw-runtime'),
    scope: plugin.origin === 'config' ? 'user' : 'bundled',
    state: sanitize(plugin.status || (plugin.activated ? 'loaded' : plugin.enabled ? 'enabled' : 'discovered')),
    invocation: '',
    restartRequirement: 'gateway-restart',
  })).filter((item) => item.name);
}

function parseOpenClawPluginCommandsJson(data, helpers) {
  const { sanitize, withCapabilityMeta } = helpers;
  const items = Array.isArray(data && data.plugins) ? data.plugins : [];
  const out = [];
  for (const plugin of items) {
    const commands = Array.isArray(plugin.commands) ? plugin.commands : [];
    for (const command of commands) {
      const name = sanitize(command || '');
      if (!name) continue;
      out.push(withCapabilityMeta({
        name,
        desc: sanitize(`plugin: ${plugin.id || plugin.name || 'openclaw-plugin'}`),
        filePath: '',
      }, {
        host: 'openclaw',
        surfaceType: 'plugin_command',
        source: sanitize(plugin.id || plugin.name || 'openclaw-plugin'),
        scope: 'plugin',
        state: sanitize(plugin.status || 'loaded'),
        invocation: 'slash',
        restartRequirement: 'gateway-restart',
      }));
    }
  }
  return out;
}

function parseOpenClawCliCommandsJson(data, helpers) {
  const { sanitize, withCapabilityMeta } = helpers;
  const items = Array.isArray(data && data.plugins) ? data.plugins : [];
  const out = [];
  for (const plugin of items) {
    const commands = Array.isArray(plugin.cliCommands) ? plugin.cliCommands : [];
    for (const command of commands) {
      const name = sanitize(command || '');
      if (!name) continue;
      out.push(withCapabilityMeta({
        name,
        desc: sanitize(`plugin-cli: ${plugin.id || plugin.name || 'openclaw-plugin'}`),
        filePath: '',
      }, {
        host: 'openclaw',
        surfaceType: 'cli_subcommand',
        source: sanitize(plugin.id || plugin.name || 'openclaw-plugin'),
        scope: 'plugin',
        state: sanitize(plugin.status || 'loaded'),
        invocation: 'cli',
        restartRequirement: 'gateway-restart',
      }));
    }
  }
  return out;
}

function parseOpenClawHooksJson(data, helpers) {
  const { sanitize, truncate, withCapabilityMeta } = helpers;
  const items = Array.isArray(data && data.hooks) ? data.hooks : [];
  return items.map((hook) => withCapabilityMeta({
    name: sanitize(hook.name || ''),
    desc: sanitize(truncate(hook.description || '', MAX_DESC)),
  }, {
    host: 'openclaw',
    surfaceType: 'hook',
    source: sanitize(hook.source || 'openclaw-runtime'),
    scope: hook.managedByPlugin ? 'plugin' : 'bundled',
    state: hook.loadable && !hook.disabled ? 'loaded' : 'discovered',
    invocation: '',
    restartRequirement: 'gateway-restart',
  })).filter((item) => item.name);
}

function scanOpenClawRuntimeSkills(errors, helpers) {
  const data = tryExecJson('openclaw', ['skills', 'list', '--json'], errors, 'OpenClaw skills CLI');
  return data ? parseOpenClawSkillsJson(data, helpers) : [];
}

function scanOpenClawRuntimePlugins(errors, helpers) {
  const data = tryExecJson('openclaw', ['plugins', 'list', '--json'], errors, 'OpenClaw plugins CLI');
  return data ? parseOpenClawPluginsJson(data, helpers) : [];
}

function scanOpenClawRuntimePluginCommands(errors, helpers) {
  const data = tryExecJson('openclaw', ['plugins', 'list', '--json'], errors, 'OpenClaw plugins CLI');
  return data ? parseOpenClawPluginCommandsJson(data, helpers) : [];
}

function scanOpenClawRuntimeCliCommands(errors, helpers) {
  const data = tryExecJson('openclaw', ['plugins', 'list', '--json'], errors, 'OpenClaw plugins CLI');
  return data ? parseOpenClawCliCommandsJson(data, helpers) : [];
}

function scanOpenClawRuntimeHooks(errors, helpers) {
  const data = tryExecJson('openclaw', ['hooks', 'list', '--json'], errors, 'OpenClaw hooks CLI');
  return data ? parseOpenClawHooksJson(data, helpers) : [];
}

function parseOpenClawInspectCommandList(text, label, helpers, pluginId) {
  const { sanitize, withCapabilityMeta } = helpers;
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  let inSection = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (inSection) break;
      continue;
    }
    if (line === `${label}:`) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (/^[A-Z][A-Za-z ]+:$/.test(line)) break;
    out.push(withCapabilityMeta({
      name: sanitize(line),
      desc: sanitize(`plugin: ${pluginId}`),
      filePath: '',
    }, {
      host: 'openclaw',
      surfaceType: label === 'Commands' ? 'plugin_command' : 'cli_subcommand',
      source: sanitize(pluginId || 'openclaw-plugin'),
      scope: 'plugin',
      state: 'loaded',
      invocation: label === 'Commands' ? 'slash' : 'cli',
      restartRequirement: 'gateway-restart',
    }));
  }
  return out;
}

function scanOpenClawRuntimeInspectCommands(errors, helpers, kind) {
  const data = tryExecJson('openclaw', ['plugins', 'list', '--json'], errors, 'OpenClaw plugins CLI');
  const plugins = Array.isArray(data && data.plugins) ? data.plugins : [];
  const results = [];
  const label = kind === 'cli' ? 'CLI commands' : 'Commands';
  for (const plugin of plugins) {
    if (plugin.status !== 'loaded') continue;
    const pluginId = plugin.id || plugin.name;
    if (!pluginId) continue;
    try {
      const stdout = execFileSync('openclaw', ['plugins', 'inspect', String(pluginId)], {
        encoding: 'utf8',
        timeout: 8000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      results.push(...parseOpenClawInspectCommandList(stdout, label, helpers, pluginId));
    } catch (e) {
      if (errors) errors.push(`OpenClaw plugin inspect ${pluginId}: ${e.code || e.message}`);
    }
  }
  return results;
}

function scanOpenClawRuntimePluginCommands(errors, helpers) {
  return scanOpenClawRuntimeInspectCommands(errors, helpers, 'slash');
}

function scanOpenClawRuntimeCliCommands(errors, helpers) {
  return scanOpenClawRuntimeInspectCommands(errors, helpers, 'cli');
}

module.exports = {
  parseOpenClawSkillsJson,
  parseOpenClawPluginsJson,
  parseOpenClawPluginCommandsJson,
  parseOpenClawCliCommandsJson,
  parseOpenClawInspectCommandList,
  parseOpenClawHooksJson,
  scanOpenClawRuntimeSkills,
  scanOpenClawRuntimePlugins,
  scanOpenClawRuntimePluginCommands,
  scanOpenClawRuntimeCliCommands,
  scanOpenClawRuntimeHooks,
};
