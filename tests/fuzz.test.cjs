'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { sanitize } = require('../scripts/scan-environment.cjs');
const {
  extractKeywords, findBestMatch, passThrough, createOutput, STOP_WORDS,
} = require('../scripts/route-matcher.cjs');

// ─── Random generators (zero dependencies) ─────────────────────────────────

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randAscii(len) {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(randInt(32, 126));
  return s;
}

function randUnicode(len) {
  let s = '';
  for (let i = 0; i < len; i++) {
    const cp = randInt(0, 0xFFFF);
    if (cp >= 0xD800 && cp <= 0xDFFF) { s += '\uFFFD'; continue; }
    s += String.fromCharCode(cp);
  }
  return s;
}

function randCJK(len) {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(randInt(0x4E00, 0x9FFF));
  return s;
}

function randHtmlPayload() {
  const tags = ['script', 'img', 'div', 'style', 'iframe', 'a'];
  const tag = tags[randInt(0, tags.length - 1)];
  return `<${tag} ${randAscii(randInt(0, 20))}>${randAscii(randInt(0, 30))}</${tag}>`;
}

function randMdLink() {
  return `[${randAscii(randInt(1, 20))}](${randAscii(randInt(5, 40))})`;
}

function randMixed(len) {
  const generators = [randAscii, randUnicode, randCJK];
  let s = '';
  while (s.length < len) {
    const gen = generators[randInt(0, generators.length - 1)];
    s += gen(randInt(1, 10));
  }
  return s.slice(0, len);
}

const UNSAFE_UNICODE_RE = /[\u200B\u200C\u200D\uFEFF\u00AD\u2060\u180E\u200E\u200F\u202A-\u202E\u2066-\u2069\u061C\u2061-\u2064\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFF9-\uFFFB]/;

// ─── 3a: sanitize fuzz ─────────────────────────────────────────────────────

test('fuzz sanitize: ASCII inputs (500 iterations)', () => {
  for (let i = 0; i < 500; i++) {
    const input = randAscii(randInt(0, 200));
    const result = sanitize(input);
    assert.ok(typeof result === 'string', `iteration ${i}: not a string`);
    assert.ok(!result.includes('\n'), `iteration ${i}: contains newline`);
    assert.ok(!result.includes('\r'), `iteration ${i}: contains CR`);
    assert.ok(!result.includes('`'), `iteration ${i}: contains backtick`);
    assert.ok(!/<[^>]*>/.test(result), `iteration ${i}: contains HTML tag`);
    assert.ok(!UNSAFE_UNICODE_RE.test(result), `iteration ${i}: contains unsafe unicode`);
  }
});

test('fuzz sanitize: Unicode inputs (500 iterations)', () => {
  for (let i = 0; i < 500; i++) {
    const input = randUnicode(randInt(0, 200));
    const result = sanitize(input);
    assert.ok(typeof result === 'string', `iteration ${i}: not a string`);
    assert.ok(!result.includes('\n'), `iteration ${i}: contains newline`);
    assert.ok(!result.includes('\r'), `iteration ${i}: contains CR`);
    assert.ok(!result.includes('`'), `iteration ${i}: contains backtick`);
    assert.ok(!UNSAFE_UNICODE_RE.test(result), `iteration ${i}: contains unsafe unicode`);
  }
});

test('fuzz sanitize: structured payloads (500 iterations)', () => {
  for (let i = 0; i < 500; i++) {
    const parts = [];
    for (let j = 0; j < randInt(1, 5); j++) {
      const r = randInt(0, 2);
      if (r === 0) parts.push(randHtmlPayload());
      else if (r === 1) parts.push(randMdLink());
      else parts.push(randAscii(randInt(1, 30)));
    }
    const input = parts.join(' ');
    const result = sanitize(input);
    assert.ok(typeof result === 'string', `iteration ${i}: not a string`);
    assert.ok(!result.includes('\n'), `iteration ${i}: contains newline`);
    assert.ok(!result.includes('`'), `iteration ${i}: contains backtick`);
    assert.ok(!/<[^>]*>/.test(result), `iteration ${i}: contains HTML tag`);
  }
});

test('fuzz sanitize: idempotency (300 iterations)', () => {
  for (let i = 0; i < 300; i++) {
    const input = randMixed(randInt(0, 150));
    const once = sanitize(input);
    const twice = sanitize(once);
    assert.equal(once, twice, `iteration ${i}: sanitize not idempotent`);
  }
});

// ─── 3b: extractKeywords fuzz ───────────────────────────────────────────────

test('fuzz extractKeywords: ASCII inputs (300 iterations)', () => {
  for (let i = 0; i < 300; i++) {
    const input = randAscii(randInt(0, 100));
    const kw = extractKeywords(input);
    assert.ok(Array.isArray(kw), `iteration ${i}: not an array`);
    for (const k of kw) {
      assert.ok(typeof k === 'string', `iteration ${i}: keyword not string`);
      assert.ok(k.length > 0, `iteration ${i}: empty keyword`);
    }
    assert.equal(kw.length, new Set(kw).size, `iteration ${i}: duplicates found`);
  }
});

test('fuzz extractKeywords: CJK inputs (300 iterations)', () => {
  for (let i = 0; i < 300; i++) {
    const input = randCJK(randInt(1, 30));
    const kw = extractKeywords(input);
    assert.ok(Array.isArray(kw), `iteration ${i}: not an array`);
    for (const k of kw) {
      assert.ok(typeof k === 'string' && k.length > 0, `iteration ${i}: bad keyword`);
    }
    assert.equal(kw.length, new Set(kw).size, `iteration ${i}: duplicates`);
  }
});

