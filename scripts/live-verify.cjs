#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const REAL_HOME = process.env.REAL_HOME || os.homedir();
const LIVE_VERIFY_ROOT = path.join(REAL_HOME, '.capability-orchestrator-live');
const CLAUDE_AUTH = path.join(REAL_HOME, '.claude', '.credentials.json');
const CODEX_AUTH = path.join(REAL_HOME, '.codex', 'auth.json');
const CODEX_CONFIG = path.join(REAL_HOME, '.codex', 'config.toml');

function resolveCodexWrapper() {
  if (process.env.CODEX_WRAPPER) return process.env.CODEX_WRAPPER;
  const defaultWrapper = path.join(REAL_HOME, '.codex', 'codex_wrapper.sh');
  if (fs.existsSync(defaultWrapper)) return defaultWrapper;
  const which = run('which', ['codex']);
  if (which.status === 0) return (which.stdout || '').trim();
  throw new Error('cannot locate codex wrapper');
}

function resolveCodexRealBin(wrapperPath) {
  if (process.env.CODEX_REAL_BIN) return process.env.CODEX_REAL_BIN;
  const wrapper = fs.existsSync(wrapperPath) ? fs.readFileSync(wrapperPath, 'utf8') : '';
  const match = wrapper.match(/REAL_CODEX_BIN_DEFAULT=\"([^\"]+)\"/);
  if (match) return match[1];
  return '/opt/homebrew/bin/codex';
}

function parseArgs(argv) {
  const args = { platform: 'claude', timeoutSec: 25 };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--platform') args.platform = argv[++i];
    else if (arg.startsWith('--platform=')) args.platform = arg.split('=')[1];
    else if (arg === '--timeout') args.timeoutSec = Number(argv[++i]);
    else if (arg.startsWith('--timeout=')) args.timeoutSec = Number(arg.split('=')[1]);
  }
  return args;
}

function makeTempDir(prefix) {
  ensureDir(LIVE_VERIFY_ROOT);
  return fs.mkdtempSync(path.join(LIVE_VERIFY_ROOT, prefix));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function syncWorktreeSnapshot(installDir) {
  fs.rmSync(installDir, { recursive: true, force: true });
  fs.cpSync(REPO_ROOT, installDir, {
    recursive: true,
    filter(src) {
      const rel = path.relative(REPO_ROOT, src);
      if (!rel) return true;
      const top = rel.split(path.sep)[0];
      return top !== '.git' && top !== '.omx' && top !== 'node_modules';
    },
  });
  for (const relPath of ['scripts/scan-environment.cjs', 'scripts/route-matcher.cjs']) {
    const scriptPath = path.join(installDir, relPath);
    if (fs.existsSync(scriptPath)) fs.chmodSync(scriptPath, 0o755);
  }
}

function maybeCopy(src, dest) {
  if (fs.existsSync(src)) fs.copyFileSync(src, dest);
}

function run(cmd, args, options = {}) {
  return spawnSync(cmd, args, {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
}

function summarizeClaude(stdout, targetName = 'valid-skill') {
  const summary = {
    hookEvents: 0,
    autoRouteSeen: false,
    validSkillSeen: false,
    matchedRouteSeen: false,
    matchedRouteSample: '',
  };
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      const subtype = String(obj.subtype || '').toLowerCase();
      if (subtype.startsWith('hook_')) summary.hookEvents += 1;
      if (String(obj.subtype || '').toLowerCase() === 'hook_response' &&
          String(obj.hook_event || '').toLowerCase() === 'userpromptsubmit') {
        const output = String(obj.output || '');
        const stdoutText = String(obj.stdout || '');
        const hookOutput = output === stdoutText || !stdoutText
          ? output
          : `${output}\n${stdoutText}`;
        const hasAutoRoute = hookOutput.includes('[AUTO-ROUTE]');
        const hasTarget = hookOutput.includes(targetName);
        if (hasAutoRoute) summary.autoRouteSeen = true;
        if (hasTarget) summary.validSkillSeen = true;
        if (hasAutoRoute && hasTarget) {
          summary.matchedRouteSeen = true;
          if (!summary.matchedRouteSample) {
            summary.matchedRouteSample = hookOutput.trim().slice(0, 400);
          }
        }
      }
    } catch {
      continue;
    }
  }
  return summary;
}

function summarizeCodexRouteLog(routeLog, targetName = 'valid-skill') {
  const summary = {
    matchedRouteSeen: false,
    matchedRouteEntry: null,
  };

  for (const line of routeLog.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.action === 'route' && entry.targetType === 'skill' && entry.targetName === targetName) {
        summary.matchedRouteSeen = true;
        summary.matchedRouteEntry = entry;
      }
    } catch {
      continue;
    }
  }

  return summary;
}

