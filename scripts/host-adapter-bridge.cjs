#!/usr/bin/env node
'use strict';

const path = require('path');
const { collectSnapshot, renderSnapshot } = require('./scan-environment.cjs');
const {
  resolveRouteDecision,
  createOutput,
  createCommandOutput,
  createMcpOutput,
} = require('./route-matcher.cjs');
const { resolveUserDirWithSource } = require('./lib/user-dir.cjs');

function setHostUserDirEnv(platform, userDir) {
  if (!userDir) return [];
  const touched = [];
  const pairs = {
    claude: [['CLAUDE_USER_DIR', userDir]],
    codex: [['CODEX_USER_DIR', userDir]],
    openclaw: [['OPENCLAW_USER_DIR', userDir]],
    hermes: [['HERMES_HOME', userDir], ['HERMES_USER_DIR', userDir]],
  };
  for (const [key, value] of pairs[platform] || []) {
    touched.push([key, process.env[key]]);
    process.env[key] = value;
  }
  return touched;
}

function withScopedHostEnv(platform, userDir, fn) {
  const prevPlatform = process.env.CAPABILITY_PLATFORM;
  process.env.CAPABILITY_PLATFORM = platform;
  const touched = setHostUserDirEnv(platform, userDir);
  try {
    return fn();
  } finally {
    if (prevPlatform === undefined) delete process.env.CAPABILITY_PLATFORM;
    else process.env.CAPABILITY_PLATFORM = prevPlatform;
    for (const [key, prev] of touched) {
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    }
  }
}

function captureStdout(fn) {
  let output = '';
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, encoding, cb) => {
    output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString(encoding || 'utf8');
    if (typeof cb === 'function') cb();
    return true;
  };
  try {
    fn();
  } finally {
    process.stdout.write = original;
  }
  return output.trim();
}

function renderDecision(decision) {
  if (!decision || !decision.match) {
    return 'No route match.';
  }
  return captureStdout(() => {
    if (decision.targetType === 'command') createCommandOutput(decision.match);
    else if (decision.targetType === 'mcp') createMcpOutput(decision.match);
    else createOutput(decision.match);
  });
}

function renderAwareness({ platform, cwd, userDir, mode = 'awareness' }) {
  return withScopedHostEnv(platform, userDir, () => {
    const snapshot = collectSnapshot(cwd, userDir);
    const { text } = renderSnapshot(snapshot, mode);
    return String(text || '').trim();
  });
}

function renderRoute({ platform, cwd, userDir, prompt }) {
  return withScopedHostEnv(platform, userDir, () => {
    const decision = resolveRouteDecision(JSON.stringify({ prompt, cwd }));
    return {
      explain: decision.explain,
      rendered: renderDecision(decision),
    };
  });
}

function buildStatus({ platform, cwd, userDir, coreRoot }) {
  return withScopedHostEnv(platform, userDir, () => {
    const snapshot = collectSnapshot(cwd, userDir);
    const { dir: resolvedUserDir, source } = resolveUserDirWithSource();
    return [
      `capability-orchestrator host bridge`,
      `platform: ${platform}`,
      `cwd: ${cwd || process.cwd()}`,
      `coreRoot: ${coreRoot || process.cwd()}`,
      `userDir: ${userDir || resolvedUserDir}`,
      `userDirSource: ${source}`,
      `sections: ${snapshot.sections.length}`,
      `errors: ${snapshot.errors.length}`,
    ].join('\n');
  });
}

function getArg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  return inline ? inline.slice(prefix.length) : undefined;
}

function main() {
  const mode = getArg('mode') || 'status';
  const platform = getArg('platform') || process.env.CAPABILITY_PLATFORM || 'claude';
  const cwd = getArg('cwd') || process.cwd();
  const userDir = getArg('user-dir');
  const prompt = getArg('prompt') || '';
  const format = getArg('format') || 'text';
  const coreRoot = path.resolve(__dirname, '..');

  if (mode === 'status') {
    const text = buildStatus({ platform, cwd, userDir, coreRoot });
    if (format === 'json') process.stdout.write(JSON.stringify({ text }) + '\n');
    else process.stdout.write(text + '\n');
    return;
  }

  if (mode === 'awareness' || mode === 'list') {
    const text = renderAwareness({ platform, cwd, userDir, mode });
    if (format === 'json') process.stdout.write(JSON.stringify({ text }) + '\n');
    else process.stdout.write(text + '\n');
    return;
  }

  if (mode === 'route') {
    const result = renderRoute({ platform, cwd, userDir, prompt });
    if (format === 'json') process.stdout.write(JSON.stringify(result) + '\n');
    else process.stdout.write((result.rendered || 'No route match.') + '\n');
    return;
  }

  process.stderr.write(`Unsupported mode: ${mode}\n`);
  process.exit(1);
}

module.exports = {
  withScopedHostEnv,
  renderAwareness,
  renderRoute,
  buildStatus,
  renderDecision,
};

if (require.main === module) {
  main();
}
