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
const {
  scanSkills,
  sanitize,
  scanInstalledPlugins,
  scanCommands,
  readMcpServers,
  getOpenClawSkillDir,
  getHermesSkillDir,
  scanCompatibleSkills,
  scanHermesRuntimeSkills,
} = require('./lib/scan-core.cjs');
const { resolveUserDirWithSource } = require('./lib/user-dir.cjs');
const {
  detectPlatform,
  getPlatformPaths,
  getUserSkillsPaths,
  getUserCommandsPaths,
} = require('./lib/platform.cjs');
const { appendRouteLog } = require('./lib/route-logger.cjs');
const { resolveIntentRoute } = require('./lib/intent-router.cjs');
const {
  extractKeywords,
  _tokenizeStemmed,
  STOP_WORDS,
} = require('./lib/route-keywords.cjs');
const {
  findBestMatch,
  findBestMcpMatch,
  MIN_CONFIDENCE,
} = require('./lib/route-scoring.cjs');
const {
  createOutput,
  passThrough,
  createCommandOutput,
  createMcpOutput,
  createIntentOutput,
  canInvokeAsSlashCommand,
  getCommandExplainReason,
} = require('./lib/route-output.cjs');

const STDIN_TIMEOUT = 3000;
const MIN_PROMPT_LEN = 5;

const ESCAPE_PATTERNS = ['直接做', '直接执行', '直接回答', '不要用skill', '不用skill', 'skip'];
const EXPLAIN_META_FIELDS = [
  'host', 'source', 'scope', 'surfaceType', 'invocation',
  'transport', 'authRequired', 'mayWrite', 'externalAccess',
];

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

