'use strict';

const fs = require('fs');
const path = require('path');

const MAX_LOG_SIZE = 1 * 1024 * 1024; // 1MB
const MAX_LOG_FILES = 3;

function getLogDir() {
  // 优先使用平台插件数据目录（插件更新后内容保留）
  const pluginData = process.env.CLAUDE_PLUGIN_DATA || process.env.CODEX_PLUGIN_DATA;
  if (pluginData) return pluginData;
  // fallback 到插件目录下
  const { resolveUserDir } = require('./user-dir.cjs');
  return path.join(
    resolveUserDir(),
    'plugins', 'cache', 'capability-orchestrator', 'data'
  );
}

function getLogPath() {
  return path.join(getLogDir(), 'route-log.jsonl');
}

function rotateIfNeeded(logPath) {
  try {
    const stat = fs.statSync(logPath);
    if (stat.size < MAX_LOG_SIZE) return;
  } catch { return; }
  // 轮转：.jsonl.2 删除，.jsonl.1 → .jsonl.2，.jsonl → .jsonl.0
  for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
    const older = logPath + '.' + i;
    const newer = logPath + '.' + (i - 1);
    if (i === MAX_LOG_FILES - 1) {
      try { fs.unlinkSync(older); } catch { /* ignore */ }
    }
    try { fs.renameSync(newer, older); } catch { /* ignore */ }
  }
  try { fs.renameSync(logPath, logPath + '.0'); } catch { /* ignore */ }
}

function appendRouteLog(explain) {
  try {
    const logPath = getLogPath();
    rotateIfNeeded(logPath);
    // 确保目录存在
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const entry = { ts: new Date().toISOString(), ...explain };
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
  } catch {
    // 故障开放：日志写入失败不影响路由
  }
}

function readLogs() {
  const results = [];
  const logPath = getLogPath();
  // 读取主日志 + 轮转日志
  const files = [logPath];
  for (let i = 0; i < MAX_LOG_FILES; i++) {
    files.push(logPath + '.' + i);
  }
  for (const f of files) {
    try {
      const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        try { results.push(JSON.parse(line)); }
        catch { /* skip corrupt line */ }
      }
    } catch { /* file doesn't exist */ }
  }
  // 按时间排序
  results.sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
  return results;
}

function aggregateStats(entries) {
  const stats = {
    total: entries.length,
    routed: 0,
    passed: 0,
    byTargetType: {},
    byReason: {},
    topTargets: {},
    avgConfidence: 0,
    last24h: 0,
  };

  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  let confSum = 0;

  for (const e of entries) {
    if (e.action === 'route') stats.routed++;
    else stats.passed++;

    stats.byReason[e.reason] = (stats.byReason[e.reason] || 0) + 1;

    if (e.targetType) {
      stats.byTargetType[e.targetType] = (stats.byTargetType[e.targetType] || 0) + 1;
    }
    if (e.targetName) {
      stats.topTargets[e.targetName] = (stats.topTargets[e.targetName] || 0) + 1;
    }

    confSum += e.confidence || 0;

    if (e.ts && new Date(e.ts).getTime() > oneDayAgo) stats.last24h++;
  }

  stats.avgConfidence = entries.length > 0 ? (confSum / entries.length).toFixed(2) : '0';
  return stats;
}

module.exports = {
  getLogDir,
  getLogPath,
  rotateIfNeeded,
  appendRouteLog,
  readLogs,
  aggregateStats,
  MAX_LOG_SIZE,
  MAX_LOG_FILES,
};
