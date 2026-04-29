'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  buildStatus,
  renderAwareness,
  renderRoute,
} = require('../scripts/host-adapter-bridge.cjs');

test('host bridge: status reflects requested platform and cwd', () => {
  const text = buildStatus({
    platform: 'hermes',
    cwd: process.cwd(),
    coreRoot: process.cwd(),
  });
  assert.match(text, /platform: hermes/);
  assert.match(text, /coreRoot:/);
});

test('host bridge: OpenClaw status is frozen instead of ready', () => {
  const text = buildStatus({
    platform: 'openclaw',
    cwd: process.cwd(),
    coreRoot: process.cwd(),
  });
  assert.match(text, /platform: openclaw/);
  assert.match(text, /state: frozen/);
  assert.match(text, /read-only skill scanning/);
});

test('host bridge: route returns rendered text payload', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-bridge-hermes-'));
  const binDir = path.join(root, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const fakeHermes = path.join(binDir, 'hermes');
  fs.writeFileSync(fakeHermes, `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1 $2" == "skills list" ]]; then
  cat <<'TABLE'
Installed Skills
│ Name                     │ Category             │ Source │ Trust │ Notes │
│ autonomous-coding-agent │ delegate coding tasks to a coding agent background process │ user │ trusted │ │
TABLE
elif [[ "$1 $2" == "plugins list" ]]; then
  cat <<'TABLE'
Installed Plugins
│ Name │ Status │ Version │ Description │ Source │
TABLE
else
  exit 1
fi
`);
  fs.chmodSync(fakeHermes, 0o755);
  const prev = process.env.HERMES_USER_DIR;
  const prevHome = process.env.HERMES_HOME;
  const prevPath = process.env.PATH;
  process.env.HERMES_USER_DIR = root;
  process.env.HERMES_HOME = root;
  process.env.PATH = `${binDir}:${prevPath || ''}`;
  try {
    const result = renderRoute({
      platform: 'hermes',
      cwd: process.cwd(),
      prompt: 'delegate coding tasks to a coding agent background process',
    });
    assert.match(result.rendered, /AUTO-ROUTE|立即调用/);
    assert.equal(result.explain.action, 'route');
  } finally {
    if (prev === undefined) delete process.env.HERMES_USER_DIR;
    else process.env.HERMES_USER_DIR = prev;
    if (prevHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = prevHome;
    if (prevPath === undefined) delete process.env.PATH;
    else process.env.PATH = prevPath;
  }
});
