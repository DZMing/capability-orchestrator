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
const { scanSkills } = require('./scan-environment.cjs');

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
  '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去',
  '你', '会', '着', '没有', '看', '好', '自己', '这', '他', '她',
  '吗', '个', '们', '中', '来', '里', '后', '能', '对', '把',
  '让', '给', '用', '下', '被', '得', '还', '那', '些', '吧',
  '帮', '帮我', '请', '想', '做', '什么',
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

function extractKeywords(text) {
  if (!text || typeof text !== 'string') return [];
  const lower = text.toLowerCase();
  const tokens = lower.match(/[\p{L}\p{N}]+/gu) || [];
  return [...new Set(tokens.filter(t => t.length > 1 && !STOP_WORDS.has(t)))];
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

  let best = null;
  let bestScore = 0;
  for (const skill of skills) {
    const descKw = extractKeywords(skill.desc);
    const nameKw = extractKeywords(skill.name);
    const skillKw = [...new Set([...descKw, ...nameKw])];
    const overlap = promptKw.filter(k => skillKw.includes(k)).length;
    if (overlap >= MIN_KEYWORD_OVERLAP ||
        (overlap === 1 && prompt.length > SHORT_SINGLE_KEYWORD_LEN)) {
      if (overlap > bestScore) {
        bestScore = overlap;
        best = skill;
      }
    }
  }
  return best;
}

function createOutput(match) {
  const ctx = [
    '[AUTO-ROUTE] 检测到任务匹配 skill: ' + match.name,
    '描述: ' + (match.desc || ''),
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
  const seen = new Set();
  const deduped = [];
  for (const s of [...projSkills, ...userSkills]) {
    if (!seen.has(s.name)) {
      seen.add(s.name);
      deduped.push(s);
    }
  }
  return deduped;
}

module.exports = {
  readStdin, extractPrompt, extractKeywords, isEscaped,
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
      const projectDir = process.env.CAPABILITY_PROJECT_DIR || process.cwd();
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
