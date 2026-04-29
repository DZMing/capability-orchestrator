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

function buildGitHubHeaders(token) {
  const headers = {
    'User-Agent': 'capability-orchestrator-release-check',
    'Accept': 'application/vnd.github+json',
  };

  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function fetchReleaseByTag(repo, tag) {
  if (!repo || !tag) return Promise.resolve({ ok: false, skipped: true, error: 'missing repo or tag' });

  return new Promise((resolve) => {
    const req = https.get({
      hostname: 'api.github.com',
      path: `/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`,
      headers: buildGitHubHeaders(process.env.GITHUB_TOKEN),
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode === 404) {
          resolve({ ok: true, exists: false });
          return;
        }
        if (res.statusCode !== 200) {
          let detail = '';
          try {
            const parsed = JSON.parse(body);
            detail = parsed && parsed.message ? `: ${parsed.message}` : '';
          } catch {}
          resolve({ ok: false, exists: false, error: `GitHub API ${res.statusCode}${detail}` });
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

function readYamlVersion(relPath) {
  try {
    const content = fs.readFileSync(path.join(root, relPath), 'utf8');
    const match = content.match(/^version:\s*['"]?([^\s'"]+)/m);
    return match ? match[1] : '';
  } catch { return ''; }
}

function pathExists(repoRoot, relPath) {
  return fs.existsSync(path.join(repoRoot, relPath));
}

function readText(repoRoot, relPath) {
  try {
    return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
  } catch {
    return '';
  }
}

function buildSupportMatrixStatus(repoRoot = root) {
  const findings = [];
  for (const relPath of [
    'adapters/openclaw',
    'adapters/openclaw-hook-pack',
    'scripts/verify-openclaw-adapter.cjs',
    'scripts/lib/openclaw-runtime.cjs',
    'docs/host-contract-openclaw.md',
  ]) {
    if (pathExists(repoRoot, relPath)) findings.push(`unexpected OpenClaw host surface remains: ${relPath}`);
  }

  let pkg = {};
  try {
    pkg = JSON.parse(readText(repoRoot, 'package.json'));
  } catch {
    findings.push('package.json is unreadable');
  }
  const scripts = pkg.scripts || {};
  for (const [name, command] of Object.entries(scripts)) {
    if (/verify:host:openclaw|verify-openclaw-adapter|--platform[ =]openclaw/i.test(`${name} ${command}`)) {
      findings.push(`package script still exposes OpenClaw host bridge: ${name}`);
    }
  }

  const installText = readText(repoRoot, 'install.sh');
  if (!/OpenClaw host bridge 当前已冻结/.test(installText) || !/claude \/ codex \/ hermes/.test(installText)) {
    findings.push('install.sh does not clearly freeze the OpenClaw host bridge install path');
  }

  const docChecks = [
    ['README.md', /OpenClaw[\s\S]{0,120}(Frozen|frozen|scan-only|read-only)/i],
    ['README.zh.md', /OpenClaw[\s\S]{0,120}(冻结|只读|scan-only)/i],
    ['README.es.md', /OpenClaw[\s\S]{0,160}(Congelado|congelado|solo escaneo|solo lectura)/i],
    ['ARCHITECTURE.md', /OpenClaw[\s\S]{0,160}(冻结|只读|scan-only|frozen)/i],
    ['VERIFICATION.md', /OpenClaw[\s\S]{0,160}(冻结|scan-only|只读)/i],
  ];
  for (const [relPath, pattern] of docChecks) {
    if (!pattern.test(readText(repoRoot, relPath))) {
      findings.push(`${relPath} does not describe OpenClaw as frozen scan-only`);
    }
  }

  return { ok: findings.length === 0, findings };
}

function buildStatus({ pkg, claude, codex, hermesYaml, changelog, latestTag, headCommit, latestTagCommit, worktreeDirty, releaseProbe, supportMatrix }) {
  const topChangelog = (changelog.match(/^## \[([^\]]+)\]/m) || [null, ''])[1];
  const latestTagMatchesPackage = latestTag === `v${pkg.version}`;
  const githubReleaseReady = !!(releaseProbe && releaseProbe.ok && releaseProbe.exists && !releaseProbe.isDraft && !releaseProbe.isPrerelease);
  const githubReleaseCheckOk = !!(releaseProbe && releaseProbe.ok);
  const supportMatrixOk = supportMatrix ? !!supportMatrix.ok : true;
  const releaseAuditOk = supportMatrixOk && (!latestTagMatchesPackage || githubReleaseReady);

  const allVersions = [
    pkg.version, claude.version, codex.version,
    hermesYaml,
  ];
  const versionSyncOk = allVersions.every(Boolean) && allVersions.every(v => v === pkg.version);
  const changelogSyncOk = topChangelog === pkg.version;
  const headMatchesLatestTag = !!latestTagCommit && latestTagCommit === headCommit;
  const worktreeClean = !worktreeDirty;
  const prelandingAuditOk = versionSyncOk && changelogSyncOk && releaseAuditOk;
  const strictReleaseBlockers = [];
  if (!versionSyncOk) strictReleaseBlockers.push('version metadata is not synced');
  if (!changelogSyncOk) strictReleaseBlockers.push('changelog top version does not match package version');
  if (!supportMatrixOk) strictReleaseBlockers.push('support matrix is not clean');
  if (!releaseAuditOk) strictReleaseBlockers.push('GitHub Release audit is not ready for the current package/tag state');
  if (!worktreeClean) strictReleaseBlockers.push('worktree is not clean');
  if (!headMatchesLatestTag) strictReleaseBlockers.push('HEAD does not match latest release tag');

  return {
    packageVersion: pkg.version,
    claudeManifestVersion: claude.version,
    codexManifestVersion: codex.version,
    hermesPluginVersion: hermesYaml,
    topChangelogVersion: topChangelog,
    latestGitTag: latestTag,
    headCommit,
    latestTagCommit,
    versionSyncOk,
    changelogSyncOk,
    latestTagMatchesPackage,
    headMatchesLatestTag,
    worktreeClean,
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
    supportMatrixOk,
    supportMatrixFindings: supportMatrix && Array.isArray(supportMatrix.findings) ? supportMatrix.findings : [],
    releaseAuditOk,
    prelandingAuditOk,
    strictReleaseOk: strictReleaseBlockers.length === 0,
    strictReleaseBlockers,
  };
}

async function main() {
  const strictMode = process.argv.includes('--strict');
  const pkg = readJson('package.json');
  const claude = readJson('.claude-plugin/plugin.json');
  const codex = readJson('.codex-plugin/plugin.json');
  const hermesYaml = readYamlVersion('adapters/hermes/plugin.yaml');
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
  const supportMatrix = buildSupportMatrixStatus(root);

  const status = buildStatus({
    pkg,
    claude,
    codex,
    hermesYaml,
    changelog,
    latestTag,
    headCommit,
    latestTagCommit,
    worktreeDirty,
    releaseProbe,
    supportMatrix,
  });
  status.releaseGateMode = strictMode ? 'strict-release' : 'prelanding-audit';

  console.log(JSON.stringify(status, null, 2));

  const ok = strictMode ? status.strictReleaseOk : status.prelandingAuditOk;
  if (!ok) process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
} else {
  module.exports = {
    buildGitHubHeaders,
    buildSupportMatrixStatus,
    buildStatus,
    fetchReleaseByTag,
    readRepoSlug,
  };
}