function isEscaped(prompt) {
  if (!prompt) return false;
  const lower = prompt.toLowerCase().replace(/\s+/g, '');
  if (ESCAPE_PATTERNS.some(p => lower.includes(p.replace(/\s+/g, '')))) return true;
  if (prompt.trimEnd().endsWith('?') && prompt.length < 15 && !/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(prompt)) return true;
  return false;
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

function collectAllSkills(projectDir, userDir) {
  const activeUserDir = userDir || resolveUserDir();
  const platform = detectPlatform();
  const pp = getPlatformPaths(platform);

  const baseMeta = {
    host: platform,
    state: 'enabled',
    invocation: pp.invocationStyle,
  };

  const projSkills = scanSkills(path.join(projectDir, pp.projectSkillsDir), [], {
    ...baseMeta,
    source: 'project',
    scope: 'project',
  });
  const userSkills = getUserSkillsPaths(activeUserDir, platform)
    .flatMap((dir, index) => scanSkills(dir, [], {
      ...baseMeta,
      source: index === 0 ? 'user' : 'external',
      scope: 'user',
    }));
  const runtimeHelpers = {
    sanitize,
    truncate: (str, max) => {
      if (!str) return '';
      str = String(str).replace(/\r?\n/g, ' ').trim();
      return str.length > max ? str.slice(0, max - 1) + '…' : str;
    },
    withCapabilityMeta: (entity, meta = {}) => ({ ...entity, ...meta }),
  };
  const openClawSkills = scanCompatibleSkills(getOpenClawSkillDir(), 'openclaw', [], {
    scope: 'workspace',
    invocation: pp.invocationStyle,
  });
  const hermesSkills = platform === 'hermes'
    ? scanHermesRuntimeSkills([], runtimeHelpers)
    : scanCompatibleSkills(getHermesSkillDir(), 'hermes', [], {
      scope: 'user',
      invocation: pp.invocationStyle,
    });
  const pluginSkills = [];
  try {
    for (const p of scanInstalledPlugins(activeUserDir, [])) {
      for (const s of (p.skillItems || [])) pluginSkills.push(s);
    }
  } catch { /* fault-open */ }

  // Legacy /commands — 有描述才纳入匹配池，优先级低于 skills
  const legacyCmds = [];
  try {
    if (pp.projectCommandsDir) {
      const projCmds = scanCommands(path.join(projectDir, pp.projectCommandsDir), [], {
        ...baseMeta,
        source: 'project',
        scope: 'project',
      });
      const userCmds = getUserCommandsPaths(activeUserDir, platform)
        .flatMap((dir) => scanCommands(dir, [], {
          ...baseMeta,
          source: 'user',
          scope: 'user',
        }));
      for (const c of [...projCmds, ...userCmds]) {
        if (c.desc) legacyCmds.push({ ...c, type: 'command' });
      }
    }
  } catch { /* fault-open */ }

  const seen = new Set();
  const deduped = [];
  // Skills 优先，legacy commands 最低优先
  for (const s of [...projSkills, ...userSkills, ...pluginSkills, ...openClawSkills, ...hermesSkills, ...legacyCmds]) {
    if (!seen.has(s.name)) {
      seen.add(s.name);
      deduped.push(s);
    }
  }
  return deduped;
}

function classifyPromptType(prompt, reason) {
  const text = String(prompt || '').trim();
  if (!text) return 'empty';
  if (reason === 'confirmation-required') return 'high_risk';
  if (reason === 'escaped') return 'escaped';
  if (text.length < MIN_PROMPT_LEN) return 'short';
  if (/^\/[a-z0-9_-]+/i.test(text)) return 'command_literal';
  return 'ordinary';
}

function pickExplainMeta(match) {
  const meta = {};
  for (const field of EXPLAIN_META_FIELDS) {
    if (match && Object.prototype.hasOwnProperty.call(match, field)) meta[field] = match[field];
  }
  return meta;
}

function buildExplainResult({ action, reason, targetType = null, targetName = null, confidence = 0, matchedKeywords = [], cwd = '', userDirSource = '', prompt = '', match = null }) {
  return {
    action,
    reason,
    targetType,
    targetName,
    confidence,
    matchedKeywords,
    cwd,
    userDirSource,
    promptType: classifyPromptType(prompt, reason),
    ...pickExplainMeta(match),
  };
}

function _resolveRouteDecisionInner(input) {
  const prompt = extractPrompt(input);
  const stdinCwd = extractCwd(input);
  const projectDir = stdinCwd || process.env.CAPABILITY_PROJECT_DIR || process.cwd();
  const { dir: inferredUserDir, source: userDirSource } = resolveUserDirWithSource();
  const userDir = process.env.CAPABILITY_USER_DIR || process.env.CLAUDE_USER_DIR || process.env.CODEX_USER_DIR || inferredUserDir;
  const platform = detectPlatform();

  if (!prompt) {
    return {
      explain: buildExplainResult({
        action: 'pass',
        reason: 'too-short',
        cwd: projectDir,
        userDirSource,
        prompt,
      }),
    };
  }

  const escaped = isEscaped(prompt);
  const intentRoute = resolveIntentRoute({ prompt, cwd: projectDir });
  if (intentRoute && intentRoute.safety && intentRoute.safety.confirmationRequired) {
    return {
      intentRoute,
      targetType: 'intent',
      explain: buildExplainResult({
        action: 'route',
        reason: 'confirmation-required',
        targetType: 'intent',
        targetName: intentRoute.intent,
        confidence: intentRoute.confidence || 0,
        matchedKeywords: intentRoute.matchedKeywords || [],
        cwd: projectDir,
        userDirSource,
        prompt,
      }),
    };
  }

  if (escaped) {
    return {
      explain: buildExplainResult({
        action: 'pass',
        reason: 'escaped',
        cwd: projectDir,
        userDirSource,
        prompt,
      }),
    };
  }

  if (intentRoute) {
    return {
      intentRoute,
      targetType: 'intent',
      explain: buildExplainResult({
        action: 'route',
        reason: 'intent-router',
        targetType: 'intent',
        targetName: intentRoute.intent,
        confidence: intentRoute.confidence || 0,
        matchedKeywords: intentRoute.matchedKeywords || [],
        cwd: projectDir,
        userDirSource,
        prompt,
      }),
    };
  }

  if (prompt.length < MIN_PROMPT_LEN) {
    return {
      explain: buildExplainResult({
        action: 'pass',
        reason: 'too-short',
        cwd: projectDir,
        userDirSource,
        prompt,
      }),
    };
  }

  const skills = collectAllSkills(projectDir, userDir);
  const literal = findLiteralMatch(prompt, skills);
  const literalMatched = !!literal;
  const bestSkill = findBestMatch(prompt, skills);
  // 语义匹配低于最低置信度阈值视为噪音，不路由（字面量匹配不受限制）
  const match = literal || (bestSkill && bestSkill.confidence >= MIN_CONFIDENCE ? bestSkill : null);
  if (match) {
    const isCommandLike = match.type === 'command'
      || match.surfaceType === 'slash_command'
      || match.surfaceType === 'plugin_command'
      || match.surfaceType === 'cli_subcommand';
    const targetType = isCommandLike ? 'command' : 'skill';
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
        prompt,
        match,
      }),
    };
  }

  try {
    const mcpItems = [];
    const projMcp = path.join(projectDir, '.mcp.json');
    const userMcpFile = fs.existsSync(path.join(userDir, 'mcp.json'))
      ? path.join(userDir, 'mcp.json')
      : path.join(userDir, '.mcp.json');
    readMcpServers(projMcp, [], {
      host: platform,
      source: 'project',
      scope: 'project',
    }).forEach(s => mcpItems.push(s));
    const projNames = new Set(mcpItems.map(s => s.name));
    readMcpServers(userMcpFile, [], {
      host: platform,
      source: 'user',
      scope: 'user',
    }).forEach(s => {
      if (!projNames.has(s.name)) mcpItems.push(s);
    });
    const mcpMatch = findBestMcpMatch(prompt, mcpItems);
    if (mcpMatch && (mcpMatch.confidence || 0) >= MIN_CONFIDENCE) {
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
          prompt,
          match: mcpMatch,
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
      prompt,
    }),
  };
}

function resolveRouteDecision(input) {
  const decision = _resolveRouteDecisionInner(input);
  // 追加路由日志（fire-and-forget，失败不影响路由）
  appendRouteLog(decision.explain);
  return decision;
}

module.exports = {
  readStdin, extractPrompt, extractCwd, extractKeywords, isEscaped,
  findBestMatch, findBestMcpMatch, findLiteralMatch,
  createOutput, createMcpOutput, createCommandOutput,
  createIntentOutput,
  canInvokeAsSlashCommand, getCommandExplainReason,
  passThrough, collectAllSkills, buildExplainResult, resolveRouteDecision,
  classifyPromptType, pickExplainMeta,
  _tokenizeStemmed,
  STOP_WORDS, ESCAPE_PATTERNS, MIN_CONFIDENCE,
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
      if (decision.targetType === 'intent') return createIntentOutput(decision.intentRoute);
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
