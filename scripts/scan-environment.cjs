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

// errors 收集器，由 collectSnapshot 注入
let _errors = [];

function tryRead(filePath) {
  try { return fs.readFileSync(filePath, 'utf8'); }
  catch (e) {
    if (e.code !== 'ENOENT') _errors.push(`读取 ${path.basename(filePath)}: ${e.code}`);
    return null;
  }
}

// 只读前 2KB，足够提取 frontmatter
const HEAD_BYTES = 2048;
function tryReadHead(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    const bytesRead = fs.readSync(fd, buf, 0, HEAD_BYTES, 0);
    return buf.toString('utf8', 0, bytesRead);
  } catch (e) {
    if (e.code !== 'ENOENT') _errors.push(`读取 ${path.basename(filePath)}: ${e.code}`);
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function tryReadDir(dirPath, withTypes) {
  try {
    return withTypes
      ? fs.readdirSync(dirPath, { withFileTypes: true })
      : fs.readdirSync(dirPath);
  } catch (e) {
    if (e.code !== 'ENOENT') _errors.push(`列目录 ${path.basename(dirPath)}: ${e.code}`);
    return [];
  }
}

function truncate(str, max) {
  if (!str) return '';
  str = str.replace(/\r?\n/g, ' ').trim();
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

// 注入到 Claude 上下文前的净化：去除换行、反引号、HTML 标签等 prompt injection 载体
function sanitize(str) {
  if (!str) return '';
  return str
    .replace(/\r?\n|\r/g, ' ')   // 换行 → 空格（防跳出列表项）
    .replace(/`/g, "'")           // 反引号 → 单引号（防 !command 注入）
    .replace(/<[^>]*>/g, '')      // HTML 标签（防 XSS-like）
    .trim();
}

// 从 SKILL.md / agent.md 的 YAML frontmatter 提取指定字段
// 支持 plain scalar、quoted scalar 和 block scalar（> | >- |-）
function extractFrontmatter(content) {
  if (!content) return {};
  // 移除 UTF-8 BOM
  content = content.replace(/^\uFEFF/, '');
  const match = content.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const lines = match[1].split('\n');
  const result = {};
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\w[\w-]*):\s*(.*?)\s*$/);
    if (!m) continue;
    const key = m[1];
    const rawVal = m[2];
    // block scalar: > | >- |- 等指示符
    if (/^[>|][-+]?$/.test(rawVal)) {
      const blockLines = [];
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) {
        blockLines.push(lines[++i].trimStart());
      }
      // > 折叠换行为空格，| 保留换行
      result[key] = rawVal.startsWith('>')
        ? blockLines.join(' ').trim()
        : blockLines.join('\n').trim();
    } else {
      // 移除首尾引号
      result[key] = rawVal.replace(/^["']|["']$/g, '').trim();
    }
  }
  return result;
}

function getDescription(content) {
  const fm = extractFrontmatter(content);
  if (fm.description) return sanitize(truncate(fm.description, MAX_DESC));
  // fallback：取 frontmatter 后第一个非空、非标题行
  if (!content) return '';
  const afterFm = content.replace(/^---[\s\S]*?\n---\s*\n?/, '');
  const firstPara = afterFm
    .split('\n')
    .find(l => l.trim() && !l.startsWith('#'));
  return sanitize(truncate(firstPara || '', MAX_DESC));
}

function getName(content, fallback) {
  const fm = extractFrontmatter(content);
  return sanitize((fm.name || fallback || '').trim());
}

// ─── 扫描函数 ────────────────────────────────────────────────────────────────

// 扫描 skills 目录（每个子目录为一个 skill，必须含 SKILL.md）
function scanSkills(dir) {
  const results = [];
  for (const dirent of tryReadDir(dir, true)) {
    if (dirent.name.startsWith('.') || !dirent.isDirectory()) continue;
    const content = tryReadHead(path.join(dir, dirent.name, 'SKILL.md'));
    if (content === null) continue;
    const name = getName(content, dirent.name);
    const desc = getDescription(content);
    results.push({ name, desc });
  }
  return results;
}

// 扫描 agents 目录（每个 .md 文件为一个 agent）
function scanAgents(dir) {
  const results = [];
  for (const dirent of tryReadDir(dir, true)) {
    if (dirent.name.startsWith('.') || !dirent.isFile() || !dirent.name.endsWith('.md')) continue;
    const content = tryReadHead(path.join(dir, dirent.name));
    if (content === null) continue;
    const name = getName(content, dirent.name.replace(/\.md$/, ''));
    const desc = getDescription(content);
    results.push({ name, desc });
  }
  return results;
}

// 扫描 commands 目录（legacy，仅列名称）
function scanCommands(dir) {
  return tryReadDir(dir, true)
    .filter(d => d.isFile() && d.name.endsWith('.md'))
    .map(d => d.name.replace(/\.md$/, ''));
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
  } catch {
    // 可能是 JSON5/带注释的文件，输出警告而非静默丢弃
    _errors.push(`${path.basename(mcpFile)} 解析失败（非标准 JSON？）`);
    return [];
  }
}

// 扫描已安装插件（best-effort）
function scanInstalledPlugins(claudeUserDir) {
  const cacheDir = path.join(claudeUserDir, 'plugins', 'cache');
  const results = [];

  for (const dirent of tryReadDir(cacheDir, true)) {
    if (!dirent.isDirectory()) continue;
    const pluginPath = path.join(cacheDir, dirent.name);

    // 读取 manifest（优先 .claude-plugin/plugin.json，fallback 根目录 plugin.json）
    const manifestContent =
      tryRead(path.join(pluginPath, '.claude-plugin', 'plugin.json')) ||
      tryRead(path.join(pluginPath, 'plugin.json'));

    let name = dirent.name;
    let version = '';
    let description = '';

    if (manifestContent) {
      try {
        const manifest = JSON.parse(manifestContent);
        name = sanitize(manifest.name || dirent.name);
        version = sanitize(manifest.version || '');
        description = sanitize(truncate(manifest.description || '', MAX_DESC));
      } catch { /* 解析失败，使用目录名 */ }
    }

    // 列出该插件的 skills（必须含 SKILL.md）和 agents（必须是 .md）
    const skillNames = tryReadDir(path.join(pluginPath, 'skills'), true)
      .filter(d => !d.name.startsWith('.') && d.isDirectory()
        && tryRead(path.join(pluginPath, 'skills', d.name, 'SKILL.md')) !== null)
      .map(d => d.name);
    const agentNames = tryReadDir(path.join(pluginPath, 'agents'), true)
      .filter(d => !d.name.startsWith('.') && d.isFile() && d.name.endsWith('.md'))
      .map(d => d.name.replace(/\.md$/, ''));

    results.push({ name, version, description, skillNames, agentNames });
  }

  return results;
}

// ─── 数据收集（一次扫描）─────────────────────────────────────────────────────

// WSL 下额外探测 Windows %USERPROFILE%\.claude
function resolveUserDir() {
  const linuxHome = path.join(os.homedir(), '.claude');
  if (!process.env.WSL_DISTRO_NAME) return linuxHome;
  // 优先 Linux home（通常是 ~/.claude symlink 或挂载点）
  try { if (require('fs').statSync(linuxHome).isDirectory()) return linuxHome; } catch { /**/ }
  // fallback: 通过 wslpath 获取 Windows %USERPROFILE%
  try {
    const winProfile = require('child_process')
      .execSync('wslpath "$(cmd.exe /C "echo %USERPROFILE%" 2>/dev/null)"', { timeout: 2000 })
      .toString().trim();
    const winClaude = path.join(winProfile, '.claude');
    require('fs').statSync(winClaude); // 确认存在
    return winClaude;
  } catch { return linuxHome; }
}

function collectSnapshot(projectDir, userDir) {
  const cwd = projectDir || process.cwd();
  const claudeUserDir = userDir || resolveUserDir();
  _errors = []; // 重置全局错误收集器（供 tryRead/tryReadDir 使用）
  const errors = _errors;
  // 按优先级排列：项目级 > MCP > 用户级 > 插件 > legacy > 内置
  const sections = [];

  function tryCollect(label, prefix, fn) {
    try {
      const items = fn();
      if (items.length > 0) sections.push({ label, prefix, items });
    } catch (e) { errors.push(`${label}: ${e.message}`); }
  }

  tryCollect('项目级 Skills', '', () => scanSkills(path.join(cwd, '.claude', 'skills')));
  tryCollect('项目级 Subagents', '@', () => scanAgents(path.join(cwd, '.claude', 'agents')));

  // MCP Servers（结构不同，手动处理）
  try {
    const mcpItems = [];
    readMcpServers(path.join(cwd, '.mcp.json')).forEach(s => mcpItems.push({ name: s, desc: '项目级' }));
    readMcpServers(path.join(claudeUserDir, '.mcp.json')).forEach(s => mcpItems.push({ name: s, desc: '用户级' }));
    if (mcpItems.length > 0) sections.push({ label: 'MCP Servers', prefix: '', items: mcpItems });
  } catch (e) { errors.push(`MCP: ${e.message}`); }

  tryCollect('用户级 Skills', '', () => scanSkills(path.join(claudeUserDir, 'skills')));
  tryCollect('用户级 Subagents', '@', () => scanAgents(path.join(claudeUserDir, 'agents')));

  // 已安装插件
  try {
    const plugins = scanInstalledPlugins(claudeUserDir);
    if (plugins.length > 0) {
      const items = plugins.map(p => ({
        name: `${p.name}${p.version ? ' (v' + p.version + ')' : ''}`,
        desc: p.description,
        extra: [
          p.skillNames.length > 0 ? `skills: ${p.skillNames.join(', ')}` : '',
          p.agentNames.length > 0 ? `agents: ${p.agentNames.join(', ')}` : '',
        ].filter(Boolean).join(' | ')
      }));
      sections.push({ label: '已安装插件', prefix: '', items });
    }
  } catch (e) { errors.push(`插件扫描: ${e.message}`); }

  // Legacy commands
  try {
    const projCmds = scanCommands(path.join(cwd, '.claude', 'commands'));
    const userCmds = scanCommands(path.join(claudeUserDir, 'commands'));
    const cmds = [
      ...projCmds.map(c => ({ name: c, desc: 'legacy，建议迁移到 skills/' })),
      ...userCmds.map(c => ({ name: c, desc: 'legacy' })),
    ];
    if (cmds.length > 0) sections.push({ label: 'Legacy Commands', prefix: '', items: cmds });
  } catch (e) { errors.push(`commands: ${e.message}`); }

  // 跨级别去重：项目级优先，用户级同名条目移除
  const projSkillNames = new Set(
    (sections.find(s => s.label === '项目级 Skills') || { items: [] }).items.map(i => i.name)
  );
  const projAgentNames = new Set(
    (sections.find(s => s.label === '项目级 Subagents') || { items: [] }).items.map(i => i.name)
  );
  for (const s of sections) {
    if (s.label === '用户级 Skills') s.items = s.items.filter(i => !projSkillNames.has(i.name));
    if (s.label === '用户级 Subagents') s.items = s.items.filter(i => !projAgentNames.has(i.name));
  }
  // 去重后可能清空 section，移除空的
  const nonEmpty = sections.filter(s => s.items.length > 0);
  sections.length = 0;
  sections.push(...nonEmpty);

  // 稳定排序：固定 'en' locale，保证跨平台/跨系统输出完全一致
  for (const s of sections) {
    s.items.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  }

  return { sections, errors };
}

// ─── 渲染（支持多级降级）────────────────────────────────────────────────────

const BUILTINS_COMPACT = '内置 24 个（/help 查看）';
const BUILTINS_FULL = [
  '/clear', '/compact', '/cost', '/help', '/model', '/config',
  '/hooks', '/permissions', '/agents', '/skills', '/resume', '/init',
  '/rename', '/reload-plugins', '/plan', '/mcp', '/memory', '/btw',
  '/diff', '/context', '/fast', '/effort', '/export', '/copy',
].join(' | ');

// level 0: 名称 + 完整 desc | level 1: 名称 + 短 desc | level 2: 仅名称 | level 3: 计数
function renderSection(section, level) {
  const { label, prefix, items } = section;
  if (level >= 3) return `### ${label}\n${items.length} 个`;
  if (level >= 2) return `### ${label}\n${items.map(i => prefix + i.name).join(', ')}`;
  const descMax = level >= 1 ? 50 : MAX_DESC;
  const lines = items.map(i => {
    let line = `- ${prefix}${i.name}`;
    const desc = truncate(i.desc, descMax);
    if (desc) line += `: ${desc}`;
    if (i.extra) line += `\n  ${i.extra}`;
    return line;
  });
  return `### ${label}\n${lines.join('\n')}`;
}

// mode: 'route'（保留描述用于路由判断）| 'list'（高密度目录，初始 level 2）
function renderSnapshot(snapshot, mode) {
  const { sections, errors } = snapshot;
  const initLevel = mode === 'list' ? 2 : 0;
  const levels = sections.map(() => initLevel);
  // 内置命令 Claude 已知，默认压缩，降级时已无需再压
  let useCompactBuiltins = true;

  function assemble() {
    const header = useCompactBuiltins ? BUILTINS_COMPACT : `### 内置命令 [built-in]\n${BUILTINS_FULL}`;
    const parts = sections.map((s, i) => renderSection(s, levels[i]));
    return `## 当前环境能力摘要\n\n${header}\n\n${parts.join('\n\n')}`;
  }

  let output = assemble();

  // 逐步降级最长的 section，直到 ≤ 预算
  while (output.length > MAX_TOTAL_CHARS) {
    // 找当前渲染最长且 level < 3 的 section
    let maxLen = -1, maxIdx = -1;
    for (let i = 0; i < sections.length; i++) {
      if (levels[i] >= 3) continue;
      const len = renderSection(sections[i], levels[i]).length;
      if (len > maxLen) { maxLen = len; maxIdx = i; }
    }
    if (maxIdx === -1) break;
    levels[maxIdx]++;
    output = assemble();
  }

  // error footer（在预算内计算，不追加在截断点之后）
  const FOOTER = errors.length > 0 ? '\n\n[部分扫描失败，详见 stderr]' : '';
  const budget = MAX_TOTAL_CHARS - FOOTER.length;

  // 兜底截断（在预算内，为 footer 留出空间）
  if (output.length > budget) {
    output = output.slice(0, budget - 20) + '\n\n…（已截断）';
  }
  return { text: output + FOOTER, errors };
}

// ─── 模块导出（供测试使用）───────────────────────────────────────────────────

module.exports = {
  extractFrontmatter, getDescription, getName,
  scanSkills, scanAgents, scanCommands, readMcpServers,
  collectSnapshot, renderSnapshot, truncate,
};

// ─── 入口（CLI 直接运行时执行）──────────────────────────────────────────────

if (require.main !== module) { /* 被 require 时不执行 */ }
else try {
  function getArg(name) {
    const a = process.argv.find(x => x.startsWith(`--${name}=`));
    return a ? a.split('=')[1] : undefined;
  }
  const mode = getArg('mode') || 'route';
  const projectDir = getArg('project-dir') || process.env.CAPABILITY_PROJECT_DIR;
  const userDir = getArg('user-dir') || process.env.CAPABILITY_USER_DIR;
  const { text, errors: errs } = renderSnapshot(collectSnapshot(projectDir, userDir), mode);
  if (errs.length > 0) {
    process.stderr.write(`扫描部分失败:\n${errs.map(e => '  ' + e).join('\n')}\n`);
  }
  process.stdout.write(text + '\n');
} catch (err) {
  process.stderr.write(`致命错误: ${err.message}\n${err.stack}\n`);
  process.stdout.write('[扫描失败，详见 stderr]\n');
  process.exit(1);
}
