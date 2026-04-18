#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveRouteDecision } = require('./route-matcher.cjs');

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'capability-debug-route-'));

try {
  const projectDir = path.join(tmpBase, 'project');
  const userDir = path.join(tmpBase, 'user');
  const skillDir = path.join(projectDir, '.claude', 'skills', 'valid-skill');

  fs.mkdirSync(skillDir, { recursive: true });
  fs.mkdirSync(userDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
    '---',
    'name: valid-skill',
    'description: A valid test skill',
    '---',
    '',
    'This is a valid skill.',
    '',
  ].join('\n'));

  process.env.CLAUDE_USER_DIR = userDir;

  const input = JSON.stringify({
    prompt: 'I need a valid test skill for this important task',
    cwd: projectDir,
  });

  const decision = resolveRouteDecision(input);
  process.stdout.write(JSON.stringify(decision.explain) + '\n');
} finally {
  fs.rmSync(tmpBase, { recursive: true, force: true });
}
