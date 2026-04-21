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
  try {
    return _main(tmp);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

function _main(tmp) {
  const home = path.join(tmp, 'hermes-home');
  const repo = path.join(tmp, 'adapter-repo');
  fs.mkdirSync(home, { recursive: true });
  copyDir(ADAPTER_SRC, repo);
  fs.writeFileSync(path.join(repo, '.capability-orchestrator-core-root'), path.join(__dirname, '..') + '\n');

  run('git', ['init', '-q'], { cwd: repo });
  run('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  run('git', ['config', 'user.name', 'test'], { cwd: repo });
  run('git', ['add', '.'], { cwd: repo });
  run('git', ['commit', '-q', '-m', 'init'], { cwd: repo });

  const env = { ...process.env, HERMES_HOME: home };
  const install = run('hermes', ['plugins', 'install', `file://${repo}`], { env });
  const list = run('hermes', ['plugins', 'list'], { env });
  const bridgeCheck = run('python3', ['-c', `
from hermes_cli.plugins import discover_plugins, get_plugin_commands, invoke_hook
discover_plugins()
commands = get_plugin_commands()
handler = commands["cap-orch"]["handler"]
status_text = handler("status")
route_text = handler("route delegate coding tasks to a coding agent background process")
hook_results = invoke_hook("pre_llm_call", session_id="verify-hermes", user_message="hi", conversation_history=[], is_first_turn=True, model="test")
hook_text = hook_results[0]["context"] if hook_results else ""
print("STATUS>>>" + status_text)
print("ROUTE>>>" + route_text)
print("HOOK>>>" + hook_text)
`], { env });
  const disable = run('hermes', ['plugins', 'disable', 'capability-orchestrator'], { env });
  const listDisabled = run('hermes', ['plugins', 'list'], { env });
  const enable = run('hermes', ['plugins', 'enable', 'capability-orchestrator'], { env });
  const listEnabled = run('hermes', ['plugins', 'list'], { env });
  const remove = run('hermes', ['plugins', 'remove', 'capability-orchestrator'], { env });
  const listAfterRemove = run('hermes', ['plugins', 'list'], { env });

  const result = {
    installSucceeded: /Installed|Plugin installed/.test(install),
    listed: /capability-orchestrat/i.test(list),
    bridgeStatusOk: /STATUS>>>capability-orchestrator host bridge/i.test(bridgeCheck),
    bridgeRouteOk: /ROUTE>>>[\s\S]*(AUTO-ROUTE|立即调用|Best route|No route match)/i.test(bridgeCheck),
    bridgeHookOk: /HOOK>>>[\s\S]*(\[能力感知\]|环境能力感知)/i.test(bridgeCheck),
    disabled: /disabled/i.test(disable) || /capability-orchestrat/i.test(listDisabled),
    reenabled: /enabled/i.test(enable) || /capability-orchestrat/i.test(listEnabled),
    removed: /removed|deleted/i.test(remove) || !/capability-orchestrat/i.test(listAfterRemove),
    home,
  };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (!result.installSucceeded || !result.listed || !result.bridgeStatusOk || !result.bridgeRouteOk || !result.bridgeHookOk || !result.disabled || !result.reenabled || !result.removed) process.exit(1);
}

main();
