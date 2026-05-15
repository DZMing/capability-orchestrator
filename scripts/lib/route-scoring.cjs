'use strict';

const {
  CJK_RANGE,
  extractKeywords,
  _tokenizeStemmed,
} = require('./route-keywords.cjs');

function envNum(name, def) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : def;
}

const MIN_KEYWORD_OVERLAP = envNum('CO_MIN_KEYWORD_OVERLAP', 2);
const MIN_CONFIDENCE = envNum('CO_MIN_CONFIDENCE', 0.3);
const SHORT_SINGLE_KEYWORD_LEN = envNum('CO_SHORT_SINGLE_KEYWORD_LEN', 20);
const UNMATCHED_PENALTY = envNum('CO_UNMATCHED_PENALTY', 0.15);
const UNMATCHED_IDF_WEIGHT = envNum('CO_UNMATCHED_IDF_WEIGHT', 0);
const TOP_N_CANDIDATES = envNum('CO_TOP_N_CANDIDATES', 3);

function findBestMatch(prompt, skills) {
  if (!prompt || !skills || skills.length === 0) return null;
  const promptKw = extractKeywords(prompt);
  if (promptKw.length === 0) return null;

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
    const stemmedSet = new Set([..._tokenizeStemmed(skill.name), ..._tokenizeStemmed(skill.desc)]);
    const stemmedNameKw = new Set(_tokenizeStemmed(skill.name));
    const stemmedSkillKw = new Set(_tokenizeStemmed(skill.desc + ' ' + skill.name));
    for (const k of stemmedSet) df.set(k, (df.get(k) || 0) + 1);
    return { skill, kwSet, nameSet, stemmedSkillKw, stemmedNameKw };
  });

  const candidates = [];
  for (const { skill, kwSet, nameSet, stemmedSkillKw, stemmedNameKw } of skillData) {
    const stemmedMatched = promptRaw.filter(k => stemmedSkillKw.has(k));
    let overlap = stemmedMatched.length;
    if (overlap < MIN_KEYWORD_OVERLAP) {
      if (overlap === 1 && prompt.length > SHORT_SINGLE_KEYWORD_LEN &&
          stemmedNameKw.has(stemmedMatched[0])) {
        /* single keyword hit on skill name: allowed */
      } else if (overlap === 0) {
        const crossMatched = promptKw.filter(k => kwSet.has(k));
        if (crossMatched.length >= MIN_KEYWORD_OVERLAP) {
          overlap = crossMatched.length;
        } else if (crossMatched.length === 1 && stemmedNameKw.has(crossMatched[0])) {
          overlap = 1;
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
    // base bonus: 防止 N=1（单 skill 测试）时 idf=0 退化
    score += matched.length * 0.05;

    // A.1 负向惩罚：prompt 出现但 skill desc 缺失的 CJK 主题词
    const unmatchedTopicKw = scorablePromptKw.filter(
      k => !kwSet.has(k) && k.length >= 2 && CJK_RANGE.test(k)
    );
    let penalty = 0;
    for (const k of unmatchedTopicKw) {
      penalty += UNMATCHED_PENALTY;
      if (UNMATCHED_IDF_WEIGHT > 0) {
        const idf = Math.log(N / (df.get(k) || 1));
        penalty += Math.max(idf, 0.5) * UNMATCHED_IDF_WEIGHT;
      }
    }
    score -= penalty;

    candidates.push({
      skill,
      score,
      overlap,
      kwSetSize: kwSet.size,
      matched: [...new Set(matched)],
      unmatchedPenalty: penalty,
      unmatchedTopicKw,
    });
  }
  if (candidates.length === 0) return null;

  // A.2 平局打破：score → overlap → 更聚焦（kwSetSize 小）
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.overlap !== a.overlap) return b.overlap - a.overlap;
    return a.kwSetSize - b.kwSetSize;
  });
  const winner = candidates[0];
  if (winner.score <= 0) return null;

  const rawPromptLen = Math.max(promptRaw.length, 1);
  const conf = Math.min(winner.overlap / rawPromptLen, 1);

  // B.1 Top-N 候选透传
  const topCandidates = candidates.slice(0, TOP_N_CANDIDATES).map(c => ({
    name: c.skill.name,
    score: Number(c.score.toFixed(3)),
    overlap: c.overlap,
    matchedKeywords: c.matched,
    unmatchedPenalty: Number(c.unmatchedPenalty.toFixed(3)),
  }));

  return {
    ...winner.skill,
    confidence: conf,
    matchedKeywords: winner.matched,
    topCandidates,
    unmatchedTopicKw: winner.unmatchedTopicKw,
  };
}

function findBestMcpMatch(prompt, servers) {
  if (!prompt || !servers || servers.length === 0) return null;
  const asMcpSkills = servers.map(s => ({ ...s, name: s.name, desc: s.desc || '' }));
  return findBestMatch(prompt, asMcpSkills);
}

module.exports = {
  findBestMatch,
  findBestMcpMatch,
  MIN_CONFIDENCE,
  MIN_KEYWORD_OVERLAP,
  SHORT_SINGLE_KEYWORD_LEN,
  UNMATCHED_PENALTY,
  UNMATCHED_IDF_WEIGHT,
  TOP_N_CANDIDATES,
};
