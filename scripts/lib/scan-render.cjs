'use strict';

const { truncate } = require('./scan-core.cjs');

const MAX_TOTAL_CHARS = 5000;
const TOP_N = 15;
const AWARENESS_MCP_DESC = 80;
const AWARENESS_AGENT_DESC = 60;
const AWARENESS_SKILL_DESC = 40;

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

  const skillCount = find('项目级 Skills').length + find('用户级 Skills').length;
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
  if (allSkills.length > 0) {
    parts.push('### Skills');
    for (const s of allSkills.slice(0, TOP_N)) {
      parts.push(s.desc ? `- ${s.name}: ${truncate(s.desc, AWARENESS_SKILL_DESC)}` : `- ${s.name}`);
    }
    if (allSkills.length > TOP_N) parts.push(`+${allSkills.length - TOP_N} 个`);
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
    mcpHints = '\nMCP 工具路由（遇到对应任务必须调用）：\n' + hints.join('\n');
  }

  const ROUTING = '\n### 路由规则\n<MANDATORY>\n1. 有匹配 skill 时必须用 Skill tool 调用，不得跳过直接做。\n   匹配依据：skill description 与用户任务的语义重叠。\n2. 当 UserPromptSubmit hook 输出包含 [AUTO-ROUTE] 和 /command 时，必须立即调用 Skill tool 执行该 /command，等同于用户亲自输入该命令。不得忽略、不得自行回答、不得询问确认。\n3. 逃逸条件：用户明确说"直接做/skip"，或纯问答无需执行动作。\n4. 不确定时用 ToolSearch 搜索可用能力。' + mcpHints + '\n</MANDATORY>';
  const FOOTER = errors.length > 0 ? '\n\n[部分扫描失败，详见 stderr]' : '';
  const listBudget = MAX_TOTAL_CHARS - ROUTING.length - FOOTER.length;

  let listOutput = parts.join('\n');
  if (listOutput.length > listBudget) {
    listOutput = listOutput.slice(0, listBudget - 20) + '\n\n…（已截断）';
  }
  return { text: listOutput + ROUTING + FOOTER, errors };
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
};
