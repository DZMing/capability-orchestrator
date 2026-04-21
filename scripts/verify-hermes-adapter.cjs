#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ADAPTER_SRC = path.join(__dirname, '..', 'adapters', 'hermes');

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 40000,
    ...opts,
  });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-orch-hermes-'));
  const home = path.join(tmp, 'hermes-home');
  const repo = path.join(tmp, 'adapter-repo');
  fs.mkdirSync(home, { recursive: true });
  copyDir(ADAPTER_SRC, repo);

  run('git', ['init', '-q'], { cwd: repo });
  run('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  run('git', ['config', 'user.name', 'test'], { cwd: repo });
  run('git', ['add', '.'], { cwd: repo });
  run('git', ['commit', '-q', '-m', 'init'], { cwd: repo });

  const env = { ...process.env, HERMES_HOME: home };
  const install = run('hermes', ['plugins', 'install', `file://${repo}`], { env });
  const list = run('hermes', ['plugins', 'list'], { env });

  const result = {
    installSucceeded: /Installed|Plugin installed/.test(install),
    listed: /capability-orchestrat/i.test(list),
    home,
  };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (!result.installSucceeded || !result.listed) process.exit(1);
}

main();
