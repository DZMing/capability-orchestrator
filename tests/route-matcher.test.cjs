'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const path = require('path');

const {
  extractPrompt, extractKeywords, isEscaped, findBestMatch,
  collectAllSkills, STOP_WORDS, ESCAPE_PATTERNS,
} = require('../scripts/route-matcher.cjs');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'route-matcher.cjs');
const NODE = process.execPath;

// ─── extractPrompt ──────────────────────────────────────────────────────────

test('extractPrompt: extracts from prompt field', () => {
  const input = JSON.stringify({ prompt: 'hello world' });
  assert.equal(extractPrompt(input), 'hello world');
});

test('extractPrompt: extracts from message.content', () => {
  const input = JSON.stringify({ message: { content: 'test msg' } });
  assert.equal(extractPrompt(input), 'test msg');
});

test('extractPrompt: extracts from parts array', () => {
  const input = JSON.stringify({ parts: [
    { type: 'text', text: 'part one' },
    { type: 'image', url: 'x' },
    { type: 'text', text: 'part two' },
  ]});
  assert.equal(extractPrompt(input), 'part one part two');
});

test('extractPrompt: returns empty for invalid JSON', () => {
  assert.equal(extractPrompt('not json'), '');
});

test('extractPrompt: returns empty for empty object', () => {
  assert.equal(extractPrompt('{}'), '');
});

test('extractPrompt: prompt field takes priority', () => {
  const input = JSON.stringify({ prompt: 'primary', message: { content: 'secondary' } });
  assert.equal(extractPrompt(input), 'primary');
});

// ─── extractCwd ────────────────────────────────────────────────────────────

test('extractCwd: extracts cwd field', () => {
  const { extractCwd } = require('../scripts/route-matcher.cjs');
  assert.equal(extractCwd(JSON.stringify({ cwd: '/foo/bar', prompt: 'hi' })), '/foo/bar');
});

test('extractCwd: returns empty for missing cwd', () => {
  const { extractCwd } = require('../scripts/route-matcher.cjs');
  assert.equal(extractCwd(JSON.stringify({ prompt: 'hi' })), '');
});

test('extractCwd: returns empty for invalid JSON', () => {
  const { extractCwd } = require('../scripts/route-matcher.cjs');
  assert.equal(extractCwd('not json'), '');
});

// ─── extractKeywords ────────────────────────────────────────────────────────

test('extractKeywords: splits English text', () => {
  const kw = extractKeywords('debug this error now');
  assert.ok(kw.includes('debug'));
  assert.ok(kw.includes('error'));
  assert.ok(kw.includes('now'));
});

