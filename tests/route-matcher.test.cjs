'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('child_process');
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
  // Synonym expansion adds 调试/fix/troubleshoot, but no duplicate tokens
  assert.ok(kw.length >= 1, 'should produce at least one token');
  assert.equal(kw.length, new Set(kw).size, 'no duplicates');
  assert.ok(kw.includes('debug'), 'should include original token');
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
    { name: 'debugging', desc: 'fix bug and debug error in code' },
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
  const skills = [{ name: 'debugging', desc: 'fix bug and debug error in code' }];
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
  process.stdout.write = (s) => { captured += s; return true; };
  try {
    createOutput({ name: 'evil-skill', desc: 'normal <script>alert(1)</script> `rm -rf /`' });
    // createOutput now outputs plain text (not JSON)
    assert.ok(captured.includes('[AUTO-ROUTE]'), 'should include AUTO-ROUTE marker');
    assert.ok(!captured.includes('<script>'), 'HTML tags should be stripped');
    assert.ok(!captured.includes('`rm'), 'backticks should be neutralized');
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

// ─── 匹配精度：长描述不应靠通用词碰撞赢过精确匹配 ────────────────────────

test('findBestMatch: specific keyword match beats generic overlap from long desc', () => {
  // "用户" and "功能" appear in many skills — IDF should reduce their weight
  const skills = [
    { name: 'auth-quick', desc: '5 分钟认证集成：Supabase Auth 或 Clerk，含 Google OAuth' },
    { name: 'feedback-loop', desc: '用户反馈系统：嵌入式反馈按钮 + 自动分类（Bug/功能请求/好评）+ 邮件通知，15 分钟集成完成' },
    { name: 'user-dashboard', desc: '用户仪表盘：展示用户数据和功能入口' },
    { name: 'user-profile', desc: '用户资料页面：编辑用户信息和功能设置' },
    { name: 'feature-flags', desc: '功能开关系统：灰度发布用户功能' },
    { name: 'analytics', desc: '用户分析工具：追踪用户行为和功能使用' },
  ];
  const match = findBestMatch('写一个用户认证功能', skills);
  assert.ok(match, 'should match something');
  assert.equal(match.name, 'auth-quick', '"认证" is rare and specific, should outweigh common "用户"/"功能"');
});

test('findBestMatch: does not match on incidental word in long description', () => {
  const skills = [
    { name: 'deploy-tool', desc: 'deploy code to staging and production servers' },
    { name: 'design-html', desc: 'Design finalization: generates production-quality HTML/CSS' },
  ];
  const match = findBestMatch('I need to deploy this to production', skills);
  assert.ok(match, 'should match');
  assert.equal(match.name, 'deploy-tool', '"deploy" + "production" should beat incidental "production" in design desc');
});

test('findBestMatch: single-keyword match on desc only should not route when no skill matches intent', () => {
  // "production" appears in design-html desc as "production-quality" — not the user's intent
  // With only 1 keyword overlap and no name match, should return null
  const skills = [
    { name: 'design-html', desc: 'Design finalization: generates production-quality HTML/CSS' },
    { name: 'frontend-design', desc: 'Create production-grade frontend interfaces' },
  ];
  const match = findBestMatch('I need to deploy this to production', skills);
  assert.equal(match, null, 'single keyword "production" not in any skill name — should not match');
});

test('findBestMatch: single-keyword match on skill name still works', () => {
  const skills = [
    { name: 'production-deploy', desc: 'deploy code to servers' },
    { name: 'design-html', desc: 'Design finalization: generates production-quality HTML/CSS' },
  ];
  const match = findBestMatch('I need to deploy this to production', skills);
  assert.ok(match, 'should match — "production" is in skill name');
  assert.equal(match.name, 'production-deploy');
});

test('findBestMatch: bigram match weighs more than single-char matches', () => {
  const skills = [
    { name: 'code-review', desc: '代码审查工具' },
    { name: 'code-gen', desc: '代码生成器，自动生成代码模板' },
  ];
  const match = findBestMatch('帮我做代码审查', skills);
  assert.ok(match);
  assert.equal(match.name, 'code-review', '"代码审查" bigram match should win');
});

test('findBestMatch: rare bigram beats common single-char noise in large skill set', () => {
  // Simulates real 90-skill environment where:
  // - "用户" and "功能" appear in many skills (low IDF)
  // - "认证" appears in few skills (high IDF)
  // - Single CJK chars '户' and '功' are noise fragments from bigram decomposition
  const skills = [
    { name: 'auth-quick', desc: '5 分钟认证集成：Supabase Auth 或 Clerk，含 Google OAuth' },
    { name: 'feedback-loop', desc: '用户反馈系统：嵌入式反馈按钮 + 自动分类（Bug/功能请求/好评）+ 邮件通知' },
    { name: 'user-dashboard', desc: '用户仪表盘：展示用户数据和功能入口' },
    { name: 'user-profile', desc: '用户资料页面：编辑用户信息和功能设置' },
    { name: 'feature-flags', desc: '功能开关系统：灰度发布用户功能' },
    { name: 'analytics', desc: '用户分析工具：追踪用户行为和功能使用' },
    // Skills that dilute '认' and '证' as single chars
    { name: 'security-scan', desc: '安全认定扫描：确认代码合规性和证明安全等级' },
    { name: 'identity-verify', desc: '身份验证服务：证件识别和认可自动化' },
    { name: 'data-validation', desc: '数据验证工具：认真校验格式和证据链完整性' },
    { name: 'compliance', desc: '合规认定系统：许可证管理和认可流程自动化' },
    { name: 'audit-log', desc: '审计日志：确认操作记录和证据保存' },
    { name: 'permission-mgr', desc: '权限管理：认可授权和证书分发' },
  ];
  const match = findBestMatch('写一个用户认证功能', skills);
  assert.ok(match, 'should match something');
  assert.equal(match.name, 'auth-quick',
    '"认证" as a semantic unit should outweigh scattered single-char noise');
});

test('findBestMatch: single CJK char noise does not inflate score', () => {
  // When '认' and '证' appear in many skills but '认证' is rare,
  // auth-quick should win because '认证' as a semantic unit is the key intent.
  // Single chars '功' and '户' are noise from bigram decomposition.
  const skills = [
    { name: 'auth-quick', desc: '认证集成' },
    { name: 'feedback-loop', desc: '用户反馈功能请求' },
    { name: 'user-mgr', desc: '用户设置' },
    { name: 'user-data', desc: '用户数据' },
    { name: 'verify', desc: '确认验证识别' },
    { name: 'cert', desc: '证书管理证件' },
    { name: 'confirm', desc: '认可审核确认' },
    { name: 'proof', desc: '证明材料证据' },
  ];
  const match = findBestMatch('用户认证功能', skills);
  assert.ok(match, 'should match');
  assert.equal(match.name, 'auth-quick',
    '"认证" is specific intent, single-char noise should not inflate competing scores');
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
  // passThrough outputs JSON {"continue":true}
  const output = JSON.parse(raw);
  assert.equal(output.continue, true);
  assert.ok(!output.hookSpecificOutput, 'short prompt should not have hookSpecificOutput');
});

test('e2e: passThrough for escaped prompt', () => {
  const raw = execFileSync(NODE, [SCRIPT], {
    input: JSON.stringify({ prompt: '直接做：列出文件' }),
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();
  // passThrough outputs JSON {"continue":true}
  const output = JSON.parse(raw);
  assert.equal(output.continue, true);
  assert.ok(!output.hookSpecificOutput, 'escaped prompt should not have hookSpecificOutput');
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

test('e2e: passThrough on invalid input produces valid JSON', () => {
  // Invalid JSON → extractPrompt returns '' → passThrough → JSON output
  const raw = execFileSync(NODE, [SCRIPT], {
    input: 'invalid json garbage',
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();
  assert.doesNotThrow(() => JSON.parse(raw), 'passThrough must produce valid JSON');
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
  // Output is either plain text [AUTO-ROUTE] (match) or JSON passThrough
  const trimmed = raw.trim();
  const isMatch = trimmed.startsWith('[AUTO-ROUTE]');
  const isPassThrough = trimmed.startsWith('{');
  assert.ok(isMatch || isPassThrough, 'output should be AUTO-ROUTE text or passThrough JSON');
});

test('e2e: uses cwd from stdin for skill scanning', () => {
  const fixtureProject = path.join(__dirname, 'fixtures', 'project');
  const raw = execFileSync(NODE, [SCRIPT], {
    input: JSON.stringify({ prompt: 'I need a valid test skill for this task', cwd: fixtureProject }),
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();
  // Output is either plain text AUTO-ROUTE or passThrough JSON
  const isMatch = raw.startsWith('[AUTO-ROUTE]');
  const isPassThrough = raw.startsWith('{');
  assert.ok(isMatch || isPassThrough, 'should produce AUTO-ROUTE or passThrough output');
  if (isMatch) {
    assert.ok(raw.includes('[AUTO-ROUTE]'), 'match should include AUTO-ROUTE marker');
    assert.ok(raw.includes('Skill tool') || raw.includes('命令'), 'should instruct to use skill or command');
  }
});

// ─── Session 2: readStdin 超时 & 异常路径 ─────────────────────────────────

test('e2e: stdin timeout produces passThrough (no stdin data)', (t, done) => {
  const child = spawn(NODE, [SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.on('close', (code) => {
    assert.equal(code, 0, 'should exit 0');
    const output = JSON.parse(stdout.trim());
    assert.equal(output.continue, true, 'should passThrough on timeout');
    done();
  });
  // Don't write anything to stdin, don't end it — force the timeout path
  // Default STDIN_TIMEOUT is 3000ms, so this test takes ~3s
});

test('e2e: multi-chunk stdin correctly assembled', () => {
  // Split JSON across two writes to test chunk accumulation
  const json = JSON.stringify({ prompt: 'help me review this code carefully' });
  const mid = Math.floor(json.length / 2);
  const chunk1 = json.slice(0, mid);
  const chunk2 = json.slice(mid);

  // Use a wrapper script that writes in two chunks
  const wrapperScript = `
    const { spawn } = require('child_process');
    const child = spawn(process.execPath, ['${SCRIPT.replace(/'/g, "\\'")}'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', d => out += d);
    child.on('close', () => { process.stdout.write(out); });
    child.stdin.write(${JSON.stringify(chunk1)});
    setTimeout(() => { child.stdin.write(${JSON.stringify(chunk2)}); child.stdin.end(); }, 50);
  `;
  const raw = execFileSync(NODE, ['-e', wrapperScript], {
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();
  // Output is either plain text [AUTO-ROUTE] or JSON passThrough
  const trimmed = raw.trim();
  assert.ok(trimmed.startsWith('[AUTO-ROUTE]') || trimmed.startsWith('{'),
    'multi-chunk input should produce AUTO-ROUTE or passThrough output');
});

test('e2e: empty stdin end produces passThrough', () => {
  // Pipe empty buffer and immediately end — tests readableEnded path
  const raw = execFileSync(NODE, [SCRIPT], {
    input: Buffer.alloc(0),
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();
  const output = JSON.parse(raw);
  assert.equal(output.continue, true);
});

test('collectAllSkills: fault-open when plugin scan throws', () => {
  // Pass a non-existent userDir that will cause scanInstalledPlugins to fail
  const skills = collectAllSkills(
    path.join(__dirname, 'fixtures', 'project'),
    '/nonexistent/path/that/definitely/does/not/exist'
  );
  // Should still return project skills without crashing
  assert.ok(Array.isArray(skills), 'should return array');
  const names = skills.map(s => s.name);
  assert.ok(names.includes('valid-skill'), 'project skill should still be present');
});

// ─── Session 4: 突变测试断言加固 ──────────────────────────────────────────

// 4a: MIN_KEYWORD_OVERLAP boundary — exactly 2 keywords overlap must match
test('mutation: exactly 2 keyword overlap matches (MIN_KEYWORD_OVERLAP=2)', () => {
  const skills = [{ name: 'deploy', desc: 'deploy production server application' }];
  // 'deploy' and 'production' overlap — exactly 2
  const match = findBestMatch('deploy to production environment', skills);
  assert.ok(match, 'exactly 2 keyword overlap should match');
  assert.equal(match.name, 'deploy');
});

// 4b: SHORT_SINGLE_KEYWORD_LEN boundary — 21+ char prompt with 1 keyword overlap
test('mutation: single keyword overlap with long prompt matches (SHORT_SINGLE_KEYWORD_LEN=20)', () => {
  const skills = [{ name: 'deploy', desc: 'deploy application' }];
  // Only 'deploy' overlaps but prompt is > 20 chars
  const longPrompt = 'please deploy this thing for me now';
  assert.ok(longPrompt.length > 20, 'prompt must be > 20 chars');
  const match = findBestMatch(longPrompt, skills);
  assert.ok(match, 'single keyword + long prompt should match');
  // Short prompt with same single overlap should NOT match
  const shortMatch = findBestMatch('deploy it', skills);
  assert.equal(shortMatch, null, 'single keyword + short prompt should not match');
});

// 4c: isEscaped short question threshold — 25 char question should be escaped
test('mutation: 25-char question is escaped (threshold < 30)', () => {
  // Exactly 25 characters ending with ?
  const q = 'abcdefghijklmnopqrstuvwx?';
  assert.equal(q.length, 25);
  assert.ok(isEscaped(q), '25-char question should be escaped');
  // 30-char question should also be escaped (< 30)
  const q29 = 'abcdefghijklmnopqrstuvwxyzab?';
  assert.equal(q29.length, 29);
  assert.ok(isEscaped(q29), '29-char question should be escaped');
  // 31-char question should NOT be escaped
  const q31 = 'abcdefghijklmnopqrstuvwxyzabcd?';
  assert.equal(q31.length, 31);
  assert.ok(!isEscaped(q31), '31-char question should NOT be escaped');
});

// 4e: MIN_PROMPT_LEN boundary — 5 char prompt processed, 4 char skipped
test('mutation: MIN_PROMPT_LEN boundary at 5 chars', () => {
  // 4-char prompt should be skipped (passThrough → JSON {"continue":true})
  const raw4 = execFileSync(NODE, [SCRIPT], {
    input: JSON.stringify({ prompt: 'abcd' }),
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();
  const out4 = JSON.parse(raw4);
  assert.equal(out4.continue, true, '4-char prompt should passThrough');
  assert.ok(!out4.hookSpecificOutput, '4-char prompt should not route');

  // 5-char prompt "debug" matches /debug command (literal match) or no match
  // Either way it gets processed (not auto-skipped)
  const raw5 = execFileSync(NODE, [SCRIPT], {
    input: JSON.stringify({ prompt: 'debug' }),
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();
  // Output is either plain text AUTO-ROUTE (literal match to /debug) or JSON passThrough
  assert.ok(raw5.startsWith('[AUTO-ROUTE]') || raw5.startsWith('{'),
    '5-char prompt should be processed (not auto-skipped)');
});

// 4g: compareSemver exact return values
test('mutation: compareSemver returns exactly 1 or -1', () => {
  const { compareSemver } = require('../scripts/scan-environment.cjs');
  assert.equal(compareSemver('2.0.0', '1.0.0'), 1, 'greater should return 1');
  assert.equal(compareSemver('1.0.0', '2.0.0'), -1, 'lesser should return -1');
  assert.equal(compareSemver('1.0.0', '1.0.0'), 0, 'equal should return 0');
});

// 4h: collectAllSkills dedup order — project > user > plugin
test('mutation: collectAllSkills dedup prefers project over plugin', () => {
  const skills = collectAllSkills(FIXTURE_PROJECT, FIXTURE_USER);
  // 'valid-skill' exists in project fixture
  const vs = skills.find(s => s.name === 'valid-skill');
  assert.ok(vs, 'valid-skill should exist');
  // Its desc should be from project level, not a hypothetical plugin override
  assert.ok(vs.desc.includes('valid test skill'),
    `desc should be project-level, got: ${vs.desc}`);
});

// ─── Session 7: 词干提取 & 同义词扩展 ─────────────────────────────────────

// Stemming
test('stemming: extractKeywords stems English plurals (bugs→bug, errors→error)', () => {
  const kw = extractKeywords('fix bugs and debug errors in code');
  assert.ok(kw.includes('bug'), '"bugs" should stem to "bug"');
  assert.ok(kw.includes('error'), '"errors" should stem to "error"');
});

test('stemming: extractKeywords stems -ing forms (debugging→debug)', () => {
  const kw = extractKeywords('debugging the code');
  assert.ok(kw.includes('debug'), '"debugging" should stem to "debug"');
});

test('stemming: extractKeywords stems -ed forms (deployed→deploy)', () => {
  const kw = extractKeywords('deployed the application');
  assert.ok(kw.includes('deploy'), '"deployed" should stem to "deploy"');
});

test('stemming: findBestMatch matches across word forms via stemming', () => {
  const skills = [{ name: 'bug-tracker', desc: 'track and fix bug in code' }];
  const match = findBestMatch('there are bugs errors in my code', skills);
  assert.ok(match, '"bugs"→"bug" and "errors"→"error" should enable match');
  assert.equal(match.name, 'bug-tracker');
});

// Synonyms
test('synonym: extractKeywords expands Chinese→English (认证→auth)', () => {
  const kw = extractKeywords('用户认证集成');
  assert.ok(kw.includes('auth'), '"认证" should expand to "auth"');
});

test('synonym: extractKeywords expands English→Chinese (auth→认证)', () => {
  const kw = extractKeywords('auth login setup');
  assert.ok(kw.includes('认证'), '"auth" should expand to "认证"');
});

test('synonym: extractKeywords expands debug→调试', () => {
  const kw = extractKeywords('help debug this code');
  assert.ok(kw.includes('调试'), '"debug" should expand to "调试"');
});

test('synonym: findBestMatch Chinese prompt matches English skill desc via synonym', () => {
  const skills = [
    { name: 'auth-quick', desc: 'Supabase Auth Clerk OAuth authentication integration' },
    { name: 'other', desc: 'general purpose helper' },
  ];
  const match = findBestMatch('用户认证集成方案', skills);
  assert.ok(match, 'should match via 认证→auth synonym');
  assert.equal(match.name, 'auth-quick');
});

test('synonym: findBestMatch English prompt matches Chinese skill desc via synonym', () => {
  const skills = [
    { name: 'debug-tool', desc: '代码调试分析错误诊断' },
    { name: 'other', desc: 'general helper only' },
  ];
  const match = findBestMatch('help me debug this code issue', skills);
  assert.ok(match, 'should match via debug→调试 synonym');
  assert.equal(match.name, 'debug-tool');
});

// ─── Step A: MCP tool 路由 ──────────────────────────────────────────────────

const { findBestMcpMatch, createMcpOutput } = require('../scripts/route-matcher.cjs');

test('findBestMcpMatch: matches MCP server by keyword overlap', () => {
  const servers = [
    { name: 'chrome-devtools', desc: '控制真实 Chrome 浏览器，截图，DOM 操作' },
    { name: 'context7', desc: '文档检索与上下文查询' },
  ];
  const match = findBestMcpMatch('帮我截图当前页面', servers);
  assert.ok(match, 'should match chrome-devtools');
  assert.equal(match.name, 'chrome-devtools');
});

test('findBestMcpMatch: matches documentation query to context7', () => {
  const servers = [
    { name: 'chrome-devtools', desc: '控制真实 Chrome 浏览器截图DOM操作' },
    { name: 'context7', desc: '文档检索库文档查询API文档' },
  ];
  const match = findBestMcpMatch('查一下 React 的文档', servers);
  assert.ok(match, 'should match context7');
  assert.equal(match.name, 'context7');
});

test('findBestMcpMatch: returns null when no match', () => {
  const servers = [
    { name: 'chrome-devtools', desc: '控制浏览器截图' },
  ];
  const match = findBestMcpMatch('帮我写一首诗', servers);
  assert.equal(match, null, 'poetry has no MCP match');
});

test('findBestMcpMatch: returns null for empty servers', () => {
  assert.equal(findBestMcpMatch('anything', []), null);
});

test('createMcpOutput: outputs plain text with mcp__ instruction', () => {
  const origWrite = process.stdout.write.bind(process.stdout);
  let captured = '';
  process.stdout.write = (s) => { captured += s; return true; };
  try {
    createMcpOutput({ name: 'chrome-devtools', desc: '控制浏览器' });
    // createMcpOutput now outputs plain text (not JSON)
    assert.ok(captured.includes('mcp__chrome-devtools'), 'should include mcp__ prefix');
    assert.ok(captured.includes('[AUTO-ROUTE]'), 'should include AUTO-ROUTE marker');
    assert.ok(captured.includes('强制指令'), 'should include mandatory instruction');
  } finally {
    process.stdout.write = origWrite;
  }
});

// ─── Legacy command routing ──────────────────────────────────────────────────

test('collectAllSkills: includes legacy commands with desc', () => {
  const skills = collectAllSkills(FIXTURE_PROJECT);
  const cmd = skills.find(s => s.name === 'legacy-cmd');
  assert.ok(cmd, 'legacy-cmd should be in pool');
  assert.equal(cmd.type, 'command', 'should be typed as command');
  assert.ok(cmd.desc, 'should have desc from frontmatter');
  assert.ok(cmd.filePath, 'should have filePath for content injection');
});

test('collectAllSkills: skills take priority over same-named legacy commands', () => {
  // 如果 skill 和 command 同名，skill 优先
  const skills = collectAllSkills(FIXTURE_PROJECT);
  const validSkill = skills.find(s => s.name === 'valid-skill');
  if (validSkill) assert.notEqual(validSkill.type, 'command', 'valid-skill should be a skill, not command');
});

test('createCommandOutput: outputs plain text with AUTO-ROUTE marker', () => {
  const origWrite = process.stdout.write.bind(process.stdout);
  let captured = '';
  process.stdout.write = (data) => { captured += data; return true; };
  try {
    const { createCommandOutput } = require('../scripts/route-matcher.cjs');
    createCommandOutput({ name: 'commit', desc: 'Create well-formatted commits', filePath: null });
    // createCommandOutput now outputs plain text (not JSON)
    assert.ok(captured.includes('[AUTO-ROUTE]'), 'should include AUTO-ROUTE marker');
    assert.ok(captured.includes('/commit'), 'should reference /commit');
    assert.ok(captured.includes('强制指令'), 'should include mandatory instruction');
  } finally {
    process.stdout.write = origWrite;
  }
});

test('createCommandOutput: injects file content when filePath provided', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const tmpFile = path.join(os.tmpdir(), 'test-cmd-' + process.pid + '.md');
  fs.writeFileSync(tmpFile, '---\ndescription: test\n---\nDo the thing.\n');
  const origWrite = process.stdout.write.bind(process.stdout);
  let captured = '';
  process.stdout.write = (data) => { captured += data; return true; };
  try {
    const { createCommandOutput } = require('../scripts/route-matcher.cjs');
    createCommandOutput({ name: 'test-cmd', desc: 'test', filePath: tmpFile, type: 'command' });
    // createCommandOutput outputs plain text
    assert.ok(captured.includes('Do the thing.'),
      'should inject file content (frontmatter stripped)');
    assert.ok(!captured.includes('description: test'),
      'should strip frontmatter');
  } finally {
    process.stdout.write = origWrite;
    fs.rmSync(tmpFile, { force: true });
  }
});
