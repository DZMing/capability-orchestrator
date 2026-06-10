'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ── 辅助：创建临时目录，测试后自动清理 ──────────────────────────────────────
function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ── 隔离测试环境，避免 CLAUDE_PLUGIN_DATA 影响单测 ──────────────────────────
function withTmpData(fn) {
  const dir = makeTmpDir('co-scan-cache-');
  const saved = {
    CLAUDE_PLUGIN_DATA: process.env.CLAUDE_PLUGIN_DATA,
    CODEX_PLUGIN_DATA: process.env.CODEX_PLUGIN_DATA,
    CO_DISABLE_CACHE: process.env.CO_DISABLE_CACHE,
  };
  process.env.CLAUDE_PLUGIN_DATA = dir;
  delete process.env.CODEX_PLUGIN_DATA;
  delete process.env.CO_DISABLE_CACHE;
  try {
    return fn(dir);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(dir, { recursive: true, force: true });
    // 清除 require 缓存，避免模块级缓存污染跨测试
    delete require.cache[require.resolve('../scripts/lib/scan-cache.cjs')];
  }
}

// ─────────────────────────────────────────────────────────────────────────────

test('scan-cache: computeFingerprint 同输入同输出（确定性）', () => {
  const { computeFingerprint } = require('../scripts/lib/scan-cache.cjs');
  const dirs = [os.tmpdir(), path.join(os.homedir(), '.claude')];
  const a = computeFingerprint(dirs);
  const b = computeFingerprint(dirs);
  assert.equal(a, b, 'fingerprint 应当确定性相同');
  assert.equal(typeof a, 'string');
});

test('scan-cache: computeFingerprint 不存在的目录返回 mtime=0', () => {
  const { computeFingerprint } = require('../scripts/lib/scan-cache.cjs');
  const fp = computeFingerprint(['/no/such/dir/xyz123']);
  assert.ok(fp.includes(':0'), '不存在目录 mtime 应为 0');
});

test('scan-cache: cache miss 时调用 collectFn', () => {
  withTmpData(() => {
    const { getCachedSkills } = require('../scripts/lib/scan-cache.cjs');
    let calls = 0;
    const skills = [{ name: 'foo', desc: 'bar' }];
    const result = getCachedSkills([], () => { calls++; return skills; });
    assert.equal(calls, 1, '首次 miss 应调用 collectFn');
    assert.deepEqual(result, skills);
  });
});

test('scan-cache: cache hit 时不再调用 collectFn（同 fingerprint）', () => {
  withTmpData(() => {
    const { getCachedSkills, computeFingerprint, getCachePath } = require('../scripts/lib/scan-cache.cjs');
    const skills = [{ name: 'cached-skill', desc: 'test' }];
    // 用专门的 watchDir 做指纹（与 CLAUDE_PLUGIN_DATA 分开，写 cache 不改变它的 mtime）
    const watchDir = makeTmpDir('co-watch-');
    try {
      const dirs = [watchDir];
      const fp = computeFingerprint(dirs);

      // 写入缓存（在 CLAUDE_PLUGIN_DATA 下，不影响 watchDir mtime）
      const cachePath = getCachePath();
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify({ fingerprint: fp, skills }));

      let calls = 0;
      const result = getCachedSkills(dirs, () => { calls++; return []; });
      assert.equal(calls, 0, 'fingerprint 命中不应调用 collectFn');
      assert.deepEqual(result, skills);
    } finally {
      fs.rmSync(watchDir, { recursive: true, force: true });
    }
  });
});

test('scan-cache: 目录 mtime 变化后 fingerprint 不同，缓存失效', () => {
  withTmpData((dir) => {
    const { getCachedSkills, computeFingerprint, getCachePath } = require('../scripts/lib/scan-cache.cjs');
    const dirs = [dir];
    const staleSkills = [{ name: 'stale', desc: '' }];
    const freshSkills = [{ name: 'fresh', desc: '' }];

    // 写入 stale 指纹
    const staleDir = makeTmpDir('co-stale-');
    try {
      const staleFp = computeFingerprint([staleDir]);
      const cachePath = getCachePath();
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify({ fingerprint: staleFp, skills: staleSkills }));

      // 用真实目录（mtime 不同）→ fingerprint 不匹配 → cache miss
      let calls = 0;
      const result = getCachedSkills(dirs, () => { calls++; return freshSkills; });
      assert.equal(calls, 1, 'fingerprint 不同应触发重扫');
      assert.deepEqual(result, freshSkills);
    } finally {
      fs.rmSync(staleDir, { recursive: true, force: true });
    }
  });
});

test('scan-cache: 缓存文件损坏（半截 JSON）→ 降级全扫，不崩溃', () => {
  withTmpData(() => {
    const { getCachedSkills, getCachePath } = require('../scripts/lib/scan-cache.cjs');
    const cachePath = getCachePath();
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, '{"fingerprint":"x","skills":[{truncated');

    let calls = 0;
    const result = getCachedSkills([], () => { calls++; return []; });
    assert.equal(calls, 1, '损坏缓存应降级全扫');
    assert.deepEqual(result, []);
  });
});

test('scan-cache: CO_DISABLE_CACHE=1 绕过缓存，每次调用 collectFn', () => {
  withTmpData(() => {
    process.env.CO_DISABLE_CACHE = '1';
    const { getCachedSkills } = require('../scripts/lib/scan-cache.cjs');
    let calls = 0;
    getCachedSkills([], () => { calls++; return []; });
    getCachedSkills([], () => { calls++; return []; });
    assert.equal(calls, 2, 'CO_DISABLE_CACHE=1 应每次调用 collectFn');
  });
});

test('scan-cache: 目录不可写时仍返回正确结果（不崩溃）', () => {
  withTmpData(() => {
    // 设置一个无法写入的 data 目录路径（指向不存在且无权限创建的路径）
    const impossibleDir = '/no_permission_xyz/co-data';
    process.env.CLAUDE_PLUGIN_DATA = impossibleDir;

    const { getCachedSkills } = require('../scripts/lib/scan-cache.cjs');
    const skills = [{ name: 'x', desc: 'y' }];
    let calls = 0;
    const result = getCachedSkills([], () => { calls++; return skills; });
    assert.equal(calls, 1);
    assert.deepEqual(result, skills, '写入失败不影响返回值');
  });
});

test('scan-cache: getCachePath 返回 CLAUDE_PLUGIN_DATA 下的路径', () => {
  withTmpData((dir) => {
    const { getCachePath } = require('../scripts/lib/scan-cache.cjs');
    const p = getCachePath();
    assert.ok(p.startsWith(dir), 'cache 路径应在 CLAUDE_PLUGIN_DATA 内');
    assert.ok(p.endsWith('scan-cache.json'));
  });
});
