'use strict';

const { truncate } = require('./scan-core.cjs');

const MAX_TOTAL_CHARS = 5000;
const TOP_N = 15;
const AWARENESS_MCP_DESC = 80;
const AWARENESS_AGENT_DESC = 60;
const AWARENESS_SKILL_DESC = 40;
const ROUTING_HINT_MIN_SAMPLES = 10;
const ROUTING_HINT_MAX_CHARS = 280;

// B.2 路由偏好提示：基于过去 7d 日志，列出高频未匹配主题词 + Top-1 命中目标
// 故障开放：日志读取失败/数据不足时返回空字符串
// 守门：仅在真实 plugin runtime 注入 PLUGIN_DATA 时启用，避免污染单测 golden snapshot
function buildRoutingHint() {
  if (process.env.CO_AWARENESS_HINT === 'off') return '';
  const explicitOn = process.env.CO_AWARENESS_HINT === 'on';
  const runtimeData = process.env.CLAUDE_PLUGIN_DATA || process.env.CODEX_PLUGIN_DATA;
  if (!explicitOn && !runtimeData) return '';
  try {
    const { readLogs, aggregateStats } = require('./route-logger.cjs');
    const entries = readLogs();
    if (entries.length < ROUTING_HINT_MIN_SAMPLES) return '';
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recent = entries.filter(e => e.ts && new Date(e.ts).getTime() > cutoff);
    if (recent.length < ROUTING_HINT_MIN_SAMPLES) return '';
    const stats = aggregateStats(recent);
    const lines = [];
    lines.push(`### 最近 7d 路由统计`);
    lines.push(`- 路由 ${stats.routed} / 放行 ${stats.passed} / no-match ${stats.misses}`);
    const topTargets = Object.entries(stats.topTargets || {})
      .sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (topTargets.length > 0) {
      lines.push(`- 热门目标：${topTargets.map(([n, c]) => `${n}(${c})`).join(', ')}`);
    }
    const topUnmatched = Object.entries(stats.topUnmatchedTopics || {})
      .sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (topUnmatched.length > 0) {
      lines.push(`- 高频未匹配主题词：${topUnmatched.map(([k, c]) => `${k}(${c})`).join(', ')}`);
      lines.push(`  → 建议为这些场景显式触发对应 skill 或扩词典`);
    }
    let out = lines.join('\n') + '\n';
    if (out.length > ROUTING_HINT_MAX_CHARS) out = out.slice(0, ROUTING_HINT_MAX_CHARS - 3) + '…\n';
    return out;
  } catch {
    return '';
  }
}

const BUILTINS_COMPACT = '内置 24 个（/help 查看）';

function renderSection(section, level) {
  const { label, prefix, items } = section;
  if (level >= 4) return `### ${label}\n${items.length} 个`;
  if (level >= 3) {
    if (items.length <= TOP_N) return `### ${label}\n${items.map(i => prefix + i.name).join(', ')}`;
    const shown = items.slice(0, TOP_N).map(i => prefix + i.name).join(', ');
    return `### ${label}\n${shown}, +${items.length - TOP_N} 个`;
  }
  if (level >= 2) return `### ${label}\n${items.map(i => prefix + i.name).join(', ')}`;
  const descMax = level >= 1 ? 50 : 100;
  const lines = items.map(i => {
    let line = `- ${prefix}${i.name}`;
    const desc = truncate(i.desc, descMax);
    if (desc) line += `: ${desc}`;
    if (i.extra) line += `\n  ${i.extra}`;
    return line;
  });
  return `### ${label}\n${lines.join('\n')}`;
}

