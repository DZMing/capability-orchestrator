'use strict';

const fs = require('fs');
const path = require('path');
const { resolveUserDir } = require('./user-dir.cjs');

const MAX_DESC = 100;
const MAX_PLUGIN_DEPTH = 3;
const HEAD_BYTES = 2048;

function tryRead(filePath, errors) {
  try { return fs.readFileSync(filePath, 'utf8'); }
  catch (e) {
    if (e.code !== 'ENOENT' && errors) errors.push(`读取 ${path.basename(filePath)}: ${e.code}`);
    return null;
  }
}

function tryReadHead(filePath, errors) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    const bytesRead = fs.readSync(fd, buf, 0, HEAD_BYTES, 0);
    let str = buf.toString('utf8', 0, bytesRead);
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

const UNSAFE_UNICODE = /[\u200B\u200C\u200D\uFEFF\u00AD\u2060\u180E\u200E\u200F\u202A-\u202E\u2066-\u2069\u061C\u2061-\u2064\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFF9-\uFFFB]/g;

function sanitize(str) {
  if (!str) return '';
  return String(str)
    .replace(/\r?\n|\r/g, ' ')
    .replace(UNSAFE_UNICODE, '')
    .replace(/`/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/<[^>]*>?/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(^| )#{1,6} /g, '$1')
    .trim();
}

function extractFrontmatter(content) {
  if (!content) return {};
  content = content.replace(/^\uFEFF/, '');
  const result = {};
  const blockRe = /(?:^|\n)---[ \t]*\r?\n([\s\S]*?)\r?\n---/g;
  let blockMatch;
  while ((blockMatch = blockRe.exec(content)) !== null) {
    const lines = blockMatch[1].split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(\w[\w-]*):\s*(.*?)\s*$/);
      if (!m) continue;
      const key = m[1];
      const rawVal = m[2];
      if (/^[>|][-+]?$/.test(rawVal)) {
        const blockLines = [];
        while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || lines[i + 1].trim() === '')) {
          blockLines.push(lines[++i].trimStart());
        }
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
  if (!content) return '';
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

function isSymlink(filePath, errors) {
  try { return fs.lstatSync(filePath).isSymbolicLink(); }
  catch (e) {
    if (errors && e.code !== 'ENOENT') errors.push(`lstat ${path.basename(filePath)}: ${e.code}`);
    return true;
  }
}

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
    const filePath = path.join(fullPath, 'SKILL.md');
    results.push({ name, desc, filePath });
  }
  return results;
}

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
    results.push({ name, desc, filePath: fullPath });
  }
  return results;
}

function scanCommands(dir, errors) {
  return tryReadDir(dir, true, errors)
    .filter(d => !d.name.startsWith('.') && d.isFile() && d.name.endsWith('.md'))
    .map(d => {
      const name = sanitize(d.name.replace(/\.md$/, ''));
      const filePath = path.join(dir, d.name);
      const content = tryReadHead(filePath, errors);
      const fm = extractFrontmatter(content || '');
      const desc = sanitize(fm.description || fm.name || '');
      return { name, desc, filePath };
    });
}

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
    try {
      const stripped = content.split('\n').map(line => {
        let inStr = false;
        for (let i = 0; i < line.length - 1; i++) {
          if (line[i] === '"') {
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

function isPluginRoot(dirPath) {
  if (fs.existsSync(path.join(dirPath, '.claude-plugin', 'plugin.json'))) return true;
  if (fs.existsSync(path.join(dirPath, '.codex-plugin', 'plugin.json'))) return true;
  if (fs.existsSync(path.join(dirPath, 'plugin.json'))) return true;
  if (tryReadDir(path.join(dirPath, 'skills'), true).some(d => d.isDirectory())) return true;
  return tryReadDir(path.join(dirPath, 'agents'), true).some(d => d.isFile() && d.name.endsWith('.md'));
}

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

function scanInstalledPlugins(claudeUserDir, errors) {
  const cacheDir = path.join(claudeUserDir, 'plugins', 'cache');
  const results = [];

  for (const dirent of tryReadDir(cacheDir, true, errors)) {
    if (!dirent.isDirectory()) continue;
    const candidate = path.join(cacheDir, dirent.name);
    if (isSymlink(candidate)) continue;
    const pluginPaths = findPluginRoots(candidate, MAX_PLUGIN_DEPTH, errors);

    for (const pluginPath of pluginPaths) {
      const pluginName = path.basename(pluginPath);
      const manifestContent =
        tryRead(path.join(pluginPath, '.claude-plugin', 'plugin.json'), errors) ||
        tryRead(path.join(pluginPath, '.codex-plugin', 'plugin.json'), errors) ||
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

      const skillItems = tryReadDir(path.join(pluginPath, 'skills'), true, errors)
        .filter(d => !d.name.startsWith('.') && d.isDirectory()
          && fs.existsSync(path.join(pluginPath, 'skills', d.name, 'SKILL.md')))
        .map(d => {
          const skillPath = path.join(pluginPath, 'skills', d.name, 'SKILL.md');
          const head = tryReadHead(skillPath, errors);
          return { name: sanitize(getName(head, d.name)), desc: head ? getDescription(head) : '', filePath: skillPath };
        });
      const agentNames = tryReadDir(path.join(pluginPath, 'agents'), true, errors)
        .filter(d => !d.name.startsWith('.') && d.isFile() && d.name.endsWith('.md'))
        .map(d => sanitize(d.name.replace(/\.md$/, '')));

      results.push({ name, version, description, skillItems, agentNames });
    }
  }

  const seen = new Map();
  for (const p of results) {
    const prev = seen.get(p.name);
    if (!prev || (p.version && (!prev.version || compareSemver(p.version, prev.version) > 0))) {
      seen.set(p.name, p);
    }
  }
  return [...seen.values()];
}

function collectSnapshot(projectDir, userDir) {
  const cwd = projectDir || process.cwd();
  const claudeUserDir = userDir || resolveUserDir();
  const errors = [];
  const sections = [];

  const { detectPlatform, getPlatformPaths } = require('./platform.cjs');
  const platform = detectPlatform();
  const pp = getPlatformPaths(platform);

  function tryCollect(label, prefix, fn) {
    try {
      const items = fn();
      if (items.length > 0) sections.push({ label, prefix, items });
    } catch (e) {
      errors.push(`${label}: ${e.message}`);
    }
  }

  tryCollect('项目级 Skills', '', () => scanSkills(path.join(cwd, pp.projectSkillsDir), errors));
  if (pp.projectAgentsDir) {
    tryCollect('项目级 Subagents', '@', () => scanAgents(path.join(cwd, pp.projectAgentsDir), errors));
  }

  try {
    const mcpItems = [];
    readMcpServers(path.join(cwd, '.mcp.json'), errors).forEach(s =>
      mcpItems.push({ name: sanitize(s.name), desc: sanitize(truncate(s.desc, MAX_DESC)) || '项目级' }));

    const userMcpFile = fs.existsSync(path.join(claudeUserDir, 'mcp.json'))
      ? path.join(claudeUserDir, 'mcp.json')
      : path.join(claudeUserDir, '.mcp.json');
    const projMcpNames = new Set(mcpItems.map(s => s.name));
    readMcpServers(userMcpFile, errors).forEach(s => {
      const name = sanitize(s.name);
      if (!projMcpNames.has(name)) {
        mcpItems.push({ name, desc: sanitize(truncate(s.desc, MAX_DESC)) || '用户级' });
      }
    });
    if (mcpItems.length > 0) sections.push({ label: 'MCP Servers', prefix: '', items: mcpItems });
  } catch (e) {
    errors.push(`MCP: ${e.message}`);
  }

  tryCollect('用户级 Skills', '', () => scanSkills(path.join(claudeUserDir, 'skills'), errors));
  tryCollect('用户级 Subagents', '@', () => scanAgents(path.join(claudeUserDir, 'agents'), errors));

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
  } catch (e) {
    errors.push(`插件扫描: ${e.message}`);
  }

  try {
    if (pp.projectCommandsDir) {
      const projCmds = scanCommands(path.join(cwd, pp.projectCommandsDir), errors);
      const userCmds = scanCommands(path.join(claudeUserDir, 'commands'), errors);
    const cmds = [
      ...projCmds.map(c => ({ name: c.name, desc: c.desc || 'legacy，建议迁移到 skills/' })),
      ...userCmds.map(c => ({ name: c.name, desc: c.desc || 'legacy' })),
    ];
    if (cmds.length > 0) sections.push({ label: 'Legacy Commands', prefix: '', items: cmds });
    }
  } catch (e) {
    errors.push(`commands: ${e.message}`);
  }

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

  const nonEmpty = sections.filter(s => s.items.length > 0);
  sections.length = 0;
  sections.push(...nonEmpty);

  for (const s of sections) {
    s.items.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  }

  return { sections, errors };
}

module.exports = {
  MAX_DESC,
  MAX_PLUGIN_DEPTH,
  tryRead,
  tryReadHead,
  tryReadDir,
  truncate,
  compareSemver,
  sanitize,
  extractFrontmatter,
  getDescription,
  getName,
  isSymlink,
  scanSkills,
  scanAgents,
  scanCommands,
  readMcpServers,
  isPluginRoot,
  findPluginRoots,
  scanInstalledPlugins,
  collectSnapshot,
};
