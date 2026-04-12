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
const os = require('os');
const { scanSkills, sanitize, scanInstalledPlugins } = require('./scan-environment.cjs');

const STDIN_TIMEOUT = 3000;
const MIN_PROMPT_LEN = 5;
const MIN_KEYWORD_OVERLAP = 2;
const SHORT_SINGLE_KEYWORD_LEN = 20;

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
    }
  }
  return [...new Set(tokens.filter(t => !STOP_WORDS.has(t) && (t.length > 1 || CJK_RANGE.test(t))))];
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
    for (const k of kwSet) df.set(k, (df.get(k) || 0) + 1);
    return { skill, kwSet, nameSet };
  });

  let best = null;
  let bestScore = 0;
  let bestOverlap = 0;
  for (const { skill, kwSet, nameSet } of skillData) {
    const allMatched = promptKw.filter(k => kwSet.has(k));
    const overlap = allMatched.length;
    if (overlap < MIN_KEYWORD_OVERLAP) {
      if (overlap === 1 && prompt.length > SHORT_SINGLE_KEYWORD_LEN &&
          nameSet.has(allMatched[0])) { /* name match — allow */ }
      else continue;
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
    }
  }
  if (!best) return null;
  return { ...best, confidence: bestOverlap / Math.max(promptKw.length, 1) };
}

function createOutput(match) {
  const safeDesc = sanitize(match.desc || '');
  const ctx = [
    '[AUTO-ROUTE] 检测到任务匹配 skill: ' + match.name,
    '描述: ' + safeDesc,
    '你必须先通过 Skill tool 调用此 skill，再执行其他操作。',
    '调用方式: Skill("' + match.name + '")',
  ].join('\n');
  const output = {
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: ctx,
    },
  };
  process.stdout.write(JSON.stringify(output) + '\n');
}

function passThrough() {
  process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }) + '\n');
}

function collectAllSkills(projectDir, userDir) {
  const claudeUserDir = userDir || (
    os.platform() === 'win32'
      ? path.join(os.homedir(), '.claude')
      : path.join(os.homedir(), '.claude')
  );
  const projSkills = scanSkills(path.join(projectDir, '.claude', 'skills'), []);
  const userSkills = scanSkills(path.join(claudeUserDir, 'skills'), []);
  const pluginSkills = [];
  try {
    for (const p of scanInstalledPlugins(claudeUserDir, [])) {
      for (const s of (p.skillItems || [])) pluginSkills.push(s);
    }
  } catch { /* fault-open */ }
  const seen = new Set();
  const deduped = [];
  for (const s of [...projSkills, ...userSkills, ...pluginSkills]) {
    if (!seen.has(s.name)) {
      seen.add(s.name);
      deduped.push(s);
    }
  }
  return deduped;
}

module.exports = {
  readStdin, extractPrompt, extractCwd, extractKeywords, isEscaped,
  findBestMatch, createOutput, passThrough, collectAllSkills,
  STOP_WORDS, ESCAPE_PATTERNS,
};

if (require.main !== module) { /* 被 require 时不执行 */ }
else {
  readStdin(STDIN_TIMEOUT).then(input => {
    try {
      const prompt = extractPrompt(input);
      if (!prompt || prompt.length < MIN_PROMPT_LEN || isEscaped(prompt)) {
        return passThrough();
      }
      const stdinCwd = extractCwd(input);
      const projectDir = stdinCwd || process.env.CAPABILITY_PROJECT_DIR || process.cwd();
      const userDir = process.env.CAPABILITY_USER_DIR;
      const skills = collectAllSkills(projectDir, userDir);
      const match = findBestMatch(prompt, skills);
      if (match) createOutput(match);
      else passThrough();
    } catch (err) {
      process.stderr.write('route-matcher error: ' + err.message + '\n');
      passThrough();
    }
  }).catch(() => {
    passThrough();
  });
}
