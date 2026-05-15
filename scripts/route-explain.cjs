#!/usr/bin/env node
// route-explain.cjs — 路由决策可读化入口（D.1）
// 用法: node scripts/route-explain.cjs "prompt"
//
// 输出：Markdown 表格展示所有候选评分细节 + 最终决策摘要
'use strict';

const { resolveRouteDecision } = require('./route-matcher.cjs');

function pad(str, len) {
  const s = String(str ?? '');
  return s.length >= len ? s : s + ' '.repeat(len - s.length);
}

function formatKeywords(kws) {
  if (!kws || kws.length === 0) return '—';
  return kws.slice(0, 6).join(', ') + (kws.length > 6 ? ` +${kws.length - 6}` : '');
}

function renderTable(candidates, winner) {
  if (!candidates || candidates.length === 0) return '（无候选）';
  const rows = candidates.map(c => ({
    name: c.name,
    score: typeof c.score === 'number' ? c.score.toFixed(3) : '—',
    overlap: c.overlap ?? '—',
    penalty: typeof c.unmatchedPenalty === 'number' ? `-${c.unmatchedPenalty.toFixed(2)}` : '0',
    keywords: formatKeywords(c.matchedKeywords),
    winner: c.name === winner ? '✓' : '',
  }));

  const cols = [
    { key: 'winner', label: '选中', w: 4 },
    { key: 'name', label: 'Skill/MCP', w: Math.max(12, ...rows.map(r => r.name.length)) },
    { key: 'score', label: 'Score', w: 8 },
    { key: 'overlap', label: 'Overlap', w: 7 },
    { key: 'penalty', label: 'Penalty', w: 8 },
    { key: 'keywords', label: '命中关键词', w: 30 },
  ];

  const header = '| ' + cols.map(c => pad(c.label, c.w)).join(' | ') + ' |';
  const sep = '|' + cols.map(c => '-'.repeat(c.w + 2)).join('|') + '|';
  const body = rows.map(r => '| ' + cols.map(c => pad(r[c.key], c.w)).join(' | ') + ' |');
  return [header, sep, ...body].join('\n');
}

function main() {
  const prompt = process.argv[2];
  if (!prompt) {
    process.stderr.write('用法: node scripts/route-explain.cjs "<prompt>"\n');
    process.exit(1);
  }

  const cwd = process.argv[3] || process.cwd();
  const result = resolveRouteDecision(JSON.stringify({ prompt, cwd }));
  const ex = result.explain;

  process.stdout.write(`\n## 路由决策分析\n\n`);
  process.stdout.write(`**Prompt**: \`${ex.promptPreview || prompt}\`\n\n`);
  process.stdout.write(`**结论**: ${ex.action === 'pass' ? '放行（不路由）' : '路由'} | **原因**: \`${ex.reason}\`\n\n`);

  if (ex.action === 'route' && ex.targetName) {
    process.stdout.write(`**目标**: \`${ex.targetType}:${ex.targetName}\` | **置信度**: ${(ex.confidence ?? 0).toFixed(3)}\n\n`);
  }

  if (ex.topCandidates && ex.topCandidates.length > 0) {
    process.stdout.write(`### 候选评分（Top ${ex.topCandidates.length}）\n\n`);
    process.stdout.write(renderTable(ex.topCandidates, ex.targetName) + '\n\n');
  } else {
    process.stdout.write('（无候选：未达到 MIN_KEYWORD_OVERLAP 或 MIN_CONFIDENCE 阈值）\n\n');
  }

  if (ex.unmatchedTopicKw && ex.unmatchedTopicKw.length > 0) {
    process.stdout.write(`**未命中主题词**（触发负向惩罚）: \`${ex.unmatchedTopicKw.join(', ')}\`\n\n`);
  }

  if (ex.matchedKeywords && ex.matchedKeywords.length > 0) {
    process.stdout.write(`**命中关键词**: \`${ex.matchedKeywords.join(', ')}\`\n`);
  }
}

main();
