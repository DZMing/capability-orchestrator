'use strict';

const {
  CJK_RANGE,
  extractKeywords,
  _tokenizeStemmed,
} = require('./route-keywords.cjs');

const MIN_KEYWORD_OVERLAP = 2;
const MIN_CONFIDENCE = 0.3;
const SHORT_SINGLE_KEYWORD_LEN = 20;

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

  let best = null;
  let bestScore = 0;
  let bestOverlap = 0;
  let bestMatchedKeywords = [];
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

    if (score > bestScore) {
      bestScore = score;
      bestOverlap = overlap;
      best = skill;
      bestMatchedKeywords = [...new Set(matched)];
    }
  }
  if (!best) return null;
  const rawPromptLen = Math.max(promptRaw.length, 1);
  const conf = Math.min(bestOverlap / rawPromptLen, 1);
  return { ...best, confidence: conf, matchedKeywords: bestMatchedKeywords };
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
};
