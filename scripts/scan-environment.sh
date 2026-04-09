#!/usr/bin/env node
// scan-environment.sh — capability-orchestrator 核心扫描脚本
//
// 稳定来源（官方目录结构，随 Claude Code 版本稳定）：
//   .claude/skills/           项目级 skills
//   .claude/agents/           项目级 subagents
//   .claude/commands/         项目级 legacy commands
//   ~/.claude/skills/         用户级 skills
//   ~/.claude/agents/         用户级 subagents
//   ~/.claude/commands/       用户级 legacy commands
//   .mcp.json                 项目级 MCP 配置
//   ~/.claude/.mcp.json       用户级 MCP 配置
//
// best-effort 来源（结构未正式文档化，可能随版本变化）：
//   ~/.claude/plugins/cache/  已安装插件缓存目录
//
// 运行方式: node scripts/scan-environment.sh
// 依赖: 仅 Node.js 标准库 (fs, path, os)

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_TOTAL_CHARS = 3000;
const MAX_DESC = 100;

// ─── 工具函数 ───────────────────────────────────────────────────────────────

function tryRead(filePath) {
  try { return fs.readFileSync(filePath, 'utf8'); }
  catch { return null; }
}

function tryReadDir(dirPath) {
  try { return fs.readdirSync(dirPath); }
  catch { return []; }
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); }
  catch { return false; }
}

