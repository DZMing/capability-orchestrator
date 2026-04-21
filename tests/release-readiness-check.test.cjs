'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildGitHubHeaders,
  buildStatus,
  readRepoSlug,
} = require('../scripts/release-readiness-check.cjs');

function makeStatus(releaseProbe, overrides = {}) {
  return buildStatus({
    pkg: { version: '1.9.1' },
    claude: { version: '1.9.1' },
    codex: { version: '1.9.1' },
    openclaw: { version: '1.9.1' },
    openclawHookPack: { version: '1.9.1' },
    hermesYaml: '1.9.1',
    changelog: '# Changelog\n\n## [1.9.1] - 2026-04-20\n',
    latestTag: overrides.latestTag || 'v1.9.1',
    headCommit: overrides.headCommit || 'abc123',
    latestTagCommit: overrides.latestTagCommit || 'abc123',
    worktreeDirty: !!overrides.worktreeDirty,
    releaseProbe,
  });
}

test('readRepoSlug: extracts owner/name from git URL', () => {
  assert.equal(readRepoSlug({
    repository: { url: 'https://github.com/DZMing/capability-orchestrator.git' },
  }), 'DZMing/capability-orchestrator');
});

test('buildGitHubHeaders: adds bearer token only when provided', () => {
  assert.deepEqual(buildGitHubHeaders('secret-token'), {
    'User-Agent': 'capability-orchestrator-release-check',
    'Accept': 'application/vnd.github+json',
    Authorization: 'Bearer secret-token',
  });
  assert.deepEqual(buildGitHubHeaders(''), {
    'User-Agent': 'capability-orchestrator-release-check',
    'Accept': 'application/vnd.github+json',
  });
});

test('buildStatus: requires published GitHub release when package version matches latest tag', () => {
  const status = makeStatus({ ok: true, exists: false });
  assert.equal(status.latestTagMatchesPackage, true);
  assert.equal(status.releaseAuditOk, false);
  assert.equal(status.githubReleaseExists, false);
});

test('buildStatus: draft release is not release-ready', () => {
  const status = makeStatus({
    ok: true,
    exists: true,
    tagName: 'v1.9.1',
    isDraft: true,
    isPrerelease: false,
    url: 'https://example.invalid/release',
    publishedAt: '',
    targetCommitish: 'master',
  });
  assert.equal(status.githubReleaseReady, false);
  assert.equal(status.releaseAuditOk, false);
});

test('buildStatus: unreleased worktree ahead of latest tag stays audit-ok pre-release', () => {
  const status = makeStatus({ ok: true, exists: true, tagName: 'v1.9.0' }, { latestTag: 'v1.9.0' });
  assert.equal(status.latestTagMatchesPackage, false);
  assert.equal(status.releaseAuditOk, true);
});

test('buildStatus: published non-draft release satisfies release audit', () => {
  const status = makeStatus({
    ok: true,
    exists: true,
    tagName: 'v1.9.1',
    isDraft: false,
    isPrerelease: false,
    url: 'https://example.invalid/release',
    publishedAt: '2026-04-20T00:00:00Z',
    targetCommitish: 'master',
  });
  assert.equal(status.githubReleaseReady, true);
  assert.equal(status.releaseAuditOk, true);
});
