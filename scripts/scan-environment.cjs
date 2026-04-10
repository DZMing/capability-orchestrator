#!/usr/bin/env node
// scan-environment.cjs — capability-orchestrator 核心扫描脚本
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
// 运行方式: node scripts/scan-environment.cjs
// 依赖: 仅 Node.js 标准库 (fs, path, os)

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_TOTAL_CHARS = 3000;
const MAX_DESC = 100;

// ─── 工具函数 ───────────────────────────────────────────────────────────────

// IO 工具函数，errors 参数可选（传入数组时收集非致命错误）

function tryRead(filePath, errors) {
  try { return fs.readFileSync(filePath, 'utf8'); }
  catch (e) {
    if (e.code !== 'ENOENT' && errors) errors.push(`读取 ${path.basename(filePath)}: ${e.code}`);
    return null;
  }
}

// 只读前 2KB，足够提取 frontmatter
// 处理 UTF-8 多字节截断：移除末尾可能的 U+FFFD 替换字符
const HEAD_BYTES = 2048;
function tryReadHead(filePath, errors) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    const bytesRead = fs.readSync(fd, buf, 0, HEAD_BYTES, 0);
    let str = buf.toString('utf8', 0, bytesRead);
    // 截断可能切在多字节字符中间，产生末尾 U+FFFD，去掉所有末尾的
    str = str.replace(/\uFFFD+$/, '');
    return str;
  } catch (e) {
    if (e.code !== 'ENOENT' && errors) errors.push(`读取 ${path.basename(filePath)}: ${e.code}`);
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function tryReadDir(dirPath, withTypes, errors) {
  try {
    return withTypes
      ? fs.readdirSync(dirPath, { withFileTypes: true })
      : fs.readdirSync(dirPath);
  } catch (e) {
    if (e.code !== 'ENOENT' && errors) errors.push(`列目录 ${path.basename(dirPath)}: ${e.code}`);
    return [];
  }
}

function truncate(str, max) {
  if (!str) return '';
  str = String(str).replace(/\r?\n/g, ' ').trim();
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

// 零依赖 semver 比较：逐段数字比较，避免字符串排序的经典 bug（"9" > "10"）
// 注意：不支持 pre-release 标签（如 1.0.0-beta），仅用于插件去重场景
function compareSemver(a, b) {
  const pa = a.replace(/^v/i, '').split('.').map(Number);
  const pb = b.replace(/^v/i, '').split('.').map(Number);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

// 危险 Unicode 字符：零宽字符、方向覆盖、不可见控制字符（保留 TAB/LF/CR）
const UNSAFE_UNICODE = /[\u200B\u200C\u200D\uFEFF\u00AD\u2060\u180E\u200E\u200F\u202A-\u202E\u2066-\u2069\u061C\u2061-\u2064\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFF9-\uFFFB]/g;

// 注入到 Claude 上下文前的净化：去除换行、反引号、HTML 标签、危险 Unicode 等 prompt injection 载体
function sanitize(str) {
  if (!str) return '';
  return String(str)
    .replace(/\r?\n|\r/g, ' ')   // 换行 → 空格（防跳出列表项）
    .replace(UNSAFE_UNICODE, '')  // 零宽/方向覆盖/控制字符（防隐藏文本注入）
    .replace(/`/g, "'")           // 反引号 → 单引号（防 !command 注入）
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') // 先解码 HTML entities 再过滤
    .replace(/<[^>]*>?/g, '')     // HTML 标签（含未闭合，如 <script alert(1)）
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // Markdown 图片链接（防数据外泄）
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')  // Markdown 普通链接（防钓鱼）
    .replace(/(^| )#{1,6} /g, '$1') // Markdown 标题语法（精确匹配：行首或空格后跟 # 和空格）
    .trim();
}

// 从 SKILL.md / agent.md 的 YAML frontmatter 提取指定字段
// 支持 plain scalar、quoted scalar 和 block scalar（> | >- |-）
// 合并所有 frontmatter 块（某些 agent 文件有两个：metadata + 实际描述）
function extractFrontmatter(content) {
  if (!content) return {};
  // 移除 UTF-8 BOM
  content = content.replace(/^\uFEFF/, '');
  const result = {};
  // 匹配所有 --- 块（插件注册的 agent 可能有 metadata 块 + 正文块）
  const blockRe = /(?:^|\n)---[ \t]*\r?\n([\s\S]*?)\r?\n---/g;
  let blockMatch;
  while ((blockMatch = blockRe.exec(content)) !== null) {
    const lines = blockMatch[1].split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(\w[\w-]*):\s*(.*?)\s*$/);
      if (!m) continue;
      const key = m[1];
      const rawVal = m[2];
      // block scalar: > | >- |- 等指示符
      if (/^[>|][-+]?$/.test(rawVal)) {
        const blockLines = [];
        // 空行也属于 block scalar（段落分隔），直到遇到非缩进的非空行
        while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || lines[i + 1].trim() === '')) {
          blockLines.push(lines[++i].trimStart());
        }
        // > 折叠换行为空格，| 保留换行
        // 后出现的块覆盖先出现的（正文块优先于 metadata 块）
        result[key] = rawVal.startsWith('>')
          ? blockLines.join(' ').trim()
          : blockLines.join('\n').trim();
      } else {
        result[key] = rawVal.replace(/^["']|["']$/g, '').trim();
      }
    }
  }
  return result;
}

function getDescription(content) {
  const fm = extractFrontmatter(content);
  if (fm.description) return sanitize(truncate(fm.description, MAX_DESC));
  // fallback：取 frontmatter 后第一个非空、非标题行
  if (!content) return '';
  // 与 extractFrontmatter 相同的精确正则，不贪婪消费尾部空白
  const afterFm = content.replace(/(?:^|\n)---[ \t]*\r?\n[\s\S]*?\r?\n---/g, '');
  const firstPara = afterFm
    .split('\n')
    .find(l => l.trim() && !l.startsWith('#') && !/^---\s*$/.test(l));
  return sanitize(truncate(firstPara || '', MAX_DESC));
}

function getName(content, fallback) {
  const fm = extractFrontmatter(content);
  return sanitize((fm.name || fallback || '').trim());
}

// ─── 扫描函数 ────────────────────────────────────────────────────────────────

// symlink 安全检查：跳过符号链接（防止循环引用导致无限递归）
// fail-safe：异常时返回 true（宁可跳过也不冒循环风险）
function isSymlink(filePath) {
  try { return fs.lstatSync(filePath).isSymbolicLink(); } catch { return true; }
}

// 扫描 skills 目录（每个子目录为一个 skill，必须含 SKILL.md）
function scanSkills(dir, errors) {
  const results = [];
  for (const dirent of tryReadDir(dir, true, errors)) {
    if (dirent.name.startsWith('.') || !dirent.isDirectory()) continue;
    const fullPath = path.join(dir, dirent.name);
    if (isSymlink(fullPath)) continue;
    const content = tryReadHead(path.join(fullPath, 'SKILL.md'), errors);
    if (content === null) continue;
    const name = getName(content, dirent.name);
    const desc = getDescription(content);
    results.push({ name, desc });
  }
  return results;
}

// 扫描 agents 目录（每个 .md 文件为一个 agent）
function scanAgents(dir, errors) {
  const results = [];
  for (const dirent of tryReadDir(dir, true, errors)) {
    if (dirent.name.startsWith('.') || !dirent.isFile() || !dirent.name.endsWith('.md')) continue;
    const fullPath = path.join(dir, dirent.name);
    if (isSymlink(fullPath)) continue;
    const content = tryReadHead(fullPath, errors);
    if (content === null) continue;
    const name = getName(content, dirent.name.replace(/\.md$/, ''));
    const desc = getDescription(content);
    results.push({ name, desc });
  }
  return results;
}

// 扫描 commands 目录（legacy，仅列名称）
function scanCommands(dir, errors) {
  return tryReadDir(dir, true, errors)
    .filter(d => d.isFile() && d.name.endsWith('.md'))
    .map(d => d.name.replace(/\.md$/, ''));
}

// 读取 .mcp.json 中的 server 名称和描述，过滤 disabled
// 容错：先尝试标准 JSON，失败后去除 // 行注释再重试
function readMcpServers(mcpFile, errors) {
  const content = tryRead(mcpFile, errors);
  if (!content) return [];
  function extractServers(json) {
    const servers = json.mcpServers || json.mcp_servers || {};
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return [];
    return Object.entries(servers)
      .filter(([, v]) => v && v.disabled !== true)
      .map(([name, v]) => ({ name, desc: (v && v.description) || '' }));
  }
  try {
    return extractServers(JSON.parse(content));
  } catch {
    // 去除 // 注释后重试（整行 + 行尾，安全跳过字符串内的 //）
    try {
      const stripped = content.split('\n').map(line => {
        // 逐字符查找字符串外的 //（正确处理 \\" 等连续转义）
        let inStr = false;
        for (let i = 0; i < line.length - 1; i++) {
          if (line[i] === '"') {
            // 数引号前连续反斜杠：偶数个 = 引号未被转义
            let bs = 0;
            for (let j = i - 1; j >= 0 && line[j] === '\\'; j--) bs++;
            if (bs % 2 === 0) inStr = !inStr;
          }
          if (!inStr && line[i] === '/' && line[i + 1] === '/') return line.slice(0, i).trimEnd();
        }
        return line;
      }).join('\n');
      return extractServers(JSON.parse(stripped));
    } catch {
      if (errors) errors.push(`${path.basename(mcpFile)} 解析失败（非标准 JSON？）`);
      return [];
    }
  }
}

// 判断一个目录是否是有效插件根（有 manifest 或 skills/agents）
// 短路优先检查最常见的 .claude-plugin/plugin.json，用 existsSync 避免不必要的文件读取
function isPluginRoot(dirPath) {
  // 最常见：标准 manifest 位置
  if (fs.existsSync(path.join(dirPath, '.claude-plugin', 'plugin.json'))) return true;
  // 次常见：根目录 manifest
  if (fs.existsSync(path.join(dirPath, 'plugin.json'))) return true;
  // fallback：有 skills 或 agents 子目录即可
  if (tryReadDir(path.join(dirPath, 'skills'), true).some(d => d.isDirectory())) return true;
  return tryReadDir(path.join(dirPath, 'agents'), true).some(d => d.isFile() && d.name.endsWith('.md'));
}

// 递归查找插件根目录（遇到插件根停止，最大深度防失控）
// 真实结构：扁平 cache/<name>/ | 两级 cache/<vendor>/<name>/ | 三级 cache/<vendor>/<name>/<version>/
function findPluginRoots(dir, maxDepth, errors) {
  if (maxDepth <= 0) return [];
  if (isPluginRoot(dir)) return [dir];
  const roots = [];
  for (const d of tryReadDir(dir, true, errors)) {
    if (!d.isDirectory() || d.name.startsWith('.')) continue;
    const child = path.join(dir, d.name);
    if (isSymlink(child)) continue;
    roots.push(...findPluginRoots(child, maxDepth - 1, errors));
  }
  return roots;
}

// 扫描已安装插件（best-effort）
// 支持扁平/两级/三级结构，递归查找最大深度 3
function scanInstalledPlugins(claudeUserDir, errors) {
  const cacheDir = path.join(claudeUserDir, 'plugins', 'cache');
  const results = [];

  for (const dirent of tryReadDir(cacheDir, true, errors)) {
    if (!dirent.isDirectory()) continue;
    const candidate = path.join(cacheDir, dirent.name);
    if (isSymlink(candidate)) continue;

    const pluginPaths = findPluginRoots(candidate, 3, errors);

    for (const pluginPath of pluginPaths) {
      const pluginName = path.basename(pluginPath);

      // 读取 manifest（优先 .claude-plugin/plugin.json，fallback 根目录 plugin.json）
      const manifestContent =
        tryRead(path.join(pluginPath, '.claude-plugin', 'plugin.json'), errors) ||
        tryRead(path.join(pluginPath, 'plugin.json'), errors);

      let name = sanitize(pluginName);
      let version = '';
      let description = '';

      if (manifestContent) {
        try {
          const manifest = JSON.parse(manifestContent);
          name = sanitize(manifest.name || pluginName);
          version = sanitize(manifest.version || '');
          description = sanitize(truncate(manifest.description || '', MAX_DESC));
        } catch { /* 解析失败，使用目录名 */ }
      }

      // 列出该插件的 skills（用 existsSync 检查而非 tryRead，减少不必要 IO）
      const skillItems = tryReadDir(path.join(pluginPath, 'skills'), true, errors)
        .filter(d => !d.name.startsWith('.') && d.isDirectory()
          && fs.existsSync(path.join(pluginPath, 'skills', d.name, 'SKILL.md')))
        .map(d => {
          const head = tryReadHead(path.join(pluginPath, 'skills', d.name, 'SKILL.md'), errors);
          return { name: sanitize(getName(head, d.name)), desc: head ? getDescription(head) : '' };
        });
      const agentNames = tryReadDir(path.join(pluginPath, 'agents'), true, errors)
        .filter(d => !d.name.startsWith('.') && d.isFile() && d.name.endsWith('.md'))
        .map(d => sanitize(d.name.replace(/\.md$/, '')));

      results.push({ name, version, description, skillItems, agentNames });
    } // end inner for (pluginPaths)
  } // end outer for (cacheDir entries)

  // 同名插件去重（多版本保留有 version 的或后发现的）
  const seen = new Map();
  for (const p of results) {
    const prev = seen.get(p.name);
    if (!prev || (p.version && (!prev.version || compareSemver(p.version, prev.version) > 0))) seen.set(p.name, p);
  }
  return [...seen.values()];
}

// ─── 数据收集（一次扫描）─────────────────────────────────────────────────────

// WSL 下额外探测 Windows %USERPROFILE%\.claude
function resolveUserDir() {
  const linuxHome = path.join(os.homedir(), '.claude');
  if (!process.env.WSL_DISTRO_NAME) return linuxHome;
  // 优先 Linux home（通常是 ~/.claude symlink 或挂载点）
  try { if (fs.statSync(linuxHome).isDirectory()) return linuxHome; } catch { /**/ }
  // fallback: 两步获取 Windows 路径（避免嵌套 shell 替换）
  try {
    const { execSync } = require('child_process');
    const winRaw = execSync('cmd.exe /C "echo %USERPROFILE%" 2>/dev/null', { timeout: 2000 })
      .toString().trim().replace(/\r/g, '');
    const winProfile = execSync(`wslpath "${winRaw}"`, { timeout: 2000 })
      .toString().trim();
    const winClaude = path.join(winProfile, '.claude');
    fs.statSync(winClaude); // 确认存在
    return winClaude;
  } catch { return linuxHome; }
}

function collectSnapshot(projectDir, userDir) {
  const cwd = projectDir || process.cwd();
  const claudeUserDir = userDir || resolveUserDir();
  const errors = [];
  // 按优先级排列：项目级 > MCP > 用户级 > 插件 > legacy > 内置
  const sections = [];

  function tryCollect(label, prefix, fn) {
    try {
      const items = fn();
      if (items.length > 0) sections.push({ label, prefix, items });
    } catch (e) { errors.push(`${label}: ${e.message}`); }
  }

  tryCollect('项目级 Skills', '', () => scanSkills(path.join(cwd, '.claude', 'skills'), errors));
  tryCollect('项目级 Subagents', '@', () => scanAgents(path.join(cwd, '.claude', 'agents'), errors));

  // MCP Servers（结构不同，手动处理）
  try {
    const mcpItems = [];
    readMcpServers(path.join(cwd, '.mcp.json'), errors).forEach(s =>
      mcpItems.push({ name: sanitize(s.name), desc: sanitize(truncate(s.desc, MAX_DESC)) || '项目级' }));
    // 用户级 MCP：优先 mcp.json（当前标准），fallback .mcp.json（旧格式）
    const userMcpFile = fs.existsSync(path.join(claudeUserDir, 'mcp.json'))
      ? path.join(claudeUserDir, 'mcp.json')
      : path.join(claudeUserDir, '.mcp.json');
    // 跨级别去重：项目级优先，用户级同名 server 跳过
    const projMcpNames = new Set(mcpItems.map(s => s.name));
    readMcpServers(userMcpFile, errors).forEach(s => {
      const name = sanitize(s.name);
      if (!projMcpNames.has(name)) {
        mcpItems.push({ name, desc: sanitize(truncate(s.desc, MAX_DESC)) || '用户级' });
      }
    });
    if (mcpItems.length > 0) sections.push({ label: 'MCP Servers', prefix: '', items: mcpItems });
  } catch (e) { errors.push(`MCP: ${e.message}`); }

  tryCollect('用户级 Skills', '', () => scanSkills(path.join(claudeUserDir, 'skills'), errors));
  tryCollect('用户级 Subagents', '@', () => scanAgents(path.join(claudeUserDir, 'agents'), errors));

  // 已安装插件
  try {
    const plugins = scanInstalledPlugins(claudeUserDir, errors);
    if (plugins.length > 0) {
      const items = plugins.map(p => ({
        name: `${p.name}${p.version ? ' (v' + p.version + ')' : ''}`,
        desc: p.description,
        extra: [
          p.skillItems.length > 0 ? `skills: ${p.skillItems.map(s => s.name).join(', ')}` : '',
          p.agentNames.length > 0 ? `agents: ${p.agentNames.join(', ')}` : '',
        ].filter(Boolean).join(' | ')
      }));
      sections.push({ label: '已安装插件', prefix: '', items });
    }
  } catch (e) { errors.push(`插件扫描: ${e.message}`); }

  // Legacy commands
  try {
    const projCmds = scanCommands(path.join(cwd, '.claude', 'commands'), errors);
    const userCmds = scanCommands(path.join(claudeUserDir, 'commands'), errors);
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

// level 0: 名+完整desc | 1: 名+短desc | 2: 仅名 | 3: top-15名+折叠 | 4: 纯计数
function renderSection(section, level) {
  const { label, prefix, items } = section;
  if (level >= 4) return `### ${label}\n${items.length} 个`;
  if (level >= 3) {
    const TOP_N = 15;
    if (items.length <= TOP_N) return `### ${label}\n${items.map(i => prefix + i.name).join(', ')}`;
    const shown = items.slice(0, TOP_N).map(i => prefix + i.name).join(', ');
    return `### ${label}\n${shown}, +${items.length - TOP_N} 个`;
  }
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

// mode: 'awareness'（SessionStart 用，差异化路由增强）
function renderAwareness(snapshot) {
  const { sections, errors } = snapshot;
  const find = label => (sections.find(s => s.label === label) || { items: [] }).items;

  // 统计各类能力总数
  const skillCount = find('项目级 Skills').length + find('用户级 Skills').length;
  const agentCount = find('项目级 Subagents').length + find('用户级 Subagents').length;
  const mcpItems = find('MCP Servers');
  const plugins = find('已安装插件');
  const legacyCmds = find('Legacy Commands');

  const parts = ['## 环境能力感知\n'];

  // 总览行
  const counts = [];
  if (skillCount > 0) counts.push(`${skillCount} skills`);
  if (agentCount > 0) counts.push(`${agentCount} subagents`);
  if (plugins.length > 0) counts.push(`${plugins.length} plugins`);
  if (mcpItems.length > 0) counts.push(`${mcpItems.length} MCP servers`);
  if (counts.length > 0) parts.push(counts.join('、') + '。\n');

  // MCP Servers：带完整描述（差异化价值最高，平台不展示详情）
  if (mcpItems.length > 0) {
    parts.push('### MCP Servers');
    for (const s of mcpItems) {
      parts.push(s.desc ? `- ${s.name}: ${truncate(s.desc, 80)}` : `- ${s.name}`);
    }
    parts.push('');
  }

  // Subagents：带描述的 top-N（帮 Claude 匹配任务到 agent）
  const allAgents = [...find('项目级 Subagents'), ...find('用户级 Subagents')];
  if (allAgents.length > 0) {
    const TOP_AGENTS = 15;
    parts.push('### Subagents');
    const shown = allAgents.slice(0, TOP_AGENTS);
    for (const a of shown) {
      parts.push(a.desc ? `- ${a.name}: ${truncate(a.desc, 60)}` : `- ${a.name}`);
    }
    if (allAgents.length > TOP_AGENTS) parts.push(`+${allAgents.length - TOP_AGENTS} 个`);
    parts.push('');
  }

  // Skills：仅总数 + top-15 名字（平台 Skill tool 已有描述，不重复）
  const allSkills = [...find('项目级 Skills'), ...find('用户级 Skills')];
  if (allSkills.length > 0) {
    const TOP_SKILLS = 15;
    const shown = allSkills.slice(0, TOP_SKILLS).map(s => s.name).join(', ');
    const fold = allSkills.length > TOP_SKILLS ? `, +${allSkills.length - TOP_SKILLS} 个` : '';
    parts.push(`### Skills\n${shown}${fold}\n`);
  }

  // 插件：仅总数
  if (plugins.length > 0) {
    parts.push(`### 已安装插件\n${plugins.length} 个\n`);
  }

  // Legacy commands：仅总数
  if (legacyCmds.length > 0) {
    parts.push(`### Legacy Commands\n${legacyCmds.length} 个\n`);
  }

  // 路由策略是 awareness 模式的核心价值，必须保证不被截断
  const ROUTING = '\n### 路由策略\n收到任务时按优先级自动匹配：(1) 简单任务→直接做 (2) 有匹配 skill→Skill tool 调用 (3) 需专业化/隔离→委派 subagent (4) 涉及外部服务→MCP tool (5) 都不匹配→用自身能力完成。不确定时用 ToolSearch 搜索可用能力。';
  const FOOTER = errors.length > 0 ? '\n\n[部分扫描失败，详见 stderr]' : '';
  const listBudget = MAX_TOTAL_CHARS - ROUTING.length - FOOTER.length;

  let listOutput = parts.join('\n');
  // 列表部分超预算时截断列表，路由策略永远保留
  if (listOutput.length > listBudget) {
    listOutput = listOutput.slice(0, listBudget - 20) + '\n\n…（已截断）';
  }
  return { text: listOutput + ROUTING + FOOTER, errors };
}

// mode: 'route'（保留描述用于路由判断）| 'list'（高密度目录，初始 level 2）| 'awareness'（SessionStart 路由增强）
function renderSnapshot(snapshot, mode) {
  if (mode === 'awareness') return renderAwareness(snapshot);
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
      if (levels[i] >= 4) continue;
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
  extractFrontmatter, getDescription, getName, sanitize, compareSemver,
  tryReadHead, scanSkills, scanAgents, scanCommands, readMcpServers,
  scanInstalledPlugins, isPluginRoot,
  collectSnapshot, renderSnapshot, truncate,
};

// ─── 入口（CLI 直接运行时执行）──────────────────────────────────────────────

if (require.main !== module) { /* 被 require 时不执行 */ }
else try {
  function getArg(name) {
    const prefix = `--${name}=`;
    const a = process.argv.find(x => x.startsWith(prefix));
    return a ? a.slice(prefix.length) : undefined;
  }
  const VALID_MODES = ['route', 'list', 'awareness'];
  const mode = getArg('mode') || 'route';
  if (!VALID_MODES.includes(mode)) {
    process.stderr.write(`无效模式: ${mode}，支持: ${VALID_MODES.join('/')}\n`);
    process.exit(1);
  }
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
