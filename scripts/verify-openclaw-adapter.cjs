#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const HOOK_PACK_DIR = path.join(__dirname, '..', 'adapters', 'openclaw-hook-pack');
const ADAPTER_DIR = path.join(__dirname, '..', 'adapters', 'openclaw');

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
    ...opts,
  });
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-orch-openclaw-'));
  const cfg = path.join(tmp, 'openclaw.json');
  fs.writeFileSync(cfg, '{}\n');
  const env = { ...process.env, OPENCLAW_CONFIG_PATH: cfg };

  const install = run('openclaw', ['plugins', 'install', HOOK_PACK_DIR, '--link'], { env });
  const pluginInstall = run('openclaw', ['plugins', 'install', ADAPTER_DIR, '--link'], { env });
  const info = run('openclaw', ['hooks', 'info', 'capability-orchestrator-bootstrap'], { env });
  const inspect = run('openclaw', ['plugins', 'inspect', 'capability-orchestrator'], { env });
  const configAfterInstall = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  const installed = !!configAfterInstall?.hooks?.internal?.installs?.['openclaw-hook-pack'];
  const enabled = configAfterInstall?.hooks?.internal?.entries?.['capability-orchestrator-bootstrap']?.enabled === true;
  const handlerPath = path.join(HOOK_PACK_DIR, 'capability-orchestrator-bootstrap', 'handler.js');
  const prevConfigPath = process.env.OPENCLAW_CONFIG_PATH;
  process.env.OPENCLAW_CONFIG_PATH = cfg;
  const handlerModule = await import(pathToFileURL(handlerPath).href);
  const event = {
    type: 'agent',
    action: 'bootstrap',
    sessionKey: 'verify-openclaw',
    timestamp: new Date(),
    context: { workspaceDir: process.cwd() },
    messages: [],
  };
  await handlerModule.default(event);
  if (prevConfigPath === undefined) delete process.env.OPENCLAW_CONFIG_PATH;
  else process.env.OPENCLAW_CONFIG_PATH = prevConfigPath;
  const awarenessInjected = event.messages.some((msg) => {
    const text = String(msg || '');
    return text.includes('环境能力感知') || text.includes('[能力感知]');
  });
  const uninstallLogs = [];
  const adapterLoaded = /Status:\s+loaded/i.test(inspect);
  const adapterCommandsExposed = /Commands:\s*[\s\S]*capability-orchestrator-awareness/i.test(inspect)
    && /CLI commands:\s*[\s\S]*cap-orch/i.test(inspect);
  uninstallLogs.push(run('openclaw', ['plugins', 'uninstall', 'capability-orchestrator', '--force'], { env }));
  for (const args of [
    ['config', 'unset', 'hooks.internal.entries.capability-orchestrator-bootstrap'],
    ['config', 'unset', 'hooks.internal.installs.openclaw-hook-pack'],
    ['config', 'unset', 'hooks.internal.load.extraDirs.0'],
  ]) {
    uninstallLogs.push(run('openclaw', args, { env }));
  }
  let infoAfter = '';
  try {
    infoAfter = run('openclaw', ['hooks', 'info', 'capability-orchestrator-bootstrap'], { env });
  } catch (error) {
    infoAfter = String(error.stderr || error.stdout || error.message || '');
  }

  const uninstallCalled = uninstallLogs.every((out) => /Removed|overwrite|apply/i.test(out));
  const infoRemoved = /not found/i.test(infoAfter) || !/capability-orchestrator-bootstrap/.test(infoAfter);

  const result = {
    installSucceeded: /Installed|Linked hook pack path/.test(install),
    pluginInstallSucceeded: /Linked plugin path|Installed/i.test(pluginInstall),
    infoRecognized: /capability-orchestrator-bootstrap/.test(info),
    installed,
    enabled,
    awarenessInjected,
    adapterLoaded,
    adapterCommandsExposed,
    uninstallCalled,
    infoRemoved,
    configPath: cfg,
  };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');

  if (!result.installSucceeded || !result.pluginInstallSucceeded || !result.infoRecognized || !result.installed || !result.enabled || !result.awarenessInjected || !result.adapterLoaded || !result.adapterCommandsExposed || !result.uninstallCalled || !result.infoRemoved) {
    process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(String(error && error.stack ? error.stack : error) + '\n');
  process.exit(1);
});