function renderAwareness(snapshot) {
  const { sections, errors } = snapshot;
  const find = label => (sections.find(s => s.label === label) || { items: [] }).items;

  const skillCount = find('项目级 Skills').length
    + find('用户级 Skills').length
    + find('OpenClaw Skills').length
    + find('Hermes Skills').length;
  const agentCount = find('项目级 Subagents').length + find('用户级 Subagents').length;
  const mcpItems = find('MCP Servers');
  const plugins = find('已安装插件');
  const legacyCmds = find('Legacy Commands');

  const parts = ['## 环境能力感知\n'];
  const counts = [];
  if (skillCount > 0) counts.push(`${skillCount} skills`);
  if (agentCount > 0) counts.push(`${agentCount} subagents`);
  if (plugins.length > 0) counts.push(`${plugins.length} plugins`);
  if (mcpItems.length > 0) counts.push(`${mcpItems.length} MCP servers`);
  if (counts.length > 0) parts.push(counts.join('、') + '。\n');

  if (mcpItems.length > 0) {
    parts.push('### MCP Servers');
    for (const s of mcpItems) {
      parts.push(s.desc ? `- ${s.name}: ${truncate(s.desc, AWARENESS_MCP_DESC)}` : `- ${s.name}`);
    }
    parts.push('');
  }

  const allAgents = [...find('项目级 Subagents'), ...find('用户级 Subagents')];
  if (allAgents.length > 0) {
    parts.push('### Subagents');
    const shown = allAgents.slice(0, TOP_N);
    for (const a of shown) {
      parts.push(a.desc ? `- ${a.name}: ${truncate(a.desc, AWARENESS_AGENT_DESC)}` : `- ${a.name}`);
    }
    if (allAgents.length > TOP_N) parts.push(`+${allAgents.length - TOP_N} 个`);
    parts.push('');
  }

  const allSkills = [...find('项目级 Skills'), ...find('用户级 Skills')];
  const ecosystemSkills = [...find('OpenClaw Skills'), ...find('Hermes Skills')];
  if (allSkills.length > 0) {
    parts.push('### Skills');
    for (const s of allSkills.slice(0, TOP_N)) {
      parts.push(s.desc ? `- ${s.name}: ${truncate(s.desc, AWARENESS_SKILL_DESC)}` : `- ${s.name}`);
    }
    if (allSkills.length > TOP_N) parts.push(`+${allSkills.length - TOP_N} 个`);
    parts.push('');
  }

  if (ecosystemSkills.length > 0) {
    parts.push('### 兼容生态 Skills');
    for (const s of ecosystemSkills.slice(0, TOP_N)) {
      parts.push(s.desc ? `- ${s.name}: ${truncate(s.desc, AWARENESS_SKILL_DESC)}` : `- ${s.name}`);
    }
    if (ecosystemSkills.length > TOP_N) parts.push(`+${ecosystemSkills.length - TOP_N} 个`);
    parts.push('');
  }

  if (plugins.length > 0) parts.push(`### 已安装插件\n${plugins.length} 个\n`);
  if (legacyCmds.length > 0) parts.push(`### Legacy Commands\n${legacyCmds.length} 个\n`);

  let mcpHints = '';
  if (mcpItems.length > 0) {
    const hints = mcpItems.map(s => {
      const prefix = `mcp__${s.name}`;
      return s.desc
        ? `- ${s.desc.split('，')[0].split('：')[0].slice(0, 20)} → 调用 ${prefix}__*`
        : `- ${s.name} → 调用 ${prefix}__*`;
    });
    mcpHints = '\nMCP 工具路由（能力建议，遇到高风险动作必须先确认）：\n' + hints.join('\n');
  }

  const ROUTING = '\n### 路由规则\n<MANDATORY>\n1. 有匹配 skill 时必须用 Skill tool 调用，不得跳过直接做。\n   匹配依据：skill description 与用户任务的语义重叠。\n2. 当 UserPromptSubmit hook 输出包含 [AUTO-ROUTE] 和 /command 时，优先使用明确命令入口；不得执行扫描到的命令正文或 markdown 定义。\n3. 当 hook 输出包含 [CONFIRMATION REQUIRED] 时，必须等待明确确认后才能发布、推送、部署、删除、付费、使用凭证或做真实产品/UX 决策。\n4. 逃逸条件：用户明确说"直接做/skip"，或纯问答无需执行动作。\n5. 不确定时用 ToolSearch 搜索可用能力。' + mcpHints + '\n</MANDATORY>';
  const HINT_RAW = buildRoutingHint();
  const HINT = HINT_RAW ? '\n' + HINT_RAW : '';
  const FOOTER = errors.length > 0 ? '\n\n[部分扫描失败，详见 stderr]' : '';
  const listBudget = MAX_TOTAL_CHARS - ROUTING.length - HINT.length - FOOTER.length;

  let listOutput = parts.join('\n');
  if (listOutput.length > listBudget) {
    listOutput = listOutput.slice(0, listBudget - 20) + '\n\n…（已截断）';
  }
  return { text: listOutput + ROUTING + HINT + FOOTER, errors };
}

function renderSnapshot(snapshot, mode) {
  if (mode === 'awareness') return renderAwareness(snapshot);
  const { sections, errors } = snapshot;
  const initLevel = mode === 'list' ? 2 : 0;
  const levels = sections.map(() => initLevel);

  function assemble() {
    const header = BUILTINS_COMPACT;
    const parts = sections.map((s, i) => renderSection(s, levels[i]));
    return `## 当前环境能力摘要\n\n${header}\n\n${parts.join('\n\n')}`;
  }

  let output = assemble();
  while (output.length > MAX_TOTAL_CHARS) {
    let maxLen = -1;
    let maxIdx = -1;
    for (let i = 0; i < sections.length; i++) {
      if (levels[i] >= 4) continue;
      const len = renderSection(sections[i], levels[i]).length;
      if (len > maxLen) {
        maxLen = len;
        maxIdx = i;
      }
    }
    if (maxIdx === -1) break;
    levels[maxIdx]++;
    output = assemble();
  }

  const FOOTER = errors.length > 0 ? '\n\n[部分扫描失败，详见 stderr]' : '';
  const budget = MAX_TOTAL_CHARS - FOOTER.length;
  if (output.length > budget) {
    output = output.slice(0, budget - 20) + '\n\n…（已截断）';
  }
  return { text: output + FOOTER, errors };
}

module.exports = {
  MAX_TOTAL_CHARS,
  renderSection,
  renderAwareness,
  renderSnapshot,
  buildRoutingHint,
};
