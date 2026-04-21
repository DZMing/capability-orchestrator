#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOOK_PACK_DIR = path.join(__dirname, '..', 'adapters', 'openclaw-hook-pack');

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
    ...opts,
  });
}

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-orch-openclaw-'));
  const cfg = path.join(tmp, 'openclaw.json');
  fs.writeFileSync(cfg, '{}\n');
  const env = { ...process.env, OPENCLAW_CONFIG_PATH: cfg };

  const install = run('openclaw', ['plugins', 'install', HOOK_PACK_DIR, '--link'], { env });
  const info = run('openclaw', ['hooks', 'info', 'capability-orchestrator-bootstrap'], { env });
  const configAfterInstall = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  const installed = !!configAfterInstall?.hooks?.internal?.installs?.['openclaw-hook-pack'];
  const enabled = configAfterInstall?.hooks?.internal?.entries?.['capability-orchestrator-bootstrap']?.enabled === true;
  const uninstallLogs = [];
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
    infoRecognized: /capability-orchestrator-bootstrap/.test(info),
    installed,
    enabled,
    uninstallCalled,
    infoRemoved,
    configPath: cfg,
  };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');

  if (!result.installSucceeded || !result.infoRecognized || !result.installed || !result.enabled || !result.uninstallCalled || !result.infoRemoved) {
    process.exit(1);
  }
}

main();
