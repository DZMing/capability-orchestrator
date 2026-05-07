'use strict';

const { stemEnglish } = require('../stem-rules.cjs');
const { expandSynonyms } = require('../synonyms.cjs');

const CJK_RANGE = /[\u4e00-\u9fff\u3400-\u4dbf\u{20000}-\u{3134f}]/u;
const CJK_RUN = /[\u4e00-\u9fff\u3400-\u4dbf\u{20000}-\u{3134f}]+/gu;
const NON_CJK_RUN = /[^\u4e00-\u9fff\u3400-\u4dbf\u{20000}-\u{3134f}]+/gu;

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
      const stem = stemEnglish(t);
      if (stem) tokens.push(stem);
    }
  }
  const filtered = tokens.filter(t => !STOP_WORDS.has(t) && (t.length > 1 || CJK_RANGE.test(t)));
  return [...new Set(expandSynonyms(filtered))];
}

module.exports = {
  CJK_RANGE,
  STOP_WORDS,
  extractKeywords,
  _tokenizeStemmed,
};
