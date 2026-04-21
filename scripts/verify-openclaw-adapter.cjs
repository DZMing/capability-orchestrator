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

  const config = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  const installed = !!config?.hooks?.internal?.installs?.['openclaw-hook-pack'];
  const enabled = config?.hooks?.internal?.entries?.['capability-orchestrator-bootstrap']?.enabled === true;

  const result = {
    installSucceeded: /Installed|Linked hook pack path/.test(install),
    infoRecognized: /capability-orchestrator-bootstrap/.test(info),
    installed,
    enabled,
    configPath: cfg,
  };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');

  if (!result.installSucceeded || !result.infoRecognized || !result.installed || !result.enabled) {
    process.exit(1);
  }
}

main();
