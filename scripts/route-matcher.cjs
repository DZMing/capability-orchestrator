#!/usr/bin/env node
// route-matcher.cjs — UserPromptSubmit hook 实时路由匹配
//
// 每条用户消息经过此脚本：
//   1. 从 stdin 读取 JSON（含 prompt 字段）
//   2. 扫描环境中所有 skill 的 name + description
//   3. 关键词匹配 → 找到最佳匹配 skill
//   4. 匹配到 → 输出 additionalContext 强制调用指令
//   5. 未匹配 → 静默放行
//
// 安全性：只读扫描，零网络调用，故障开放（异常时放行）

'use strict';

const path = require('path');
const fs = require('fs');
const { scanSkills, sanitize, scanInstalledPlugins, scanCommands, readMcpServers } = require('./lib/scan-core.cjs');
const { resolveUserDirWithSource } = require('./lib/user-dir.cjs');
const { stemEnglish } = require('./stem-rules.cjs');
const { expandSynonyms } = require('./synonyms.cjs');

const STDIN_TIMEOUT = 3000;
const MIN_PROMPT_LEN = 5;
const MIN_KEYWORD_OVERLAP = 2;
const SHORT_SINGLE_KEYWORD_LEN = 20;
const SLASH_COMMAND_NAME = /^[a-z0-9_-]+$/i;

const ESCAPE_PATTERNS = ['直接做', '直接回答', '不要用skill', '不用skill', 'skip'];

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'than',
  'that', 'this', 'it', 'its', 'and', 'or', 'but', 'if', 'not', 'no',
  'so', 'up', 'out', 'then', 'just', 'also', 'how', 'what', 'when',
  'where', 'which', 'who', 'why', 'all', 'each', 'every', 'both',
  'few', 'more', 'most', 'other', 'some', 'such', 'only', 'very',
  'my', 'your', 'our', 'me', 'you', 'we', 'us', 'i',
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人',
  '都', '一', '一个', '上', '也', '很', '到', '说', '去',
  '你', '会', '着', '没有', '看', '好', '自己', '这', '他', '她',
  '吗', '个', '们', '中', '来', '里', '后', '能', '对', '把',
  '让', '给', '用', '下', '被', '得', '还', '那', '些', '吧',
  '帮', '帮我', '请', '想',
  '功能', '系统', '工具', '服务',
]);

function resolveUserDir() {
  return resolveUserDirWithSource().dir;
}

function readStdin(timeoutMs) {
  return new Promise((resolve) => {
    const chunks = [];
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        process.stdin.removeAllListeners();
        process.stdin.destroy();
        process.stdin.unref();
        resolve(Buffer.concat(chunks).toString('utf-8'));
      }
    }, timeoutMs);
    process.stdin.on('data', (chunk) => { chunks.push(chunk); });
    process.stdin.on('end', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(Buffer.concat(chunks).toString('utf-8'));
      }
    });
    if (process.stdin.readableEnded) {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(Buffer.concat(chunks).toString('utf-8'));
      }
    }
  });
}

function extractPrompt(input) {
  try {
    const data = JSON.parse(input);
    if (data.prompt) return data.prompt;
    if (data.message && data.message.content) return data.message.content;
    if (Array.isArray(data.parts)) {
      return data.parts
        .filter(p => p.type === 'text')
        .map(p => p.text)
        .join(' ');
    }
    return '';
  } catch {
    return '';
  }
}

function extractCwd(input) {
  try {
    const data = JSON.parse(input);
    return (data && data.cwd) ? String(data.cwd) : '';
  } catch { return ''; }
}

const CJK_RANGE = /[\u4e00-\u9fff\u3400-\u4dbf\u{20000}-\u{3134f}]/u;
const CJK_RUN = /[\u4e00-\u9fff\u3400-\u4dbf\u{20000}-\u{3134f}]+/gu;
const NON_CJK_RUN = /[^\u4e00-\u9fff\u3400-\u4dbf\u{20000}-\u{3134f}]+/gu;

