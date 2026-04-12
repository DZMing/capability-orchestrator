'use strict';
// 轻量英文词干提取 — 只处理最常见的 -s/-es/-ed/-ing 四类变形
// 保守策略：保留原始 token，词干形式作为追加。不处理不规则变形。

const STEM_RULES = [
  // -ing 变形（双写辅音：debugging→debug, running→run）
  { suffix: 'gging', replace: 'g' },
  { suffix: 'nning', replace: 'n' },
  { suffix: 'tting', replace: 't' },
  { suffix: 'pping', replace: 'p' },
  { suffix: 'mming', replace: 'm' },
  { suffix: 'rring', replace: 'r' },
  // -ying → -y（applying→apply 之类，但 "deploying" 不在此类）
  { suffix: 'ying', replace: 'y', minStem: 3 },
  // -ing 一般情况（testing→test, deploying→deploy 的 deploy 部分）
  { suffix: 'ing', replace: '', minStem: 3 },

  // -ed 变形（双写辅音：formatted→format）
  { suffix: 'tted', replace: 't' },
  { suffix: 'pped', replace: 'p' },
  { suffix: 'mmed', replace: 'm' },
  // -ied → -y（applied→apply）
  { suffix: 'ied', replace: 'y', minStem: 2 },
  // -ed 一般情况
  { suffix: 'ed', replace: '', minStem: 3 },

  // -s/-es 单复数
  { suffix: 'ies', replace: 'y', minStem: 2 },   // queries→query
  { suffix: 'ses', replace: 's', minStem: 3 },    // analyses→analys（有限）
  { suffix: 'es', replace: '', minStem: 3 },       // fixes→fix
  { suffix: 's', replace: '', minStem: 3 },        // bugs→bug
];

function stemEnglish(word) {
  if (!word || word.length < 4) return null; // 短词不处理
  const lower = word.toLowerCase();
  for (const rule of STEM_RULES) {
    if (lower.endsWith(rule.suffix)) {
      const stem = lower.slice(0, -rule.suffix.length) + rule.replace;
      const minLen = rule.minStem || 3;
      if (stem.length >= minLen && stem !== lower) return stem;
    }
  }
  return null;
}

module.exports = { stemEnglish };
