#!/usr/bin/env node
'use strict';

const path = require('path');
const { resolveRouteDecision } = require('./route-matcher.cjs');

const repoRoot = path.join(__dirname, '..');
const fixtureProject = path.join(repoRoot, 'tests', 'fixtures', 'project');
const fixtureUser = path.join(repoRoot, 'tests', 'fixtures', 'user');

process.env.CLAUDE_USER_DIR = fixtureUser;

const input = JSON.stringify({
  prompt: 'I need a valid test skill for this important task',
  cwd: fixtureProject,
});

const decision = resolveRouteDecision(input);
process.stdout.write(JSON.stringify(decision.explain) + '\n');
