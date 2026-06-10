'use strict';

const fs = require('fs');
const path = require('path');

const {
  readLogs,
  aggregateStats,
  getLogDir,
} = require('./lib/route-logger.cjs');

// ─── --label 参数处理 ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const labelArg = (() => {
  const idx = args.indexOf('--label');
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  // 支持 --label=... 形式
  const inlined = args.find(a => a.startsWith('--label='));
  if (inlined) return inlined.slice('--label='.length);
  return null;
})();

if (labelArg !== null) {
  const sep = labelArg.indexOf('|');
  if (sep === -1) {
    process.stderr.write('错误：--label 格式应为 \'<prompt>|<expected-skill-or-none>\'\n');
    process.exit(1);
  }
  const prompt = labelArg.slice(0, sep);
  const expected = labelArg.slice(sep + 1);
  const labeledPath = path.join(getLogDir(), 'labeled-cases.jsonl');
  try {
    fs.mkdirSync(path.dirname(labeledPath), { recursive: true });
    const entry = { ts: new Date().toISOString(), prompt, expected };
    fs.appendFileSync(labeledPath, JSON.stringify(entry) + '\n');
    process.stdout.write('已写入标注：' + labeledPath + '\n');
  } catch (e) {
    process.stderr.write('写入失败：' + String(e.message || e) + '\n');
    process.exit(1);
  }
  process.exit(0);
}

// ─── 读取日志 & 生成报告 ───────────────────────────────────────────────────────

const entries = readLogs();
const stats = aggregateStats(entries);

const lines = [];
lines.push('# route-tune 报告');
lines.push('');
lines.push('## 总览');

if (entries.length === 0) {
  lines.push('');
  lines.push('暂无路由日志数据。');
  lines.push('');
  lines.push('## Top-20 未路由关键词（同义词缺口候选）');
  lines.push('');
  lines.push('暂无数据。');
  lines.push('');
  lines.push('## 热门目标 Top-10');
  lines.push('');
  lines.push('暂无数据。');
  lines.push('');
  lines.push('## 疑似误推（路由后下一条 prompt 含逃逸词）');
  lines.push('');
  lines.push('暂无数据。');
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(0);
}

const rate = stats.total > 0 ? ((stats.routed / stats.total) * 100).toFixed(1) : '0';
const labeledCount = (() => {
  try {
    const labeledPath = path.join(getLogDir(), 'labeled-cases.jsonl');
    const lines2 = fs.readFileSync(labeledPath, 'utf8').split('\n').filter(Boolean);
    return lines2.length;
  } catch { return 0; }
})();
const decidedForAdoption = stats.adopted + stats.rejected;
const adoptionRate = decidedForAdoption > 0
  ? ((stats.adopted / decidedForAdoption) * 100).toFixed(1)
  : '0';

lines.push('');
lines.push('- 总路由数：' + stats.total + '，放行：' + stats.passed + '，路由率：' + rate + '%');
lines.push('- 采纳率：' + adoptionRate + '%（已标注 ' + labeledCount + ' 条）');
lines.push('- no-match：' + stats.misses + '，确认拦截：' + stats.confirmationGates);

// ─── Top-20 未路由关键词 ──────────────────────────────────────────────────────

lines.push('');
lines.push('## Top-20 未路由关键词（同义词缺口候选）');
lines.push('');

const unmatchedTopics = stats.topUnmatchedTopics || {};
const topUnmatched = Object.entries(unmatchedTopics)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20);

if (topUnmatched.length === 0) {
  lines.push('暂无未匹配关键词数据。');
} else {
  lines.push('| 关键词 | 次数 | 建议加入 synonyms.cjs |');
  lines.push('|--------|------|----------------------|');
  for (const [kw, count] of topUnmatched) {
    lines.push('| ' + kw + ' | ' + count + ' | [ ] |');
  }
}

// ─── 热门目标 Top-10 ──────────────────────────────────────────────────────────

lines.push('');
lines.push('## 热门目标 Top-10');
lines.push('');

const topTargets = Object.entries(stats.topTargets || {})
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10);

if (topTargets.length === 0) {
  lines.push('暂无目标数据。');
} else {
  lines.push('| 目标 | 路由次数 |');
  lines.push('|------|---------|');
  for (const [name, count] of topTargets) {
    lines.push('| ' + name + ' | ' + count + ' |');
  }
}

// ─── 疑似误推：路由后下一条 prompt 含逃逸词 ──────────────────────────────────

lines.push('');
lines.push('## 疑似误推（路由后下一条 prompt 含逃逸词）');
lines.push('');

const ESCAPE_WORDS = ['直接做', 'skip', '算了', '不对', '不是', '错了', '取消'];

const suspects = [];
for (let i = 0; i < entries.length - 1; i++) {
  const cur = entries[i];
  const next = entries[i + 1];
  if (cur.action !== 'route') continue;
  const nextPreview = (next.promptPreview || '').toLowerCase();
  const matched = ESCAPE_WORDS.find(w => nextPreview.includes(w));
  if (matched) {
    suspects.push({
      ts: cur.ts,
      target: cur.targetName || '(unknown)',
      targetType: cur.targetType || '',
      confidence: cur.confidence || 0,
      escapeWord: matched,
    });
  }
}

if (suspects.length === 0) {
  lines.push('未检测到疑似误推记录。');
} else {
  lines.push('| 时间 | 目标 | 类型 | 置信度 | 逃逸词 |');
  lines.push('|------|------|------|--------|--------|');
  for (const s of suspects) {
    const ts = s.ts ? s.ts.slice(0, 19).replace('T', ' ') : '';
    lines.push('| ' + ts + ' | ' + s.target + ' | ' + s.targetType + ' | ' + Number(s.confidence).toFixed(2) + ' | ' + s.escapeWord + ' |');
  }
}

process.stdout.write(lines.join('\n') + '\n');