// 带词干提取但不扩展同义词 — 用于 findBestMatch 的重叠门槛判断
// 防止同义词扩展造成 overlap 虚高，但允许 bugs→bug 的形态变化匹配
function _tokenizeStemmed(text) {
  if (!text || typeof text !== 'string') return [];
  const lower = text.normalize('NFC').toLowerCase();
  const rawTokens = lower.match(/[\p{L}\p{N}]+/gu) || [];
  const tokens = [];
  for (const t of rawTokens) {
    if (CJK_RANGE.test(t)) {
      const cjkRuns = t.match(CJK_RUN) || [];
      for (const run of cjkRuns) {
        const chars = [...run];
        for (const c of chars) tokens.push(c);
        for (let i = 0; i < chars.length - 1; i++) tokens.push(chars[i] + chars[i + 1]);
      }
    } else {
      tokens.push(t);
      const stem = stemEnglish(t);
      if (stem) tokens.push(stem);
    }
  }
  return [...new Set(tokens.filter(t => !STOP_WORDS.has(t) && (t.length > 1 || CJK_RANGE.test(t))))];
}

function extractKeywords(text) {
  if (!text || typeof text !== 'string') return [];
  const lower = text.normalize('NFC').toLowerCase();
  const rawTokens = lower.match(/[\p{L}\p{N}]+/gu) || [];
  const tokens = [];
  for (const t of rawTokens) {
    if (CJK_RANGE.test(t)) {
      const cjkRuns = t.match(CJK_RUN) || [];
      for (const run of cjkRuns) {
        const chars = [...run];
        for (const c of chars) tokens.push(c);
        for (let i = 0; i < chars.length - 1; i++) tokens.push(chars[i] + chars[i + 1]);
      }
      const nonCjkRuns = t.match(NON_CJK_RUN) || [];
      for (const run of nonCjkRuns) {
        const sub = run.match(/[\p{L}\p{N}]+/gu) || [];
        for (const s of sub) tokens.push(s);
      }
    } else {
      tokens.push(t);
      // 英文词干：追加词干形式（不替换原词，避免信息丢失）
      const stem = stemEnglish(t);
      if (stem) tokens.push(stem);
    }
  }
  const filtered = tokens.filter(t => !STOP_WORDS.has(t) && (t.length > 1 || CJK_RANGE.test(t)));
  // 同义词扩展：追加中英互通和近义词（先词干化再展开）
  return [...new Set(expandSynonyms(filtered))];
}

function isEscaped(prompt) {
  if (!prompt) return false;
  const lower = prompt.toLowerCase().replace(/\s+/g, '');
  if (ESCAPE_PATTERNS.some(p => lower.includes(p.replace(/\s+/g, '')))) return true;
  if (prompt.trimEnd().endsWith('?') && prompt.length < 30) return true;
  return false;
}

