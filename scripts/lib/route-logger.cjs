'use strict';

const fs = require('fs');
const path = require('path');

const MAX_LOG_SIZE = 1 * 1024 * 1024; // 1MB
const MAX_LOG_FILES = 3;
const LOW_CONFIDENCE_ROUTE = 0.45;
const LOG_FIELDS = [
  'ts', 'action', 'reason', 'targetType', 'targetName',
  'confidence', 'matchedKeywords', 'cwd', 'userDirSource',
  'promptType', 'host', 'source', 'scope', 'surfaceType', 'invocation',
  'transport', 'authRequired', 'mayWrite', 'externalAccess',
  'topCandidates', 'unmatchedTopicKw', 'adopted', 'promptPreview',
];
const MAX_TOP_CANDIDATES = 5;
const MAX_UNMATCHED_KW = 8;
const PROMPT_PREVIEW_LEN = 120;

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

function getFeedbackPath() {
  return path.join(getLogDir(), 'route-feedback.jsonl');
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

function normalizeLogEntry(explain) {
  const entry = { ts: new Date().toISOString() };
  for (const field of LOG_FIELDS) {
    if (field === 'ts') continue;
    if (explain && Object.prototype.hasOwnProperty.call(explain, field)) {
      entry[field] = explain[field];
    }
  }
  if (Array.isArray(entry.matchedKeywords)) {
    entry.matchedKeywords = entry.matchedKeywords
      .map((item) => String(item).slice(0, 80))
      .slice(0, 12);
  }
  if (Array.isArray(entry.topCandidates)) {
    entry.topCandidates = entry.topCandidates
      .slice(0, MAX_TOP_CANDIDATES)
      .map((c) => ({
        name: String(c.name || '').slice(0, 80),
        score: Number(c.score) || 0,
        overlap: Number(c.overlap) || 0,
        matchedKeywords: Array.isArray(c.matchedKeywords)
          ? c.matchedKeywords.map((k) => String(k).slice(0, 40)).slice(0, 8)
          : [],
        unmatchedPenalty: Number(c.unmatchedPenalty) || 0,
      }));
  }
  if (Array.isArray(entry.unmatchedTopicKw)) {
    entry.unmatchedTopicKw = entry.unmatchedTopicKw
      .map((k) => String(k).slice(0, 40))
      .slice(0, MAX_UNMATCHED_KW);
  }
  if (typeof entry.promptPreview === 'string' && entry.promptPreview.length > PROMPT_PREVIEW_LEN) {
    entry.promptPreview = entry.promptPreview.slice(0, PROMPT_PREVIEW_LEN) + '…';
  }
  return entry;
}

function appendRouteLog(explain) {
  try {
    const logPath = getLogPath();
    rotateIfNeeded(logPath);
    // 确保目录存在
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const entry = normalizeLogEntry(explain || {});
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
  for (let i = 0; i < MAX_LOG_FILES - 1; i++) {
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
  // 关联 feedback：在 30s 窗口内匹配 targetName，标记 adopted
  try {
    const feedbacks = readFeedback();
    if (feedbacks.length > 0) joinFeedback(results, feedbacks);
  } catch { /* fault-open */ }
  return results;
}

function readFeedback() {
  const fb = [];
  try {
    const lines = fs.readFileSync(getFeedbackPath(), 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try { fb.push(JSON.parse(line)); } catch { /* skip */ }
    }
  } catch { /* file doesn't exist */ }
  return fb;
}

const FEEDBACK_WINDOW_MS = 30 * 1000;

function joinFeedback(entries, feedbacks) {
  // 简单关联：route 事件后 30s 内出现的 feedback 视为同一次决策
  // adopted: 用户实际触发了对应 target；rejected: 用户触发了不同 target
  for (const e of entries) {
    if (e.action !== 'route' || !e.ts || !e.targetName) continue;
    const eMs = new Date(e.ts).getTime();
    let nearest = null;
    let nearestDelta = FEEDBACK_WINDOW_MS;
    for (const f of feedbacks) {
      if (!f.ts) continue;
      const fMs = new Date(f.ts).getTime();
      const delta = fMs - eMs;
      if (delta < 0 || delta > FEEDBACK_WINDOW_MS) continue;
      if (delta < nearestDelta) {
        nearest = f;
        nearestDelta = delta;
      }
    }
    if (nearest) {
      e.adopted = nearest.toolTarget === e.targetName;
      e.feedbackTool = nearest.toolName;
      e.feedbackTarget = nearest.toolTarget;
    }
  }
}

function appendFeedback(record) {
  try {
    const fbPath = getFeedbackPath();
    fs.mkdirSync(path.dirname(fbPath), { recursive: true });
    const entry = {
      ts: new Date().toISOString(),
      toolName: String(record.toolName || '').slice(0, 80),
      toolTarget: String(record.toolTarget || '').slice(0, 80),
    };
    fs.appendFileSync(fbPath, JSON.stringify(entry) + '\n');
  } catch {
    // 故障开放
  }
}

function aggregateStats(entries) {
  const stats = {
    total: entries.length,
    routed: 0,
    passed: 0,
    adopted: 0,
    rejected: 0,
    byTargetType: {},
    byReason: {},
    topTargets: {},
    byPromptType: {},
    topUnmatchedTopics: {},
    adoptionRate: '0',
    misses: 0,
    confirmationGates: 0,
    lowConfidenceRoutes: 0,
    avgConfidence: 0,
    last24h: 0,
    last7d: 0,
  };

  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let confSum = 0;

  for (const e of entries) {
    if (e.action === 'route') stats.routed++;
    else stats.passed++;

    stats.byReason[e.reason] = (stats.byReason[e.reason] || 0) + 1;
    if (e.promptType) stats.byPromptType[e.promptType] = (stats.byPromptType[e.promptType] || 0) + 1;
    if (e.reason === 'no-match') stats.misses++;
    if (e.reason === 'confirmation-required') stats.confirmationGates++;
    if (e.action === 'route' && Number(e.confidence || 0) > 0 && Number(e.confidence || 0) < LOW_CONFIDENCE_ROUTE) {
      stats.lowConfidenceRoutes++;
    }

    if (e.targetType) {
      stats.byTargetType[e.targetType] = (stats.byTargetType[e.targetType] || 0) + 1;
    }
    if (e.targetName) {
      stats.topTargets[e.targetName] = (stats.topTargets[e.targetName] || 0) + 1;
    }

    if (Array.isArray(e.unmatchedTopicKw)) {
      for (const kw of e.unmatchedTopicKw) {
        stats.topUnmatchedTopics[kw] = (stats.topUnmatchedTopics[kw] || 0) + 1;
      }
    }

    if (e.action === 'route' && e.adopted === true) stats.adopted++;
    if (e.action === 'route' && e.adopted === false) stats.rejected++;

    confSum += e.confidence || 0;

    if (e.ts) {
      const t = new Date(e.ts).getTime();
      if (t > oneDayAgo) stats.last24h++;
      if (t > sevenDaysAgo) stats.last7d++;
    }
  }

  stats.avgConfidence = entries.length > 0 ? (confSum / entries.length).toFixed(2) : '0';
  const decided = stats.adopted + stats.rejected;
  stats.adoptionRate = decided > 0 ? ((stats.adopted / decided) * 100).toFixed(1) : '0';
  return stats;
}

module.exports = {
  getLogDir,
  getLogPath,
  getFeedbackPath,
  rotateIfNeeded,
  appendRouteLog,
  appendFeedback,
  readLogs,
  readFeedback,
  joinFeedback,
  aggregateStats,
  normalizeLogEntry,
  MAX_LOG_SIZE,
  MAX_LOG_FILES,
  LOW_CONFIDENCE_ROUTE,
  FEEDBACK_WINDOW_MS,
};
