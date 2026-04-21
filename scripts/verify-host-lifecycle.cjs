#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');

function hasCommand(cmd) {
  try {
    execFileSync('command', ['-v', cmd], { stdio: 'ignore', shell: true });
    return true;
  } catch {
    return false;
  }
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60000,
    ...opts,
  });
}

function copyRepoToTemp(dest) {
  fs.cpSync(REPO_ROOT, dest, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(REPO_ROOT, src);
      if (!rel) return true;
      return !rel.startsWith('.git')
        && !rel.startsWith('.omx')
        && !rel.startsWith('node_modules')
        && !rel.startsWith('dist')
        && !rel.includes('__pycache__');
    },
  });
  run('git', ['init', '-q'], { cwd: dest });
  run('git', ['branch', '-M', 'master'], { cwd: dest });
  run('git', ['config', 'user.email', 'capability-orchestrator@example.invalid'], { cwd: dest });
  run('git', ['config', 'user.name', 'capability-orchestrator'], { cwd: dest });
  run('git', ['add', '-A'], { cwd: dest });
  run('git', ['-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'verify host lifecycle source'], { cwd: dest });
}

function installEnv(sourceRepo, extraEnv) {
  return {
    ...process.env,
    CAPABILITY_INSTALL_REPO_URL: sourceRepo,
    CAPABILITY_INSTALL_REF: 'master',
    ...extraEnv,
  };
}

function verifyOpenClaw(sourceRepo) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-orch-lifecycle-openclaw-'));
  const cfg = path.join(tmp, 'openclaw.json');
  const env = installEnv(sourceRepo, {
    OPENCLAW_USER_DIR: tmp,
    OPENCLAW_CONFIG_PATH: cfg,
  });

  const install1 = run('bash', [path.join(REPO_ROOT, 'install.sh'), '--platform=openclaw'], { env });
  const install2 = run('bash', [path.join(REPO_ROOT, 'install.sh'), '--platform=openclaw'], { env });
  const hookInfo = run('openclaw', ['hooks', 'info', 'capability-orchestrator-bootstrap'], { env });
  const inspect = run('openclaw', ['plugins', 'inspect', 'capability-orchestrator'], { env });
  const uninstall = run('bash', [path.join(REPO_ROOT, 'install.sh'), '--platform=openclaw', '--uninstall'], { env });

  let hookRemoved = false;
  try {
    const infoAfter = run('openclaw', ['hooks', 'info', 'capability-orchestrator-bootstrap'], { env });
    hookRemoved = /not found/i.test(infoAfter);
  } catch (error) {
    hookRemoved = /not found/i.test(String(error.stderr || error.stdout || error.message || ''));
  }

  let pluginRemoved = false;
  try {
    run('openclaw', ['plugins', 'inspect', 'capability-orchestrator'], { env });
  } catch (error) {
    pluginRemoved = /not found|not installed|unknown/i.test(String(error.stderr || error.stdout || error.message || ''));
  }

  return {
    install1: /OpenClaw hook-pack \+ adapter|OpenClaw hook-pack/.test(install1),
    reinstall: /OpenClaw hook-pack \+ adapter|OpenClaw hook-pack/.test(install2),
    hookRecognized: /capability-orchestrator-bootstrap/.test(hookInfo),
    adapterLoaded: /Status:\s+loaded/i.test(inspect),
    commandsExposed: /Commands:\s*[\s\S]*capability-orchestrator-awareness/i.test(inspect)
      && /CLI commands:\s*[\s\S]*cap-orch/i.test(inspect),
    uninstall: /卸载完成|OpenClaw hook-pack/.test(uninstall),
    hookRemoved,
    pluginRemoved,
  };
}

function verifyHermesBridge(env) {
  const script = `
from hermes_cli.plugins import discover_plugins, get_plugin_commands, invoke_hook
discover_plugins()
commands = get_plugin_commands()
handler = commands["cap-orch"]["handler"]
status_text = handler("status")
route_text = handler("route delegate coding tasks to a coding agent background process")
hook_results = invoke_hook("pre_llm_call", session_id="verify-lifecycle", user_message="hi", conversation_history=[], is_first_turn=True, model="test")
hook_text = hook_results[0]["context"] if hook_results else ""
print("STATUS>>>" + status_text)
print("ROUTE>>>" + route_text)
print("HOOK>>>" + hook_text)
`;
  const output = run('python3', ['-c', script], { env });
  return /STATUS>>>capability-orchestrator host bridge/i.test(output)
    && /ROUTE>>>[\s\S]*(AUTO-ROUTE|立即调用|No route match)/i.test(output)
    && /HOOK>>>[\s\S]*(\[能力感知\]|环境能力感知)/i.test(output);
}

function verifyHermes(sourceRepo) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-orch-lifecycle-hermes-'));
  const home = path.join(tmp, 'hermes-home');
  const env = installEnv(sourceRepo, { HERMES_HOME: home });

  const install1 = run('bash', [path.join(REPO_ROOT, 'install.sh'), '--platform=hermes'], { env });
  const list1 = run('hermes', ['plugins', 'list'], { env });
  const bridgeOk1 = verifyHermesBridge(env);
  const install2 = run('bash', [path.join(REPO_ROOT, 'install.sh'), '--platform=hermes'], { env });
  const list2 = run('hermes', ['plugins', 'list'], { env });
  const disable = run('hermes', ['plugins', 'disable', 'capability-orchestrator'], { env });
  const enable = run('hermes', ['plugins', 'enable', 'capability-orchestrator'], { env });
  const uninstall = run('bash', [path.join(REPO_ROOT, 'install.sh'), '--platform=hermes', '--uninstall'], { env });
  const listAfter = run('hermes', ['plugins', 'list'], { env });

  return {
    install1: /Hermes adapter/.test(install1),
    listed: /capability-orchestrat/i.test(list1),
    bridgeOk: bridgeOk1,
    reinstall: /Hermes adapter/.test(install2) && /capability-orchestrat/i.test(list2),
    disable: /disabled|ok/i.test(disable),
    enable: /enabled|ok/i.test(enable),
    uninstall: /卸载完成|Hermes adapter/.test(uninstall),
    removed: !/capability-orchestrat/i.test(listAfter),
  };
}

function allTrue(obj) {
  return Object.values(obj).every(Boolean);
}

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-orch-lifecycle-source-'));
  copyRepoToTemp(tmp);

  const result = {
    sourceRepo: tmp,
    openclaw: hasCommand('openclaw') ? verifyOpenClaw(tmp) : { skipped: true },
    hermes: hasCommand('hermes') ? verifyHermes(tmp) : { skipped: true },
  };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');

  if (result.openclaw.skipped || result.hermes.skipped) {
    process.exit(1);
  }
  if (!allTrue(result.openclaw) || !allTrue(result.hermes)) {
    process.exit(1);
  }
}

main();
