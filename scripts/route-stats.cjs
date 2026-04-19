'use strict';

const {
  readLogs,
  aggregateStats,
  getLogPath,
} = require('./lib/route-logger.cjs');

const entries = readLogs();

if (entries.length === 0) {
  console.log('## 路由统计\n\n暂无数据。日志文件：' + getLogPath() + '\n');
  process.exit(0);
}

const stats = aggregateStats(entries);
const rate = stats.total > 0 ? ((stats.routed / stats.total) * 100).toFixed(1) : '0';

const lines = [];
lines.push('## 路由统计\n');
lines.push(`- 总请求数：${stats.total}`);
lines.push(`- 路由命中：${stats.routed}（${rate}%）`);
lines.push(`- 直接放行：${stats.passed}`);
lines.push(`- 过去 24h：${stats.last24h} 条`);
lines.push(`- 平均置信度：${stats.avgConfidence}`);

if (Object.keys(stats.byTargetType).length > 0) {
  lines.push('');
  lines.push('### 按目标类型');
  for (const [type, count] of Object.entries(stats.byTargetType)) {
    lines.push(`- ${type}: ${count}`);
  }
}

if (Object.keys(stats.topTargets).length > 0) {
  lines.push('');
  lines.push('### 热门目标（Top 10）');
  const sorted = Object.entries(stats.topTargets).sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [name, count] of sorted) {
    lines.push(`- ${name}: ${count} 次`);
  }
}

if (Object.keys(stats.byReason).length > 0) {
  lines.push('');
  lines.push('### 路由原因');
  for (const [reason, count] of Object.entries(stats.byReason)) {
    lines.push(`- ${reason}: ${count}`);
  }
}

console.log(lines.join('\n'));
