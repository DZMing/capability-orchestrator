'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const path = require('path');

const {
  extractPrompt, extractKeywords, isEscaped, findBestMatch,
  STOP_WORDS, ESCAPE_PATTERNS,
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
