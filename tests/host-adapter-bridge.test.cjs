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
    platform: 'openclaw',
    cwd: process.cwd(),
    coreRoot: process.cwd(),
  });
  assert.match(text, /platform: openclaw/);
  assert.match(text, /coreRoot:/);
});

test('host bridge: awareness renders snapshot text for active openclaw host', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-bridge-oc-'));
  const binDir = path.join(root, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const fakeOpenClaw = path.join(binDir, 'openclaw');
  fs.writeFileSync(fakeOpenClaw, `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1 $2 $3" == "skills list --json" ]]; then
  cat <<'JSON'
{"skills":[{"name":"oc-bridge","description":"OpenClaw bridge skill","eligible":true,"disabled":false,"bundled":false,"source":"workspace"}]}
JSON
elif [[ "$1 $2 $3" == "plugins list --json" ]]; then
  cat <<'JSON'
{"plugins":[{"id":"capability-orchestrator","description":"bridge plugin","status":"loaded","origin":"config"}]}
JSON
elif [[ "$1 $2 $3" == "hooks list --json" ]]; then
  cat <<'JSON'
{"hooks":[{"name":"capability-orchestrator-bootstrap","description":"bridge hook","source":"openclaw-managed","loadable":true,"disabled":false}]}
JSON
else
  exit 1
fi
`);
  fs.chmodSync(fakeOpenClaw, 0o755);
  const prev = process.env.OPENCLAW_USER_DIR;
  const prevPath = process.env.PATH;
  process.env.OPENCLAW_USER_DIR = root;
  process.env.PATH = `${binDir}:${prevPath || ''}`;
  try {
    const text = renderAwareness({
      platform: 'openclaw',
      cwd: process.cwd(),
      mode: 'list',
    });
    assert.match(text, /OpenClaw Runtime Skills/);
    assert.match(text, /oc-bridge/);
  } finally {
    if (prev === undefined) delete process.env.OPENCLAW_USER_DIR;
    else process.env.OPENCLAW_USER_DIR = prev;
    if (prevPath === undefined) delete process.env.PATH;
    else process.env.PATH = prevPath;
  }
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