function findBestMatch(prompt, skills) {
  if (!prompt || !skills || skills.length === 0) return null;
  const promptKw = extractKeywords(prompt);
  if (promptKw.length === 0) return null;

  // 门槛判断用词干化 token（含形态变化，不含同义词扩展），避免扩展后 overlap 虚高
  const promptRaw = _tokenizeStemmed(prompt);

  const promptBigrams = promptKw.filter(k => k.length >= 2 && CJK_RANGE.test(k));
  const scorablePromptKw = promptKw.filter(k => {
    if (k.length === 1 && CJK_RANGE.test(k)) {
      return !promptBigrams.some(b => b.includes(k));
    }
    return true;
  });

  const N = skills.length || 1;
  const df = new Map();
  const skillData = skills.map(skill => {
    const descKw = extractKeywords(skill.desc);
    const nameKw = extractKeywords(skill.name);
    const kwSet = new Set([...descKw, ...nameKw]);
    const nameSet = new Set(nameKw);
    // IDF 基于词干化但未扩展的词集，保持统计意义
    const stemmedSet = new Set([..._tokenizeStemmed(skill.name), ..._tokenizeStemmed(skill.desc)]);
    for (const k of stemmedSet) df.set(k, (df.get(k) || 0) + 1);
    return { skill, kwSet, nameSet };
  });

  let best = null;
  let bestScore = 0;
  let bestOverlap = 0;
  let bestMatchedKeywords = [];
  for (const { skill, kwSet, nameSet } of skillData) {
    // 门槛：优先用词干化（无同义词）的 token 判断重叠，防止同义词虚高
    const stemmedSkillKw = new Set(_tokenizeStemmed(skill.desc + ' ' + skill.name));
    const stemmedNameKw = new Set(_tokenizeStemmed(skill.name));
    const stemmedMatched = promptRaw.filter(k => stemmedSkillKw.has(k));
    let overlap = stemmedMatched.length;
    if (overlap < MIN_KEYWORD_OVERLAP) {
      if (overlap === 1 && prompt.length > SHORT_SINGLE_KEYWORD_LEN &&
          stemmedNameKw.has(stemmedMatched[0])) {
        /* 单关键词命中 skill 名称 — 放行 */
      } else if (overlap === 0) {
        // 跨语言兜底：仅当词干化无任何重叠（真正的跨语言）时，
        // 用完整扩展词检查（中英互通场景），要求至少 2 个扩展词命中；
        // 或仅 1 个但命中 skill 名称（name-match gate 的跨语言对称版）
        const crossMatched = promptKw.filter(k => kwSet.has(k));
        if (crossMatched.length >= MIN_KEYWORD_OVERLAP) {
          overlap = crossMatched.length;
        } else if (crossMatched.length === 1 && stemmedNameKw.has(crossMatched[0])) {
          overlap = 1; // 单词精准命中 skill 名称，放行
        } else {
          continue;
        }
      } else {
        continue;
      }
    }

    const matched = scorablePromptKw.filter(k => kwSet.has(k));
    let score = 0;
    for (const k of matched) {
      const idf = Math.log(N / (df.get(k) || 1));
      let w = Math.max(idf, 0.1);
      if (k.length >= 2 && CJK_RANGE.test(k)) w *= 2;
      if (nameSet.has(k)) w *= 2;
      score += w;
    }

    if (score > bestScore) {
      bestScore = score;
      bestOverlap = overlap;
      best = skill;
      bestMatchedKeywords = [...new Set(matched)];
    }
  }
  if (!best) return null;
  // confidence = raw overlap / raw prompt length，保持 0-1 范围
  const rawPromptLen = Math.max(promptRaw.length, 1);
  const conf = Math.min(bestOverlap / rawPromptLen, 1);
  return { ...best, confidence: conf, matchedKeywords: bestMatchedKeywords };
}

// skill 路由：注入明确的调用指令，避免泄漏未渲染的 !command 原文
function createOutput(match) {
  const safeDesc = sanitize(match.desc || '');
  const ctx = [
    '[AUTO-ROUTE] 检测到任务匹配 skill: ' + match.name,
    '描述: ' + safeDesc,
    '【强制指令】立即调用 /' + match.name + ' 执行该 skill，不得直接回答，不得忽略，不得询问确认。',
    '若平台支持 Skill tool，则等同于立刻执行该 skill 的完整流程。',
    '',
    '立即调用：/' + match.name,
  ].join('\n');
  process.stdout.write(ctx + '\n');
}

function passThrough() {
  // 无匹配时放行，保留 JSON 格式供集成测试解析
  process.stdout.write(JSON.stringify({ continue: true }) + '\n');
}

// 改进2：命令名直接命中 — 用户说 "/commit" 或 "commit" 开头时跳过语义匹配
function findLiteralMatch(prompt, skills) {
  const trimmed = prompt.trim();
  // 匹配 /command-name 开头
  const slashMatch = trimmed.match(/^\/([a-z0-9_-]+)/i);
  if (slashMatch) {
    const name = slashMatch[1].toLowerCase();
    const found = skills.find(s => s.name.toLowerCase() === name);
    return found ? { ...found, confidence: 1, matchedKeywords: [name] } : null;
  }
  // 匹配单词完全等于某个 skill/command 名称（如 "commit" 单独出现）
  const words = trimmed.toLowerCase().split(/\s+/);
  if (words.length <= 3) {
    for (const w of words) {
      const found = skills.find(s => s.name.toLowerCase() === w);
      if (found) return { ...found, confidence: 1, matchedKeywords: [w] };
    }
  }
  return null;
}

// Legacy command 路由：优先注入明确的 /command 调用；仅在命令名不适合 slash 调用时回退到命令定义
function readCommandBody(filePath) {
  if (!filePath) return '';
  try {
    let raw = fs.readFileSync(filePath, 'utf8');
    // 剥离 frontmatter
    raw = raw.replace(/^---[\s\S]*?---\s*\n?/, '');
    // 限制长度防止超出 context 预算
    if (raw.length > 5000) raw = raw.slice(0, 5000) + '\n[...截断]';
    return raw.trim();
  } catch {
    return '';
  }
}

