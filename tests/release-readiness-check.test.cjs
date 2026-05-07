'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildGitHubHeaders,
  buildSupportMatrixStatus,
  buildStatus,
  readInstallerFallbacks,
  readRepoSlug,
} = require('../scripts/release-readiness-check.cjs');

function makeStatus(releaseProbe, overrides = {}) {
  return buildStatus({
    pkg: { version: '1.9.1' },
    claude: { version: '1.9.1' },
    codex: { version: '1.9.1' },
    hermesYaml: '1.9.1',
    changelog: '# Changelog\n\n## [1.9.1] - 2026-04-20\n',
    latestTag: overrides.latestTag || 'v1.9.1',
    headCommit: overrides.headCommit || 'abc123',
    latestTagCommit: overrides.latestTagCommit || 'abc123',
    worktreeDirty: !!overrides.worktreeDirty,
    releaseProbe,
    supportMatrix: overrides.supportMatrix || { ok: true, findings: [] },
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
  const status = makeStatus({ ok: true, exists: true, tagName: 'v1.9.0' }, {
    latestTag: 'v1.9.0',
    headCommit: 'new-head',
    latestTagCommit: 'old-tag',
    worktreeDirty: true,
  });
  assert.equal(status.latestTagMatchesPackage, false);
  assert.equal(status.releaseAuditOk, true);
  assert.equal(status.prelandingAuditOk, true);
  assert.equal(status.strictReleaseOk, false);
  assert.ok(status.strictReleaseBlockers.includes('worktree is not clean'));
  assert.ok(status.strictReleaseBlockers.includes('HEAD does not match latest release tag'));
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
  assert.equal(status.prelandingAuditOk, true);
  assert.equal(status.strictReleaseOk, true);
});

test('buildStatus: support matrix drift blocks release audit', () => {
  const status = makeStatus({
    ok: true,
    exists: true,
    tagName: 'v1.9.1',
    isDraft: false,
    isPrerelease: false,
  }, {
    supportMatrix: { ok: false, findings: ['unexpected OpenClaw host surface remains: adapters/openclaw'] },
  });
  assert.equal(status.supportMatrixOk, false);
  assert.equal(status.releaseAuditOk, false);
  assert.deepEqual(status.supportMatrixFindings, ['unexpected OpenClaw host surface remains: adapters/openclaw']);
});

test('buildStatus: requires every supported adapter version to be present and synced', () => {
  const missingHermes = buildStatus({
    pkg: { version: '1.9.1' },
    claude: { version: '1.9.1' },
    codex: { version: '1.9.1' },
    hermesYaml: '',
    changelog: '# Changelog\n\n## [1.9.1] - 2026-04-20\n',
    latestTag: 'v1.9.1',
    headCommit: 'abc123',
    latestTagCommit: 'abc123',
    worktreeDirty: false,
    releaseProbe: { ok: true, exists: true, tagName: 'v1.9.1' },
  });
  assert.equal(missingHermes.versionSyncOk, false);

  const mismatchedHermes = buildStatus({
    pkg: { version: '1.9.1' },
    claude: { version: '1.9.1' },
    codex: { version: '1.9.1' },
    hermesYaml: '1.9.0',
    changelog: '# Changelog\n\n## [1.9.1] - 2026-04-20\n',
    latestTag: 'v1.9.1',
    headCommit: 'abc123',
    latestTagCommit: 'abc123',
    worktreeDirty: false,
    releaseProbe: { ok: true, exists: true, tagName: 'v1.9.1' },
  });
  assert.equal(mismatchedHermes.versionSyncOk, false);
});

test('readInstallerFallbacks: parses shell and PowerShell fallback versions', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-installer-fallbacks-'));
  try {
    fs.writeFileSync(path.join(tmp, 'install.sh'), 'VERSION_FALLBACK="2.0.0"\n');
    fs.writeFileSync(path.join(tmp, 'install.ps1'), "$VersionFallback = '2.0.0'\n");
    assert.deepEqual(readInstallerFallbacks(tmp), {
      installShFallbackVersion: '2.0.0',
      installPs1FallbackVersion: '2.0.0',
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('buildStatus: installer fallback drift blocks version sync', () => {
  const status = buildStatus({
    pkg: { version: '2.0.0' },
    claude: { version: '2.0.0' },
    codex: { version: '2.0.0' },
    hermesYaml: '2.0.0',
    installerFallbacks: {
      installShFallbackVersion: '2.0.0',
      installPs1FallbackVersion: '1.11.22',
    },
    changelog: '# Changelog\n\n## [2.0.0] - 2026-04-29\n',
    latestTag: 'v2.0.0',
    headCommit: 'abc123',
    latestTagCommit: 'abc123',
    worktreeDirty: false,
    releaseProbe: { ok: true, exists: true, tagName: 'v2.0.0' },
    supportMatrix: { ok: true, findings: [] },
  });
  assert.equal(status.versionSyncOk, false);
  assert.equal(status.installPs1FallbackVersion, '1.11.22');
  assert.ok(status.strictReleaseBlockers.includes('version metadata is not synced'));
});

test('buildSupportMatrixStatus: detects OpenClaw host bridge drift', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-support-matrix-'));
  try {
    fs.mkdirSync(path.join(tmp, 'adapters', 'openclaw'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
      scripts: {
        'verify:host:openclaw': 'node scripts/verify-openclaw-adapter.cjs',
      },
    }));
    fs.writeFileSync(path.join(tmp, 'install.sh'), '#!/usr/bin/env bash\n');
    for (const relPath of ['README.md', 'README.zh.md', 'README.es.md', 'ARCHITECTURE.md', 'VERIFICATION.md']) {
      fs.writeFileSync(path.join(tmp, relPath), 'OpenClaw host bridge supported.\n');
    }

    const status = buildSupportMatrixStatus(tmp);
    assert.equal(status.ok, false);
    assert.ok(status.findings.some((finding) => finding.includes('adapters/openclaw')));
    assert.ok(status.findings.some((finding) => finding.includes('verify:host:openclaw')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
