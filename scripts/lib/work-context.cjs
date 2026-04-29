'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { getLogPath } = require('./route-logger.cjs');

const MAX_RULE_BYTES = 4096;

function redactContextText(value) {
  return String(value || '')
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, '[REDACTED]')
    .replace(/\b(api[_-]?key|token|password|secret)\s*[:=]\s*([^\s,;]+)/gi, '$1=[REDACTED]')
    .replace(/\bAuthorization\s*:\s*Bearer\s+([^\s]+)/gi, 'Authorization: Bearer [REDACTED]');
}

function readBounded(filePath, maxBytes = MAX_RULE_BYTES) {
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(maxBytes);
      const bytes = fs.readSync(fd, buffer, 0, maxBytes, 0);
      return redactContextText(buffer.slice(0, bytes).toString('utf8'));
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

function readProjectRules(cwd) {
  const rules = [];
  for (const name of ['AGENTS.md', 'CLAUDE.md']) {
    const text = readBounded(path.join(cwd, name));
    if (!text) continue;
    for (const line of text.split(/\r?\n/)) {
      const clean = line.replace(/^[-#*\s]+/, '').trim();
      if (/push|branch|verify|test|confirm|permission|权限|确认|提交|PR|master/i.test(clean)) {
        rules.push(clean);
      }
      if (rules.length >= 8) break;
    }
  }
  return [...new Set(rules)].slice(0, 8);
}

function readGitSummary(cwd) {
  try {
    return execFileSync('git', ['status', '--short', '--branch'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    }).trim().split(/\r?\n/).slice(0, 12).join(' | ');
  } catch {
    return '';
  }
}

function readRecentRouteLogs(logPath = getLogPath(), { limit = 5, maxBytes = 64 * 1024 } = {}) {
  let text = '';
  try {
    const stat = fs.statSync(logPath);
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(logPath, 'r');
    try {
      const buffer = Buffer.alloc(stat.size - start);
      fs.readSync(fd, buffer, 0, buffer.length, start);
      text = buffer.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return [];
  }

  const entries = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(redactContextText(line)));
    } catch {
      continue;
    }
  }
  entries.sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));
  return entries.slice(-limit);
}

function collectWorkContext({ cwd = process.cwd(), routeLogPath } = {}) {
  const safeCwd = cwd || process.cwd();
  return {
    cwd: safeCwd,
    gitSummary: readGitSummary(safeCwd),
    projectRules: readProjectRules(safeCwd),
    recentRoutes: readRecentRouteLogs(routeLogPath || getLogPath(), { limit: 5 }),
  };
}

module.exports = {
  collectWorkContext,
  readRecentRouteLogs,
  readProjectRules,
  readGitSummary,
  redactContextText,
};