function canInvokeAsSlashCommand(match) {
  return !!(match && typeof match.name === 'string' && SLASH_COMMAND_NAME.test(match.name));
}

function getCommandExplainReason(match, literalMatched) {
  if (!canInvokeAsSlashCommand(match)) return 'matched-command-fallback';
  return literalMatched ? 'matched-command-literal' : 'matched-command-semantic';
}

function createCommandOutput(match) {
  let body = '';
  body = readCommandBody(match.filePath);
  const safeDesc = sanitize(match.desc || '');
  if (canInvokeAsSlashCommand(match)) {
    const ctx = [
      '[AUTO-ROUTE] 检测到任务匹配命令: /' + match.name,
      '描述: ' + safeDesc,
      '【强制指令】优先立即调用 /' + match.name + ' 执行该命令，不得直接回答，不得询问确认，不得偏离。',
      '若平台当前无法直接调用该命令，再按下面的命令定义继续执行：',
      '',
      '立即调用：/' + match.name,
      '',
      '[回退定义]',
      body || ('执行 /' + match.name + ' 命令的完整流程。'),
    ].join('\n');
    process.stdout.write(ctx + '\n');
    return;
  }
  const ctx = [
    '[AUTO-ROUTE] 检测到任务匹配命令定义: ' + match.name,
    '描述: ' + safeDesc,
    '【强制指令】该命令名不适合直接作为 /command 调用。请立即按照以下命令定义执行任务，不得询问确认，不得偏离：',
    '',
    body || ('执行该命令定义的完整流程。'),
  ].join('\n');
  process.stdout.write(ctx + '\n');
}

// MCP tool 路由：基于同 extractKeywords 的关键词匹配，返回最匹配的 MCP server
function findBestMcpMatch(prompt, servers) {
  if (!prompt || !servers || servers.length === 0) return null;
  // 复用 findBestMatch 逻辑：把 MCP server 当作 skill 处理（name + desc 匹配）
  const asMcpSkills = servers.map(s => ({ name: s.name, desc: s.desc || '' }));
  return findBestMatch(prompt, asMcpSkills);
}

function createMcpOutput(server) {
  const safeDesc = sanitize(server.desc || '');
  const toolPrefix = 'mcp__' + server.name;
  const ctx = [
    '[AUTO-ROUTE] 检测到任务匹配 MCP server: ' + server.name,
    '描述: ' + safeDesc,
    '【强制指令】立即调用 ' + toolPrefix + '__* 相关工具，不得询问确认。',
    '可用工具前缀: ' + toolPrefix,
  ].join('\n');
  process.stdout.write(ctx + '\n');
}

function collectAllSkills(projectDir, userDir) {
  const claudeUserDir = userDir || resolveUserDir();
  const projSkills = scanSkills(path.join(projectDir, '.claude', 'skills'), []);
  const userSkills = scanSkills(path.join(claudeUserDir, 'skills'), []);
  const pluginSkills = [];
  try {
    for (const p of scanInstalledPlugins(claudeUserDir, [])) {
      for (const s of (p.skillItems || [])) pluginSkills.push(s);
    }
  } catch { /* fault-open */ }

  // Legacy /commands — 有描述才纳入匹配池，优先级低于 skills
  const legacyCmds = [];
  try {
    const projCmds = scanCommands(path.join(projectDir, '.claude', 'commands'), []);
    const userCmds = scanCommands(path.join(claudeUserDir, 'commands'), []);
    for (const c of [...projCmds, ...userCmds]) {
      if (c.desc) legacyCmds.push({ ...c, type: 'command' });
    }
  } catch { /* fault-open */ }

  const seen = new Set();
  const deduped = [];
  // Skills 优先，legacy commands 最低优先
  for (const s of [...projSkills, ...userSkills, ...pluginSkills, ...legacyCmds]) {
    if (!seen.has(s.name)) {
      seen.add(s.name);
      deduped.push(s);
    }
  }
  return deduped;
}

function buildExplainResult({ action, reason, targetType = null, targetName = null, confidence = 0, matchedKeywords = [], cwd = '', userDirSource = '' }) {
  return {
    action,
    reason,
    targetType,
    targetName,
    confidence,
    matchedKeywords,
    cwd,
    userDirSource,
  };
}

