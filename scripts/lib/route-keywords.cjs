'use strict';

const { stemEnglish } = require('../stem-rules.cjs');
const { expandSynonyms } = require('../synonyms.cjs');

const CJK_RANGE = /[\u4e00-\u9fff\u3400-\u4dbf\u{20000}-\u{3134f}]/u;
const CJK_RUN = /[\u4e00-\u9fff\u3400-\u4dbf\u{20000}-\u{3134f}]+/gu;
const NON_CJK_RUN = /[^\u4e00-\u9fff\u3400-\u4dbf\u{20000}-\u{3134f}]+/gu;

// A.3 选择性 trigram whitelist：只对高频技术词生成 3-gram，避免 token 爆炸
// 触发条件：原文（normalized）中作为整词出现，才追加 trigram token
const TRIGRAM_WHITELIST = new Set([
  '数据库', '区块链', '微服务', '容器化', '虚拟化',
  '机器学习', '深度学习', '人工智能', '大数据', '物联网',
  '云原生', '可观测', '高并发', '低延迟', '边缘计算',
  '负载均衡', '反向代理', '消息队列', '缓存层', '一致性哈希',
  '蓝绿部署', '灰度发布', '回归测试', '压力测试', '性能测试',
  '单元测试', '集成测试', '冒烟测试', '渗透测试',
  '前端化', '后端化', '工程化', '组件化',
  '数据仓库', '数据湖', '数据管道', '链路追踪', '日志聚合',
  '权限管理', '身份认证', '密钥管理', '漏洞扫描',
  '工单系统', '客户关系', '供应链', '数字化',
]);

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

// 在 CJK 串中扫描 whitelist trigram（整词命中），返回命中的 3-gram 列表
function _scanTrigrams(cjkRun) {
  const hits = [];
  if (cjkRun.length < 3) return hits;
  for (let i = 0; i <= cjkRun.length - 3; i++) {
    const tri = cjkRun.slice(i, i + 3);
    if (TRIGRAM_WHITELIST.has(tri)) hits.push(tri);
  }
  return hits;
}

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
        for (const tri of _scanTrigrams(run)) tokens.push(tri);
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
        for (const tri of _scanTrigrams(run)) tokens.push(tri);
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
  TRIGRAM_WHITELIST,
  extractKeywords,
  _tokenizeStemmed,
};