function verifyClaude(timeoutSec) {
  if (!fs.existsSync(CLAUDE_AUTH)) {
    throw new Error('missing ~/.claude/.credentials.json');
  }

  const tmpHome = makeTempDir('cap-orch-live-claude-');
  const claudeDir = path.join(tmpHome, '.claude');
  ensureDir(claudeDir);
  maybeCopy(CLAUDE_AUTH, path.join(claudeDir, '.credentials.json'));

  const installEnv = { ...process.env, HOME: tmpHome, CLAUDE_USER_DIR: claudeDir };
  const install = run('bash', [path.join(REPO_ROOT, 'install.sh')], { env: installEnv });
  if (install.status !== 0) throw new Error(`install failed: ${install.stderr || install.stdout}`);
  syncWorktreeSnapshot(path.join(claudeDir, 'plugins', 'cache', 'capability-orchestrator'));

  const fixture = path.join(REPO_ROOT, 'tests', 'fixtures', 'project');
  const debugFile = path.join(tmpHome, 'claude-debug.log');
  const env = { ...process.env, HOME: tmpHome, CLAUDE_USER_DIR: claudeDir };
  const proc = run('claude', [
    '-p',
    '--verbose',
    '--output-format',
    'stream-json',
    '--include-hook-events',
    '--debug-file',
    debugFile,
    'I need a valid test skill for this important task',
  ], { cwd: fixture, env, timeout: timeoutSec * 1000 });

  const summary = summarizeClaude(proc.stdout || '');
  const debugTail = fs.existsSync(debugFile)
    ? fs.readFileSync(debugFile, 'utf8').split('\n').slice(-25).join('\n')
    : '';

  fs.rmSync(tmpHome, { recursive: true, force: true });

  return {
    platform: 'claude',
    installStatus: install.status,
    exitStatus: proc.status,
    timedOut: !!proc.error && proc.error.code === 'ETIMEDOUT',
    hookEvents: summary.hookEvents,
    autoRouteSeen: summary.autoRouteSeen,
    validSkillSeen: summary.validSkillSeen,
    matchedRouteSeen: summary.matchedRouteSeen,
    matchedRouteSample: summary.matchedRouteSample,
    stdoutHead: (proc.stdout || '').split('\n').slice(0, 20).join('\n'),
    debugTail,
  };
}

function verifyCodex(timeoutSec) {
  if (!fs.existsSync(CODEX_AUTH)) throw new Error('missing ~/.codex/auth.json');

  const tmpRoot = makeTempDir('cap-orch-live-codex-');
  const tmpHome = path.join(tmpRoot, 'home');
  const codexDir = path.join(tmpHome, '.codex');
  ensureDir(codexDir);
  maybeCopy(CODEX_AUTH, path.join(codexDir, 'auth.json'));
  maybeCopy(CODEX_CONFIG, path.join(codexDir, 'config.toml'));

  const installEnv = {
    ...process.env,
    CODEX_USER_DIR: codexDir,
  };
  const install = run('bash', [path.join(REPO_ROOT, 'install.sh'), '--platform=codex'], { env: installEnv });
  if (install.status !== 0) throw new Error(`install failed: ${install.stderr || install.stdout}`);
  syncWorktreeSnapshot(path.join(codexDir, 'plugins', 'cache', 'capability-orchestrator'));

  const project = path.join(tmpRoot, 'project');
  const skillDir = path.join(project, '.agents', 'skills', 'valid-skill');
  ensureDir(skillDir);
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: valid-skill\ndescription: A valid test skill\n---\n');

  const aliasPath = '/tmp/cap-orch-codex-live';
  try {
    if (fs.existsSync(aliasPath) || fs.lstatSync(aliasPath).isSymbolicLink()) {
      fs.rmSync(aliasPath, { recursive: true, force: true });
    }
  } catch {}
  fs.symlinkSync(project, aliasPath);

  const wrapperPath = resolveCodexWrapper();
  const realBin = resolveCodexRealBin(wrapperPath);
  const env = {
    ...process.env,
    HOME: tmpHome,
    CODEX_USER_DIR: codexDir,
    CODEX_HOOKS: '1',
    CODEX_REAL_BIN: realBin,
  };
  const proc = run(wrapperPath, [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '-C',
    aliasPath,
    'I need a valid test skill for this important task',
  ], { env, timeout: timeoutSec * 1000 });

  const routeLogPath = path.join(codexDir, 'plugins', 'cache', 'capability-orchestrator', 'data', 'route-log.jsonl');
  const routeLog = fs.existsSync(routeLogPath) ? fs.readFileSync(routeLogPath, 'utf8') : '';
  const stdout = proc.stdout || '';
  const stderr = proc.stderr || '';
  const routeSummary = summarizeCodexRouteLog(routeLog);

  const summary = {
    platform: 'codex',
    installStatus: install.status,
    exitStatus: proc.status,
    timedOut: !!proc.error && proc.error.code === 'ETIMEDOUT',
    validSkillSeen: stdout.includes('valid-skill'),
    routeLogSeen: routeSummary.matchedRouteSeen,
    routeLogEntry: routeSummary.matchedRouteEntry,
    utf8HeaderErrorSeen: stderr.includes('x-codex-turn-metadata') || stdout.includes('x-codex-turn-metadata'),
    stdoutHead: stdout.split('\n').slice(0, 20).join('\n'),
    stderrHead: stderr.split('\n').slice(0, 20).join('\n'),
    wrapperPath,
    realBin,
  };

  try { fs.rmSync(aliasPath, { recursive: true, force: true }); } catch {}
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  return summary;
}

function main() {
  const { platform, timeoutSec } = parseArgs(process.argv);
  let result;
  if (platform === 'claude') result = verifyClaude(timeoutSec);
  else if (platform === 'codex') result = verifyCodex(timeoutSec);
  else {
    console.error(`Unsupported platform: ${platform}`);
    process.exit(2);
  }

  console.log(JSON.stringify(result, null, 2));

  if (platform === 'claude') {
    if (!result.matchedRouteSeen) process.exit(1);
    return;
  }

  if (!(result.routeLogSeen && !result.utf8HeaderErrorSeen)) process.exit(1);
}

if (require.main === module) {
  main();
} else {
  module.exports = {
    summarizeClaude,
    summarizeCodexRouteLog,
  };
}