function resolveRouteDecision(input) {
  const prompt = extractPrompt(input);
  const stdinCwd = extractCwd(input);
  const projectDir = stdinCwd || process.env.CAPABILITY_PROJECT_DIR || process.cwd();
  const { dir: inferredUserDir, source: userDirSource } = resolveUserDirWithSource();
  const userDir = process.env.CAPABILITY_USER_DIR || process.env.CLAUDE_USER_DIR || inferredUserDir;

  if (!prompt || prompt.length < MIN_PROMPT_LEN) {
    return {
      explain: buildExplainResult({
        action: 'pass',
        reason: 'too-short',
        cwd: projectDir,
        userDirSource,
      }),
    };
  }

  if (isEscaped(prompt)) {
    return {
      explain: buildExplainResult({
        action: 'pass',
        reason: 'escaped',
        cwd: projectDir,
        userDirSource,
      }),
    };
  }

  const skills = collectAllSkills(projectDir, userDir);
  const literal = findLiteralMatch(prompt, skills);
  const literalMatched = !!literal;
  const match = literal || findBestMatch(prompt, skills);
  if (match) {
    const targetType = match.type === 'command' ? 'command' : 'skill';
    const reason = targetType === 'command'
      ? getCommandExplainReason(match, literalMatched)
      : 'matched-skill';
    return {
      match,
      targetType,
      explain: buildExplainResult({
        action: 'route',
        reason,
        targetType,
        targetName: match.name,
        confidence: match.confidence || 0,
        matchedKeywords: match.matchedKeywords || [],
        cwd: projectDir,
        userDirSource,
      }),
    };
  }

  try {
    const mcpItems = [];
    const projMcp = path.join(projectDir, '.mcp.json');
    const userMcpFile = fs.existsSync(path.join(userDir, 'mcp.json'))
      ? path.join(userDir, 'mcp.json')
      : path.join(userDir, '.mcp.json');
    readMcpServers(projMcp, []).forEach(s => mcpItems.push(s));
    const projNames = new Set(mcpItems.map(s => s.name));
    readMcpServers(userMcpFile, []).forEach(s => {
      if (!projNames.has(s.name)) mcpItems.push(s);
    });
    const mcpMatch = findBestMcpMatch(prompt, mcpItems);
    if (mcpMatch) {
      return {
        match: mcpMatch,
        targetType: 'mcp',
        explain: buildExplainResult({
          action: 'route',
          reason: 'matched-mcp',
          targetType: 'mcp',
          targetName: mcpMatch.name,
          confidence: mcpMatch.confidence || 0,
          matchedKeywords: mcpMatch.matchedKeywords || [],
          cwd: projectDir,
          userDirSource,
        }),
      };
    }
  } catch { /* fault-open: mcp explain falls through to no-match */ }

  return {
    explain: buildExplainResult({
      action: 'pass',
      reason: 'no-match',
      cwd: projectDir,
      userDirSource,
    }),
  };
}

module.exports = {
  readStdin, extractPrompt, extractCwd, extractKeywords, isEscaped,
  findBestMatch, findBestMcpMatch, findLiteralMatch,
  createOutput, createMcpOutput, createCommandOutput,
  readCommandBody, canInvokeAsSlashCommand, getCommandExplainReason,
  passThrough, collectAllSkills, buildExplainResult, resolveRouteDecision,
  STOP_WORDS, ESCAPE_PATTERNS,
};

if (require.main !== module) { /* 被 require 时不执行 */ }
else {
  const explainMode = process.argv.includes('--explain');
  readStdin(STDIN_TIMEOUT).then(input => {
    try {
      const decision = resolveRouteDecision(input);
      if (explainMode) {
        process.stdout.write(JSON.stringify(decision.explain) + '\n');
        return;
      }
      if (!decision.match) return passThrough();
      if (decision.targetType === 'command') return createCommandOutput(decision.match);
      if (decision.targetType === 'mcp') return createMcpOutput(decision.match);
      return createOutput(decision.match);
    } catch (err) {
      process.stderr.write('route-matcher error: ' + err.message + '\n');
      if (explainMode) {
        process.stdout.write(JSON.stringify(buildExplainResult({ action: 'pass', reason: 'no-match' })) + '\n');
      } else {
        passThrough();
      }
    }
  }).catch(() => {
    if (explainMode) {
      process.stdout.write(JSON.stringify(buildExplainResult({ action: 'pass', reason: 'no-match' })) + '\n');
    } else {
      passThrough();
    }
  });
}
