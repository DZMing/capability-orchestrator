#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const claude = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
const codex = JSON.parse(fs.readFileSync(path.join(root, '.codex-plugin', 'plugin.json'), 'utf8'));
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');

const latestTag = execFileSync('git', ['tag', '--list', 'v*'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  .pop() || '';
const headCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const latestTagCommit = latestTag
  ? execFileSync('git', ['rev-list', '-n', '1', latestTag], { cwd: root, encoding: 'utf8' }).trim()
  : '';
const worktreeDirty = execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }).trim().length > 0;

const topChangelog = (changelog.match(/^## \[([^\]]+)\]/m) || [null, ''])[1];
const status = {
  packageVersion: pkg.version,
  claudeManifestVersion: claude.version,
  codexManifestVersion: codex.version,
  topChangelogVersion: topChangelog,
  latestGitTag: latestTag,
  headCommit,
  latestTagCommit,
  versionSyncOk: pkg.version === claude.version && pkg.version === codex.version,
  changelogSyncOk: topChangelog === pkg.version,
  latestTagMatchesPackage: latestTag === `v${pkg.version}`,
  headMatchesLatestTag: !!latestTagCommit && latestTagCommit === headCommit,
  worktreeClean: !worktreeDirty,
};

console.log(JSON.stringify(status, null, 2));

if (!status.versionSyncOk || !status.changelogSyncOk) process.exit(1);
