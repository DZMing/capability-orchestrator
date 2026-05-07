'use strict';

process.env.CAPABILITY_PLATFORM = 'claude';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const corpus = require('./fixtures/route-corpus.json');
const { resolveRouteDecision } = require('../scripts/route-matcher.cjs');

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function makeCorpusFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'route-corpus-'));
  const project = path.join(root, 'project');
  const userDir = path.join(root, 'user');
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(userDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });

  writeFile(path.join(project, 'AGENTS.md'), 'Verify before claiming completion.\n');
  writeFile(path.join(project, '.claude', 'skills', 'artifact-review', 'SKILL.md'), [
    '---',
    'name: artifact-review',
    'description: artifact review helper for evidence and quality review',
    '---',
    '',
  ].join('\n'));
  writeFile(path.join(project, '.claude', 'commands', 'ship-it.md'), [
    '---',
    'description: ship it command for release packaging',
    '---',
    'Do not inject this command body.',
    '',
  ].join('\n'));
  writeFile(path.join(project, '.mcp.json'), JSON.stringify({
    mcpServers: {
      'data-tool': {
        command: 'node',
        description: 'database query analytics report helper',
      },
    },
  }));

  const previous = {
    CAPABILITY_PLATFORM: process.env.CAPABILITY_PLATFORM,
    CAPABILITY_PROJECT_DIR: process.env.CAPABILITY_PROJECT_DIR,
    CAPABILITY_USER_DIR: process.env.CAPABILITY_USER_DIR,
    CLAUDE_USER_DIR: process.env.CLAUDE_USER_DIR,
    CLAUDE_PLUGIN_DATA: process.env.CLAUDE_PLUGIN_DATA,
    OPENCLAW_USER_DIR: process.env.OPENCLAW_USER_DIR,
    HERMES_USER_DIR: process.env.HERMES_USER_DIR,
  };
  process.env.CAPABILITY_PLATFORM = 'claude';
  process.env.CAPABILITY_PROJECT_DIR = project;
  process.env.CAPABILITY_USER_DIR = userDir;
  process.env.CLAUDE_USER_DIR = userDir;
  process.env.CLAUDE_PLUGIN_DATA = dataDir;
  process.env.OPENCLAW_USER_DIR = path.join(root, 'openclaw');
  process.env.HERMES_USER_DIR = path.join(root, 'hermes');

  return { root, project, previous };
}

function restoreEnv(previous) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test('route corpus: precision/recall expectations stay stable', () => {
  const fixture = makeCorpusFixture();
  try {
    let truePositive = 0;
    let expectedPositive = 0;
    let actualPositive = 0;
    const failures = [];

    for (const item of corpus) {
      const decision = resolveRouteDecision(JSON.stringify({ prompt: item.prompt, cwd: fixture.project }));
      const explain = decision.explain;
      const expected = item.expected;
      const expectedRoute = expected.action === 'route';
      const actualRoute = explain.action === 'route';
      if (expectedRoute) expectedPositive++;
      if (actualRoute) actualPositive++;

      let ok = true;
      for (const [key, value] of Object.entries(expected)) {
        if (explain[key] !== value) ok = false;
      }
      if (ok && expectedRoute && actualRoute) truePositive++;
      if (!ok) failures.push({ name: item.name, expected, actual: explain });
    }

    const precision = actualPositive === 0 ? 1 : truePositive / actualPositive;
    const recall = expectedPositive === 0 ? 1 : truePositive / expectedPositive;
    assert.deepEqual(failures, []);
    assert.ok(precision >= 0.95, `precision=${precision}`);
    assert.ok(recall >= 0.95, `recall=${recall}`);
  } finally {
    restoreEnv(fixture.previous);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