test('fuzz extractKeywords: mixed inputs (300 iterations)', () => {
  for (let i = 0; i < 300; i++) {
    const input = randMixed(randInt(0, 80));
    const kw = extractKeywords(input);
    assert.ok(Array.isArray(kw), `iteration ${i}: not an array`);
    assert.equal(kw.length, new Set(kw).size, `iteration ${i}: duplicates`);
  }
});

test('fuzz extractKeywords: stability (200 iterations)', () => {
  for (let i = 0; i < 200; i++) {
    const input = randMixed(randInt(5, 50));
    const kw1 = extractKeywords(input);
    const kw2 = extractKeywords(input);
    assert.deepEqual(kw1, kw2, `iteration ${i}: unstable results`);
  }
});

test('fuzz extractKeywords: NFC normalization (200 iterations)', () => {
  for (let i = 0; i < 200; i++) {
    const input = randMixed(randInt(5, 50));
    const kwRaw = extractKeywords(input);
    const kwNfc = extractKeywords(input.normalize('NFC'));
    assert.deepEqual(kwRaw, kwNfc, `iteration ${i}: NFC divergence`);
  }
});

test('fuzz extractKeywords: edge inputs', () => {
  assert.deepEqual(extractKeywords(null), []);
  assert.deepEqual(extractKeywords(undefined), []);
  assert.deepEqual(extractKeywords(''), []);
  assert.deepEqual(extractKeywords(42), []);
  assert.ok(Array.isArray(extractKeywords('   ')));
  assert.ok(Array.isArray(extractKeywords('\n\t\r')));
});

// ─── 3c: passThrough & createOutput fuzz ─────────────────────────────────��──

test('fuzz passThrough: always valid JSON with continue:true (100 iterations)', () => {
  const origWrite = process.stdout.write;
  try {
    for (let i = 0; i < 100; i++) {
      let captured = '';
      process.stdout.write = (s) => { captured += s; return true; };
      passThrough();
      const parsed = JSON.parse(captured.trim());
      assert.equal(parsed.continue, true, `iteration ${i}: continue not true`);
    }
  } finally {
    process.stdout.write = origWrite;
  }
});

test('fuzz createOutput: always valid JSON for random inputs (300 iterations)', () => {
  const origWrite = process.stdout.write;
  try {
    for (let i = 0; i < 300; i++) {
      let captured = '';
      process.stdout.write = (s) => { captured += s; return true; };
      const name = randMixed(randInt(1, 30));
      const desc = randMixed(randInt(0, 100));
      createOutput({ name, desc });
      const parsed = JSON.parse(captured.trim());
      assert.equal(parsed.continue, true, `iteration ${i}: continue not true`);
      assert.ok(parsed.hookSpecificOutput, `iteration ${i}: missing hookSpecificOutput`);
      assert.ok(parsed.hookSpecificOutput.additionalContext, `iteration ${i}: missing additionalContext`);
    }
  } finally {
    process.stdout.write = origWrite;
  }
});

// ─── 3d: findBestMatch property tests ───────────────────────────────────────

test('fuzz findBestMatch: null for empty skills (100 iterations)', () => {
  for (let i = 0; i < 100; i++) {
    const prompt = randMixed(randInt(10, 50));
    assert.equal(findBestMatch(prompt, []), null, `iteration ${i}`);
  }
});

test('fuzz findBestMatch: null for empty prompt', () => {
  const skills = [{ name: 'test', desc: 'test something useful' }];
  assert.equal(findBestMatch('', skills), null);
  assert.equal(findBestMatch(null, skills), null);
});

test('fuzz findBestMatch: confidence in [0,1] when match found (200 iterations)', () => {
  for (let i = 0; i < 200; i++) {
    const word1 = 'alpha' + randInt(0, 99);
    const word2 = 'beta' + randInt(0, 99);
    const skills = [{ name: 'sk', desc: `${word1} ${word2} tool helper utility` }];
    const prompt = `please use ${word1} and ${word2} for my project`;
    const match = findBestMatch(prompt, skills);
    if (match) {
      assert.ok(match.confidence >= 0, `iteration ${i}: confidence < 0`);
      assert.ok(match.confidence <= 1, `iteration ${i}: confidence > 1`);
    }
  }
});

test('fuzz findBestMatch: returned skill exists in input array (200 iterations)', () => {
  for (let i = 0; i < 200; i++) {
    const skills = Array.from({ length: randInt(1, 10) }, (_, j) => ({
      name: `skill-${j}`,
      desc: randMixed(randInt(10, 40)),
    }));
    const prompt = randMixed(randInt(15, 60));
    const match = findBestMatch(prompt, skills);
    if (match) {
      assert.ok(skills.some(s => s.name === match.name), `iteration ${i}: returned skill not in input`);
    }
  }
});

test('fuzz findBestMatch: exact desc match has >= confidence of partial', () => {
  for (let i = 0; i < 100; i++) {
    const desc = `analyze data reports metrics dashboard visualization`;
    const skills = [{ name: 'analytics', desc }];
    const exact = findBestMatch(desc, skills);
    const partial = findBestMatch('analyze data', skills);
    if (exact && partial) {
      assert.ok(exact.confidence >= partial.confidence,
        `iteration ${i}: exact ${exact.confidence} < partial ${partial.confidence}`);
    }
  }
});