test('extractKeywords: splits Chinese text into individual characters', () => {
  const kw = extractKeywords('调试代码问题');
  assert.ok(kw.includes('调'));
  assert.ok(kw.includes('试'));
  assert.ok(kw.includes('代'));
  assert.ok(kw.includes('码'));
  assert.ok(kw.includes('问'));
  assert.ok(kw.includes('题'));
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
  assert.ok(kw.includes('调'), 'CJK chars should be split individually');
  assert.ok(kw.includes('调试'), 'CJK bigrams should be extracted');
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
  assert.equal(kw.length, 1);
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

// ─── isEscaped ──────────────────────────────────────────────────────────────

test('isEscaped: detects 直接做', () => {
  assert.ok(isEscaped('直接做：列出文件'));
});

test('isEscaped: detects skip', () => {
  assert.ok(isEscaped('skip this, just do it'));
});

test('isEscaped: detects 不要用skill', () => {
  assert.ok(isEscaped('不要用skill，自己处理'));
});

test('isEscaped: detects 不用skill', () => {
  assert.ok(isEscaped('不用skill'));
});

test('isEscaped: detects short question', () => {
  assert.ok(isEscaped('这是什么?'));
});

test('isEscaped: long question not escaped', () => {
  assert.ok(!isEscaped('能帮我调试一下这个函数为什么报错了吗？我试了很多方法都不行?'));
});

test('isEscaped: normal message not escaped', () => {
  assert.ok(!isEscaped('帮我调试这个 bug'));
});

test('isEscaped: null returns false', () => {
  assert.ok(!isEscaped(null));
});

// ─── findBestMatch ──────────────────────────────────────────────────────────

test('findBestMatch: matches skill by keyword overlap', () => {
  const skills = [
    { name: 'debugging', desc: 'fix bugs and debug errors in code' },
    { name: 'testing', desc: 'write tests and run test suites' },
  ];
  const match = findBestMatch('there is a bug error in my code', skills);
  assert.ok(match);
  assert.equal(match.name, 'debugging');
});

test('findBestMatch: picks highest overlap', () => {
  const skills = [
    { name: 'general', desc: 'general purpose task handler' },
    { name: 'code-review', desc: 'review code quality and code style and code patterns' },
  ];
  const match = findBestMatch('please review my code quality and code style', skills);
  assert.ok(match);
  assert.equal(match.name, 'code-review');
});

test('findBestMatch: returns null when no match', () => {
  const skills = [
    { name: 'debugging', desc: 'fix bugs and errors' },
  ];
  const match = findBestMatch('deploy to production server', skills);
  assert.equal(match, null);
});

test('findBestMatch: returns null for empty skills', () => {
  assert.equal(findBestMatch('something', []), null);
});

test('findBestMatch: returns null for empty prompt', () => {
  const skills = [{ name: 'test', desc: 'test something' }];
  assert.equal(findBestMatch('', skills), null);
});

test('findBestMatch: single keyword match needs long prompt', () => {
  const skills = [{ name: 'debug', desc: 'debug errors' }];
  assert.equal(findBestMatch('debug', skills), null);
  const match = findBestMatch('can you help me debug this issue', skills);
  assert.ok(match);
});

test('findBestMatch: matches on skill name keywords too', () => {
  const skills = [{ name: 'code-review', desc: 'checks quality' }];
  const match = findBestMatch('please do a code review on this PR', skills);
  assert.ok(match);
  assert.equal(match.name, 'code-review');
});

// ─── confidence scoring ────────────────────────────────────────────────────

test('findBestMatch: returns confidence between 0 and 1', () => {
  const skills = [{ name: 'debugging', desc: 'fix bugs and debug errors in code' }];
  const match = findBestMatch('there is a bug error in my code', skills);
  assert.ok(match);
  assert.ok(typeof match.confidence === 'number', 'should have confidence');
  assert.ok(match.confidence > 0 && match.confidence <= 1, `confidence ${match.confidence} out of range`);
});

test('findBestMatch: high overlap produces high confidence', () => {
  const skills = [{ name: 'review', desc: 'review code quality style patterns lint' }];
  const match = findBestMatch('review code quality style patterns', skills);
  assert.ok(match);
  assert.ok(match.confidence > 0.5, `expected high confidence, got ${match.confidence}`);
});

test('findBestMatch: low overlap produces low confidence', () => {
  const skills = [{ name: 'debug', desc: 'debug errors' }];
  const match = findBestMatch('can you help me debug this weird issue in production', skills);
  assert.ok(match);
  assert.ok(match.confidence < 0.5, `expected low confidence, got ${match.confidence}`);
});

test('findBestMatch: null return has no confidence', () => {
  const skills = [{ name: 'debug', desc: 'debug errors' }];
  const match = findBestMatch('deploy to production server', skills);
  assert.equal(match, null);
});

// ─── STOP_WORDS ─────────────────────────────────────────────────────────────

test('STOP_WORDS: contains common English words', () => {
  assert.ok(STOP_WORDS.has('the'));
  assert.ok(STOP_WORDS.has('is'));
  assert.ok(STOP_WORDS.has('and'));
});

test('STOP_WORDS: contains common Chinese words', () => {
  assert.ok(STOP_WORDS.has('的'));
  assert.ok(STOP_WORDS.has('是'));
  assert.ok(STOP_WORDS.has('帮我'));
});

test('STOP_WORDS: does NOT contain task-critical Chinese words', () => {
  assert.ok(!STOP_WORDS.has('做'), '"做" should not be a stop word');
  assert.ok(!STOP_WORDS.has('什么'), '"什么" should not be a stop word');
  assert.ok(!STOP_WORDS.has('要'), '"要" should not be a stop word');
});

test('extractKeywords: "做" preserved in task descriptions', () => {
  const kw = extractKeywords('帮我做数据分析');
  assert.ok(kw.some(k => k.includes('做')), `"做" should be preserved, got: ${JSON.stringify(kw)}`);
});

test('findBestMatch: Chinese prompt with "做" matches skill', () => {
  const skills = [{ name: 'review', desc: '代码审查工具' }];
  const match = findBestMatch('帮我做一个代码审查', skills);
  assert.ok(match, 'should match despite "做" in prompt');
  assert.equal(match.name, 'review');
});

// ─── createOutput sanitization ──────────────────────────────────────────────

test('createOutput: sanitizes skill description to prevent injection', () => {
  const { createOutput } = require('../scripts/route-matcher.cjs');
  const origWrite = process.stdout.write;
  let captured = '';
  process.stdout.write = (s) => { captured += s; };
  try {
    createOutput({ name: 'evil-skill', desc: 'normal <script>alert(1)</script> `rm -rf /`' });
    const output = JSON.parse(captured.trim());
    const ctx = output.hookSpecificOutput.additionalContext;
    assert.ok(!ctx.includes('<script>'), 'HTML tags should be stripped');
    assert.ok(!ctx.includes('`rm'), 'backticks should be neutralized');
  } finally {
    process.stdout.write = origWrite;
  }
});

// ─── collectAllSkills 插件 skill 路由 ───────────────────────────────────────

const FIXTURE_PROJECT = path.join(__dirname, 'fixtures', 'project');
const FIXTURE_USER = path.join(__dirname, 'fixtures', 'user');

test('collectAllSkills: includes plugin skills', () => {
  const skills = collectAllSkills(FIXTURE_PROJECT, FIXTURE_USER);
  const names = skills.map(s => s.name);
  assert.ok(names.includes('alpha'), 'should include good-plugin alpha skill');
  assert.ok(names.includes('beta'), 'should include vendor-structure beta skill');
  assert.ok(names.includes('gamma-skill'), 'should include three-level gamma-skill');
});

test('collectAllSkills: project skills take priority over plugin skills', () => {
  const skills = collectAllSkills(FIXTURE_PROJECT, FIXTURE_USER);
  const names = skills.map(s => s.name);
  assert.ok(names.includes('valid-skill'), 'project skill should be present');
  const validSkill = skills.find(s => s.name === 'valid-skill');
  assert.ok(validSkill.desc.includes('valid test skill'), 'should have project-level desc');
});

test('findBestMatch: matches plugin-provided skill', () => {
  const skills = [
    { name: 'alpha', desc: 'Alpha skill for data analysis and reports' },
    { name: 'beta', desc: 'Beta skill for testing frameworks' },
  ];
  const match = findBestMatch('run data analysis and generate reports', skills);
  assert.ok(match);
  assert.equal(match.name, 'alpha');
});

// ─── Bug 1: Unicode NFC/NFD 归一化 ──────────────────────────────────────────

test('extractKeywords: NFC and NFD produce identical results', () => {
  const nfc = 'caf\u00e9';       // café (NFC: é = U+00E9)
  const nfd = 'cafe\u0301';      // café (NFD: e + combining acute)
  const kwNfc = extractKeywords(nfc);
  const kwNfd = extractKeywords(nfd);
  assert.deepEqual(kwNfc, kwNfd, `NFC ${JSON.stringify(kwNfc)} !== NFD ${JSON.stringify(kwNfd)}`);
});

test('findBestMatch: NFC prompt matches NFD skill description', () => {
  const skills = [{ name: 'cafe-tool', desc: 'cafe\u0301 helper for re\u0301sume\u0301' }];
  const match = findBestMatch('I need the caf\u00e9 helper for my r\u00e9sum\u00e9 today', skills);
  assert.ok(match, 'NFC prompt should match NFD description');
  assert.equal(match.name, 'cafe-tool');
});

// ─── Bug 2: CJK Extensions B-G ─────────────────────────────────────────────

test('extractKeywords: CJK Extension B characters treated as CJK', () => {
  // U+20000 (𠀀) and U+20001 (𠀁) are CJK Extension B characters
  const kw = extractKeywords('\u{20000}\u{20001}测试');
  assert.ok(kw.includes('测'), 'basic CJK char should be extracted');
  assert.ok(kw.includes('试'), 'basic CJK char should be extracted');
  assert.ok(kw.includes('\u{20000}'), 'Extension B char should be extracted as CJK');
  assert.ok(kw.includes('\u{20001}'), 'Extension B char should be extracted as CJK');
});

test('extractKeywords: CJK Extension B bigrams', () => {
  const kw = extractKeywords('\u{20000}\u{20001}');
  assert.ok(kw.includes('\u{20000}\u{20001}'), 'should produce bigram from Extension B chars');
});

// ─── 端到端子进程测试 ──────────────────────────────────────────────────────

test('e2e: passThrough for short prompt', () => {
  const raw = execFileSync(NODE, [SCRIPT], {
    input: JSON.stringify({ prompt: 'hi' }),
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();
  const output = JSON.parse(raw);
  assert.equal(output.continue, true);
  assert.equal(output.suppressOutput, true);
});

test('e2e: passThrough for escaped prompt', () => {
  const raw = execFileSync(NODE, [SCRIPT], {
    input: JSON.stringify({ prompt: '直接做：列出文件' }),
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();
  const output = JSON.parse(raw);
  assert.equal(output.continue, true);
  assert.equal(output.suppressOutput, true);
});

test('e2e: passThrough for empty input', () => {
  const raw = execFileSync(NODE, [SCRIPT], {
    input: '',
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();
  const output = JSON.parse(raw);
  assert.equal(output.continue, true);
});

test('e2e: always outputs valid JSON', () => {
  const raw = execFileSync(NODE, [SCRIPT], {
    input: 'invalid json garbage',
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();
  assert.doesNotThrow(() => JSON.parse(raw), 'output must be valid JSON');
  const output = JSON.parse(raw);
  assert.equal(output.continue, true);
});

test('e2e: exit 0 on normal input', () => {
  const raw = execFileSync(NODE, [SCRIPT], {
    input: JSON.stringify({ prompt: 'help me review this code carefully' }),
    encoding: 'utf-8',
    timeout: 10000,
  });
  assert.ok(raw.length > 0, 'should produce output');
  const output = JSON.parse(raw.trim());
  assert.equal(output.continue, true);
});

test('e2e: uses cwd from stdin for skill scanning', () => {
  const fixtureProject = path.join(__dirname, 'fixtures', 'project');
  const raw = execFileSync(NODE, [SCRIPT], {
    input: JSON.stringify({ prompt: 'I need a valid test skill for this task', cwd: fixtureProject }),
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();
  const output = JSON.parse(raw);
  assert.equal(output.continue, true);
  if (output.hookSpecificOutput) {
    assert.ok(output.hookSpecificOutput.additionalContext.includes('valid-skill'),
      'should route to valid-skill from fixture project');
  }
});
