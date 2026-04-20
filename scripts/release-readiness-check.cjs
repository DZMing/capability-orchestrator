#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(root, relPath), 'utf8'));
}

function readRepoSlug(pkg) {
  const url = String(pkg.repository && pkg.repository.url || '');
  const match = url.match(/github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/);
  return match ? match[1] : '';
}

function runGit(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function fetchReleaseByTag(repo, tag) {
  if (!repo || !tag) return Promise.resolve({ ok: false, skipped: true, error: 'missing repo or tag' });

  return new Promise((resolve) => {
    const req = https.get({
      hostname: 'api.github.com',
      path: `/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`,
      headers: {
        'User-Agent': 'capability-orchestrator-release-check',
        'Accept': 'application/vnd.github+json',
      },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode === 404) {
          resolve({ ok: true, exists: false });
          return;
        }
        if (res.statusCode !== 200) {
          resolve({ ok: false, exists: false, error: `GitHub API ${res.statusCode}` });
          return;
        }
        try {
          const data = JSON.parse(body);
          resolve({
            ok: true,
            exists: true,
            tagName: data.tag_name || '',
            url: data.html_url || '',
            publishedAt: data.published_at || '',
            isDraft: !!data.draft,
            isPrerelease: !!data.prerelease,
            targetCommitish: data.target_commitish || '',
          });
        } catch (error) {
          resolve({ ok: false, exists: false, error: `invalid GitHub API JSON: ${error.message}` });
        }
      });
    });

    req.on('error', (error) => resolve({ ok: false, exists: false, error: error.message }));
    req.setTimeout(5000, () => {
      req.destroy(new Error('timeout'));
    });
  });
}

function buildStatus({ pkg, claude, codex, changelog, latestTag, headCommit, latestTagCommit, worktreeDirty, releaseProbe }) {
  const topChangelog = (changelog.match(/^## \[([^\]]+)\]/m) || [null, ''])[1];
  const latestTagMatchesPackage = latestTag === `v${pkg.version}`;
  const githubReleaseReady = !!(releaseProbe && releaseProbe.ok && releaseProbe.exists && !releaseProbe.isDraft && !releaseProbe.isPrerelease);
  const githubReleaseCheckOk = !!(releaseProbe && releaseProbe.ok);
  const releaseAuditOk = !latestTagMatchesPackage || githubReleaseReady;

  return {
    packageVersion: pkg.version,
    claudeManifestVersion: claude.version,
    codexManifestVersion: codex.version,
    topChangelogVersion: topChangelog,
    latestGitTag: latestTag,
    headCommit,
    latestTagCommit,
    versionSyncOk: pkg.version === claude.version && pkg.version === codex.version,
    changelogSyncOk: topChangelog === pkg.version,
    latestTagMatchesPackage,
    headMatchesLatestTag: !!latestTagCommit && latestTagCommit === headCommit,
    worktreeClean: !worktreeDirty,
    githubReleaseCheckOk,
    githubReleaseExists: !!(releaseProbe && releaseProbe.exists),
    githubReleaseReady,
    githubReleaseTag: releaseProbe && releaseProbe.tagName || '',
    githubReleaseUrl: releaseProbe && releaseProbe.url || '',
    githubReleasePublishedAt: releaseProbe && releaseProbe.publishedAt || '',
    githubReleaseIsDraft: !!(releaseProbe && releaseProbe.isDraft),
    githubReleaseIsPrerelease: !!(releaseProbe && releaseProbe.isPrerelease),
    githubReleaseTargetCommitish: releaseProbe && releaseProbe.targetCommitish || '',
    githubReleaseError: !githubReleaseCheckOk && releaseProbe && !releaseProbe.skipped ? releaseProbe.error || 'unknown' : '',
    releaseAuditOk,
  };
}

async function main() {
  const pkg = readJson('package.json');
  const claude = readJson('.claude-plugin/plugin.json');
  const codex = readJson('.codex-plugin/plugin.json');
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');

  const latestTag = runGit(['tag', '--list', 'v*'])
    .split('\n')
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .pop() || '';
  const headCommit = runGit(['rev-parse', 'HEAD']);
  const latestTagCommit = latestTag ? runGit(['rev-list', '-n', '1', latestTag]) : '';
  const worktreeDirty = runGit(['status', '--short']).length > 0;
  const releaseProbe = await fetchReleaseByTag(readRepoSlug(pkg), latestTag);

  const status = buildStatus({
    pkg,
    claude,
    codex,
    changelog,
    latestTag,
    headCommit,
    latestTagCommit,
    worktreeDirty,
    releaseProbe,
  });

  console.log(JSON.stringify(status, null, 2));

  if (!status.versionSyncOk || !status.changelogSyncOk || !status.releaseAuditOk) process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
} else {
  module.exports = {
    buildStatus,
    fetchReleaseByTag,
    readRepoSlug,
  };
}
