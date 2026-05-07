'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  extractKeywords,
  _tokenizeStemmed,
  STOP_WORDS,
} = require('../scripts/lib/route-keywords.cjs');

test('extractKeywords: splits English text', () => {
  const kw = extractKeywords('debug this error now');
  assert.ok(kw.includes('debug'));
  assert.ok(kw.includes('error'));
  assert.ok(kw.includes('now'));
});

test('extractKeywords: splits Chinese text into individual characters', () => {
  const kw = extractKeywords('调试代码问题');
  for (const token of ['调', '试', '代', '码', '问', '题']) {
    assert.ok(kw.includes(token), `should include ${token}`);
  }
});

test('extractKeywords: Chinese bigrams extracted', () => {
  const kw = extractKeywords('调试代码');
  assert.ok(kw.includes('调试'));
  assert.ok(kw.includes('代码'));
});

test('extractKeywords: mixed Chinese and English', () => {
  const kw = extractKeywords('调试debug代码bug');
  assert.ok(kw.includes('debug'));
  assert.ok(kw.includes('bug'));
  assert.ok(kw.includes('调'));
  assert.ok(kw.includes('调试'));
});

test('extractKeywords: filters stop words', () => {
  const kw = extractKeywords('the quick brown fox');
  assert.ok(!kw.includes('the'));
  assert.ok(kw.includes('quick'));
  assert.ok(kw.includes('brown'));
  assert.ok(kw.includes('fox'));
});

test('extractKeywords: filters Chinese stop words', () => {
  const kw = extractKeywords('帮我调试这个代码');
  assert.ok(!kw.includes('帮我'));
  assert.ok(!kw.includes('这'));
});

test('extractKeywords: Chinese sentence produces matchable keywords', () => {
  const skillKw = extractKeywords('调试代码错误');
  const promptKw = extractKeywords('帮我调试这个代码的错误');
  const overlap = promptKw.filter(k => skillKw.includes(k));
  assert.ok(overlap.length >= 2, `should have >=2 overlap, got ${overlap.length}: ${JSON.stringify(overlap)}`);
});

test('extractKeywords: deduplicates', () => {
  const kw = extractKeywords('debug debug debug');
  assert.ok(kw.length >= 1);
  assert.equal(kw.length, new Set(kw).size);
  assert.ok(kw.includes('debug'));
});

test('extractKeywords: returns empty for null/empty', () => {
  assert.deepEqual(extractKeywords(null), []);
  assert.deepEqual(extractKeywords(''), []);
  assert.deepEqual(extractKeywords(123), []);
});

test('extractKeywords: skips single-char tokens', () => {
  const kw = extractKeywords('a b c debug');
  assert.ok(!kw.includes('a'));
  assert.ok(kw.includes('debug'));
});

test('STOP_WORDS: contains common English and Chinese words', () => {
  for (const token of ['the', 'is', 'and', '的', '是', '帮我']) {
    assert.ok(STOP_WORDS.has(token), `should contain ${token}`);
  }
});

test('STOP_WORDS: does not contain task-critical Chinese words', () => {
  for (const token of ['做', '什么', '要']) {
    assert.ok(!STOP_WORDS.has(token), `${token} should not be a stop word`);
  }
});

test('extractKeywords: "做" preserved in task descriptions', () => {
  const kw = extractKeywords('帮我做数据分析');
  assert.ok(kw.some(k => k.includes('做')), `"做" should be preserved, got: ${JSON.stringify(kw)}`);
});

test('extractKeywords: NFC and NFD produce identical results', () => {
  const nfc = 'caf\u00e9';
  const nfd = 'cafe\u0301';
  assert.deepEqual(extractKeywords(nfc), extractKeywords(nfd));
});

test('extractKeywords: CJK Extension B characters are tokenized', () => {
  const kw = extractKeywords('\u{20000}\u{20001}测试');
  for (const token of ['\u{20000}', '\u{20001}', '\u{20000}\u{20001}', '测', '试']) {
    assert.ok(kw.includes(token), `should include ${token}`);
  }
});

test('stemming: extractKeywords stems English word forms', () => {
  const plural = extractKeywords('fix bugs and debug errors in code');
  assert.ok(plural.includes('bug'));
  assert.ok(plural.includes('error'));
  assert.ok(extractKeywords('debugging the code').includes('debug'));
  assert.ok(extractKeywords('deployed the application').includes('deploy'));
});

test('synonym: extractKeywords expands bilingual synonyms', () => {
  assert.ok(extractKeywords('用户认证集成').includes('auth'));
  assert.ok(extractKeywords('auth login setup').includes('认证'));
  assert.ok(extractKeywords('help debug this code').includes('调试'));
});

test('_tokenizeStemmed: produces CJK bigrams', () => {
  const tokens = _tokenizeStemmed('调试代码');
  assert.ok(tokens.includes('调试'));
  assert.ok(tokens.includes('代码'));
});

test('_tokenizeStemmed: appends English stems without replacing original', () => {
  const tokens = _tokenizeStemmed('debugging errors');
  assert.ok(tokens.includes('debugging'));
  assert.ok(tokens.includes('debug'));
  assert.ok(tokens.includes('errors'));
  assert.ok(tokens.includes('error'));
});

test('_tokenizeStemmed: filters stop words', () => {
  const tokens = _tokenizeStemmed('the code is working');
  assert.ok(!tokens.includes('the'));
  assert.ok(!tokens.includes('is'));
  assert.ok(tokens.includes('code'));
});

test('_tokenizeStemmed: does not expand synonyms', () => {
  const stemmed = _tokenizeStemmed('debug');
  const expanded = extractKeywords('debug');
  assert.ok(!stemmed.includes('调试'));
  assert.ok(expanded.includes('调试'));
});