function truncate(str, max) {
  if (!str) return '';
  str = str.replace(/\r?\n/g, ' ').trim();
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

// 从 SKILL.md / agent.md 的 YAML frontmatter 提取指定字段
function extractFrontmatter(content) {
  if (!content) return {};
  const match = content.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fm = match[1];
  const result = {};
  // 匹配 key: value（支持带引号或不带引号的值）
  for (const line of fm.split('\n')) {
    const m = line.match(/^(\w[\w-]*):\s*["']?(.*?)["']?\s*$/);
    if (m) result[m[1]] = m[2].trim();
  }
  return result;
}

function getDescription(content, entryName) {
  const fm = extractFrontmatter(content);
  if (fm.description) return truncate(fm.description, MAX_DESC);
  // fallback：取第一个非空、非标题行
  if (!content) return '';
  const firstPara = content
    .split('\n')
    .find(l => l.trim() && !l.startsWith('#') && !l.startsWith('---') && !l.includes(':'));
  return truncate(firstPara || '', MAX_DESC);
}

function getName(content, fallback) {
  const fm = extractFrontmatter(content);
  return (fm.name || fallback || '').trim();
}

// ─── 扫描函数 ────────────────────────────────────────────────────────────────

// 扫描 skills 目录（每个子目录为一个 skill，包含 SKILL.md）
function scanSkills(dir) {
  const results = [];
  for (const entry of tryReadDir(dir)) {
    const skillDir = path.join(dir, entry);
    if (!isDir(skillDir)) continue;
    const content = tryRead(path.join(skillDir, 'SKILL.md'));
    const name = getName(content, entry);
    const desc = getDescription(content, entry);
    results.push({ name, desc });
  }
  return results;
}

// 扫描 agents 目录（每个 .md 文件为一个 agent）
function scanAgents(dir) {
  const results = [];
  for (const entry of tryReadDir(dir)) {
    if (!entry.endsWith('.md')) continue;
    const content = tryRead(path.join(dir, entry));
    const name = getName(content, entry.replace(/\.md$/, ''));
    const desc = getDescription(content, name);
    results.push({ name, desc });
  }
  return results;
}

// 扫描 commands 目录（legacy，仅列名称）
function scanCommands(dir) {
  return tryReadDir(dir)
    .filter(e => e.endsWith('.md'))
    .map(e => e.replace(/\.md$/, ''));
}

// 读取 .mcp.json 中的 server 名称
function readMcpServers(mcpFile) {
  const content = tryRead(mcpFile);
  if (!content) return [];
  try {
    const json = JSON.parse(content);
    // 支持 mcpServers 和 mcp_servers 两种键名
    const servers = json.mcpServers || json.mcp_servers || {};
    return Object.keys(servers);
  } catch { return []; }
}

// 扫描已安装插件（best-effort）
function scanInstalledPlugins() {
  const cacheDir = path.join(os.homedir(), '.claude', 'plugins', 'cache');
  const results = [];

  for (const entry of tryReadDir(cacheDir)) {
    const pluginPath = path.join(cacheDir, entry);
    if (!isDir(pluginPath)) continue;

    // 读取 manifest（优先 .claude-plugin/plugin.json，fallback 根目录 plugin.json）
    const manifestContent =
      tryRead(path.join(pluginPath, '.claude-plugin', 'plugin.json')) ||
      tryRead(path.join(pluginPath, 'plugin.json'));

    let name = entry;
    let version = '';
    let description = '';

    if (manifestContent) {
      try {
        const manifest = JSON.parse(manifestContent);
        name = manifest.name || entry;
        version = manifest.version || '';
        description = truncate(manifest.description || '', MAX_DESC);
      } catch { /* 解析失败，使用目录名 */ }
    }

    // 列出该插件的 skills 和 agents
    const skillNames = tryReadDir(path.join(pluginPath, 'skills'))
      .filter(e => isDir(path.join(pluginPath, 'skills', e)));
    const agentNames = tryReadDir(path.join(pluginPath, 'agents'))
      .filter(e => e.endsWith('.md'))
      .map(e => e.replace(/\.md$/, ''));

    results.push({ name, version, description, skillNames, agentNames });
  }

  return results;
}

// ─── 构建输出 ────────────────────────────────────────────────────────────────

function buildOutput() {
  const cwd = process.cwd();
  const claudeUserDir = path.join(os.homedir(), '.claude');
  const sections = [];
  const errors = [];

  // 1. 内置命令（硬编码，来自官方文档）
  const builtins = [
    '/clear', '/compact', '/cost', '/help', '/model', '/config',
    '/hooks', '/permissions', '/agents', '/skills', '/resume', '/init',
    '/rename', '/reload-plugins', '/plan', '/mcp', '/memory', '/btw',
    '/diff', '/context', '/fast', '/effort', '/export', '/copy',
  ].join(' | ');
  sections.push(`### 内置命令 [built-in]\n${builtins}`);

  // 2. 项目级 skills
  try {
    const items = scanSkills(path.join(cwd, '.claude', 'skills'));
    if (items.length > 0) {
      sections.push(
        `### 项目级 Skills\n` +
        items.map(s => `- ${s.name}${s.desc ? ': ' + s.desc : ''}`).join('\n')
      );
    }
  } catch (e) { errors.push(`项目 skills: ${e.message}`); }

  // 3. 项目级 subagents
  try {
    const items = scanAgents(path.join(cwd, '.claude', 'agents'));
    if (items.length > 0) {
      sections.push(
        `### 项目级 Subagents\n` +
        items.map(a => `- @${a.name}${a.desc ? ': ' + a.desc : ''}`).join('\n')
      );
    }
  } catch (e) { errors.push(`项目 agents: ${e.message}`); }

  // 4. 项目级 legacy commands
  try {
    const cmds = scanCommands(path.join(cwd, '.claude', 'commands'));
    if (cmds.length > 0) {
      sections.push(
        `### 项目级 Legacy Commands\n` +
        cmds.map(c => `- ${c} [legacy，建议迁移到 skills/]`).join('\n')
      );
    }
  } catch (e) { errors.push(`项目 commands: ${e.message}`); }

  // 5. 用户级 skills
  try {
    const items = scanSkills(path.join(claudeUserDir, 'skills'));
    if (items.length > 0) {
      sections.push(
        `### 用户级 Skills\n` +
        items.map(s => `- ${s.name}${s.desc ? ': ' + s.desc : ''}`).join('\n')
      );
    }
  } catch (e) { errors.push(`用户 skills: ${e.message}`); }

  // 6. 用户级 subagents
  try {
    const items = scanAgents(path.join(claudeUserDir, 'agents'));
    if (items.length > 0) {
      sections.push(
        `### 用户级 Subagents\n` +
        items.map(a => `- @${a.name}${a.desc ? ': ' + a.desc : ''}`).join('\n')
      );
    }
  } catch (e) { errors.push(`用户 agents: ${e.message}`); }

  // 7. 用户级 legacy commands
  try {
    const cmds = scanCommands(path.join(claudeUserDir, 'commands'));
    if (cmds.length > 0) {
      sections.push(
        `### 用户级 Legacy Commands\n` +
        cmds.map(c => `- ${c} [legacy]`).join('\n')
      );
    }
  } catch (e) { errors.push(`用户 commands: ${e.message}`); }

  // 8. 已安装插件（best-effort）
  try {
    const plugins = scanInstalledPlugins();
    if (plugins.length > 0) {
      const lines = plugins.map(p => {
        let line = `- ${p.name}${p.version ? ' (v' + p.version + ')' : ''}`;
        if (p.description) line += `: ${p.description}`;
        if (p.skillNames.length > 0) line += `\n  - skills: ${p.skillNames.join(', ')}`;
        if (p.agentNames.length > 0) line += `\n  - agents: ${p.agentNames.join(', ')}`;
        return line;
      });
      sections.push(`### 已安装插件\n${lines.join('\n')}`);
    }
  } catch (e) { errors.push(`插件扫描: ${e.message}`); }

  // 9. MCP Servers
  try {
    const mcpLines = [];
    readMcpServers(path.join(cwd, '.mcp.json')).forEach(s => mcpLines.push(`- ${s} (项目级)`));
    readMcpServers(path.join(claudeUserDir, '.mcp.json')).forEach(s => mcpLines.push(`- ${s} (用户级)`));
    if (mcpLines.length > 0) {
      sections.push(`### MCP Servers\n${mcpLines.join('\n')}`);
    }
  } catch (e) { errors.push(`MCP: ${e.message}`); }

  // 组合输出
  let output = `## 当前环境能力摘要\n\n${sections.join('\n\n')}`;

  // 超限处理：缩短每条 description 后重新构建
  if (output.length > MAX_TOTAL_CHARS) {
    const SHORT_DESC = 50;
    const shortSections = [];

    shortSections.push(`### 内置命令 [built-in]\n${builtins}`);

    // 重新扫描并用短 description
    const scanMap = [
      ['项目级 Skills',           () => scanSkills(path.join(cwd, '.claude', 'skills')),   'skill'],
      ['项目级 Subagents',        () => scanAgents(path.join(cwd, '.claude', 'agents')),   'agent'],
      ['用户级 Skills',           () => scanSkills(path.join(claudeUserDir, 'skills')),    'skill'],
      ['用户级 Subagents',        () => scanAgents(path.join(claudeUserDir, 'agents')),    'agent'],
    ];

    for (const [label, scanner, type] of scanMap) {
      try {
        const items = scanner();
        if (items.length === 0) continue;
        const prefix = type === 'agent' ? '@' : '';
        const lines = items.map(i => {
          const desc = truncate(i.desc, SHORT_DESC);
          return `- ${prefix}${i.name}${desc ? ': ' + desc : ''}`;
        });
        shortSections.push(`### ${label}\n${lines.join('\n')}`);
      } catch { /* 静默跳过 */ }
    }

    output = `## 当前环境能力摘要\n\n${shortSections.join('\n\n')}`;

    // 最后兜底：强制截断
    if (output.length > MAX_TOTAL_CHARS) {
      output = output.slice(0, MAX_TOTAL_CHARS - 30) + '\n\n…（内容已截断）';
    }
  }

  if (errors.length > 0) {
    process.stderr.write(`扫描部分失败:\n${errors.map(e => '  ' + e).join('\n')}\n`);
    output += '\n\n[部分扫描失败，详见 stderr]';
  }

  return output;
}

// ─── 入口 ────────────────────────────────────────────────────────────────────

try {
  process.stdout.write(buildOutput() + '\n');
} catch (err) {
  process.stderr.write(`致命错误: ${err.message}\n${err.stack}\n`);
  process.stdout.write('[扫描失败，详见 stderr]\n');
  process.exit(1);
}
